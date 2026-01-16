-- 002_add_revenue_fields.sql
-- Add revenue, roi, and profit fields to daily_stats table

ALTER TABLE daily_stats
ADD COLUMN IF NOT EXISTS revenue DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS roi DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS profit DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS conversion_value DECIMAL(10,2);
