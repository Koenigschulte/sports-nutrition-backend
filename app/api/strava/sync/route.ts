import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { getActivities, getActivityDetail, activityToHistory, getValidToken } from '@/lib/strava'
import pool from '@/lib/db'

export const POST = requireAuth(async (_req: NextRequest, userId: string) => {
  const client = await pool.connect()
  try {
    // Load Strava connection
    const connRes = await client.query(
      `SELECT access_token, refresh_token, expires_at, last_sync_at
       FROM strava_connections WHERE user_id = $1`,
      [userId]
    )

    if (connRes.rows.length === 0) {
      return NextResponse.json({ error: 'Kein Strava-Account verbunden' }, { status: 400 })
    }

    const conn = connRes.rows[0]

    // Refresh token if needed
    const { accessToken, refreshToken, expiresAt, refreshed } = await getValidToken(
      conn.access_token,
      conn.refresh_token,
      Number(conn.expires_at)
    )

    if (refreshed) {
      await client.query(
        `UPDATE strava_connections SET access_token = $1, refresh_token = $2, expires_at = $3 WHERE user_id = $4`,
        [accessToken, refreshToken, expiresAt, userId]
      )
    }

    // Fetch activities since last sync (or last 90 days)
    const lastSync = conn.last_sync_at
      ? Math.floor(new Date(conn.last_sync_at).getTime() / 1000) - 86400  // 1 day overlap
      : Math.floor(Date.now() / 1000) - 90 * 24 * 3600  // 90 days

    const activities = await getActivities(accessToken, lastSync)

    // Für Aktivitäten der letzten 14 Tage: Detail-Endpoint für echte Kalorien
    const fourteenDaysAgo = Math.floor(Date.now() / 1000) - 14 * 24 * 3600
    const recentIds = new Set(
      activities
        .filter(a => new Date(a.start_date).getTime() / 1000 >= fourteenDaysAgo)
        .map(a => a.id)
    )

    // Details für aktuelle Aktivitäten laden (alle der letzten 14 Tage)
    // Strava Rate Limit: 100 Requests/15min — wir haben typisch 5–15 Aktivitäten/Woche, kein Problem
    const detailMap = new Map<number, typeof activities[0]>()
    await Promise.all(
      [...recentIds].map(async (id) => {
        try {
          const detail = await getActivityDetail(accessToken, id)
          detailMap.set(id, detail)
        } catch { /* ignore einzelne Fehler */ }
      })
    )

    // Upsert into activity_history
    let synced = 0
    for (const act of activities) {
      const enriched = detailMap.get(act.id) ?? act
      const row = activityToHistory(enriched, userId)
      await client.query(
        `INSERT INTO activity_history
           (user_id, external_id, activity_date, activity_type, duration_minutes,
            distance_km, calories_burned, avg_heart_rate, intensity_level, training_load, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (user_id, external_id) WHERE external_id IS NOT NULL DO UPDATE SET
           activity_date   = EXCLUDED.activity_date,
           activity_type   = EXCLUDED.activity_type,
           duration_minutes = EXCLUDED.duration_minutes,
           distance_km     = EXCLUDED.distance_km,
           calories_burned = EXCLUDED.calories_burned,
           avg_heart_rate  = EXCLUDED.avg_heart_rate,
           intensity_level = EXCLUDED.intensity_level,
           training_load   = EXCLUDED.training_load`,
        [
          row.user_id, row.external_id, row.activity_date, row.activity_type,
          row.duration_minutes, row.distance_km, row.calories_burned,
          row.avg_heart_rate, row.intensity_level, row.training_load, row.source,
        ]
      )
      synced++
    }

    // Update last_sync_at
    await client.query(
      `UPDATE strava_connections SET last_sync_at = NOW(), sync_status = 'connected' WHERE user_id = $1`,
      [userId]
    )

    return NextResponse.json({
      synced,
      message: `${synced} Aktivitäten synchronisiert`,
    })
  } catch (e) {
    console.error('Strava sync error:', e)
    await client.query(
      `UPDATE strava_connections SET sync_status = 'error' WHERE user_id = $1`,
      [userId]
    )
    return NextResponse.json({ error: 'Sync fehlgeschlagen' }, { status: 500 })
  } finally {
    client.release()
  }
})
