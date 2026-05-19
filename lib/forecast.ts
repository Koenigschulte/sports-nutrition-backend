import pool from './db'

export interface ActivityEntry {
  activityType: string
  durationMinutes: number
  distanceKm?: number
  calories: number
  avgHeartRate?: number
  intensityLevel: string
}

export interface DayForecast {
  date: string        // YYYY-MM-DD
  weekday: string     // Montag, Dienstag, ...
  hasTraining: boolean
  durationMinutes: number
  intensityLevel: string  // easy, moderate, hard, very_hard, rest
  estimatedCalories: number
  activityType: string
  isActual: boolean   // true = echte Strava-Aktivität, false = Prognose
  distanceKm?: number
  activities?: ActivityEntry[]  // einzelne Aktivitäten (nur bei isActual=true, mehrere möglich)
}

export interface WeekForecast {
  weekStart: string
  days: DayForecast[]
  totalMinutes: number
  totalCalories: number
  trainingDays: number
  weeklyLoadLevel: string  // light, moderate, heavy, peak
}

const WEEKDAYS_DE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']

/** Erzeugt YYYY-MM-DD aus lokalem Datum — verhindert UTC-Offset-Fehler von toISOString() */
function localDateStr(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export async function buildWeekForecast(userId: string): Promise<WeekForecast> {
  const client = await pool.connect()
  try {
    // Current week: Monday to Sunday
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const mondayOffset = (today.getDay() + 6) % 7  // days since Monday (0=Mon, 6=Sun)
    const weekMonday = new Date(today)
    weekMonday.setDate(today.getDate() - mondayOffset)

    const weekEnd = new Date(weekMonday)
    weekEnd.setDate(weekMonday.getDate() + 7)

    // --- Fetch actual activities for THIS week (Mon to today) ---
    // activity_date is a DATE column (already the correct local date) — no timezone conversion needed
    const actualsResult = await client.query(
      `SELECT activity_date::text as date,
              activity_type, duration_minutes, distance_km,
              calories_burned, avg_heart_rate, intensity_level, training_load
       FROM activity_history
       WHERE user_id = $1
         AND activity_date >= $2::date
         AND activity_date < $3::date
       ORDER BY activity_date, activity_type`,
      [userId, localDateStr(weekMonday), localDateStr(weekEnd)]
    )

    // Build map: date string → activities[]
    // act.date is a 'YYYY-MM-DD' string from the DATE column — use directly
    const actualsByDate = new Map<string, typeof actualsResult.rows>()
    for (const act of actualsResult.rows) {
      const dateStr = act.date as string
      if (!actualsByDate.has(dateStr)) actualsByDate.set(dateStr, [])
      actualsByDate.get(dateStr)!.push(act)
    }

    // --- Fetch 12 weeks of history for FUTURE-day predictions ---
    const historyResult = await client.query(
      `SELECT activity_date::text as activity_date,
              activity_type, duration_minutes, calories_burned, intensity_level, training_load
       FROM activity_history
       WHERE user_id = $1 AND activity_date >= CURRENT_DATE - 84
       ORDER BY activity_date`,
      [userId]
    )
    const historicActivities = historyResult.rows

    // Analyze weekday patterns for predictions
    // rawCount = absolute number of trainings on this weekday (for avg calculation)
    // count = probability (rawCount / weeksWithData)
    const weekdayStats: Record<number, { count: number; rawCount: number; totalDuration: number; totalLoad: number; types: string[] }> = {}
    for (let i = 0; i < 7; i++) {
      weekdayStats[i] = { count: 0, rawCount: 0, totalDuration: 0, totalLoad: 0, types: [] }
    }

    if (historicActivities.length >= 5) {
      const firstDate = new Date(historicActivities[0].activity_date)
      const lastDate = new Date(historicActivities[historicActivities.length - 1].activity_date)
      const weeksWithData = Math.max(1, Math.ceil((lastDate.getTime() - firstDate.getTime()) / (7 * 24 * 3600 * 1000)))

      for (const act of historicActivities) {
        // Parse 'YYYY-MM-DD' as local date to get correct weekday
        const [y, mo, dy] = (act.activity_date as string).split('-').map(Number)
        const wd = new Date(y, mo - 1, dy).getDay()
        weekdayStats[wd].rawCount++
        weekdayStats[wd].totalDuration += Number(act.duration_minutes) || 0
        weekdayStats[wd].totalLoad += Number(act.training_load) || 0
        if (act.activity_type) weekdayStats[wd].types.push(act.activity_type)
      }

      for (let i = 0; i < 7; i++) {
        weekdayStats[i].count = weekdayStats[i].rawCount / weeksWithData  // normalize to probability
      }
    }

    // --- Build 7-day forecast ---
    const days: DayForecast[] = []
    for (let i = 0; i < 7; i++) {
      const date = new Date(weekMonday)
      date.setDate(weekMonday.getDate() + i)
      const dateStr = localDateStr(date)
      const wd = date.getDay()

      const isPastOrToday = date <= today
      const actuals = actualsByDate.get(dateStr) || []

      if (isPastOrToday && actuals.length > 0) {
        // Real activities from Strava: aggregate totals + keep individual entries
        const totalDuration = actuals.reduce((s, a) => s + (Number(a.duration_minutes) || 0), 0)
        const totalCals = actuals.reduce((s, a) => s + (Number(a.calories_burned) || 0), 0)
        const avgLoad = actuals.reduce((s, a) => s + (Number(a.training_load) || 0), 0) / actuals.length
        const dominantType = mostCommon(actuals.map(a => a.activity_type)) || 'training'
        const totalDistance = actuals.reduce((s, a) => s + (Number(a.distance_km) || 0), 0)

        const activityEntries: ActivityEntry[] = actuals.map(a => ({
          activityType: a.activity_type as string,
          durationMinutes: Number(a.duration_minutes) || 0,
          distanceKm: Number(a.distance_km) > 0 ? Math.round(Number(a.distance_km) * 100) / 100 : undefined,
          calories: Number(a.calories_burned) || 0,
          avgHeartRate: Number(a.avg_heart_rate) > 0 ? Number(a.avg_heart_rate) : undefined,
          intensityLevel: a.intensity_level as string || 'moderate',
        }))

        days.push({
          date: dateStr,
          weekday: WEEKDAYS_DE[wd],
          hasTraining: true,
          durationMinutes: totalDuration,
          intensityLevel: loadToIntensity(avgLoad),
          estimatedCalories: totalCals,
          activityType: dominantType,
          isActual: true,
          distanceKm: totalDistance > 0 ? Math.round(totalDistance * 100) / 100 : undefined,
          activities: activityEntries,
        })
      } else if (isPastOrToday) {
        // Past day, no activity = rest
        days.push({
          date: dateStr,
          weekday: WEEKDAYS_DE[wd],
          hasTraining: false,
          durationMinutes: 0,
          intensityLevel: 'rest',
          estimatedCalories: 0,
          activityType: 'rest',
          isActual: true,
        })
      } else {
        // Future day: prediction from historic patterns
        const prob = weekdayStats[wd].count  // already normalized
        const hasTraining = prob >= 0.4
        const avgDuration = weekdayStats[wd].rawCount > 0
          ? Math.round(weekdayStats[wd].totalDuration / weekdayStats[wd].rawCount)
          : 0
        const avgLoad = weekdayStats[wd].rawCount > 0
          ? weekdayStats[wd].totalLoad / weekdayStats[wd].rawCount
          : 0
        const dominantType = mostCommon(weekdayStats[wd].types) || 'training'

        days.push({
          date: dateStr,
          weekday: WEEKDAYS_DE[wd],
          hasTraining,
          durationMinutes: hasTraining ? Math.max(avgDuration, 30) : 0,
          intensityLevel: hasTraining ? loadToIntensity(avgLoad) : 'rest',
          estimatedCalories: hasTraining ? Math.round(Math.max(avgDuration, 30) * 8) : 0,
          activityType: hasTraining ? dominantType : 'rest',
          isActual: false,
        })
      }
    }

    const trainingDays = days.filter(d => d.hasTraining).length
    const totalMinutes = days.reduce((s, d) => s + d.durationMinutes, 0)
    const totalCalories = days.reduce((s, d) => s + d.estimatedCalories, 0)

    const fourWeeksAgo = new Date()
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28)
    const recentLoad = historicActivities
      .filter(a => new Date(a.activity_date) >= fourWeeksAgo)
      .reduce((s, a) => s + (Number(a.training_load) || 50), 0) / 4

    return {
      weekStart: localDateStr(weekMonday),
      days,
      totalMinutes,
      totalCalories,
      trainingDays,
      weeklyLoadLevel: classifyWeeklyLoad(recentLoad, totalMinutes),
    }
  } finally {
    client.release()
  }
}

