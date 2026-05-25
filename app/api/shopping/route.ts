import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import pool from '@/lib/db'

interface ShoppingItem {
  name: string
  amount: string
  category: string
}

// Kategorisierung — Schlüsselwörter im Zutaten-Namen
const CATEGORIES: [RegExp, string][] = [
  // Fleisch & Fisch
  [/h[äa]hnchen|h[üu]hnchen|h[üu]hn\b|pute[n]?|rind(er)?|hack|steak|schnitzel|lachs|thunfisch|fisch|garnelen|salami|wurst|speck/i, 'Fleisch & Fisch'],
  // Milch & Eier
  [/\beier?\b|milch|joghurt|quark|käse|mozzarella|butter|sahne|frischkäse|skyr|hüttenkäse/i, 'Milch & Eier'],
  // Gemüse
  [/tomate|paprika|spinat|brokkoli|karotte|möhre|zwiebel|knoblauch|zucchini|gurke|avocado|süßkartoffel|salat|feldsalat|rucola|blumenkohl|lauch|sellerie|fenchel|erbsen|mais/i, 'Gemüse'],
  // Obst
  [/banane|apfel|beere[n]?|orange|zitrone|mango|traube[n]?|erdbeere[n]?|heidelbeere[n]?|himbeere[n]?|kiwi|ananas/i, 'Obst'],
  // Getreide & Kohlenhydrate
  [/reis|nudel|pasta|brot|hafer|quinoa|kartoffel|couscous|bulgur|dinkel|mehl|tortilla|wrap|bagel/i, 'Getreide & Kohlenhydrate'],
  // Hülsenfrüchte & Proteine
  [/linsen|bohnen|kichererbsen|tofu|tempeh|edamame/i, 'Hülsenfrüchte'],
  // Nüsse & Samen
  [/mandel[n]?|nuss|nüsse|walnuss|cashew|erdnuss|sonnenblumenkern|kürbiskern|sesam|leinsamen|chiasamen/i, 'Nüsse & Samen'],
  // Vorrat — Dinge die man meist zuhause hat
  [/salz|pfeffer|paprikapulver|kurkuma|zimt|oregano|basilikum|thymian|rosmarin|kümmel|muskat|currypulver|knoblauchpulver|zwiebelpulver|chilipulver|chili|gewürz|olivenöl|sonnenblumenöl|rapsöl|\böl\b|essig|sojasoße|senf|honig|ahornsirup|tomatenmark|brühe|bouillon/i, 'Vorrat'],
]

function categorize(ingredient: string): string {
  for (const [pattern, category] of CATEGORIES) {
    if (pattern.test(ingredient)) return category
  }
  return 'Sonstiges'
}

// Bruchzahlen und Adjektive normalisieren
function preprocessRaw(raw: string): string {
  return raw
    .replace(/½/g, '0.5')
    .replace(/¼/g, '0.25')
    .replace(/¾/g, '0.75')
    .replace(/⅓/g, '0.33')
    .replace(/⅔/g, '0.67')
    // "2 große Eier" → "2 Eier" (Adjektiv zwischen Zahl und Name entfernen)
    .replace(/^(\d+(?:[.,]\d+)?)\s+(große?[s]?|kleine?[s]?|frische?[s]?|reife?[s]?|gehackte?[s]?|geriebene?[s]?)\s+/i, '$1 ')
}

