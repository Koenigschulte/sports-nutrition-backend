import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import pool from '@/lib/db'

interface ShoppingItem {
  name: string
  amount: string
  category: string
}

// ─── Kategorien ──────────────────────────────────────────────────────────────
const CATEGORY_RULES: [RegExp, string][] = [
  [/h[äa]hnchen|h[üu]hnchen|pute|rind|hack|steak|schnitzel|lachs|thunfisch|fisch|garnelen|wurst|speck/i, 'Fleisch & Fisch'],
  [/\beier?\b|milch|joghurt|quark|käse|mozzarella|butter|sahne|frischkäse|skyr/i, 'Milch & Eier'],
  [/tomate|spinat|brokkoli|karotte|möhre|zwiebel|knoblauch(?!pulver)|zucchini|gurke|avocado|süßkartoffel|rucola|blumenkohl|lauch|fenchel|erbsen|mais|champignon|pilz|paprika(?!pulver)|salat(?!soße)/i, 'Gemüse'],
  [/banane|apfel|beere|orange|zitrone|mango|traube|erdbeere|heidelbeere|himbeere|kiwi|ananas|früchte|obst/i, 'Obst'],
  [/reis|nudel|pasta|toast|brot|hafer|quinoa|kartoffel|couscous|bulgur|dinkel|tortilla|wrap/i, 'Getreide & Kohlenhydrate'],
  [/linsen|bohnen|kichererbsen|tofu|tempeh|edamame/i, 'Hülsenfrüchte'],
  [/mandel|walnuss|cashew|erdnuss|sonnenblumenkern|kürbiskern|sesam|leinsamen|chiasamen/i, 'Nüsse & Samen'],
  [/salz|pfeffer|paprikapulver|kurkuma|zimt|oregano|basilikum|thymian|rosmarin|kümmel|muskat|curry|knoblauchpulver|zwiebelpulver|chilipulver|gewürz|olivenöl|sonnenblumenöl|rapsöl|\böl\b|essig|sojasoße|senf|honig|ahornsirup|tomatenmark|brühe|bouillon|backpulver|vanille|kakao/i, 'Vorrat'],
]

function categorize(name: string): string {
  const lower = name.toLowerCase()
  for (const [re, cat] of CATEGORY_RULES) {
    if (re.test(lower)) return cat
  }
  return 'Sonstiges'
}

// ─── Normalisierung ───────────────────────────────────────────────────────────
const ALIASES: [RegExp, string][] = [
  // Fleisch
  [/h[äa]hnchen(brust)?filet|h[äa]hnchenbrust|h[üu]hnerbrust|h[äa]hnchen\b/i, 'Hähnchenbrustfilet'],
  [/putenbrust(filet)?|putenfilet|pute\b/i, 'Putenbrustfilet'],
  [/rinderhack|hackfleisch/i, 'Rinderhackfleisch'],
  [/lachsfilet|lachs\b/i, 'Lachsfilet'],
  [/thunfisch/i, 'Thunfisch (Dose)'],
  // Brot & Getreide
  [/vollkorn.*toast|toast.*vollkorn/i, 'Vollkorntoast'],
  [/\btoast(brot)?\b/i, 'Toastbrot'],
  [/vollkornbrot|vollkorn.*brot/i, 'Vollkornbrot'],
  [/vollkornnudeln|vollkorn.*nudeln|vollkorn.*pasta/i, 'Vollkornnudeln'],
  [/\bnudeln?\b|\bpasta\b/i, 'Nudeln'],
  [/basmati|jasmin.*reis|langkorn.*reis/i, 'Reis'],
  [/\breis\b/i, 'Reis'],
  [/haferflocken|hafer\b/i, 'Haferflocken'],
  [/couscous/i, 'Couscous'],
  [/quinoa/i, 'Quinoa'],
  [/süßkartoffel/i, 'Süßkartoffel'],
  [/kartoffel/i, 'Kartoffel'],
  // Milch
  [/magerquark|quark.*mager/i, 'Magerquark'],
  [/\bquark\b/i, 'Quark'],
  [/griechisch.*joghurt|joghurt.*griechisch/i, 'Griechischer Joghurt'],
  [/\bjoghurt\b/i, 'Joghurt'],
  [/\beier?\b|hühnerei/i, 'Eier'],
  // Öle & Vorrat
  [/olivenöl/i, 'Olivenöl'],
  [/sojasoße|sojasauce/i, 'Sojasoße'],
  [/tomatenmark/i, 'Tomatenmark'],
  [/gemüsebrühe|hühnerbrühe|rinderbrühe|brühe\b/i, 'Gemüsebrühe'],
  // Gemüse
  [/knoblauchzehe[n]?|knoblauch(?!pulver)/i, 'Knoblauch'],
  [/kirschtomaten|cocktailtomaten/i, 'Kirschtomaten'],
  [/\btomate[n]?\b/i, 'Tomaten'],
  [/rote?\s*paprika(?!pulver)/i, 'Paprika (rot)'],
  [/gelbe?\s*paprika/i, 'Paprika (gelb)'],
  [/grüne?\s*paprika/i, 'Paprika (grün)'],
  [/\bpaprika\b(?!pulver)/i, 'Paprika'],
  [/\bzwiebel[n]?\b/i, 'Zwiebeln'],
  [/frühlingszwiebel|lauchzwiebel/i, 'Frühlingszwiebeln'],
  [/\bspinat\b/i, 'Spinat'],
  [/\brucola\b/i, 'Rucola'],
  [/\bbrokkoli\b/i, 'Brokkoli'],
  [/\bavocado[s]?\b/i, 'Avocado'],
  [/\bgurke[n]?\b/i, 'Gurke'],
  [/\bzucchini\b/i, 'Zucchini'],
  [/champignon[s]?/i, 'Champignons'],
  // Obst
  [/\bbanane[n]?\b/i, 'Banane'],
  [/\bapfel\b|äpfel/i, 'Apfel'],
  [/heidelbeere[n]?|blaubeere[n]?/i, 'Heidelbeeren'],
  [/erdbeere[n]?/i, 'Erdbeeren'],
  [/himbeere[n]?/i, 'Himbeeren'],
  [/gemischte?\s*beere[n]?/i, 'Beeren (gemischt)'],
  [/\bbeere[n]?\b/i, 'Beeren'],
  [/gemischte?\s*(früchte?|obst)/i, 'Gemischte Früchte'],
  [/\bkiwi[s]?\b/i, 'Kiwi'],
  [/\btraube[n]?\b/i, 'Trauben'],
  [/\bmango[s]?\b/i, 'Mango'],
  // Nüsse
  [/mandel[n]?/i, 'Mandeln'],
  [/walnuss|walnüsse/i, 'Walnüsse'],
  [/cashew/i, 'Cashewkerne'],
  [/sonnenblumenkern/i, 'Sonnenblumenkerne'],
  [/kürbiskern/i, 'Kürbiskerne'],
  [/chiasamen/i, 'Chiasamen'],
  [/leinsamen/i, 'Leinsamen'],
  [/\bsesam\b/i, 'Sesam'],
]

