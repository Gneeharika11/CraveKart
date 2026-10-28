-- ============================================================================
-- CRAVEKART COCKROACHDB SCHEMA MIGRATION 002 (Non-Destructive Enhancement)
-- 1. Adds contact_phone to restaurant_branches and populates branch-specific
--    Chennai contact numbers without overwriting existing rows.
-- 2. Exposes menu_categories as a compatible SQL view over food_categories.
-- ============================================================================

ALTER TABLE restaurant_branches
  ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(40) NOT NULL DEFAULT '+91 44 2815 4200';

UPDATE restaurant_branches
SET contact_phone = CASE branch_code
  WHEN 'SR-TNAGAR'        THEN '+91 44 2434 1101'
  WHEN 'SR-VELACHERY'     THEN '+91 44 2243 1102'
  WHEN 'SR-ANNANAGAR'     THEN '+91 44 2621 1103'
  WHEN 'TBH-ADYAR'        THEN '+91 44 2441 2201'
  WHEN 'TBH-VELACHERY'    THEN '+91 44 2245 2202'
  WHEN 'TBH-TAMBARAM'     THEN '+91 44 2226 2203'
  WHEN 'UC-NUNGAMBAKKAM'  THEN '+91 44 2833 3301'
  WHEN 'UC-OMR'           THEN '+91 44 2454 3302'
  WHEN 'UC-ANNANAGAR'     THEN '+91 44 2626 3303'
  WHEN 'WR-TNAGAR'        THEN '+91 44 2815 4401'
  WHEN 'WR-ADYAR'         THEN '+91 44 2442 4402'
  WHEN 'WR-PORUR'         THEN '+91 44 2476 4403'
  WHEN 'BD-VELACHERY'     THEN '+91 44 2259 5501'
  WHEN 'BD-OMR'           THEN '+91 44 2450 5502'
  WHEN 'BD-ANNANAGAR'     THEN '+91 44 2618 5503'
  WHEN 'ST-ADYAR'         THEN '+91 44 2445 6601'
  WHEN 'ST-NUNGAMBAKKAM'  THEN '+91 44 2827 6602'
  WHEN 'ST-TAMBARAM'      THEN '+91 44 2239 6603'
  ELSE contact_phone
END;

CREATE OR REPLACE VIEW menu_categories AS
SELECT
  id,
  name,
  slug,
  description,
  image_url,
  display_order,
  is_active,
  created_at,
  updated_at
FROM food_categories;
