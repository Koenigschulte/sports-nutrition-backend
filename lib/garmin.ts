import { OAuth } from 'oauth'

type OAuthError = Error | { statusCode: number; data?: unknown } | null

const GARMIN_CONSUMER_KEY = process.env.GARMIN_CONSUMER_KEY!
const GARMIN_CONSUMER_SECRET = process.env.GARMIN_CONSUMER_SECRET!

const REQUEST_TOKEN_URL = 'https://connectapi.garmin.com/oauth-service/oauth/request_token'
const ACCESS_TOKEN_URL = 'https://connectapi.garmin.com/oauth-service/oauth/access_token'
const AUTHORIZE_URL = 'https://connect.garmin.com/oauthConfirm'
const API_BASE = 'https://healthapi.garmin.com/wellness-api/rest'

export function createOAuthClient(): OAuth {
  return new OAuth(
    REQUEST_TOKEN_URL,
    ACCESS_TOKEN_URL,
    GARMIN_CONSUMER_KEY,
    GARMIN_CONSUMER_SECRET,
    '1.0A',
    null,
    'HMAC-SHA1'
  )
}

export async function getRequestToken(): Promise<{ token: string; tokenSecret: string; authUrl: string }> {
  const oauth = createOAuthClient()
  return new Promise((resolve, reject) => {
    oauth.getOAuthRequestToken((err: OAuthError, token: string, tokenSecret: string) => {
      if (err) return reject(err)
      resolve({ token, tokenSecret, authUrl: `${AUTHORIZE_URL}?oauth_token=${token}` })
    })
  })
}

export async function getAccessToken(
  requestToken: string,
  requestTokenSecret: string,
  verifier: string
): Promise<{ accessToken: string; accessTokenSecret: string }> {
  const oauth = createOAuthClient()
  return new Promise((resolve, reject) => {
    oauth.getOAuthAccessToken(
      requestToken,
      requestTokenSecret,
      verifier,
      (err: OAuthError, accessToken: string, accessTokenSecret: string) => {
        if (err) return reject(err)
        resolve({ accessToken, accessTokenSecret })
      }
    )
  })
}

export async function fetchActivities(
  accessToken: string,
  accessTokenSecret: string,
  startDate: Date,
  endDate: Date
): Promise<GarminActivity[]> {
  const oauth = createOAuthClient()
  const startTs = Math.floor(startDate.getTime() / 1000)
  const endTs = Math.floor(endDate.getTime() / 1000)
  const url = `${API_BASE}/activities?startTimeInSeconds=${startTs}&endTimeInSeconds=${endTs}`

  return new Promise((resolve, reject) => {
    oauth.get(url, accessToken, accessTokenSecret, (err: OAuthError, data: string | Buffer | undefined) => {
      if (err) return reject(err)
      try {
        const parsed = JSON.parse(data as string)
        resolve(parsed.activityList || [])
      } catch {
        resolve([])
      }
    })
  })
}

export async function fetchBodyComposition(
  accessToken: string,
  accessTokenSecret: string,
  startDate: Date,
  endDate: Date
): Promise<GarminBodyComp[]> {
  const oauth = createOAuthClient()
  const startTs = Math.floor(startDate.getTime() / 1000)
  const endTs = Math.floor(endDate.getTime() / 1000)
  const url = `${API_BASE}/bodyComps?startTimeInSeconds=${startTs}&endTimeInSeconds=${endTs}`

  return new Promise((resolve, reject) => {
    oauth.get(url, accessToken, accessTokenSecret, (err: OAuthError, data: string | Buffer | undefined) => {
      if (err) return reject(err)
      try {
        const parsed = JSON.parse(data as string)
        resolve(parsed.bodyCompSummaryList || [])
      } catch {
        resolve([])
      }
    })
  })
}

export function mapIntensityLevel(trainingLoad: number | null, avgHr: number | null): string {
  if (trainingLoad) {
    if (trainingLoad < 50) return 'easy'
    if (trainingLoad < 150) return 'moderate'
    if (trainingLoad < 300) return 'hard'
    return 'very_hard'
  }
  if (avgHr) {
    if (avgHr < 120) return 'easy'
    if (avgHr < 150) return 'moderate'
    if (avgHr < 170) return 'hard'
    return 'very_hard'
  }
  return 'moderate'
}

export interface GarminActivity {
  activityId: string
  activityType: { typeKey: string }
  startTimeInSeconds: number
  durationInSeconds: number
  distanceInMeters?: number
  activeKilocalories?: number
  averageHeartRateInBeatsPerMinute?: number
  trainingLoad?: number
}

export interface GarminBodyComp {
  calendarDate: string
  weightInGrams?: number
  bodyFatInPercent?: number
  muscleMassInGrams?: number
}
