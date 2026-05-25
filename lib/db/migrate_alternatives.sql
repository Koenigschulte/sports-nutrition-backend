-- Migration: alternatives-Spalte für plan_meals
-- Run once against sports_nutrition DB
-- Idempotent: IF NOT EXISTS verhindert Fehler wenn Spalte bereits vorhanden

ALTER TABLE plan_meals
  ADD COLUMN IF NOT EXISTS alternatives JSONB DEFAULT '[]';