function normalize(raw: string): string {
  // Qualifier entfernen
  let s = raw
    .replace(/\s*(nach geschmack|nach belieben|zum abschmecken|optional|nach bedarf|zum würzen|frisch gemahlen|frisch gepresst)\b/gi, '')
    .replace(/\(\s*\)/g, '')   // leere Klammern "()"
    .replace(/\s+/g, ' ')
    .trim()
  // Zubereitungsform am Anfang
  s = s.replace(/^(gekoch|gebraten|gedünstet|gebacken|frisch|gehackt|gerieben|gewürfelt|roh)[a-z]*\s+/i, '')
  // Alias-Lookup
  for (const [re, std] of ALIASES) {
    if (re.test(s)) return std
  }
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ─── Split "Salz, Pfeffer" und "Salz und Pfeffer" ────────────────────────────
function splitIngredients(raw: string): string[] {
  const s = raw.trim()
  // Hat eine Zahl/Menge am Anfang → einzelne Zutat, kein Split
  if (/^\d/.test(s) || /^(ein|eine|zwei|drei)\b/i.test(s)) return [s]
  // Kein Komma, kein " und " → einzeln
  if (!s.includes(',') && !/\s+und\s+/i.test(s)) return [s]
  // Split by comma oder " und "
  return s.split(/,|\s+und\s+/i)
    .map(p => p.trim())
    .filter(p => p.length > 1)
}

// ─── Durchschnittsgewichte für Stück→Gramm (Obst/Gemüse) ─────────────────────
const PIECE_TO_G: Record<string, number> = {
  banane: 120, apfel: 150, orange: 180, zitrone: 100, kiwi: 90,
  avocado: 200, tomate: 100, tomaten: 100, paprika: 160, gurke: 400,
  zwiebel: 100, zwiebeln: 100, zucchini: 300,
}

// EL/TL Gewichte (g) für Vorrat & Nüsse
const SPOON_G: Record<string, number> = { el: 12, tl: 4 }

interface Amount { value: number; unit: string }

function parseOne(raw: string): { name: string; amount: Amount | null } {
  // Bruchzeichen
  let s = raw
    .replace(/½/g, '0.5').replace(/¼/g, '0.25').replace(/¾/g, '0.75')
    .replace(/⅓/g, '0.33').replace(/⅔/g, '0.67')
  // "2 große X" → "2 X"
  s = s.replace(/^(\d+(?:[.,]\d+)?)\s+(große?[s]?|kleine?[s]?|frische?[s]?|reife?[s]?)\s+/i, '$1 ')

  // Mit Einheit
  const m = s.match(/^(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l|EL|TL|Stück|Pck\.?|Dose[n]?|Tasse[n]?|Bund|Scheibe[n]?|Zehe[n]?|Portion[en]?)\.?\s+(.+)$/i)
  if (m) {
    let val = parseFloat(m[1].replace(',', '.'))
    let unit = m[2].replace(/\.$/, '').toLowerCase()
    const name = normalize(m[3].trim())
    const cat = categorize(name)
    const nameKey = name.toLowerCase().replace(/\(.*\)/g, '').trim()
    // EL/TL → g für Nüsse/Samen/Vorrat
    if ((unit === 'el' || unit === 'tl') && (cat === 'Nüsse & Samen' || cat === 'Vorrat')) {
      val = val * SPOON_G[unit]
      unit = 'g'
    }
    // g/kg → Stück für zählbares Obst/Gemüse
    if ((unit === 'g' || unit === 'kg') && PIECE_TO_G[nameKey]) {
      const grams = unit === 'kg' ? val * 1000 : val
      val = Math.max(1, Math.round(grams / PIECE_TO_G[nameKey]))
      unit = 'stück'
    }
    return { name, amount: { value: val, unit } }
  }

  // Nur Zahl: "2 Eier", "1 Avocado"
  const c = s.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/)
  if (c) {
    const val = parseFloat(c[1].replace(',', '.'))
    const name = normalize(c[2].trim())
    return { name, amount: { value: val, unit: 'stück' } }
  }

  // Kein Maß
  const name = normalize(s.trim())
  return { name, amount: null }
}