// Varianten-Normalisierung auf Standardnamen
const INGREDIENT_ALIASES: [RegExp, string][] = [
  [/h[äa]hnchen(brust)?filet|h[äa]hnchenbrust|h[üu]hnerbrust|gebraten(e[s]?)?\s+h[äa]hnchen|gekocht(e[s]?)?\s+h[äa]hnchen|h[äa]hnchen\b/i, 'Hähnchenbrustfilet'],
  [/putenbrust(filet)?|putenfilet|pute\b/i, 'Putenbrustfilet'],
  [/rinderhack|hackfleisch.*rind|rind.*hack|hackfleisch/i, 'Rinderhackfleisch'],
  [/lachsfilet|lachs\b/i, 'Lachsfilet'],
  [/thunfisch(dose)?/i, 'Thunfisch (Dose)'],
  // Brot & Toast
  [/vollkorn.*toast|toast.*vollkorn|toastbrot.*vollkorn/i, 'Vollkorntoast'],
  [/\btoast(brot)?\b/i, 'Toastbrot'],
  [/vollkornbrot|vollkorn.*brot|brot.*vollkorn/i, 'Vollkornbrot'],
  [/vollkorn.*brötchen|brötchen.*vollkorn/i, 'Vollkornbrötchen'],
  // Nudeln & Reis
  [/vollkornnudeln|vollkorn.*nudeln|vollkorn.*pasta/i, 'Vollkornnudeln'],
  [/\bnudeln?\b|\bpasta\b/i, 'Nudeln'],
  [/basmati.*reis|jasmin.*reis|langkorn.*reis|vollkorn.*reis/i, 'Reis'],
  [/\breis\b/i, 'Reis'],
  // Haferflocken
  [/haferflocken|hafer\b/i, 'Haferflocken'],
  // Kartoffeln
  [/süßkartoffel[n]?/i, 'Süßkartoffeln'],
  [/kartoffel[n]?/i, 'Kartoffeln'],
  // Milchprodukte
  [/magerquark|quark.*mager/i, 'Magerquark'],
  [/\bquark\b/i, 'Quark'],
  [/griechisch.*joghurt|joghurt.*griechisch/i, 'Griechischer Joghurt'],
  [/\bjoghurt\b/i, 'Joghurt'],
  [/\bmilch\b/i, 'Milch'],
  [/\beier?\b|hühnereier/i, 'Eier'],
  // Öle
  [/olivenöl\b/i, 'Olivenöl'],
  [/sonnenblumenöl/i, 'Sonnenblumenöl'],
  [/rapsöl/i, 'Rapsöl'],
  // Gemüse
  [/knoblauchzehe[n]?/i, 'Knoblauch'],
  [/kirschtomaten|cocktailtomaten/i, 'Kirschtomaten'],
  [/\btomate[n]?\b/i, 'Tomaten'],
  [/rote?\s+paprika|paprika.*rot/i, 'Paprika (rot)'],
  [/gelbe?\s+paprika|paprika.*gelb/i, 'Paprika (gelb)'],
  [/\bpaprika\b(?!\s*(pulver|gewürz|scharf|edelsüß))/i, 'Paprika'],
  [/\bzwiebel[n]?\b/i, 'Zwiebeln'],
  [/frühlingszwiebel[n]?|lauchzwiebel[n]?/i, 'Frühlingszwiebeln'],
  [/\bspinat\b/i, 'Spinat'],
  [/\bbrokkoli\b/i, 'Brokkoli'],
  [/\bavocado[s]?\b/i, 'Avocado'],
  [/\bgurke[n]?\b/i, 'Gurke'],
  [/\bzucchini\b/i, 'Zucchini'],
  // Obst
  [/\bbanane[n]?\b/i, 'Bananen'],
  [/\bapfel\b|äpfel/i, 'Äpfel'],
  [/heidelbeere[n]?|blaubeere[n]?/i, 'Heidelbeeren'],
  [/erdbeere[n]?/i, 'Erdbeeren'],
  [/himbeere[n]?/i, 'Himbeeren'],
  [/gemischte?\s+beere[n]?|beere[n]?/i, 'Beeren (gemischt)'],
  // Nüsse
  [/mandel[n]?/i, 'Mandeln'],
  [/walnuss|walnüsse/i, 'Walnüsse'],
  [/cashew[s]?/i, 'Cashewkerne'],
  [/erdnuss|erdnüsse/i, 'Erdnüsse'],
]

function normalizeIngredientName(name: string): string {
  const trimmed = name.trim()
  for (const [pattern, standard] of INGREDIENT_ALIASES) {
    if (pattern.test(trimmed)) return standard
  }
  // Zubereitungsform am Anfang entfernen
  const prepRemoved = trimmed.replace(/^(gekocht[e]?[s]?|gebraten[e]?[s]?|gedünstet[e]?[s]?|gebacken[e]?[s]?|frisch[e]?[s]?|gehackt[e]?[s]?|gerieben[e]?[s]?)\s+/i, '')
  return prepRemoved.charAt(0).toUpperCase() + prepRemoved.slice(1)
}

interface ParsedAmount {
  value: number
  unit: string
}

function parseIngredient(raw: string): { name: string; amount: string; parsedAmount: ParsedAmount | null } {
  const cleaned = preprocessRaw(raw)
  // Mit Einheit: "200g Hähnchen", "2 EL Olivenöl", "1 Stück Paprika"
  const match = cleaned.match(/^(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l|EL|TL|Stück|Pck\.?|Dose[n]?|Tasse[n]?|Bund|Scheibe[n]?|Zehe[n]?)\.?\s+(.+)$/i)
  if (match) {
    const value = parseFloat(match[1].replace(',', '.'))
    const unit = match[2].replace(/\.$/,'').toLowerCase()
    const name = normalizeIngredientName(match[3].trim())
    return { name, amount: `${match[1]}${match[2]} ${name}`, parsedAmount: { value, unit } }
  }
  // Nur Zahl ohne Einheit: "2 Eier", "3 Bananen" → Einheit = "stück"
  const countMatch = cleaned.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/)
  if (countMatch) {
    const value = parseFloat(countMatch[1].replace(',', '.'))
    const name = normalizeIngredientName(countMatch[2].trim())
    return { name, amount: `${countMatch[1]} ${name}`, parsedAmount: { value, unit: 'stück' } }
  }
  return { amount: '', name: normalizeIngredientName(cleaned.trim()), parsedAmount: null }
}

