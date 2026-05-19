import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { getRequestToken } from '@/lib/garmin'
import pool from '@/lib/db'

export const GET = requireAuth(async (_req: NextRequest, userId: string) => {
  const { token, tokenSecret, authUrl } = await getRequestToken()

  // Store request token temporarily (expires in 10 min)
  await pool.query(
    `INSERT INTO garmin_connections (user_id, oauth_token, oauth_token_secret, sync_status)
     VALUES ($1, $2, $3, 'pending')
     ON CONFLICT (user_id) DO UPDATE SET oauth_token = $2, oauth_token_secret = $3, sync_status = 'pending', updated_at = NOW()`,
    [userId, token, tokenSecret]
  )

  return NextResponse.json({ authUrl })
})
