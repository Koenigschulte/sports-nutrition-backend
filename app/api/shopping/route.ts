import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import pool from '@/lib/db'

interface ShoppingItem {
  name: string
  amount: string
  category: string
}

// ─── Kategorien ───────────────────────────────────────────────────────────────
// Reihenfolge ist wichtig: erster Treffer gewinnt
const CATEGORY_RULES: [RegExp, string][] = [
  [/h[äa]hnchen|h[üu]hnchen|pute|rind|hack|steak|schnitzel|lachs|thunfisch|fisch|garnelen|wurst|speck|salami/i,
    'Fleisch & Fisch'],
  [/\beier?\b|milch|joghurt|quark|käse|mozzarella|butter|sahne|frischkäse|skyr|hüttenkäse/i,
    'Milch & Eier'],
  [/tomate|spinat|brokkoli|karotte|möhre|zwiebel|knoblauch(?!pulver)|zucchini|gurke|avocado|süßkartoffel|rucola|blumenkohl|lauch|fenchel|erbsen|mais|champignon|pilz|paprika(?!pulver)|salat(?!soße)|kohl|sellerie|ingwer(?!\s*pulver)/i,
    'Gemüse'],
  [/banane|apfel|beere|orange|zitrone|mango|traube|erdbeere|heidelbeere|himbeere|kiwi|ananas|früchte|obst|melone|pfirsich|nektarine/i,
    'Obst'],
  [/reis|nudel|pasta|toast|brot|hafer|quinoa|kartoffel|couscous|bulgur|dinkel|tortilla|wrap|mehl/i,
    'Getreide & Kohlenhydrate'],
  [/linsen|bohnen|kichererbsen|tofu|tempeh|edamame/i,
    'Hülsenfrüchte'],
  [/mandel|walnuss|cashew|erdnuss|sonnenblumenkern|kürbiskern|sesam|leinsamen|chiasamen|pinienkern/i,
    'Nüsse & Samen'],
  // Gewürze & Kräuter SEPARAT von Vorrat — werden ohne Mengenangabe gefiltert
  [/\bsalz\b|pfeffer(?!minz)|paprikapulver|kurkuma|zimt|oregano|basilikum|thymian|rosmarin|kümmel|muskat|curry|knoblauchpulver|zwiebelpulver|chilipulver|ingwerpulver|korianderpulver|kreuzkümmel|kardamom|nelken|lorbeer|petersilie|schnittlauch|dill|minze|salbei|majoran|anis|fenchelsamen/i,
    'Gewürze & Kräuter'],
  // Vorrat: Öle, Saucen, Backzutaten — werden ohne Mengenangabe ebenfalls gefiltert
  [/olivenöl|sonnenblumenöl|rapsöl|sesamöl|kokosöl|\böl\b|essig|sojasoße|sojasauce|senf|honig|ahornsirup|tomatenmark|brühe|bouillon|backpulver|vanille|kakao|kokosmilch|passierte\s*tomaten|zitronensaft|limettensaft|worcester|tabasco|sriracha/i,
    'Vorrat'],
]

function categorize(name: string): string {
  const lower = name.toLowerCase()
  for (const [re, cat] of CATEGORY_RULES) {
    if (re.test(lower)) return cat
  }
  return 'Sonstiges'
}

