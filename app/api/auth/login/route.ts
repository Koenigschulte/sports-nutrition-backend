import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import pool from '@/lib/db'
import { comparePassword, signToken } from '@/lib/auth'

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Ungültiges JSON' }, { status: 400 })
  }

  const parsed = LoginSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'E-Mail und Passwort erforderlich' }, { status: 400 })
  }

  const { email, password } = parsed.data

  const client = await pool.connect()
  try {
    const result = await client.query(
      'SELECT id, email, name, password_hash FROM users WHERE email = $1',
      [email.toLowerCase()]
    )

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'E-Mail oder Passwort falsch' }, { status: 401 })
    }

    const user = result.rows[0]
    const valid = await comparePassword(password, user.password_hash)

    if (!valid) {
      return NextResponse.json({ error: 'E-Mail oder Passwort falsch' }, { status: 401 })
    }

    const token = signToken({ userId: user.id, email: user.email })

    return NextResponse.json({ token, user: { id: user.id, email: user.email, name: user.name } })
  } finally {
    client.release()
  }
}
