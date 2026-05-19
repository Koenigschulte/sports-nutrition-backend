import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import pool from '@/lib/db'
import { generateAlternativeRecipe } from '@/lib/planner'

const MAX_ALTERNATIVES = 10

export const POST = requireAuth(async (req: NextRequest, userId: string) => {
  const segments = req.nextUrl.pathname.split('/')
  const id = segments[segments.indexOf('meals') + 1]
  const direction = req.nextUrl.searchParams.get('direction') ?? 'next'

  if (!id) {
    return NextResponse.json({ error: 'Mahlzeit-ID fehlt' }, { status: 400 })
  }

  const client = await pool.connect()
  try {
    // Verify ownership and load meal data
    const mealRes = await client.query(
      `SELECT pm.id, pm.recipe_data, pm.alternatives, pm.meal_type, pm.is_togo
       FROM plan_meals pm
       JOIN weekly_plans wp ON pm.plan_id = wp.id
       WHERE pm.id = $1 AND wp.user_id = $2`,
      [id, userId]
    )

    if (mealRes.rows.length === 0) {
      return NextResponse.json({ error: 'Mahlzeit nicht gefunden' }, { status: 404 })
    }

    const meal = mealRes.rows[0]
    const currentRecipe = meal.recipe_data as Record<string, unknown>
    const alternatives: Record<string, unknown>[] = meal.alternatives ?? []

    let newRecipe: Record<string, unknown>
    let updatedAlternatives: Record<string, unknown>[]

    if (direction === 'prev') {
      if (alternatives.length === 0) {
        return NextResponse.json({ error: 'Keine vorherige Alternative' }, { status: 400 })
      }
      updatedAlternatives = [...alternatives]
      newRecipe = updatedAlternatives.pop()!
    } else {
      // Load user context for Gemini prompt
      const profileRes = await client.query(
        `SELECT up.diet_type, up.household_size
         FROM user_profiles up WHERE up.user_id = $1`,
        [userId]
      )
      const profile = profileRes.rows[0] ?? { diet_type: 'all', household_size: 1 }

      const prefRes = await client.query(
        `SELECT item_name FROM food_preferences
         WHERE user_id = $1 AND preference_type IN ('dislike', 'allergy', 'intolerance')`,
        [userId]
      )
      const dislikes = prefRes.rows.map((r: { item_name: string }) => r.item_name)

      const nutrients = (currentRecipe.nutrients as Record<string, number>) ?? {}
      const targetCalories = (nutrients.calories as number) ?? 500
      const targetProteinG = (nutrients.protein as number) ?? 30

      const generated = await generateAlternativeRecipe({
        currentTitle: (currentRecipe.title as string) ?? '',
        mealType: meal.meal_type as string,
        isTogo: meal.is_togo as boolean,
        dietType: profile.diet_type as string,
        householdSize: profile.household_size as number,
        dislikes,
        targetCalories,
        targetProteinG,
      })

      newRecipe = generated as unknown as Record<string, unknown>

      // Push current recipe onto alternatives stack (cap at MAX_ALTERNATIVES)
      updatedAlternatives = [...alternatives, currentRecipe].slice(-MAX_ALTERNATIVES)
    }

    await client.query(
      `UPDATE plan_meals
       SET recipe_data = $1, alternatives = $2
       WHERE id = $3`,
      [JSON.stringify(newRecipe), JSON.stringify(updatedAlternatives), id]
    )

    return NextResponse.json({
      recipe_data: newRecipe,
      alternatives_count: updatedAlternatives.length,
    })
  } finally {
    client.release()
  }
})
