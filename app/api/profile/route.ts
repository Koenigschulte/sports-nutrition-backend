import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/middleware'
import pool from '@/lib/db'

const NUTRITION_GOALS = ['lose_weight', 'gain_weight', 'maintain', 'muscle_gain', 'performance'] as const
const DIET_TYPES = ['all', 'vegetarian', 'vegan'] as const
const GENDERS = ['male', 'female', 'other'] as const

const ProfileUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  birthYear: z.number().int().min(1900).max(2015).optional(),
  gender: z.enum(GENDERS).optional(),
  weightKg: z.number().positive().optional(),
  heightCm: z.number().int().positive().optional(),
  nutritionGoal: z.enum(NUTRITION_GOALS).optional(),
  dietType: z.enum(DIET_TYPES).optional(),
  householdSize: z.number().int().min(1).max(20).optional(),
  timeConstraints: z.record(z.string(), z.unknown()).optional(),
})

export const GET = requireAuth(async (_req: NextRequest, userId: string) => {
  const client = await pool.connect()
  try {
    const result = await client.query(
      `SELECT u.id, u.email, u.name, u.created_at,
              p.birth_year, p.gender, p.weight_kg, p.height_cm, p.body_fat_percent,
              p.nutrition_goal, p.diet_type, p.household_size, p.time_constraints,
              gc.sync_status as garmin_sync_status, gc.last_sync_at as garmin_last_sync,
              sc.sync_status as strava_sync_status, sc.last_sync_at as strava_last_sync,
              sc.athlete_name as strava_athlete_name
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       LEFT JOIN garmin_connections gc ON gc.user_id = u.id
       LEFT JOIN strava_connections sc ON sc.user_id = u.id
       WHERE u.id = $1`,
      [userId]
    )

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Nutzer nicht gefunden' }, { status: 404 })
    }

    const row = result.rows[0]
    return NextResponse.json({
      id: row.id,
      email: row.email,
      name: row.name,
      createdAt: row.created_at,
      profile: {
        birthYear: row.birth_year,
        gender: row.gender,
        weightKg: row.weight_kg ? parseFloat(row.weight_kg) : null,
        heightCm: row.height_cm,
        bodyFatPercent: row.body_fat_percent ? parseFloat(row.body_fat_percent) : null,
        nutritionGoal: row.nutrition_goal,
        dietType: row.diet_type,
        householdSize: row.household_size,
        timeConstraints: row.time_constraints || {},
      },
      garmin: {
        syncStatus: row.garmin_sync_status || 'not_connected',
        lastSyncAt: row.garmin_last_sync,
      },
      strava: {
        syncStatus: row.strava_sync_status || 'not_connected',
        lastSyncAt: row.strava_last_sync,
        athleteName: row.strava_athlete_name || null,
      },
    })
  } finally {
    client.release()
  }
})

export const PUT = requireAuth(async (req: NextRequest, userId: string) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Ungültiges JSON' }, { status: 400 })
  }

  const parsed = ProfileUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const data = parsed.data
  const client = await pool.connect()
  try {
    if (data.name) {
      await client.query('UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2', [data.name, userId])
    }

    const profileFields: string[] = []
    const profileValues: unknown[] = []
    let idx = 1

    const fieldMap: Record<string, string> = {
      birthYear: 'birth_year',
      gender: 'gender',
      weightKg: 'weight_kg',
      heightCm: 'height_cm',
      nutritionGoal: 'nutrition_goal',
      dietType: 'diet_type',
      householdSize: 'household_size',
      timeConstraints: 'time_constraints',
    }

    for (const [key, column] of Object.entries(fieldMap)) {
      const value = data[key as keyof typeof data]
      if (value !== undefined) {
        profileFields.push(`${column} = $${idx}`)
        profileValues.push(key === 'timeConstraints' ? JSON.stringify(value) : value)
        idx++
      }
    }

    if (profileFields.length > 0) {
      profileValues.push(userId)
      await client.query(
        `UPDATE user_profiles SET ${profileFields.join(', ')}, updated_at = NOW() WHERE user_id = $${idx}`,
        profileValues
      )
    }

    return NextResponse.json({ success: true })
  } finally {
    client.release()
  }
})
