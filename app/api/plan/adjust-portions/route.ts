import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import pool from '@/lib/db'

const MIN_DELTA_KCAL = 200   // Nur anpassen wenn Unterschied > 200 kcal
const REPLACEMENT_FACTOR = 0.8  // 80% der Extra-Kalorien werden gegessen
const MIN_SERVING = 0.6
const MAX_SERVING = 2.0

function todayBerlin(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
}

export const POST = requireAuth(async (_req: NextRequest, userId: string) => {
  const client = await pool.connect()
  try {
    const today = todayBerlin()

    // 1. Plan und gespeicherten Forecast laden
    const planRes = await client.query(
      `SELECT wp.id, wp.training_forecast
       FROM weekly_plans wp
       WHERE wp.user_id = $1
       ORDER BY wp.week_start DESC LIMIT 1`,
      [userId]
    )
    if (planRes.rows.length === 0) {
      return NextResponse.json({ adjusted: false, reason: 'Kein Plan gefunden' })
    }

    const planId = planRes.rows[0].id
    const forecast = planRes.rows[0].training_forecast as {
      days?: Array<{ date: string; estimatedCalories: number; hasTraining: boolean }>
    }

    // Geplante Kalorien für heute aus gespeichertem Forecast
    const forecastDay = forecast?.days?.find(d => d.date === today)
    const plannedCalories = forecastDay?.estimatedCalories ?? 0

    // 2. Tatsächliche Kalorien heute aus activity_history
    const actRes = await client.query(
      `SELECT COALESCE(SUM(calories_burned), 0) as actual_calories
       FROM activity_history
       WHERE user_id = $1
         AND (activity_date AT TIME ZONE 'Europe/Berlin')::date = $2::date`,
      [userId, today]
    )
    const actualCalories = Number(actRes.rows[0].actual_calories)

    const delta = actualCalories - plannedCalories

    // Nicht anpassen wenn Unterschied zu klein
    if (Math.abs(delta) < MIN_DELTA_KCAL) {
      return NextResponse.json({
        adjusted: false,
        reason: `Delta ${delta} kcal unter Schwellwert (${MIN_DELTA_KCAL} kcal)`,
        plannedCalories,
        actualCalories,
        delta,
      })
    }

    // 3. Noch nicht gegessene Mahlzeiten heute laden
    const mealsRes = await client.query(
      `SELECT id, recipe_data
       FROM plan_meals
       WHERE plan_id = $1
         AND meal_date::date = $2::date
         AND is_eaten = false
         AND skipped = false`,
      [planId, today]
    )

    if (mealsRes.rows.length === 0) {
      return NextResponse.json({ adjusted: false, reason: 'Keine ausstehenden Mahlzeiten heute' })
    }

    // 4. Skalierungsfaktor berechnen
    const remainingCalories = mealsRes.rows.reduce((sum: number, m: { recipe_data: { nutrients?: { calories?: number } } }) => {
      const cals = (m.recipe_data?.nutrients?.calories as number) ?? 0
      return sum + cals
    }, 0)

    if (remainingCalories === 0) {
      return NextResponse.json({ adjusted: false, reason: 'Keine Kalorien in verbleibenden Mahlzeiten' })
    }

    const extraCalories = delta * REPLACEMENT_FACTOR
    const scalingFactor = Math.min(
      MAX_SERVING,
      Math.max(MIN_SERVING, (remainingCalories + extraCalories) / remainingCalories)
    )

    // 5. serving_size für alle verbleibenden Mahlzeiten aktualisieren
    const mealIds = mealsRes.rows.map((m: { id: string }) => m.id)
    await client.query(
      `UPDATE plan_meals SET serving_size = $1 WHERE id = ANY($2::uuid[])`,
      [scalingFactor, mealIds]
    )

    return NextResponse.json({
      adjusted: true,
      plannedCalories,
      actualCalories,
      delta: Math.round(delta),
      scalingFactor: Math.round(scalingFactor * 100) / 100,
      mealsAdjusted: mealIds.length,
    })
  } finally {
    client.release()
  }
})
