import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { buildWeekForecast } from '@/lib/forecast'
import { generateWeekPlan, UserContext } from '@/lib/planner'
import { findRecipe } from '@/lib/spoonacular'
import pool from '@/lib/db'

export const POST = requireAuth(async (_req: NextRequest, userId: string) => {
  const client = await pool.connect()
  try {
    // Load user profile + preferences
    const profileRes = await client.query(
      `SELECT p.nutrition_goal, p.diet_type, p.household_size, p.weight_kg, p.height_cm, p.time_constraints
       FROM user_profiles p WHERE p.user_id = $1`,
      [userId]
    )
    if (profileRes.rows.length === 0) {
      return NextResponse.json({ error: 'Profil nicht gefunden' }, { status: 404 })
    }
    const profile = profileRes.rows[0]

    const prefsRes = await client.query(
      'SELECT item_name, preference_type FROM food_preferences WHERE user_id = $1',
      [userId]
    )

    const userContext: UserContext = {
      nutritionGoal: profile.nutrition_goal || 'maintain',
      dietType: profile.diet_type || 'all',
      householdSize: profile.household_size || 3,
      weightKg: profile.weight_kg ? parseFloat(profile.weight_kg) : null,
      heightCm: profile.height_cm,
      preferences: prefsRes.rows.map(r => ({ item: r.item_name, type: r.preference_type })),
      timeConstraints: profile.time_constraints || {},
    }

    // Build training forecast
    const forecast = await buildWeekForecast(userId)

    // Generate meal plan via Claude
    const weekPlan = await generateWeekPlan(forecast, userContext)

    // Save plan to DB (upsert)
    const planRes = await client.query(
      `INSERT INTO weekly_plans (user_id, week_start, training_forecast, generation_notes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, week_start) DO UPDATE
         SET training_forecast = $3, generation_notes = $4, updated_at = NOW()
       RETURNING id`,
      [
        userId,
        forecast.weekStart,
        JSON.stringify(forecast),
        `Wochenlast: ${forecast.weeklyLoadLevel}, Trainingstage: ${forecast.trainingDays}`,
      ]
    )
    const planId = planRes.rows[0].id

    // Delete existing meals for this plan
    await client.query('DELETE FROM plan_meals WHERE plan_id = $1', [planId])

    // Save each meal + enrich with Spoonacular if available
    for (const day of weekPlan) {
      for (const meal of day.meals) {
        // Try Spoonacular enrichment
        let spoonacularData = null
        try {
          spoonacularData = await findRecipe(
            meal.spoonacularQuery,
            userContext.dietType,
            meal.calories,
            meal.isTogo
          )
        } catch { /* Spoonacular optional */ }

        const recipeData = spoonacularData ? {
          title: spoonacularData.title,
          imageUrl: spoonacularData.imageUrl,
          prepMinutes: spoonacularData.prepMinutes,
          ingredients: spoonacularData.ingredients,
          instructions: spoonacularData.instructions,
          nutrients: {
            calories: spoonacularData.calories,
            protein: spoonacularData.proteinG,
            carbs: spoonacularData.carbsG,
            fat: spoonacularData.fatG,
          },
        } : {
          title: meal.title,
          imageUrl: null,
          prepMinutes: meal.prepMinutes,
          ingredients: meal.ingredients,
          instructions: meal.instructions,
          nutrients: {
            calories: meal.calories,
            protein: meal.proteinG,
            carbs: meal.carbsG,
            fat: meal.fatG,
          },
        }

        await client.query(
          `INSERT INTO plan_meals
             (plan_id, meal_date, meal_type, recipe_id, recipe_source, recipe_data, serving_size, is_togo)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            planId,
            day.day + 'T00:00:00Z',  // Explicit UTC to prevent timezone shift
            meal.mealType,
            spoonacularData?.spoonacularId || null,
            spoonacularData ? 'spoonacular' : 'ai_generated',
            JSON.stringify(recipeData),
            userContext.householdSize,
            meal.isTogo,
          ]
        )
      }
    }

    // Return full plan
    const mealsRes = await client.query(
      `SELECT id, TO_CHAR(meal_date, 'YYYY-MM-DD') as meal_date, meal_type,
              recipe_data, serving_size, is_togo, is_eaten, eaten_at
       FROM plan_meals WHERE plan_id = $1 ORDER BY meal_date, meal_type`,
      [planId]
    )

    return NextResponse.json({
      id: planId,
      week_start: forecast.weekStart,
      training_forecast: forecast,
      meals: mealsRes.rows,
    }, { status: 201 })
  } finally {
    client.release()
  }
})
