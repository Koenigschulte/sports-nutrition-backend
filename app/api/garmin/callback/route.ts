import { NextRequest, NextResponse } from 'next/server'
import { getAccessToken } from '@/lib/garmin'
import { verifyToken, getTokenFromHeader } from '@/lib/auth'
import pool from '@/lib/db'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const oauthToken = searchParams.get('oauth_token')
  const oauthVerifier = searchParams.get('oauth_verifier')
  // JWT passed as state param from app
  const jwtToken = searchParams.get('state')

  if (!oauthToken || !oauthVerifier || !jwtToken) {
    return NextResponse.json({ error: 'Fehlende Parameter' }, { status: 400 })
  }

  let userId: string
  try {
    const payload = verifyToken(jwtToken)
    userId = payload.userId
  } catch {
    return NextResponse.json({ error: 'Ungültiger Token' }, { status: 401 })
  }

  const client = await pool.connect()
  try {
    const conn = await client.query(
      'SELECT oauth_token_secret FROM garmin_connections WHERE user_id = $1',
      [userId]
    )
    if (conn.rows.length === 0) {
      return NextResponse.json({ error: 'Keine ausstehende Garmin-Verbindung' }, { status: 400 })
    }

    const requestTokenSecret = conn.rows[0].oauth_token_secret
    const { accessToken, accessTokenSecret } = await getAccessToken(oauthToken, requestTokenSecret, oauthVerifier)

    await client.query(
      `UPDATE garmin_connections
       SET oauth_token = $1, oauth_token_secret = $2, sync_status = 'success', updated_at = NOW()
       WHERE user_id = $3`,
      [accessToken, accessTokenSecret, userId]
    )

    // Return success — app handles redirect
    return NextResponse.json({ success: true, message: 'Garmin erfolgreich verbunden' })
  } finally {
    client.release()
  }
}
