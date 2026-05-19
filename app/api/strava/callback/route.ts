import { NextRequest, NextResponse } from 'next/server'
import { exchangeCode } from '@/lib/strava'
import pool from '@/lib/db'

// Public endpoint — called by Strava after user authorizes
// URL: /api/strava/callback?code=xxx&state=<userId>&scope=activity:read_all
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code = searchParams.get('code')
  const state = searchParams.get('state')  // userId passed during connect
  const error = searchParams.get('error')

  if (error) {
    return htmlResponse('❌ Verbindung abgebrochen', 'Du hast die Verbindung mit Strava abgebrochen. Schließe dieses Fenster und versuche es erneut.', false)
  }

  if (!code || !state) {
    return htmlResponse('❌ Fehler', 'Ungültige Anfrage — fehlende Parameter.', false)
  }

  const userId = state

  try {
    // Exchange auth code for tokens
    const tokens = await exchangeCode(code)

    const athleteName = tokens.athlete
      ? `${tokens.athlete.firstname} ${tokens.athlete.lastname}`
      : null

    const client = await pool.connect()
    try {
      await client.query(
        `INSERT INTO strava_connections
           (user_id, access_token, refresh_token, expires_at, strava_athlete_id, athlete_name, connected_at, sync_status)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'connected')
         ON CONFLICT (user_id) DO UPDATE SET
           access_token = $2,
           refresh_token = $3,
           expires_at = $4,
           strava_athlete_id = $5,
           athlete_name = $6,
           connected_at = NOW(),
           sync_status = 'connected'`,
        [
          userId,
          tokens.access_token,
          tokens.refresh_token,
          tokens.expires_at,
          tokens.athlete?.id || null,
          athleteName,
        ]
      )
    } finally {
      client.release()
    }

    const name = athleteName ? ` als ${athleteName}` : ''
    return htmlResponse(
      '✅ Strava verbunden!',
      `Dein Strava-Account ist jetzt${name} mit der Sports Nutrition App verbunden. Du kannst dieses Fenster schließen und in der App auf "Aktivitäten synchronisieren" tippen.`,
      true
    )
  } catch (e) {
    console.error('Strava callback error:', e)
    return htmlResponse('❌ Fehler', 'Verbindung konnte nicht hergestellt werden. Bitte versuche es erneut.', false)
  }
}

function htmlResponse(title: string, message: string, success: boolean): NextResponse {
  const color = success ? '#4CAF50' : '#f44336'
  const html = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
    .card { background: white; border-radius: 16px; padding: 40px; max-width: 400px; text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
    .icon { font-size: 64px; margin-bottom: 16px; }
    h1 { color: ${color}; font-size: 24px; margin: 0 0 12px; }
    p { color: #555; line-height: 1.6; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${success ? '🎉' : '😕'}</div>
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`
  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
