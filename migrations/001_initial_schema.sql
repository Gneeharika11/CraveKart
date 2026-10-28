-- ============================================================================
-- CRAVEKART COCKROACHDB SCHEMA MIGRATION 001
-- Primary Database: CockroachDB (Distributed SQL, SERIALIZABLE Isolation)
-- Monetary columns use DECIMAL(12, 2) for exact decimal-safe arithmetic.
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(120) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1. users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(25) NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'CUSTOMER' CHECK (role IN ('CUSTOMER', 'ADMIN', 'DEV')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Session store persisted in CockroachDB
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  user_agent TEXT,
  ip_address VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);

-- 2. user_addresses
CREATE TABLE IF NOT EXISTS user_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address_label VARCHAR(40) NOT NULL DEFAULT 'Home',
  formatted_address TEXT NOT NULL,
  place_id VARCHAR(255) NOT NULL,
  latitude DECIMAL(10, 7) NOT NULL,
  longitude DECIMAL(10, 7) NOT NULL,
  house_flat_no VARCHAR(120) NOT NULL,
  building_name VARCHAR(150) NOT NULL DEFAULT '',
  floor_number VARCHAR(50) NOT NULL DEFAULT '',
  landmark VARCHAR(200) NOT NULL DEFAULT '',
  delivery_instructions TEXT NOT NULL DEFAULT '',
  locality VARCHAR(120) NOT NULL DEFAULT '',
  city VARCHAR(100) NOT NULL DEFAULT 'Chennai',
  postal_code VARCHAR(20) NOT NULL DEFAULT '',
  validation_source VARCHAR(50) NOT NULL DEFAULT 'GOOGLE_PLACES_API',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for Address lookup
CREATE INDEX IF NOT EXISTS idx_user_addresses_user_id ON user_addresses(user_id, is_default DESC, created_at DESC);

-- 3. restaurants (Six fictional restaurant brands)
CREATE TABLE IF NOT EXISTS restaurants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(150) NOT NULL UNIQUE,
  slug VARCHAR(150) NOT NULL UNIQUE,
  description TEXT NOT NULL,
  cuisine VARCHAR(200) NOT NULL,
  image_url TEXT NOT NULL,
  banner_url TEXT NOT NULL DEFAULT '',
  rating DECIMAL(3, 2) NOT NULL DEFAULT 4.50 CHECK (rating >= 0 AND rating <= 5.00),
  review_count INT NOT NULL DEFAULT 100,
  price_range VARCHAR(60) NOT NULL,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  offer_badge VARCHAR(120) NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. restaurant_branches (At least 18 branches across Chennai)
CREATE TABLE IF NOT EXISTS restaurant_branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  branch_name VARCHAR(150) NOT NULL,
  branch_code VARCHAR(60) NOT NULL UNIQUE,
  address TEXT NOT NULL,
  locality VARCHAR(120) NOT NULL,
  city VARCHAR(100) NOT NULL DEFAULT 'Chennai',
  latitude DECIMAL(10, 7) NOT NULL,
  longitude DECIMAL(10, 7) NOT NULL,
  opening_hours VARCHAR(120) NOT NULL DEFAULT '10:00 AM - 11:30 PM',
  delivery_fee DECIMAL(12, 2) NOT NULL DEFAULT 35.00 CHECK (delivery_fee >= 0),
  min_order_amount DECIMAL(12, 2) NOT NULL DEFAULT 149.00 CHECK (min_order_amount >= 0),
  estimated_delivery_time VARCHAR(50) NOT NULL DEFAULT '25-35 mins',
  delivery_radius_km DECIMAL(6, 2) NOT NULL DEFAULT 8.50,
  is_delivery_available BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, branch_name)
);

-- Index for Restaurant and branch relationships
CREATE INDEX IF NOT EXISTS idx_restaurant_branches_restaurant_id ON restaurant_branches(restaurant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_restaurant_branches_locality ON restaurant_branches(locality);

-- 14. delivery_zones (Configured delivery radii and bounding polygons for branches in Chennai)
CREATE TABLE IF NOT EXISTS delivery_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES restaurant_branches(id) ON DELETE CASCADE,
  zone_name VARCHAR(150) NOT NULL,
  city VARCHAR(100) NOT NULL DEFAULT 'Chennai',
  center_latitude DECIMAL(10, 7) NOT NULL,
  center_longitude DECIMAL(10, 7) NOT NULL,
  max_radius_km DECIMAL(6, 2) NOT NULL CHECK (max_radius_km > 0),
  polygon_geojson JSONB,
  covered_localities TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id, zone_name)
);

CREATE INDEX IF NOT EXISTS idx_delivery_zones_branch_id ON delivery_zones(branch_id, is_active);

-- 5. food_categories
CREATE TABLE IF NOT EXISTS food_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  slug VARCHAR(100) NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. menu_items (At least 60 menu items across 6 restaurant brands)
CREATE TABLE IF NOT EXISTS menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES food_categories(id) ON DELETE RESTRICT,
  name VARCHAR(160) NOT NULL,
  slug VARCHAR(180) NOT NULL UNIQUE,
  description TEXT NOT NULL,
  image_url TEXT NOT NULL,
  is_veg BOOLEAN NOT NULL DEFAULT true,
  spice_level VARCHAR(30) NOT NULL DEFAULT 'Medium',
  serves_info VARCHAR(60) NOT NULL DEFAULT 'Serves 1',
  preparation_time_mins INT NOT NULL DEFAULT 20,
  is_bestseller BOOLEAN NOT NULL DEFAULT false,
  base_price DECIMAL(12, 2) NOT NULL CHECK (base_price > 0),
  is_available BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_menu_items_restaurant_category ON menu_items(restaurant_id, category_id);

