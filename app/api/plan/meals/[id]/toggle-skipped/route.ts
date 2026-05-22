import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import pool from '@/lib/db'

export const PUT = requireAuth(async (req: NextRequest, userId: string) => {
  const segments = req.nextUrl.pathname.split('/')
  const id = segments[segments.indexOf('meals') + 1]

  if (!id) {
    return NextResponse.json({ error: 'Mahlzeit-ID fehlt' }, { status: 400 })
  }

  const client = await pool.connect()
  try {
    const res = await client.query(
      `UPDATE plan_meals pm
       SET skipped = NOT pm.skipped
       FROM weekly_plans wp
       WHERE pm.id = $1
         AND pm.plan_id = wp.id
         AND wp.user_id = $2
       RETURNING pm.skipped`,
      [id, userId]
    )

    if (res.rows.length === 0) {
      return NextResponse.json({ error: 'Mahlzeit nicht gefunden' }, { status: 404 })
    }

    return NextResponse.json({ skipped: res.rows[0].skipped })
  } finally {
    client.release()
  }
})
