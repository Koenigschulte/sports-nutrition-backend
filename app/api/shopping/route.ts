import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import pool from '@/lib/db'

interface ShoppingItem {
  name: string
  amount: string
  category: string
}

// Kategorisierung
const CATEGORIES: [RegExp, string][] = [
  [/h[äa]hnchen|h[üu]hnchen|h[üu]hn\b|pute[n]?|rind(er)?|hack|steak|schnitzel|lachs|thunfisch|fisch|garnelen|salami|wurst|speck/i, 'Fleisch & Fisch'],
  [/\beier?\b|milch|joghurt|quark|käse|mozzarella|butter|sahne|frischkäse|skyr|hüttenkäse/i, 'Milch & Eier'],
  [/tomate|spinat|brokkoli|karotte|möhre|zwiebel|knoblauch(?!pulver)|zucchini|gurke|avocado|süßkartoffel|feldsalat|rucola|blumenkohl|lauch|sellerie|fenchel|erbsen|mais|\bpaprika\b(?!pulver)|champignon|pilz/i, 'Gemüse'],
  [/banane|apfel|äpfel|beere|orange|zitrone|mango|traube|erdbeere|heidelbeere|himbeere|kiwi|ananas|obst|frucht|früchte/i, 'Obst'],
  [/reis|nudel|pasta|toast|brot|hafer|quinoa|kartoffel|couscous|bulgur|dinkel|tortilla|wrap|bagel/i, 'Getreide & Kohlenhydrate'],
  [/linsen|bohnen|kichererbsen|tofu|tempeh|edamame/i, 'Hülsenfrüchte'],
  [/mandel|walnuss|cashew|erdnuss|sonnenblumenkern|kürbiskern|sesam|leinsamen|chiasamen|nuss|nüsse/i, 'Nüsse & Samen'],
  // Vorrat: alles was man meist zuhause hat
  [/salz|pfeffer|paprikapulver|kurkuma|zimt|oregano|basilikum|thymian|rosmarin|kümmel|muskat|curry|knoblauchpulver|zwiebelpulver|chilipulver|chili(?!schote)|gewürz|olivenöl|sonnenblumenöl|rapsöl|\böl\b|essig|sojasoße|senf|honig|ahornsirup|tomatenmark|brühe|bouillon|backpulver|vanille|kakao|mehl(?!gericht)/i, 'Vorrat'],
]

function categorize(name: string): string {
  for (const [pattern, category] of CATEGORIES) {
    if (pattern.test(name)) return category
  }
  return 'Sonstiges'
}

// Durchschnittsgewichte für "X Stück" → Gramm-Umrechnung (für Obst/Gemüse)
const PIECE_WEIGHTS_G: Record<string, number> = {
  'banane': 120, 'bananen': 120,
  'apfel': 150, 'äpfel': 150,
  'orange': 180,
  'zitrone': 100,
  'kiwi': 90,
  'avocado': 200,
  'ei': 60, 'eier': 60,
  'tomate': 100, 'tomaten': 100,
  'paprika': 160,
  'gurke': 400,
  'zwiebel': 100, 'zwiebeln': 100,
}

// EL/TL in Gramm für Nüsse/Samen/Flüssiges
const SPOON_WEIGHTS_G: Record<string, number> = {
  'el': 10, 'tl': 5,
}