function buildDefaultForecast(): WeekForecast {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const mondayOffset = (today.getDay() + 6) % 7
  const weekMonday = new Date(today)
  weekMonday.setDate(today.getDate() - mondayOffset)

  const trainingDayIndices = [0, 2, 4]  // Mo, Mi, Fr
  const days: DayForecast[] = []
  for (let i = 0; i < 7; i++) {
    const date = new Date(weekMonday)
    date.setDate(weekMonday.getDate() + i)
    const trains = trainingDayIndices.includes(i)
    days.push({
      date: localDateStr(date),
      weekday: WEEKDAYS_DE[date.getDay()],
      hasTraining: trains,
      durationMinutes: trains ? 60 : 0,
      intensityLevel: trains ? 'moderate' : 'rest',
      estimatedCalories: trains ? 480 : 0,
      activityType: trains ? 'running' : 'rest',
      isActual: false,
    })
  }
  return {
    weekStart: localDateStr(weekMonday),
    days,
    totalMinutes: 180,
    totalCalories: 1440,
    trainingDays: 3,
    weeklyLoadLevel: 'moderate',
  }
}

function loadToIntensity(avgLoad: number): string {
  if (avgLoad < 50) return 'easy'
  if (avgLoad < 150) return 'moderate'
  if (avgLoad < 300) return 'hard'
  return 'very_hard'
}

function classifyWeeklyLoad(historicLoad: number, forecastMinutes: number): string {
  if (forecastMinutes < 120) return 'light'
  if (forecastMinutes < 240) return 'moderate'
  if (forecastMinutes < 360) return 'heavy'
  return 'peak'
}

function mostCommon(arr: string[]): string | null {
  if (arr.length === 0) return null
  const freq: Record<string, number> = {}
  for (const v of arr) freq[v] = (freq[v] || 0) + 1
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]
}
