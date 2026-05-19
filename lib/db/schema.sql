-- Sports Nutrition App — PostgreSQL Schema
-- DB: sports_nutrition

-- Users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User profiles (body data + goals)
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Body data (synced from Garmin or manual)
  birth_year INT,
  gender VARCHAR(20), -- male, female, other
  weight_kg DECIMAL(5,2),
  height_cm INT,
  body_fat_percent DECIMAL(4,1),
  -- Goals
  nutrition_goal VARCHAR(50) NOT NULL DEFAULT 'maintain',
  -- lose_weight, gain_weight, maintain, muscle_gain, performance
  -- Diet type
  diet_type VARCHAR(20) NOT NULL DEFAULT 'all',
  -- all, vegetarian, vegan
  -- Household
  household_size INT NOT NULL DEFAULT 3,
  -- Time constraints (JSON: {mon: {breakfast: "home", lunch: "togo", dinner: "home"}, ...})
  time_constraints JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Garmin OAuth connections
CREATE TABLE IF NOT EXISTS garmin_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  oauth_token VARCHAR(500),
  oauth_token_secret VARCHAR(500),
  garmin_user_id VARCHAR(255),
  last_sync_at TIMESTAMPTZ,
  sync_status VARCHAR(50) DEFAULT 'pending', -- pending, syncing, success, error
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Activity history (from Garmin)
CREATE TABLE IF NOT EXISTS activity_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  garmin_activity_id VARCHAR(255) UNIQUE,
  activity_date DATE NOT NULL,
  activity_type VARCHAR(100), -- running, cycling, swimming, etc.
  duration_minutes INT,
  distance_km DECIMAL(6,2),
  calories_burned INT,
  avg_heart_rate INT,
  -- Intensity zones (0-100 scale or hr zones)
  intensity_level VARCHAR(20), -- easy, moderate, hard, very_hard
  training_load DECIMAL(6,2),
  raw_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Food preferences
CREATE TABLE IF NOT EXISTS food_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_name VARCHAR(255) NOT NULL,
  preference_type VARCHAR(20) NOT NULL, -- like, dislike, intolerance, allergy
  source VARCHAR(20) DEFAULT 'voice', -- voice, manual
  raw_voice_input TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Weekly meal plans
CREATE TABLE IF NOT EXISTS weekly_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start DATE NOT NULL, -- Monday of the week
  training_forecast JSONB DEFAULT '{}', -- predicted training per day
  generation_notes TEXT, -- why this plan was generated (e.g. "high training week")
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, week_start)
);

-- Individual meals within a weekly plan
CREATE TABLE IF NOT EXISTS plan_meals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES weekly_plans(id) ON DELETE CASCADE,
  meal_date DATE NOT NULL,
  meal_type VARCHAR(20) NOT NULL, -- breakfast, lunch, dinner, snack
  recipe_id VARCHAR(255), -- Spoonacular recipe ID or internal
  recipe_source VARCHAR(20) DEFAULT 'spoonacular', -- spoonacular, ai_generated
  recipe_data JSONB NOT NULL, -- cached recipe (title, ingredients, instructions, nutrients)
  serving_size INT NOT NULL DEFAULT 1,
  alternatives JSONB DEFAULT '[]', -- array of 3 alternative recipe_data objects
  is_togo BOOLEAN DEFAULT FALSE,
  skipped BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Recipe ratings
CREATE TABLE IF NOT EXISTS recipe_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_id VARCHAR(255) NOT NULL,
  recipe_source VARCHAR(20) DEFAULT 'spoonacular',
  recipe_title VARCHAR(500),
  rating INT CHECK (rating BETWEEN 1 AND 5),
  is_favorite BOOLEAN DEFAULT FALSE,
  cooked_at DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, recipe_id)
);

-- Voice interaction log
CREATE TABLE IF NOT EXISTS voice_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  transcript TEXT NOT NULL,
  intent VARCHAR(100), -- adjust_plan, add_preference, query_plan, spontaneous_situation, etc.
  response_text TEXT,
  action_taken JSONB DEFAULT '{}', -- what changed as a result
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_activity_history_user_date ON activity_history(user_id, activity_date);
CREATE INDEX IF NOT EXISTS idx_plan_meals_plan_date ON plan_meals(plan_id, meal_date);
CREATE INDEX IF NOT EXISTS idx_food_preferences_user ON food_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_voice_logs_user ON voice_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recipe_ratings_user ON recipe_ratings(user_id);
