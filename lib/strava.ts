import axios from 'axios'

const STRAVA_BASE = 'https://www.strava.com'
const CLIENT_ID = process.env.STRAVA_CLIENT_ID || ''
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET || ''
export const REDIRECT_URI = process.env.STRAVA_REDIRECT_URI || 'http://localhost:3000/api/strava/callback'

// --- OAuth ---

export function getAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'activity:read_all',
    state,
  })
  return `${STRAVA_BASE}/oauth/authorize?${params}`
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const res = await axios.post<TokenResponse>(`${STRAVA_BASE}/oauth/token`, {
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code,
    grant_type: 'authorization_code',
  })
  return res.data
}

export async function refreshAccessToken(currentRefreshToken: string): Promise<TokenResponse> {
  const res = await axios.post<TokenResponse>(`${STRAVA_BASE}/oauth/token`, {
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: currentRefreshToken,
    grant_type: 'refresh_token',
  })
  return res.data
}

export interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_at: number   // unix timestamp
  athlete?: {
    id: number
    firstname: string
    lastname: string
  }
}

// --- Activities ---

export interface StravaActivity {
  id: number
  name: string
  type: string
  sport_type: string
  start_date: string       // ISO 8601
  elapsed_time: number     // seconds
  moving_time: number      // seconds
  distance: number         // meters
  average_heartrate?: number
  max_heartrate?: number
  calories?: number        // nur im Detail-Endpoint verfügbar
  kilojoules?: number      // Strava kJ (Cycling/Power)
  suffer_score?: number
}

// Detaillierte Aktivität (enthält calories)
export interface StravaActivityDetail extends StravaActivity {
  calories: number
}

export async function getActivities(accessToken: string, after?: number): Promise<StravaActivity[]> {
  const params: Record<string, unknown> = { per_page: 100 }
  if (after) params.after = after

  const res = await axios.get<StravaActivity[]>(`${STRAVA_BASE}/api/v3/athlete/activities`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params,
  })
  return res.data
}

/** Detail-Endpoint für einzelne Aktivität — liefert echte Kalorien */
export async function getActivityDetail(accessToken: string, activityId: number): Promise<StravaActivityDetail> {
  const res = await axios.get<StravaActivityDetail>(
    `${STRAVA_BASE}/api/v3/activities/${activityId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  return res.data
}

// --- Helpers ---

export function activityToHistory(act: StravaActivity, userId: string) {
  const durationMinutes = Math.round(act.moving_time / 60)
  const activityType = normalizeType(act.sport_type || act.type)
  const intensity = hrToIntensity(act.average_heartrate)
  const trainingLoad = intensityToLoad(intensity, durationMinutes)

  // Kalorien-Priorität:
  // 1. Echter Wert aus Strava Detail-Endpoint (act.calories > 0)
  // 2. kJ → kcal (für Cycling mit Powermeter)
  // 3. Sportart- + HR-basierte Schätzung (viel besser als pauschale 8 kcal/min)
  let calories: number
  if (act.calories && act.calories > 0) {
    calories = Math.round(act.calories)
  } else if (act.kilojoules && act.kilojoules > 0) {
    calories = Math.round(act.kilojoules / 4.184)
  } else {
    calories = estimateCalories(activityType, intensity, durationMinutes)
  }

  return {
    user_id: userId,
    external_id: String(act.id),
    activity_date: act.start_date.split('T')[0],
    activity_type: activityType,
    duration_minutes: durationMinutes,
    distance_km: act.distance ? Math.round(act.distance / 10) / 100 : null,
    calories_burned: calories,
    avg_heart_rate: act.average_heartrate ? Math.round(act.average_heartrate) : null,
    intensity_level: intensity,
    training_load: trainingLoad,
    source: 'strava',
  }
}

/**
 * Sportart- und intensitätsbasierte Kalorien-Schätzung.
 * Basis-Raten in kcal/min für moderate Intensität (70-80 kg Person).
 * HR-Intensitätsfaktor skaliert die tatsächliche Belastung.
 */
function estimateCalories(activityType: string, intensity: string, minutes: number): number {
  const baseRates: Record<string, number> = {
    running: 11,
    cycling: 9,
    swimming: 9,
    rowing: 9,
    kayaking: 8,
    hiking: 6,
    walking: 4,
    tennis: 8,
    soccer: 9,
    basketball: 8,
    strength: 6,
    crossfit: 10,
    yoga: 3,
    skiing: 7,
  }
  const intensityFactor: Record<string, number> = {
    easy: 0.75,
    moderate: 1.0,
    hard: 1.3,
    very_hard: 1.55,
  }
  const base = baseRates[activityType] ?? 8
  const factor = intensityFactor[intensity] ?? 1.0
  return Math.round(base * factor * minutes)
}

function hrToIntensity(avgHr?: number): string {
  if (!avgHr) return 'moderate'
  const maxHr = 185  // 220 - 35 (default age assumption)
  const pct = avgHr / maxHr
  if (pct < 0.6) return 'easy'
  if (pct < 0.7) return 'moderate'
  if (pct < 0.8) return 'hard'
  return 'very_hard'
}

function intensityToLoad(intensity: string, minutes: number): number {
  const multiplier: Record<string, number> = {
    easy: 30, moderate: 80, hard: 150, very_hard: 250,
  }
  return Math.round((multiplier[intensity] ?? 80) * (minutes / 60))
}

function normalizeType(type: string): string {
  const map: Record<string, string> = {
    Run: 'running', VirtualRun: 'running', TrailRun: 'running',
    Ride: 'cycling', VirtualRide: 'cycling', EBikeRide: 'cycling', GravelRide: 'cycling',
    Swim: 'swimming',
    Walk: 'walking', Hike: 'hiking',
    WeightTraining: 'strength', Crossfit: 'strength', Workout: 'strength',
    Yoga: 'yoga', Pilates: 'yoga',
    Soccer: 'soccer', Tennis: 'tennis', Basketball: 'basketball',
    Rowing: 'rowing', Kayaking: 'kayaking',
    Skiing: 'skiing', Snowboard: 'skiing',
  }
  return map[type] || type.toLowerCase().replace(/\s+/g, '_')
}

// Ensure access token is still valid, refresh if needed
export async function getValidToken(
  accessToken: string,
  refreshTokenStr: string,
  expiresAt: number
): Promise<{ accessToken: string; refreshToken: string; expiresAt: number; refreshed: boolean }> {
  const nowSec = Math.floor(Date.now() / 1000)
  if (expiresAt > nowSec + 300) {
    // Still valid for >5 min
    return { accessToken, refreshToken: refreshTokenStr, expiresAt, refreshed: false }
  }
  const fresh = await refreshAccessToken(refreshTokenStr)
  return {
    accessToken: fresh.access_token,
    refreshToken: fresh.refresh_token,
    expiresAt: fresh.expires_at,
    refreshed: true,
  }
}