// Aliase: verschiedene Schreibweisen → Standardname
const INGREDIENT_ALIASES: [RegExp, string][] = [
  // Fleisch
  [/h[äa]hnchen(brust)?filet|h[äa]hnchenbrust|h[üu]hnerbrust|gebraten(e[s]?)?\s+h[äa]hnchen|gekocht(e[s]?)?\s+h[äa]hnchen|h[äa]hnchen\b/i, 'Hähnchenbrustfilet'],
  [/putenbrust(filet)?|putenfilet|pute\b/i, 'Putenbrustfilet'],
  [/rinderhack|hackfleisch/i, 'Rinderhackfleisch'],
  [/lachsfilet|lachs\b/i, 'Lachsfilet'],
  [/thunfisch/i, 'Thunfisch (Dose)'],
  // Brot
  [/vollkorn.*toast|toast.*vollkorn/i, 'Vollkorntoast'],
  [/\btoast(brot)?\b/i, 'Toastbrot'],
  [/vollkornbrot|vollkorn.*brot/i, 'Vollkornbrot'],
  // Getreide
  [/vollkornnudeln|vollkorn.*nudeln|vollkorn.*pasta/i, 'Vollkornnudeln'],
  [/\bnudeln?\b|\bpasta\b/i, 'Nudeln'],
  [/basmati|jasmin.*reis|langkorn.*reis|vollkorn.*reis/i, 'Reis'],
  [/\breis\b/i, 'Reis'],
  [/haferflocken|hafer\b/i, 'Haferflocken'],
  [/süßkartoffel/i, 'Süßkartoffeln'],
  [/kartoffel/i, 'Kartoffeln'],
  [/couscous/i, 'Couscous'],
  [/quinoa/i, 'Quinoa'],
  // Milch
  [/magerquark|quark.*mager/i, 'Magerquark'],
  [/\bquark\b/i, 'Quark'],
  [/griechisch.*joghurt|joghurt.*griechisch/i, 'Griechischer Joghurt'],
  [/\bjoghurt\b/i, 'Joghurt'],
  [/\beier?\b|hühnerei/i, 'Eier'],
  // Öle & Vorrat
  [/olivenöl/i, 'Olivenöl'],
  [/sonnenblumenöl/i, 'Sonnenblumenöl'],
  [/tomatenmark/i, 'Tomatenmark'],
  [/sojasoße|sojasauce/i, 'Sojasoße'],
  // Gemüse
  [/knoblauchzehe[n]?/i, 'Knoblauch'],
  [/\bknoblauch\b/i, 'Knoblauch'],
  [/kirschtomaten|cocktailtomaten/i, 'Kirschtomaten'],
  [/\btomate[n]?\b/i, 'Tomaten'],
  [/rote?\s+paprika|paprika.*rot/i, 'Paprika (rot)'],
  [/gelbe?\s+paprika|paprika.*gelb/i, 'Paprika (gelb)'],
  [/grüne?\s+paprika|paprika.*grün/i, 'Paprika (grün)'],
  [/\bpaprika\b(?!\s*(pulver|gewürz|scharf|edelsüß))/i, 'Paprika'],
  [/\bzwiebel[n]?\b/i, 'Zwiebeln'],
  [/frühlingszwiebel|lauchzwiebel/i, 'Frühlingszwiebeln'],
  [/\bspinat\b/i, 'Spinat'],
  [/\brucola\b|rucola/i, 'Rucola'],
  [/\bbrokkoli\b/i, 'Brokkoli'],
  [/\bavocado[s]?\b/i, 'Avocado'],
  [/\bgurke[n]?\b/i, 'Gurke'],
  [/\bzucchini\b/i, 'Zucchini'],
  [/champignon[s]?|pilze?/i, 'Champignons'],
  // Obst — IMMER in Stück
  [/\bbanane[n]?\b/i, 'Banane'],
  [/\bapfel\b|äpfel/i, 'Apfel'],
  [/heidelbeere[n]?|blaubeere[n]?/i, 'Heidelbeeren'],
  [/erdbeere[n]?/i, 'Erdbeeren'],
  [/himbeere[n]?/i, 'Himbeeren'],
  [/gemischte?\s*beere[n]?|beere[n]? gemischt/i, 'Beeren (gemischt)'],
  [/\bbeere[n]?\b/i, 'Beeren'],
  [/gemischte?\s*(früchte?|obst)|früchte?.*gemischt/i, 'Gemischte Früchte'],
  [/\bkiwi[s]?\b/i, 'Kiwi'],
  [/\btraube[n]?\b/i, 'Trauben'],
  [/\bmango[s]?\b/i, 'Mango'],
  // Nüsse
  [/mandel[n]?/i, 'Mandeln'],
  [/walnuss|walnüsse/i, 'Walnüsse'],
  [/cashew/i, 'Cashewkerne'],
  [/erdnuss|erdnüsse/i, 'Erdnüsse'],
  [/sonnenblumenkern/i, 'Sonnenblumenkerne'],
  [/kürbiskern/i, 'Kürbiskerne'],
  [/\bsesam\b/i, 'Sesam'],
  [/leinsamen/i, 'Leinsamen'],
  [/chiasamen/i, 'Chiasamen'],
]

