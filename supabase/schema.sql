-- Truck Load Planner Schema
-- Run this in Supabase SQL Editor

-- ============================================================================
-- TRUCKS
-- ============================================================================

create table if not exists trucks (
  id uuid primary key default gen_random_uuid(),
  truck_id text unique not null,
  name text not null,
  
  -- Interior dimensions (mm)
  inner_length_mm integer not null,
  inner_width_mm integer not null,
  inner_height_mm integer not null,
  
  -- Weight (kg)
  empty_weight_kg integer not null,
  
  -- Axle configuration
  axle_front_x_mm integer not null,
  axle_rear_x_mm integer not null,
  axle_max_front_kg integer not null,
  axle_max_rear_kg integer not null,
  
  -- Balance
  max_lr_imbalance_percent numeric(5,2) not null default 10.0,
  
  -- Obstacles (JSON array of AABBs)
  obstacles jsonb,
  
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================================
-- CASE SKUs
-- ============================================================================

create table if not exists case_skus (
  id uuid primary key default gen_random_uuid(),
  sku_id text unique not null,
  name text not null,
  
  -- Dimensions (mm)
  length_mm integer not null,
  width_mm integer not null,
  height_mm integer not null,
  
  -- Weight (kg)
  weight_kg numeric(8,3) not null,
  
  -- Orientation constraints
  upright_only boolean not null default false,
  tilt_allowed boolean not null default false,
  allowed_yaw integer[] not null default array[0, 90, 180, 270],
  
  -- Stacking constraints
  can_be_base boolean not null default true,
  top_contact_allowed boolean not null default true,
  max_load_above_kg numeric(8,3) not null default 0,
  
  -- Support requirements
  min_support_ratio numeric(4,3) not null default 0.75,
  
  -- Optional classification
  stack_class text,
  color_hex text,
  is_container boolean not null default false,
  
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================================
-- LOAD PLANS
-- ============================================================================

create table if not exists load_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  truck_id uuid references trucks(id) on delete cascade,
  
  -- Placed instances (JSON array)
  instances jsonb not null default '[]',
  
  -- Metrics (computed)
  total_weight_kg numeric(10,3),
  front_axle_kg numeric(10,3),
  rear_axle_kg numeric(10,3),
  left_weight_kg numeric(10,3),
  right_weight_kg numeric(10,3),
  lr_imbalance_percent numeric(5,2),
  max_stack_height_mm integer,
  
  -- Status
  status text not null default 'draft', -- draft, validated, exported
  
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================================
-- LOAD PLAN ITEMS (for querying individual placements)
-- ============================================================================

create table if not exists load_plan_items (
  id uuid primary key default gen_random_uuid(),
  load_plan_id uuid references load_plans(id) on delete cascade,
  sku_id uuid references case_skus(id),
  
  -- Position (mm)
  position_x integer not null,
  position_y integer not null,
  position_z integer not null,
  
  -- Rotation
  yaw integer not null check (yaw in (0, 90, 180, 270)),
  
  -- Computed AABB (cached)
  aabb_min_x integer,
  aabb_min_y integer,
  aabb_min_z integer,
  aabb_max_x integer,
  aabb_max_y integer,
  aabb_max_z integer,
  
  created_at timestamptz default now()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

create index if not exists idx_trucks_truck_id on trucks(truck_id);
create index if not exists idx_case_skus_sku_id on case_skus(sku_id);
create index if not exists idx_load_plans_truck_id on load_plans(truck_id);
create index if not exists idx_load_plan_items_plan_id on load_plan_items(load_plan_id);
create index if not exists idx_load_plan_items_sku_id on load_plan_items(sku_id);

-- ============================================================================
-- SAMPLE DATA
-- ============================================================================

-- Sample truck
insert into trucks (truck_id, name, inner_length_mm, inner_width_mm, inner_height_mm, empty_weight_kg, axle_front_x_mm, axle_rear_x_mm, axle_max_front_kg, axle_max_rear_kg, max_lr_imbalance_percent)
values 
  ('STANDARD_7_5T', 'Standard 7.5T Box Truck', 7200, 2400, 2400, 3500, 1000, 5500, 4000, 8000, 10.0),
  ('LARGE_18T', 'Large 18T Truck', 12000, 2500, 2700, 8000, 1500, 9500, 6000, 15000, 12.0)
on conflict (truck_id) do nothing;

-- Sample case SKUs
insert into case_skus (sku_id, name, length_mm, width_mm, height_mm, weight_kg, upright_only, can_be_base, max_load_above_kg, min_support_ratio)
values
  ('CASE_A1', 'Standard Flight Case', 800, 600, 400, 45.0, false, true, 90.0, 0.75),
  ('CASE_A2', 'Heavy Equipment Case', 1000, 800, 600, 120.0, true, true, 200.0, 0.80),
  ('CASE_B1', 'Small Parts Box', 400, 300, 300, 15.0, false, true, 45.0, 0.70),
  ('CASE_C1', 'Fragile Monitor Case', 1200, 800, 1000, 35.0, true, false, 0, 0.85),
  ('CASE_D1', 'Cable Drum', 600, 600, 800, 80.0, true, true, 50.0, 0.75)
on conflict (sku_id) do nothing;

-- ============================================================================
-- ROW LEVEL SECURITY (optional, enable if needed)
-- ============================================================================

-- alter table trucks enable row level security;
-- alter table case_skus enable row level security;
-- alter table load_plans enable row level security;
-- alter table load_plan_items enable row level security;

-- ============================================================================
-- VIEWS
-- ============================================================================

create or replace view v_truck_summary as
select 
  t.id,
  t.truck_id,
  t.name,
  t.inner_length_mm,
  t.inner_width_mm,
  t.inner_height_mm,
  (t.inner_length_mm * t.inner_width_mm * t.inner_height_mm) as volume_mm3,
  t.axle_max_front_kg + t.axle_max_rear_kg as max_payload_kg
from trucks t;

create or replace view v_case_sku_summary as
select
  id,
  sku_id,
  name,
  length_mm,
  width_mm,
  height_mm,
  weight_kg,
  (length_mm * width_mm * height_mm) as volume_mm3,
  upright_only,
  can_be_base,
  max_load_above_kg
from case_skus;
