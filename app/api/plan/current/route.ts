import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { buildWeekForecast } from '@/lib/forecast'
import pool from '@/lib/db'

/** Aktuellen Montag als YYYY-MM-DD (lokale Serverzeit) */
function currentMondayStr(): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const offset = (today.getDay() + 6) % 7  // 0=Mo, 6=So
  today.setDate(today.getDate() - offset)
  const y = today.getFullYear()
  const m = String(today.getMonth() + 1).padStart(2, '0')
  const d = String(today.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export const GET = requireAuth(async (_req: NextRequest, userId: string) => {
  const client = await pool.connect()
  try {
    // Nur Plan der AKTUELLEN Woche zurückgeben
    const weekStart = currentMondayStr()
    const planRes = await client.query(
      `SELECT wp.id, TO_CHAR(wp.week_start, 'YYYY-MM-DD') as week_start,
              wp.generation_notes
       FROM weekly_plans wp
       WHERE wp.user_id = $1
         AND wp.week_start = $2`,
      [userId, weekStart]
    )

    if (planRes.rows.length === 0) {
      return NextResponse.json(null)
    }

    const plan = planRes.rows[0]

    // Forecast IMMER frisch berechnen — zeigt aktuelle Strava-Aktivitäten dieser Woche
    const freshForecast = await buildWeekForecast(userId)

    // alternatives-Spalte könnte bei älteren DBs fehlen → Fallback ohne alternatives_count
    let mealsRes
    try {
      mealsRes = await client.query(
        `SELECT id, TO_CHAR(meal_date, 'YYYY-MM-DD') as meal_date, meal_type,
                recipe_data, serving_size, is_togo, skipped, is_eaten, eaten_at,
                jsonb_array_length(COALESCE(alternatives, '[]'::jsonb)) as alternatives_count
         FROM plan_meals
         WHERE plan_id = $1
         ORDER BY meal_date, CASE meal_type
           WHEN 'breakfast' THEN 1
           WHEN 'lunch' THEN 2
           WHEN 'dinner' THEN 3
           ELSE 4 END`,
        [plan.id]
      )
    } catch {
      // alternatives-Spalte existiert noch nicht → ohne alternatives_count abfragen
      mealsRes = await client.query(
        `SELECT id, TO_CHAR(meal_date, 'YYYY-MM-DD') as meal_date, meal_type,
                recipe_data, serving_size, is_togo, skipped, is_eaten, eaten_at,
                0 as alternatives_count
         FROM plan_meals
         WHERE plan_id = $1
         ORDER BY meal_date, CASE meal_type
           WHEN 'breakfast' THEN 1
           WHEN 'lunch' THEN 2
           WHEN 'dinner' THEN 3
           ELSE 4 END`,
        [plan.id]
      )
    }

    return NextResponse.json({
      id: plan.id,
      week_start: plan.week_start,
      training_forecast: freshForecast,
      generation_notes: plan.generation_notes,
      meals: mealsRes.rows,
    })
  } finally {
    client.release()
  }
})
