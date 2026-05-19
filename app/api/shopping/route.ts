import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/middleware'
import pool from '@/lib/db'

interface ShoppingItem {
  name: string
  amount: string
  category: string
}

const CATEGORIES: Record<string, string> = {
  // Fleisch & Fisch
  hähnchen: 'Fleisch & Fisch', hühnchen: 'Fleisch & Fisch', huhn: 'Fleisch & Fisch',
  rindfleisch: 'Fleisch & Fisch', lachs: 'Fleisch & Fisch', thunfisch: 'Fleisch & Fisch',
  fisch: 'Fleisch & Fisch', fleisch: 'Fleisch & Fisch', turkey: 'Fleisch & Fisch',
  // Milchprodukte & Eier
  milch: 'Milch & Eier', joghurt: 'Milch & Eier', quark: 'Milch & Eier',
  käse: 'Milch & Eier', ei: 'Milch & Eier', eier: 'Milch & Eier', butter: 'Milch & Eier',
  // Gemüse
  tomate: 'Gemüse', salat: 'Gemüse', spinat: 'Gemüse', brokkoli: 'Gemüse',
  karotte: 'Gemüse', paprika: 'Gemüse', zwiebel: 'Gemüse', knoblauch: 'Gemüse',
  zucchini: 'Gemüse', gurke: 'Gemüse', avocado: 'Gemüse', süßkartoffel: 'Gemüse',
  // Obst
  banane: 'Obst', apfel: 'Obst', beeren: 'Obst', orange: 'Obst', zitrone: 'Obst',
  // Getreide & Kohlenhydrate
  reis: 'Getreide & Kohlenhydrate', nudeln: 'Getreide & Kohlenhydrate', pasta: 'Getreide & Kohlenhydrate',
  brot: 'Getreide & Kohlenhydrate', hafer: 'Getreide & Kohlenhydrate', quinoa: 'Getreide & Kohlenhydrate',
  kartoffel: 'Getreide & Kohlenhydrate',
  // Hülsenfrüchte
  linsen: 'Hülsenfrüchte', bohnen: 'Hülsenfrüchte', kichererbsen: 'Hülsenfrüchte', tofu: 'Hülsenfrüchte',
  // Öle & Würzen
  olivenöl: 'Öle & Gewürze', öl: 'Öle & Gewürze', salz: 'Öle & Gewürze', pfeffer: 'Öle & Gewürze',
}

function categorize(ingredient: string): string {
  const lower = ingredient.toLowerCase()
  for (const [keyword, category] of Object.entries(CATEGORIES)) {
    if (lower.includes(keyword)) return category
  }
  return 'Sonstiges'
}

interface ParsedAmount {
  value: number
  unit: string
}

function parseIngredient(raw: string): { name: string; amount: string; parsedAmount: ParsedAmount | null } {
  const match = raw.match(/^(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l|EL|TL|Stück|Pck|Dose|Tasse|Bund)\.?\s+(.+)$/i)
  if (match) {
    const value = parseFloat(match[1].replace(',', '.'))
    const unit = match[2].toLowerCase()
    return { name: match[3].trim(), amount: match[0].trim(), parsedAmount: { value, unit } }
  }
  return { amount: '', name: raw.trim(), parsedAmount: null }
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

    // Collect all ingredients
    const allIngredients: { name: string; amount: string; parsedAmount: ParsedAmount | null; category: string }[] = []

    for (const meal of mealsRes.rows) {
      const recipe = meal.recipe_data as { ingredients?: string[] }
      if (!recipe?.ingredients) continue
      for (const ing of recipe.ingredients) {
        const { name, amount, parsedAmount } = parseIngredient(ing)
        allIngredients.push({ name, amount, parsedAmount, category: categorize(name) })
      }
    }

    // Consolidate duplicates by name — aggregate amounts numerically
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

    // Group by category
    const byCategory: Record<string, ShoppingItem[]> = {}
    for (const item of Object.values(consolidated)) {
      if (!byCategory[item.category]) byCategory[item.category] = []
      byCategory[item.category].push(item)
    }

    // Sort categories
    const categoryOrder = ['Fleisch & Fisch', 'Milch & Eier', 'Gemüse', 'Obst', 'Getreide & Kohlenhydrate', 'Hülsenfrüchte', 'Öle & Gewürze', 'Sonstiges']
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