// ─── Aliases — einheitliche Produktnamen ──────────────────────────────────────
const ALIASES: [RegExp, string][] = [
  // Fleisch & Fisch
  [/h[äa]hnchen(brust)?filet|h[äa]hnchenbrust|h[üu]hnerbrust|h[äa]hnchen\b/i, 'Hähnchenbrustfilet'],
  [/putenbrust(filet)?|putenfilet|pute\b/i, 'Putenbrustfilet'],
  [/rinderhack|hackfleisch/i, 'Rinderhackfleisch'],
  [/lachsfilet|lachs\b/i, 'Lachsfilet'],
  [/thunfisch/i, 'Thunfisch (Dose)'],
  // Getreide & Brot
  [/vollkorn.*toast|toast.*vollkorn/i, 'Vollkorntoast'],
  [/\btoast(brot)?\b/i, 'Toastbrot'],
  [/vollkornbrot/i, 'Vollkornbrot'],
  [/vollkornnudeln|vollkorn.*nudeln|vollkorn.*pasta/i, 'Vollkornnudeln'],
  [/\bnudeln?\b|\bpasta\b/i, 'Nudeln'],
  [/basmati|jasmin.*reis|langkorn.*reis/i, 'Reis'],
  [/\breis\b/i, 'Reis'],
  [/haferflocken|hafer\b/i, 'Haferflocken'],
  [/couscous/i, 'Couscous'],
  [/quinoa/i, 'Quinoa'],
  [/süßkartoffel/i, 'Süßkartoffel'],
  [/kartoffel/i, 'Kartoffeln'],
  // Milch & Eier
  [/magerquark|quark.*mager/i, 'Magerquark'],
  [/\bquark\b/i, 'Quark'],
  [/griechisch.*joghurt|joghurt.*griechisch/i, 'Griechischer Joghurt'],
  [/naturjoghurt/i, 'Naturjoghurt'],
  [/\bjoghurt\b/i, 'Joghurt'],
  [/\beier?\b|hühnerei/i, 'Eier'],
  [/mozzarella/i, 'Mozzarella'],
  [/hüttenkäse|cottage\s*cheese/i, 'Hüttenkäse'],
  // Vorrat
  [/olivenöl/i, 'Olivenöl'],
  [/sojasoße|sojasauce/i, 'Sojasoße'],
  [/tomatenmark/i, 'Tomatenmark'],
  [/passierte\s*tomaten/i, 'Passierte Tomaten'],
  [/gemüsebrühe|hühnerbrühe|rinderbrühe|brühe\b|bouillon/i, 'Gemüsebrühe'],
  [/kokosmilch/i, 'Kokosmilch (Dose)'],
  // Gemüse
  [/knoblauchzehe[n]?|knoblauch(?!pulver)/i, 'Knoblauch'],
  [/kirschtomaten|cocktailtomaten/i, 'Kirschtomaten'],
  [/\btomate[n]?\b/i, 'Tomaten'],
  [/rote?\s*paprika(?!pulver)/i, 'Paprika (rot)'],
  [/gelbe?\s*paprika/i, 'Paprika (gelb)'],
  [/grüne?\s*paprika/i, 'Paprika (grün)'],
  [/\bpaprika\b(?!pulver)/i, 'Paprika'],
  [/\bzwiebel[n]?\b(?!pulver)/i, 'Zwiebeln'],
  [/frühlingszwiebel|lauchzwiebel/i, 'Frühlingszwiebeln'],
  [/\bspinat\b/i, 'Spinat'],
  [/\brucola\b|\brucula\b/i, 'Rucola'],
  [/\bbrokkoli\b/i, 'Brokkoli'],
  [/\bavocado[s]?\b/i, 'Avocado'],
  [/\bgurke[n]?\b/i, 'Gurke'],
  [/\bzucchini\b/i, 'Zucchini'],
  [/champignon[s]?/i, 'Champignons'],
  [/süßkartoffel[n]?/i, 'Süßkartoffel'],
  // Obst
  [/\bbanane[n]?\b/i, 'Banane'],
  [/\bapfel\b|äpfel/i, 'Apfel'],
  [/heidelbeere[n]?|blaubeere[n]?/i, 'Heidelbeeren'],
  [/erdbeere[n]?/i, 'Erdbeeren'],
  [/himbeere[n]?/i, 'Himbeeren'],
  [/gemischte?\s*beere[n]?/i, 'Beeren (gemischt)'],
  [/\bbeere[n]?\b/i, 'Beeren'],
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
  [/erdnussbutter|erdnussmus/i, 'Erdnussmus'],
]

