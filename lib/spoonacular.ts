import axios from 'axios'

const API_KEY = process.env.SPOONACULAR_API_KEY
const BASE_URL = 'https://api.spoonacular.com'

export interface SpoonacularRecipe {
  id: number
  title: string
  image: string
  readyInMinutes: number
  servings: number
  nutrition?: {
    nutrients: { name: string; amount: number; unit: string }[]
  }
  analyzedInstructions?: { steps: { number: number; step: string }[] }[]
  extendedIngredients?: { original: string }[]
}

export interface RecipeData {
  spoonacularId: string | null
  title: string
  imageUrl: string | null
  prepMinutes: number
  servings: number
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  ingredients: string[]
  instructions: string
  isTogo: boolean
}

export async function findRecipe(
  query: string,
  dietType: string,
  targetCalories: number,
  isTogo: boolean
): Promise<RecipeData | null> {
  if (!API_KEY || API_KEY === 'PLACEHOLDER_SPOONACULAR_KEY') {
    return null  // Use Claude-generated data when no API key
  }

  try {
    const diet = dietType === 'vegan' ? 'vegan' : dietType === 'vegetarian' ? 'vegetarian' : undefined

    const searchRes = await axios.get(`${BASE_URL}/recipes/complexSearch`, {
      params: {
        apiKey: API_KEY,
        query,
        diet,
        maxReadyTime: isTogo ? 15 : 45,
        minCalories: Math.round(targetCalories * 0.8),
        maxCalories: Math.round(targetCalories * 1.2),
        addRecipeNutrition: true,
        number: 5,
        language: 'de',
      },
    })

    const results = searchRes.data?.results
    if (!results || results.length === 0) return null

    const recipe: SpoonacularRecipe = results[0]
    return extractRecipeData(recipe, isTogo)
  } catch (err) {
    console.error('Spoonacular error:', err)
    return null
  }
}

export async function getRecipeById(spoonacularId: number): Promise<RecipeData | null> {
  if (!API_KEY || API_KEY === 'PLACEHOLDER_SPOONACULAR_KEY') return null

  try {
    const res = await axios.get(`${BASE_URL}/recipes/${spoonacularId}/information`, {
      params: { apiKey: API_KEY, includeNutrition: true },
    })
    return extractRecipeData(res.data, false)
  } catch {
    return null
  }
}

function extractRecipeData(recipe: SpoonacularRecipe, isTogo: boolean): RecipeData {
  const nutrients = recipe.nutrition?.nutrients || []
  const get = (name: string) => nutrients.find(n => n.name === name)?.amount || 0

  const steps = recipe.analyzedInstructions?.[0]?.steps || []
  const instructions = steps.length > 0
    ? steps.map(s => `${s.number}. ${s.step}`).join(' ')
    : 'Zubereitung siehe Rezept.'

  return {
    spoonacularId: String(recipe.id),
    title: recipe.title,
    imageUrl: recipe.image || null,
    prepMinutes: recipe.readyInMinutes || 30,
    servings: recipe.servings || 1,
    calories: Math.round(get('Calories')),
    proteinG: Math.round(get('Protein')),
    carbsG: Math.round(get('Carbohydrates')),
    fatG: Math.round(get('Fat')),
    ingredients: recipe.extendedIngredients?.map(i => i.original) || [],
    instructions,
    isTogo,
  }
}
