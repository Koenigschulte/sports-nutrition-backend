import { GoogleGenerativeAI } from '@google/generative-ai'
import { WeekForecast } from './forecast'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')

export interface MealPlan {
  day: string         // YYYY-MM-DD
  weekday: string
  meals: PlannedMeal[]
  totalCalories: number
  totalProteinG: number
  totalCarbsG: number
  totalFatG: number
}

export interface PlannedMeal {
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack'
  title: string
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  ingredients: string[]
  instructions: string
  prepMinutes: number
  isTogo: boolean
  isSimple: boolean
  spoonacularQuery: string  // search term for Spoonacular
}

export interface UserContext {
  nutritionGoal: string
  dietType: string
  householdSize: number
  weightKg: number | null
  heightCm: number | null
  preferences: { item: string; type: string }[]
  timeConstraints: Record<string, Record<string, string>>
}

const GOAL_LABELS: Record<string, string> = {
  lose_weight: 'Gewicht verlieren',
  gain_weight: 'Gewicht zunehmen',
  maintain: 'Gewicht halten',
  muscle_gain: 'Muskelaufbau',
  performance: 'Sportliche Performance steigern',
}

const DIET_LABELS: Record<string, string> = {
  all: 'keine Einschränkungen (Fleisch, Fisch, alles)',
  vegetarian: 'vegetarisch (kein Fleisch, kein Fisch)',
  vegan: 'vegan (keine tierischen Produkte)',
}

export async function generateWeekPlan(
  forecast: WeekForecast,
  user: UserContext
): Promise<MealPlan[]> {
  const dislikes = user.preferences.filter(p => p.type === 'dislike' || p.type === 'intolerance' || p.type === 'allergy').map(p => p.item)
  const likes = user.preferences.filter(p => p.type === 'like').map(p => p.item)

  const prompt = buildPrompt(forecast, user, likes, dislikes)

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    generationConfig: { maxOutputTokens: 16384, thinkingConfig: { thinkingBudget: 0 } } as any,
  })

  // Use streaming to ensure we receive the full response
  const stream = await model.generateContentStream(prompt)
  let text = ''
  for await (const chunk of stream.stream) {
    text += chunk.text()
  }
  console.log('Gemini response length:', text.length, '| first 80:', text.slice(0, 80))

  return parseResponse(text, forecast)
}

