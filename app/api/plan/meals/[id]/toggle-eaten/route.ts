import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import pool from '@/lib/db'

export const PUT = requireAuth(async (req: NextRequest, userId: string) => {
  // Extract meal id from URL: /api/plan/meals/{id}/toggle-eaten
  const segments = req.nextUrl.pathname.split('/')
  const id = segments[segments.indexOf('meals') + 1]

  if (!id) {
    return NextResponse.json({ error: 'Mahlzeit-ID fehlt' }, { status: 400 })
  }

  const client = await pool.connect()
  try {
    // Toggle is_eaten — only for meals belonging to this user's plans
    const res = await client.query(
      `UPDATE plan_meals pm
       SET
         is_eaten = NOT pm.is_eaten,
         eaten_at = CASE WHEN NOT pm.is_eaten THEN NOW() ELSE NULL END
       FROM weekly_plans wp
       WHERE pm.id = $1
         AND pm.plan_id = wp.id
         AND wp.user_id = $2
       RETURNING pm.is_eaten, pm.eaten_at`,
      [id, userId]
    )

    if (res.rows.length === 0) {
      return NextResponse.json({ error: 'Mahlzeit nicht gefunden' }, { status: 404 })
    }

    const { is_eaten, eaten_at } = res.rows[0]
    return NextResponse.json({ is_eaten, eaten_at })
  } finally {
    client.release()
  }
})