// ─── Normalisierung ───────────────────────────────────────────────────────────
function normalize(raw: string): string {
  let s = raw.trim()

  // 1. Qualifizierende Klammerausdrücke entfernen: "(nach Bedarf)", "(optional)", etc.
  s = s.replace(/\s*\((nach\s+\w+(\s+\w+)?|optional|nach\s+belieben|zum\s+\w+|frisch\s+\w+|getrocknet|tiefgekühlt|aufgetaut|light|mager|fettarm)\)/gi, '')

  // 2. Qualifier ohne Klammern entfernen
  s = s.replace(/\s*(nach geschmack|nach belieben|zum abschmecken|optional|nach bedarf|zum würzen|frisch gemahlen|frisch gepresst|nach wunsch)\b/gi, '')

  // 3. Leere oder fast-leere Klammern bereinigen: "()", "( )", "(,)"
  s = s.replace(/\(\s*[,.]?\s*\)/g, '')

  // 4. Zubereitungsform am Wortanfang
  s = s.replace(/^(gekoch|gebraten|gedünstet|gebacken|gehackt|gerieben|gewürfelt|geschnitten|eingeweicht)[a-z]*\s+/i, '')

  s = s.replace(/\s+/g, ' ').trim()

  // 5. Alias-Lookup (gibt direkt den Standardnamen zurück)
  for (const [re, std] of ALIASES) {
    if (re.test(s)) return std
  }

  // 6. Verbleibende rein beschreibende Klammern entfernen: "(schwarz)", "(weiß)", "(grob)", etc.
  s = s.replace(/\s*\((schwarz|weiß|rot|grün|gelb|hell|dunkel|grob|fein|frisch|ganz|gemahlen|geröstet|roh|natur)\)/gi, '').trim()

  if (!s) return ''
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ─── Komma/Und-Split: "Salz, Pfeffer" → ["Salz", "Pfeffer"] ─────────────────
function splitIngredients(raw: string): string[] {
  const s = raw.trim()
  // Zutat beginnt mit Zahl oder Mengenword → einzeln, kein Split
  if (/^\d/.test(s) || /^(ein|eine|zwei|drei|vier|fünf)\b/i.test(s)) return [s]
  // Kein Komma, kein "und" → einzeln
  if (!s.includes(',') && !/\s+und\s+/i.test(s)) return [s]
  return s.split(/,|\s+und\s+/i)
    .map(p => p.trim())
    .filter(p => p.length > 1)
}

// ─── Stück-Gewichte für g→Stück Umrechnung ───────────────────────────────────
const PIECE_TO_G: Record<string, number> = {
  avocado: 200, tomate: 100, tomaten: 100, paprika: 160,
  gurke: 400, zwiebel: 100, zwiebeln: 100, zucchini: 300,
  banane: 120, apfel: 150, orange: 180, zitrone: 100, kiwi: 90,
}

// EL/TL Gewichte in Gramm
const SPOON_G: Record<string, number> = { el: 12, tl: 4 }

interface Amount { value: number; unit: string }

// ─── Einzelzutat parsen ───────────────────────────────────────────────────────
function parseOne(raw: string): { name: string; amount: Amount | null } {
  // Bruchzeichen normalisieren
  let s = raw
    .replace(/½/g, '0.5').replace(/¼/g, '0.25').replace(/¾/g, '0.75')
    .replace(/⅓/g, '0.33').replace(/⅔/g, '0.67')
  // Adjektiv nach Zahl entfernen: "2 große Avocados" → "2 Avocados"
  s = s.replace(/^(\d+(?:[.,]\d+)?)\s+(große?[s]?|kleine?[s]?|frische?[s]?|reife?[s]?|gehäufte?[s]?)\s+/i, '$1 ')

  // Mit Einheit: "200g Hähnchen", "1 EL Olivenöl", "1 Dose Thunfisch"
  const m = s.match(/^(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l|EL|TL|Stück|Pck\.?|Dose[n]?|Tasse[n]?|Bund|Scheibe[n]?|Zehe[n]?|Portion[en]?)\.?\s+(.+)$/i)
  if (m) {
    let val = parseFloat(m[1].replace(',', '.'))
    let unit = m[2].replace(/\.$/, '').toLowerCase()
    const name = normalize(m[3].trim())
    if (!name) return { name: '', amount: null }
    const cat = categorize(name)
    const nameKey = name.toLowerCase().replace(/\(.*?\)/g, '').trim()

    // EL/TL → g für Nüsse/Samen und Vorrat
    if ((unit === 'el' || unit === 'tl') && (cat === 'Nüsse & Samen' || cat === 'Vorrat' || cat === 'Gewürze & Kräuter')) {
      val = Math.round(val * SPOON_G[unit])
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

  // Nur Zahl: "2 Eier", "1 Avocado", "3 Scheiben Toastbrot"
  const c = s.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/)
  if (c) {
    const val = parseFloat(c[1].replace(',', '.'))
    const name = normalize(c[2].trim())
    if (!name) return { name: '', amount: null }
    return { name, amount: { value: val, unit: 'stück' } }
  }

  // Kein Maß — nur Name
  const name = normalize(s.trim())
  return { name, amount: null }
}

// ─── Mengen formatieren ───────────────────────────────────────────────────────
function formatAmount(amounts: Amount[]): string {
  if (amounts.length === 0) return ''

  // kg→g, l→ml normalisieren
  const norm = amounts.map(a =>
    a.unit === 'kg' ? { value: a.value * 1000, unit: 'g' } :
    a.unit === 'l'  ? { value: a.value * 1000, unit: 'ml' } : a
  )

  // Pro Einheit summieren
  const byUnit: Record<string, number> = {}
  for (const a of norm) byUnit[a.unit] = (byUnit[a.unit] || 0) + a.value

  return Object.entries(byUnit).map(([unit, total]) => {
    const t = Math.round(total * 10) / 10
    if (unit === 'g')  return t >= 1000 ? `${+(t / 1000).toFixed(1)} kg` : `${Math.round(t)} g`
    if (unit === 'ml') return t >= 1000 ? `${+(t / 1000).toFixed(1)} l`  : `${Math.round(t)} ml`
    if (unit === 'stück') return `${Math.round(t)} Stück`
    if (unit === 'scheibe' || unit === 'scheiben') return `${Math.round(t)} Scheiben`
    if (unit === 'dose' || unit === 'dosen')       return `${Math.round(t)} Dose(n)`
    if (unit === 'bund')  return `${Math.round(t)} Bund`
    if (unit === 'pck' || unit === 'pck.') return `${Math.round(t)} Pck.`
    if (unit === 'el')  return `${t % 1 === 0 ? Math.round(t) : t} EL`
    if (unit === 'tl')  return `${t % 1 === 0 ? Math.round(t) : t} TL`
    if (unit === 'zehe' || unit === 'zehen') return `${Math.round(t)} Zehen`
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

    // Zutaten akkumulieren
    const accum: Record<string, {
      name: string
      cat: string
      amounts: Amount[]
      hasNoAmount: boolean
    }> = {}

    for (const meal of mealsRes.rows) {
      const ings: string[] = (meal.recipe_data as { ingredients?: string[] })?.ingredients ?? []
      for (const raw of ings) {
        if (!raw?.trim()) continue
        for (const part of splitIngredients(raw)) {
          if (!part || part.length < 2) continue
          const { name, amount } = parseOne(part)
          if (!name || name.length < 2) continue

          // Dedup-Schlüssel: Kleinbuchstaben, Klammern raus, nur Buchstaben
          const key = name.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-zäöüß]/g, '')
          if (!key) continue

          if (!accum[key]) {
            accum[key] = { name, cat: categorize(name), amounts: [], hasNoAmount: false }
          }
          if (amount) {
            accum[key].amounts.push(amount)
          } else {
            accum[key].hasNoAmount = true
          }
        }
      }
    }

    // Nach Kategorie gruppieren
    const byCategory: Record<string, ShoppingItem[]> = {}

    for (const acc of Object.values(accum)) {
      // Gewürze & Kräuter ohne Mengenangabe → nicht kaufen (immer im Haushalt)
      if (acc.cat === 'Gewürze & Kräuter' && acc.amounts.length === 0) continue
      // Vorrat ohne Mengenangabe → weglassen (z.B. "Olivenöl" ohne Menge)
      if (acc.cat === 'Vorrat' && acc.amounts.length === 0) continue

      const item: ShoppingItem = {
        name: acc.name,
        amount: formatAmount(acc.amounts),
        category: acc.cat,
      }
      if (!byCategory[item.category]) byCategory[item.category] = []
      byCategory[item.category].push(item)
    }

    // Kategorien sortieren
    const order = [
      'Fleisch & Fisch',
      'Milch & Eier',
      'Gemüse',
      'Obst',
      'Getreide & Kohlenhydrate',
      'Hülsenfrüchte',
      'Nüsse & Samen',
      'Sonstiges',
      'Gewürze & Kräuter',
      'Vorrat',
    ]
    const sorted: Record<string, ShoppingItem[]> = {}
    for (const cat of order) {
      if (byCategory[cat]?.length) {
        sorted[cat] = byCategory[cat].sort((a, b) => a.name.localeCompare(b.name))
      }
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