function buildPrompt(forecast: WeekForecast, user: UserContext, likes: string[], dislikes: string[]): string {
  const trainingDays = forecast.days.filter(d => d.hasTraining)
  const restDays = forecast.days.filter(d => !d.hasTraining)

  const dailyCaloriesBase = estimateBasalCalories(user.weightKg, user.heightCm, user.nutritionGoal)

  const dayDescriptions = forecast.days.map(d => {
    const extra = d.hasTraining ? ` (Training: ${d.durationMinutes} Min, ${d.intensityLevel}, ~${d.estimatedCalories} kcal verbrannt)` : ' (Ruhetag)'
    const constraint = user.timeConstraints?.[d.weekday.toLowerCase()]
    const lunchNote = constraint?.lunch === 'togo' ? ' — Mittagessen muss To-Go sein' : ''
    return `${d.date} (${d.weekday})${extra}${lunchNote}`
  }).join('\n')

  const firstDay = forecast.days[0]

  return `Du bist ein Sporternährungs-Experte. Erstelle einen detaillierten 7-Tage-Essensplan.

NUTZERPROFIL:
- Ernährungsziel: ${GOAL_LABELS[user.nutritionGoal] || user.nutritionGoal}
- Ernährungsweise: ${DIET_LABELS[user.dietType] || user.dietType}
- Haushaltsgröße: ${user.householdSize} Person(en)
- Tagesbedarf Basis: ~${dailyCaloriesBase} kcal
${likes.length > 0 ? `- Mag gerne: ${likes.join(', ')}` : ''}
${dislikes.length > 0 ? `- Mag NICHT / verträgt nicht: ${dislikes.join(', ')} — diese NIEMALS einplanen` : ''}

TRAININGSWOCHE (${forecast.weeklyLoadLevel}) — Wochenstart: ${firstDay.date}:
${dayDescriptions}

PFLICHT: Verwende exakt die oben angegebenen Daten (YYYY-MM-DD) für das "day"-Feld. KEINE anderen Daten erfinden.

REGELN:
1. An Trainingstagen +${forecast.weeklyLoadLevel === 'peak' ? '600' : forecast.weeklyLoadLevel === 'heavy' ? '400' : '200'} kcal mehr als Ruhetage
2. Nach hartem Training (hard/very_hard): Mahlzeit danach proteinreich (mind. 30g Protein)
3. Vor hartem Training: kohlenhydratreich, leicht verdaulich
4. Einfache Gerichte bevorzugen — Rohkost, einfache Salate, schnelle Mahlzeiten sind willkommen
5. Zutaten über die Woche optimieren — nicht für jedes Gericht komplett andere Zutaten
6. To-Go-Mahlzeiten müssen ohne Herd zubereitet werden können
7. Alle Mengen für ${user.householdSize} Person(en) angeben

ZUTATEN-FORMAT (kritisch für Einkaufsliste):
- Immer Rohform verwenden: "Hähnchenbrustfilet" NICHT "gekochte Hähnchenbrust" oder "gebratenes Hähnchen"
- Einheitliche Namen: dieselbe Zutat immer gleich schreiben (z.B. immer "Hähnchenbrustfilet", nie mal "Hähnchenbrust" mal "Hühnerbrust")
- Format immer: "MengeEinheit Name" z.B. "200g Hähnchenbrustfilet", "2 Eier", "1 EL Olivenöl"
- Keine Zubereitungsform im Zutatennamen (kein "gekocht", "gebraten", "gedünstet")

Antworte NUR mit validem JSON, kein Text davor oder danach:

{
  "weekPlan": [
    {
      "day": "YYYY-MM-DD",
      "weekday": "Montag",
      "meals": [
        {
          "mealType": "breakfast|lunch|dinner|snack",
          "title": "Name des Gerichts",
          "calories": 500,
          "proteinG": 30,
          "carbsG": 50,
          "fatG": 15,
          "ingredients": ["200g Hühnerbrust", "100g Reis", "..."],
          "instructions": "Schritt-für-Schritt Zubereitung in 3-5 Sätzen",
          "prepMinutes": 20,
          "isTogo": false,
          "isSimple": true,
          "spoonacularQuery": "chicken rice bowl high protein"
        }
      ],
      "totalCalories": 2200,
      "totalProteinG": 150,
      "totalCarbsG": 220,
      "totalFatG": 65
    }
  ]
}`
}

function estimateBasalCalories(weightKg: number | null, heightCm: number | null, goal: string): number {
  const weight = weightKg || 75
  const height = heightCm || 175
  // Mifflin-St Jeor (male default)
  const bmr = 10 * weight + 6.25 * height - 5 * 30 + 5
  const tdee = bmr * 1.55 // moderate activity

  if (goal === 'lose_weight') return Math.round(tdee - 300)
  if (goal === 'gain_weight' || goal === 'muscle_gain') return Math.round(tdee + 300)
  return Math.round(tdee)
}