function normalizeIngredientName(name: string): string {
  const trimmed = name
    .trim()
    .replace(/\s*(nach geschmack|nach belieben|zum abschmecken|optional|nach bedarf|zum würzen)\s*/gi, '')
    .trim()
  for (const [pattern, standard] of INGREDIENT_ALIASES) {
    if (pattern.test(trimmed)) return standard
  }
  const prepRemoved = trimmed.replace(/^(gekocht[e]?[s]?|gebraten[e]?[s]?|gedünstet[e]?[s]?|gebacken[e]?[s]?|frisch[e]?[s]?|gehackt[e]?[s]?|gerieben[e]?[s]?|gewürfelt[e]?[s]?)\s+/i, '')
  const result = prepRemoved.charAt(0).toUpperCase() + prepRemoved.slice(1)
  return result
}

// Bruchzahlen + Adjektive bereinigen
function preprocessRaw(raw: string): string {
  return raw
    .replace(/½/g, '0.5').replace(/¼/g, '0.25').replace(/¾/g, '0.75')
    .replace(/⅓/g, '0.33').replace(/⅔/g, '0.67')
    .replace(/^(\d+(?:[.,]\d+)?)\s+(große?[s]?|kleine?[s]?|frische?[s]?|reife?[s]?|gehackte?[s]?|geriebene?[s]?|gewürfelte?[s]?)\s+/i, '$1 ')
}

// Komma-getrennte Zutaten splitten: "Salz, Pfeffer, Knoblauchpulver" → 3 Items
function splitIngredientString(raw: string): string[] {
  const trimmed = raw.trim()
  // Hat eine Zahl am Anfang → einzelne Zutat (z.B. "200g Hähnchen, gewürfelt")
  if (/^\d/.test(trimmed)) return [trimmed]
  // Enthält Komma → als Liste behandeln
  if (trimmed.includes(',')) {
    return trimmed.split(',').map(s => s.trim()).filter(s => s.length > 1)
  }
  return [trimmed]
}

interface ParsedAmount {
  value: number
  unit: string
}

function parseIngredient(raw: string): { name: string; parsedAmount: ParsedAmount | null } {
  const cleaned = preprocessRaw(raw)

  // Mit Einheit: "200g Hähnchen", "2 EL Olivenöl"
  const match = cleaned.match(/^(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l|EL|TL|Stück|Pck\.?|Dose[n]?|Tasse[n]?|Bund|Scheibe[n]?|Zehe[n]?|Portion[en]?)\.?\s+(.+)$/i)
  if (match) {
    let value = parseFloat(match[1].replace(',', '.'))
    let unit = match[2].replace(/\.$/,'').toLowerCase()
    const name = normalizeIngredientName(match[3].trim())

    // EL/TL für Nüsse/Samen → Gramm umrechnen (besser summierbar)
    const cat = categorize(name)
    if ((unit === 'el' || unit === 'tl') && (cat === 'Nüsse & Samen' || cat === 'Vorrat')) {
      value = value * (SPOON_WEIGHTS_G[unit] ?? 10)
      unit = 'g'
    }

    // Obst in Gramm → in Stück umrechnen
    const nameKey = name.toLowerCase()
    if (unit === 'g' && PIECE_WEIGHTS_G[nameKey]) {
      value = Math.round(value / PIECE_WEIGHTS_G[nameKey])
      unit = 'stück'
    }

    return { name, parsedAmount: { value, unit } }
  }

  // Nur Zahl: "2 Eier", "1 Banane"
  const countMatch = cleaned.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/)
  if (countMatch) {
    const value = parseFloat(countMatch[1].replace(',', '.'))
    const name = normalizeIngredientName(countMatch[2].trim())
    return { name, parsedAmount: { value, unit: 'stück' } }
  }

  // Kein Maß: "Salz", "Pfeffer"
  const name = normalizeIngredientName(cleaned.trim())
  return { name, parsedAmount: null }
}