-- 7. branch_menu_items (Branch-specific pricing and availability overrides)
CREATE TABLE IF NOT EXISTS branch_menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES restaurant_branches(id) ON DELETE CASCADE,
  menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  price_override DECIMAL(12, 2) CHECK (price_override IS NULL OR price_override > 0),
  effective_price DECIMAL(12, 2) NOT NULL CHECK (effective_price > 0),
  is_available BOOLEAN NOT NULL DEFAULT true,
  stock_status VARCHAR(40) NOT NULL DEFAULT 'IN_STOCK',
  featured_at_branch BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id, menu_item_id)
);

-- Index for Branch menu lookup
CREATE INDEX IF NOT EXISTS idx_branch_menu_lookup ON branch_menu_items(branch_id, is_available, menu_item_id);

-- 8. carts (Persistent single-branch shopping cart per user)
CREATE TABLE IF NOT EXISTS carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES restaurant_branches(id) ON DELETE SET NULL,
  coupon_code VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for Cart lookup
CREATE INDEX IF NOT EXISTS idx_carts_user_branch ON carts(user_id, branch_id);

-- 9. cart_items
CREATE TABLE IF NOT EXISTS cart_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES restaurant_branches(id) ON DELETE CASCADE,
  menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  quantity INT NOT NULL CHECK (quantity > 0 AND quantity <= 50),
  special_instructions VARCHAR(250) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cart_id, menu_item_id)
);

CREATE INDEX IF NOT EXISTS idx_cart_items_cart_id ON cart_items(cart_id);

-- 10. orders
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number VARCHAR(40) NOT NULL UNIQUE,
  idempotency_key VARCHAR(120) UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL REFERENCES restaurant_branches(id) ON DELETE RESTRICT,
  address_id UUID REFERENCES user_addresses(id) ON DELETE SET NULL,
  delivery_address_snapshot JSONB NOT NULL,
  subtotal DECIMAL(12, 2) NOT NULL CHECK (subtotal >= 0),
  tax_amount DECIMAL(12, 2) NOT NULL CHECK (tax_amount >= 0),
  delivery_fee DECIMAL(12, 2) NOT NULL CHECK (delivery_fee >= 0),
  packaging_fee DECIMAL(12, 2) NOT NULL DEFAULT 15.00 CHECK (packaging_fee >= 0),
  discount_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00 CHECK (discount_amount >= 0),
  final_total DECIMAL(12, 2) NOT NULL CHECK (final_total >= 0),
  payment_method VARCHAR(40) NOT NULL CHECK (payment_method IN ('COD', 'SIMULATED_ONLINE')),
  payment_status VARCHAR(40) NOT NULL CHECK (payment_status IN ('PENDING', 'SIMULATED_PAID', 'COLLECTED', 'FAILED', 'REFUNDED')),
  order_status VARCHAR(40) NOT NULL DEFAULT 'CONFIRMED' CHECK (
    order_status IN (
      'CONFIRMED',
      'PREPARING',
      'READY_FOR_PICKUP',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'CANCELLED'
    )
  ),
  estimated_delivery_time VARCHAR(50) NOT NULL DEFAULT '30-40 mins',
  delivery_distance_km DECIMAL(6, 2) NOT NULL DEFAULT 0.00,
  special_notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for User order history and Orders by status
CREATE INDEX IF NOT EXISTS idx_orders_user_history ON orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_by_status ON orders(order_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_branch_id ON orders(branch_id, created_at DESC);

-- 11. order_items (Immutable item-name and price snapshots at order time)
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id UUID REFERENCES menu_items(id) ON DELETE SET NULL,
  item_name_snapshot VARCHAR(160) NOT NULL,
  category_name_snapshot VARCHAR(100) NOT NULL DEFAULT '',
  is_veg_snapshot BOOLEAN NOT NULL DEFAULT true,
  image_url_snapshot TEXT NOT NULL DEFAULT '',
  unit_price_snapshot DECIMAL(12, 2) NOT NULL CHECK (unit_price_snapshot >= 0),
  quantity INT NOT NULL CHECK (quantity > 0),
  line_total DECIMAL(12, 2) NOT NULL CHECK (line_total >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

-- 12. payments
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  payment_method VARCHAR(40) NOT NULL CHECK (payment_method IN ('COD', 'SIMULATED_ONLINE')),
  payment_status VARCHAR(40) NOT NULL CHECK (payment_status IN ('PENDING', 'SIMULATED_PAID', 'COLLECTED', 'FAILED', 'REFUNDED')),
  amount DECIMAL(12, 2) NOT NULL CHECK (amount >= 0),
  currency VARCHAR(10) NOT NULL DEFAULT 'INR',
  is_simulated BOOLEAN NOT NULL DEFAULT false,
  simulation_reference VARCHAR(120),
  provider_note TEXT NOT NULL DEFAULT '',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);

-- 13. order_status_history (Audit trail of every order status change)
CREATE TABLE IF NOT EXISTS order_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  previous_status VARCHAR(40),
  new_status VARCHAR(40) NOT NULL CHECK (
    new_status IN (
      'CONFIRMED',
      'PREPARING',
      'READY_FOR_PICKUP',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'CANCELLED'
    )
  ),
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_source VARCHAR(80) NOT NULL DEFAULT 'SYSTEM',
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_status_history_order_id ON order_status_history(order_id, created_at ASC);