function formatAmount(amounts: Amount[], hasNoAmount: boolean): string {
  if (amounts.length === 0) return hasNoAmount ? 'nach Bedarf' : ''

  // Normalisieren: kg→g, l→ml
  const norm = amounts.map(a =>
    a.unit === 'kg' ? { value: a.value * 1000, unit: 'g' } :
    a.unit === 'l'  ? { value: a.value * 1000, unit: 'ml' } : a
  )

  // Pro Einheit summieren
  const byUnit: Record<string, number> = {}
  for (const a of norm) byUnit[a.unit] = (byUnit[a.unit] || 0) + a.value

  return Object.entries(byUnit).map(([unit, total]) => {
    const t = Math.round(total * 10) / 10
    if (unit === 'g')       return t >= 1000 ? `${+(t/1000).toFixed(1)} kg` : `${Math.round(t)} g`
    if (unit === 'ml')      return t >= 1000 ? `${+(t/1000).toFixed(1)} l`  : `${Math.round(t)} ml`
    if (unit === 'stück')   return `${Math.round(t)}×`
    if (unit === 'scheibe' || unit === 'scheiben') return `${Math.round(t)} Scheiben`
    if (unit === 'dose' || unit === 'dosen')       return `${Math.round(t)} Dose(n)`
    if (unit === 'bund')    return `${Math.round(t)} Bund`
    if (unit === 'pck' || unit === 'pck.') return `${Math.round(t)} Pck.`
    if (unit === 'el')      return `${Math.round(t)} EL`
    if (unit === 'tl')      return `${Math.round(t)} TL`
    return `${Math.round(t)} ${unit}`
  }).join(' + ')
}

// ─── Handler ──────────────────────────────────────────────────────────────────
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

    // Akkumulieren
    const accum: Record<string, { name: string; cat: string; amounts: Amount[]; hasNoAmount: boolean }> = {}

    for (const meal of mealsRes.rows) {
      const ings: string[] = (meal.recipe_data as { ingredients?: string[] })?.ingredients ?? []
      for (const raw of ings) {
        for (const part of splitIngredients(raw)) {
          if (!part || part.length < 2) continue
          const { name, amount } = parseOne(part)
          if (!name || name.length < 2) continue
          const key = name.toLowerCase().replace(/[^a-zäöü]/g, '')
          if (!accum[key]) accum[key] = { name, cat: categorize(name), amounts: [], hasNoAmount: false }
          if (amount) accum[key].amounts.push(amount)
          else accum[key].hasNoAmount = true
        }
      }
    }

    // Gruppieren
    const byCategory: Record<string, ShoppingItem[]> = {}
    for (const acc of Object.values(accum)) {
      const item: ShoppingItem = {
        name: acc.name,
        amount: formatAmount(acc.amounts, acc.hasNoAmount),
        category: acc.cat,
      }
      if (!byCategory[item.category]) byCategory[item.category] = []
      byCategory[item.category].push(item)
    }

    const order = [
      'Fleisch & Fisch', 'Milch & Eier', 'Gemüse', 'Obst',
      'Getreide & Kohlenhydrate', 'Hülsenfrüchte', 'Nüsse & Samen',
      'Sonstiges', 'Vorrat',
    ]
    const sorted: Record<string, ShoppingItem[]> = {}
    for (const cat of order) {
      if (byCategory[cat]) sorted[cat] = byCategory[cat].sort((a, b) => a.name.localeCompare(b.name))
    }

    return NextResponse.json({
      planId,
      weekStart: planRes.rows[0].week_start,
      categories: sorted,
      totalItems: Object.values(accum).length,
    })
  } finally {
    client.release()
  }
})