function parseResponse(text: string, forecast: WeekForecast): MealPlan[] {
  // Strip markdown code fences if present
  let clean = text.trim()
  clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()

  const jsonMatch = clean.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    console.error('Gemini raw response (first 500):', text.slice(0, 500))
    throw new Error('Kein JSON in der Antwort gefunden')
  }

  // Remove trailing commas before ] or } (common Gemini quirk)
  let fixed = jsonMatch[0].replace(/,\s*([}\]])/g, '$1')
  // Fix unescaped control characters inside strings (line breaks in JSON strings)
  fixed = fixed.replace(/"([^"\\]*(\\.[^"\\]*)*)"/g, (match) =>
    match.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
  )

  let parsed: { weekPlan?: MealPlan[] }
  try {
    parsed = JSON.parse(fixed)
  } catch (e) {
    console.error('JSON parse error, raw excerpt:', jsonMatch[0].slice(850, 1050))
    throw e
  }
  const plans: MealPlan[] = (parsed as { weekPlan?: MealPlan[] }).weekPlan || []
  console.log('Gemini days:', plans.map(p => `${p.day}(${p.weekday})`).join(', '))

  // Build lookup: weekday name → correct date (German + English)
  const EN_TO_DE: Record<string, string> = {
    monday: 'montag', tuesday: 'dienstag', wednesday: 'mittwoch',
    thursday: 'donnerstag', friday: 'freitag', saturday: 'samstag', sunday: 'sonntag'
  }
  const weekdayToDate: Record<string, string> = {}
  for (const fd of forecast.days) {
    const de = fd.weekday.toLowerCase()
    weekdayToDate[de] = fd.date
    // Also map English names
    const enKey = Object.entries(EN_TO_DE).find(([, v]) => v === de)?.[0]
    if (enKey) weekdayToDate[enKey] = fd.date
  }
  const validDates = new Set(forecast.days.map(d => d.date))

  // Remap any wrong dates using weekday name as authoritative source
  for (const plan of plans) {
    if (!validDates.has(plan.day)) {
      const correctDate = weekdayToDate[plan.weekday?.toLowerCase()]
      if (correctDate) {
        console.log(`Date remap: ${plan.weekday} was "${plan.day}" → "${correctDate}"`)
        plan.day = correctDate
      } else {
        // Last resort: assign by position in Gemini output to forecast days
        const idx = plans.indexOf(plan)
        if (idx < forecast.days.length) {
          plan.day = forecast.days[idx].date
          console.log(`Positional remap: index ${idx} → "${plan.day}"`)
        }
      }
    }
  }

  // Deduplicate: if multiple plans landed on same day, merge meals
  const byDay = new Map<string, MealPlan>()
  for (const plan of plans) {
    if (byDay.has(plan.day)) {
      byDay.get(plan.day)!.meals.push(...plan.meals)
    } else {
      byDay.set(plan.day, plan)
    }
  }

  // Ensure all 7 days exist
  for (const forecastDay of forecast.days) {
    if (!byDay.has(forecastDay.date)) {
      byDay.set(forecastDay.date, {
        day: forecastDay.date,
        weekday: forecastDay.weekday,
        meals: [],
        totalCalories: 0,
        totalProteinG: 0,
        totalCarbsG: 0,
        totalFatG: 0,
      })
    }
  }

  return Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day))
}

export interface AlternativeRecipe {
  title: string
  imageUrl: null
  prepMinutes: number
  ingredients: string[]
  instructions: string
  nutrients: { calories: number; protein: number; carbs: number; fat: number }
}

export async function generateAlternativeRecipe(params: {
  currentTitle: string
  mealType: string
  isTogo: boolean
  dietType: string
  householdSize: number
  dislikes: string[]
  targetCalories: number
  targetProteinG: number
}): Promise<AlternativeRecipe> {
  const { currentTitle, mealType, isTogo, dietType, householdSize, dislikes, targetCalories, targetProteinG } = params

  const mealLabel: Record<string, string> = {
    breakfast: 'Frühstück', lunch: 'Mittagessen', dinner: 'Abendessen', snack: 'Snack',
  }
  const dietLabel = DIET_LABELS[dietType] || dietType

  const prompt = `Du bist ein Sporternährungs-Experte. Schlage EINE Alternative vor für die Mahlzeit "${currentTitle}".

ANFORDERUNGEN:
- Mahlzeitentyp: ${mealLabel[mealType] || mealType}
- Ernährungsweise: ${dietLabel}
- Haushaltsgröße: ${householdSize} Person(en)
- Kalorien: ~${targetCalories} kcal
- Protein: mind. ${targetProteinG}g
${isTogo ? '- Muss ohne Herd zubereitet werden können (To-Go)' : ''}
${dislikes.length > 0 ? `- NIEMALS verwenden: ${dislikes.join(', ')}` : ''}
- NICHT dasselbe Gericht wie "${currentTitle}" vorschlagen

Antworte NUR mit validem JSON, kein Text davor oder danach:

{
  "title": "Name des Gerichts",
  "prepMinutes": 20,
  "ingredients": ["200g Zutate", "..."],
  "instructions": "Kurze Zubereitung in 2-4 Sätzen.",
  "nutrients": { "calories": ${targetCalories}, "protein": ${targetProteinG}, "carbs": 50, "fat": 15 }
}`

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    generationConfig: { maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } } as any,
  })

  const stream = await model.generateContentStream(prompt)
  let text = ''
  for await (const chunk of stream.stream) {
    text += chunk.text()
  }

  let clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  let fixed = clean.replace(/,\s*([}\]])/g, '$1')
  fixed = fixed.replace(/"([^"\\]*(\\.[^"\\]*)*)"/g, (match) =>
    match.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
  )

  const jsonMatch = fixed.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Kein JSON in der Gemini-Antwort')

  const parsed = JSON.parse(jsonMatch[0]) as Omit<AlternativeRecipe, 'imageUrl'>
  return { ...parsed, imageUrl: null }
}
