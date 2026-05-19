-- Phase 3 Migration
-- Run once against sports_nutrition DB

ALTER TABLE plan_meals ADD COLUMN IF NOT EXISTS is_eaten BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE plan_meals ADD COLUMN IF NOT EXISTS eaten_at TIMESTAMPTZ;