function formatAmounts(amounts: ParsedAmount[], hasNoAmount: boolean): string {
  const normalized = amounts.map(a => {
    if (a.unit === 'kg') return { value: a.value * 1000, unit: 'g' }
    if (a.unit === 'l') return { value: a.value * 1000, unit: 'ml' }
    return a
  })

  // Pro Einheit zusammenzählen
  const byUnit: Record<string, number> = {}
  for (const a of normalized) {
    byUnit[a.unit] = (byUnit[a.unit] || 0) + a.value
  }

  const parts = Object.entries(byUnit).map(([unit, total]) => {
    if (unit === 'g' && total >= 1000) return `${+(total / 1000).toFixed(1)} kg`
    if (unit === 'ml' && total >= 1000) return `${+(total / 1000).toFixed(1)} l`
    if (unit === 'stück') return `${Math.round(total)} Stück`
    if (unit === 'scheibe' || unit === 'scheiben') return `${Math.round(total)} Scheiben`
    if (unit === 'el') return `${Math.round(total)} EL`
    if (unit === 'tl') return `${Math.round(total)} TL`
    if (unit === 'dose' || unit === 'dosen') return `${Math.round(total)} Dose(n)`
    if (unit === 'bund') return `${Math.round(total)} Bund`
    if (unit === 'pck' || unit === 'pck.') return `${Math.round(total)} Pck.`
    return `${Math.round(total)} ${unit}`
  })

  if (hasNoAmount && parts.length === 0) return 'nach Bedarf'
  return parts.join(' + ')
}

export const GET = requireAuth(async (_req: NextRequest, userId: string) => {
  const client = await pool.connect()
  try {
    const planRes = await client.query(
      `SELECT wp.id, wp.week_start FROM weekly_plans wp
       WHERE wp.user_id = $1 ORDER BY wp.week_start DESC LIMIT 1`,
      [userId]
    )
    if (planRes.rows.length === 0) return NextResponse.json({ items: [], categories: {} })

    const planId = planRes.rows[0].id
    const mealsRes = await client.query(
      `SELECT recipe_data FROM plan_meals WHERE plan_id = $1 AND skipped = false`,
      [planId]
    )

    // Alle Zutaten sammeln — mit Komma-Split
    const accum: Record<string, { name: string; category: string; amounts: ParsedAmount[]; hasNoAmount: boolean }> = {}

    for (const meal of mealsRes.rows) {
      const recipe = meal.recipe_data as { ingredients?: string[] }
      if (!recipe?.ingredients) continue

      for (const rawIng of recipe.ingredients) {
        const parts = splitIngredientString(rawIng)
        for (const part of parts) {
          if (!part || part.length < 2) continue
          const { name, parsedAmount } = parseIngredient(part)
          if (!name || name.length < 2) continue

          const key = name.toLowerCase().trim()
          if (!accum[key]) {
            accum[key] = { name, category: categorize(name), amounts: [], hasNoAmount: false }
          }
          if (parsedAmount) {
            accum[key].amounts.push(parsedAmount)
          } else {
            accum[key].hasNoAmount = true
          }
        }
      }
    }

    // Konsolidiert
    const byCategory: Record<string, ShoppingItem[]> = {}
    for (const acc of Object.values(accum)) {
      const item: ShoppingItem = {
        name: acc.name,
        amount: formatAmounts(acc.amounts, acc.hasNoAmount),
        category: acc.category,
      }
      if (!byCategory[item.category]) byCategory[item.category] = []
      byCategory[item.category].push(item)
    }

    // Reihenfolge — Vorrat ganz unten
    const categoryOrder = [
      'Fleisch & Fisch', 'Milch & Eier', 'Gemüse', 'Obst',
      'Getreide & Kohlenhydrate', 'Hülsenfrüchte', 'Nüsse & Samen',
      'Sonstiges', 'Vorrat',
    ]
    const sorted: Record<string, ShoppingItem[]> = {}
    for (const cat of categoryOrder) {
      if (byCategory[cat]) sorted[cat] = byCategory[cat].sort((a, b) => a.name.localeCompare(b.name))
    }

    return NextResponse.json({
      planId, weekStart: planRes.rows[0].week_start,
      categories: sorted,
      totalItems: Object.values(accum).length,
    })
  } finally {
    client.release()
  }
})
