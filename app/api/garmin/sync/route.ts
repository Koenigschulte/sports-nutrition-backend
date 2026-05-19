import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import { fetchActivities, fetchBodyComposition, mapIntensityLevel } from '@/lib/garmin'
import pool from '@/lib/db'

// Syncs last 12 weeks of Garmin data
export const POST = requireAuth(async (_req: NextRequest, userId: string) => {
  const client = await pool.connect()
  try {
    const conn = await client.query(
      `SELECT oauth_token, oauth_token_secret, sync_status
       FROM garmin_connections WHERE user_id = $1`,
      [userId]
    )

    if (conn.rows.length === 0 || !conn.rows[0].oauth_token) {
      return NextResponse.json({ error: 'Keine Garmin-Verbindung vorhanden' }, { status: 400 })
    }

    const { oauth_token: accessToken, oauth_token_secret: accessTokenSecret } = conn.rows[0]

    await client.query(
      `UPDATE garmin_connections SET sync_status = 'syncing', updated_at = NOW() WHERE user_id = $1`,
      [userId]
    )

    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - 84) // 12 weeks back

    const [activities, bodyComps] = await Promise.all([
      fetchActivities(accessToken, accessTokenSecret, startDate, endDate),
      fetchBodyComposition(accessToken, accessTokenSecret, startDate, endDate),
    ])

    // Import activities
    let importedCount = 0
    for (const activity of activities) {
      const activityDate = new Date(activity.startTimeInSeconds * 1000)
      const durationMinutes = Math.round(activity.durationInSeconds / 60)
      const distanceKm = activity.distanceInMeters ? activity.distanceInMeters / 1000 : null
      const intensityLevel = mapIntensityLevel(
        activity.trainingLoad ?? null,
        activity.averageHeartRateInBeatsPerMinute ?? null
      )

      await client.query(
        `INSERT INTO activity_history
           (user_id, garmin_activity_id, activity_date, activity_type, duration_minutes,
            distance_km, calories_burned, avg_heart_rate, intensity_level, training_load, raw_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (garmin_activity_id) DO NOTHING`,
        [
          userId,
          activity.activityId,
          activityDate.toISOString().split('T')[0],
          activity.activityType?.typeKey || 'unknown',
          durationMinutes,
          distanceKm,
          activity.activeKilocalories || null,
          activity.averageHeartRateInBeatsPerMinute || null,
          intensityLevel,
          activity.trainingLoad || null,
          JSON.stringify(activity),
        ]
      )
      importedCount++
    }

    // Update latest body composition in profile
    if (bodyComps.length > 0) {
      const latest = bodyComps[bodyComps.length - 1]
      const weightKg = latest.weightInGrams ? latest.weightInGrams / 1000 : null
      const bodyFat = latest.bodyFatInPercent || null

      if (weightKg || bodyFat) {
        await client.query(
          `UPDATE user_profiles SET weight_kg = COALESCE($1, weight_kg), body_fat_percent = COALESCE($2, body_fat_percent), updated_at = NOW()
           WHERE user_id = $3`,
          [weightKg, bodyFat, userId]
        )
      }
    }

    await client.query(
      `UPDATE garmin_connections SET sync_status = 'success', last_sync_at = NOW(), updated_at = NOW() WHERE user_id = $1`,
      [userId]
    )

    return NextResponse.json({
      success: true,
      activitiesImported: importedCount,
      lastSyncAt: new Date().toISOString(),
    })
  } catch (err) {
    await client.query(
      `UPDATE garmin_connections SET sync_status = 'error', updated_at = NOW() WHERE user_id = $1`,
      [userId]
    )
    console.error('Garmin sync error:', err)
    return NextResponse.json({ error: 'Sync fehlgeschlagen' }, { status: 500 })
  } finally {
    client.release()
  }
})