function formatAmounts(amounts: ParsedAmount[], rawAmounts: string[]): string {
  const normalized = amounts.map(a => {
    if (a.unit === 'kg') return { value: a.value * 1000, unit: 'g' }
    if (a.unit === 'l') return { value: a.value * 1000, unit: 'ml' }
    return a
  })
  const byUnit: Record<string, number> = {}
  for (const a of normalized) {
    const key = a.unit.toLowerCase()
    byUnit[key] = (byUnit[key] || 0) + a.value
  }
  const parts = Object.entries(byUnit).map(([unit, total]) => {
    if (unit === 'g' && total >= 1000) return `${+(total / 1000).toFixed(1)}kg`
    if (unit === 'ml' && total >= 1000) return `${+(total / 1000).toFixed(1)}l`
    if (unit === 'stück') return `${Math.round(total)} Stück`
    return `${Math.round(total)}${unit}`
  })
  return [...parts, ...rawAmounts].join(' + ')
}

export const GET = requireAuth(async (_req: NextRequest, userId: string) => {
  const client = await pool.connect()
  try {
    const planRes = await client.query(
      `SELECT wp.id, wp.week_start
       FROM weekly_plans wp
       WHERE wp.user_id = $1
       ORDER BY wp.week_start DESC LIMIT 1`,
      [userId]
    )
    if (planRes.rows.length === 0) {
      return NextResponse.json({ items: [], categories: {} })
    }

    const planId = planRes.rows[0].id

    const mealsRes = await client.query(
      `SELECT recipe_data, serving_size FROM plan_meals WHERE plan_id = $1 AND skipped = false`,
      [planId]
    )

    const allIngredients: { name: string; amount: string; parsedAmount: ParsedAmount | null; category: string }[] = []

    for (const meal of mealsRes.rows) {
      const recipe = meal.recipe_data as { ingredients?: string[] }
      if (!recipe?.ingredients) continue
      for (const ing of recipe.ingredients) {
        const { name, amount, parsedAmount } = parseIngredient(ing)
        allIngredients.push({ name, amount, parsedAmount, category: categorize(name) })
      }
    }

    // Zusammenzählen nach normalisiertem Namen
    const accum: Record<string, { name: string; category: string; amounts: ParsedAmount[]; rawAmounts: string[] }> = {}
    for (const item of allIngredients) {
      const key = item.name.toLowerCase().trim()
      if (!accum[key]) {
        accum[key] = { name: item.name, category: item.category, amounts: [], rawAmounts: [] }
      }
      if (item.parsedAmount) {
        accum[key].amounts.push(item.parsedAmount)
      } else if (item.amount) {
        if (!accum[key].rawAmounts.includes(item.amount)) {
          accum[key].rawAmounts.push(item.amount)
        }
      }
    }

    const consolidated: Record<string, ShoppingItem> = {}
    for (const [key, acc] of Object.entries(accum)) {
      consolidated[key] = {
        name: acc.name,
        amount: formatAmounts(acc.amounts, acc.rawAmounts),
        category: acc.category,
      }
    }

    // Nach Kategorie gruppieren
    const byCategory: Record<string, ShoppingItem[]> = {}
    for (const item of Object.values(consolidated)) {
      if (!byCategory[item.category]) byCategory[item.category] = []
      byCategory[item.category].push(item)
    }

    // Kategorie-Reihenfolge
    const categoryOrder = [
      'Fleisch & Fisch',
      'Milch & Eier',
      'Gemüse',
      'Obst',
      'Getreide & Kohlenhydrate',
      'Hülsenfrüchte',
      'Nüsse & Samen',
      'Sonstiges',
      'Vorrat',  // ganz unten — meist schon zuhause vorhanden
    ]
    const sorted: Record<string, ShoppingItem[]> = {}
    for (const cat of categoryOrder) {
      if (byCategory[cat]) sorted[cat] = byCategory[cat].sort((a, b) => a.name.localeCompare(b.name))
    }

    return NextResponse.json({
      planId,
      weekStart: planRes.rows[0].week_start,
      categories: sorted,
      totalItems: Object.values(consolidated).length,
    })
  } finally {
    client.release()
  }
})
