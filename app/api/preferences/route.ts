import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/middleware'
import pool from '@/lib/db'

const PREFERENCE_TYPES = ['like', 'dislike', 'allergy', 'intolerance'] as const

const AddSchema = z.object({
  itemName: z.string().min(1).max(100),
  preferenceType: z.enum(PREFERENCE_TYPES),
})

// GET /api/preferences — list all preferences
export const GET = requireAuth(async (_req: NextRequest, userId: string) => {
  const client = await pool.connect()
  try {
    const res = await client.query(
      `SELECT id, item_name, preference_type, created_at
       FROM food_preferences WHERE user_id = $1 ORDER BY preference_type, item_name`,
      [userId]
    )
    return NextResponse.json({
      preferences: res.rows.map(r => ({
        id: r.id,
        itemName: r.item_name,
        preferenceType: r.preference_type,
        createdAt: r.created_at,
      }))
    })
  } finally {
    client.release()
  }
})

// POST /api/preferences — add new preference
export const POST = requireAuth(async (req: NextRequest, userId: string) => {
  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Ungültiges JSON' }, { status: 400 })
  }

  const parsed = AddSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { itemName, preferenceType } = parsed.data
  const client = await pool.connect()
  try {
    // Upsert: same item can't be in two categories
    await client.query(
      `DELETE FROM food_preferences WHERE user_id = $1 AND item_name = $2`,
      [userId, itemName]
    )
    const res = await client.query(
      `INSERT INTO food_preferences (user_id, item_name, preference_type)
       VALUES ($1, $2, $3) RETURNING id, item_name, preference_type`,
      [userId, itemName, preferenceType]
    )
    return NextResponse.json({ preference: { id: res.rows[0].id, itemName: res.rows[0].item_name, preferenceType: res.rows[0].preference_type } }, { status: 201 })
  } finally {
    client.release()
  }
})

// DELETE /api/preferences?id=xxx
export const DELETE = requireAuth(async (req: NextRequest, userId: string) => {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id fehlt' }, { status: 400 })

  const client = await pool.connect()
  try {
    await client.query(
      `DELETE FROM food_preferences WHERE id = $1 AND user_id = $2`,
      [id, userId]
    )
    return NextResponse.json({ success: true })
  } finally {
    client.release()
  }
})
