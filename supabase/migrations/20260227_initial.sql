-- Truck Load Planner Schema

-- ============================================================================
-- TRUCKS
-- ============================================================================

create table if not exists public.trucks (
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

create table if not exists public.case_skus (
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
  
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================================
-- LOAD PLANS
-- ============================================================================

create table if not exists public.load_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  truck_id uuid references public.trucks(id) on delete cascade,
  
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
-- INDEXES
-- ============================================================================

create index if not exists idx_trucks_truck_id on public.trucks(truck_id);
create index if not exists idx_case_skus_sku_id on public.case_skus(sku_id);
create index if not exists idx_load_plans_truck_id on public.load_plans(truck_id);
create index if not exists idx_load_plans_status on public.load_plans(status);

-- ============================================================================
-- RLS POLICIES (public read for now)
-- ============================================================================

alter table public.trucks enable row level security;
alter table public.case_skus enable row level security;
alter table public.load_plans enable row level security;

create policy "Allow public read access" on public.trucks for select using (true);
create policy "Allow public read access" on public.case_skus for select using (true);
create policy "Allow public read access" on public.load_plans for select using (true);
create policy "Allow public write access" on public.load_plans for all using (true);

-- ============================================================================
-- SEED DATA
-- ============================================================================

-- Trucks
insert into public.trucks (truck_id, name, inner_length_mm, inner_width_mm, inner_height_mm, empty_weight_kg, axle_front_x_mm, axle_rear_x_mm, axle_max_front_kg, axle_max_rear_kg, max_lr_imbalance_percent) values
('3-5t-box', '3.5T Box Truck', 4200, 2100, 2100, 2200, 1200, 3800, 1500, 2500, 10.0),
('7-5t-box', '7.5T Box Truck', 5800, 2400, 2400, 3800, 1400, 5200, 3000, 5000, 10.0),
('12t-box', '12T Box Truck', 7200, 2500, 2600, 5500, 1600, 6500, 4500, 8000, 10.0),
('18t-box', '18T Box Truck', 8500, 2500, 2700, 7500, 1800, 7800, 6500, 12000, 10.0);

-- Cases
insert into public.case_skus (sku_id, name, length_mm, width_mm, height_mm, weight_kg, upright_only, allowed_yaw, can_be_base, top_contact_allowed, max_load_above_kg, min_support_ratio, stack_class) values
('case-a1', 'Case A1 (1200x800x1000)', 1200, 800, 1000, 150.0, false, array[0, 90, 180, 270], true, true, 300.0, 0.75, 'pallet'),
('case-a2', 'Case A2 (1200x800x800)', 1200, 800, 800, 120.0, false, array[0, 90, 180, 270], true, true, 250.0, 0.75, 'pallet'),
('case-b1', 'Case B1 (800x600x600)', 800, 600, 600, 60.0, false, array[0, 90, 180, 270], true, true, 150.0, 0.75, 'medium'),
('case-b2', 'Case B2 (800x600x400)', 800, 600, 400, 40.0, false, array[0, 90, 180, 270], true, true, 100.0, 0.75, 'medium'),
('case-c1', 'Case C1 (600x400x400)', 600, 400, 400, 25.0, false, array[0, 90, 180, 270], true, true, 60.0, 0.75, 'small'),
('case-c2', 'Case C2 (600x400x300)', 600, 400, 300, 18.0, false, array[0, 90, 180, 270], true, true, 40.0, 0.75, 'small'),
('case-d1', 'Case D1 (400x300x300)', 400, 300, 300, 12.0, false, array[0, 90, 180, 270], true, true, 30.0, 0.75, 'tiny'),
('case-d2', 'Case D2 (400x300x200)', 400, 300, 200, 8.0, false, array[0, 90, 180, 270], true, true, 20.0, 0.75, 'tiny'),
-- Special cases
('flight-case-1', 'Flight Case Large', 1200, 800, 1200, 200.0, true, array[0, 180], true, true, 50.0, 0.85, 'flight'),
('flight-case-2', 'Flight Case Medium', 800, 600, 800, 100.0, true, array[0, 180], true, true, 30.0, 0.85, 'flight'),
('rack-1', 'Equipment Rack 42U', 600, 800, 2000, 350.0, true, array[0, 180], false, false, 0.0, 1.0, 'rack'),
('amp-case-1', 'Amplifier Case', 600, 500, 600, 80.0, true, array[0, 180], true, true, 20.0, 0.85, 'amp'),
-- Fragile items
('screen-1', 'LED Screen Panel', 1000, 600, 100, 45.0, true, array[0, 180], false, true, 10.0, 1.0, 'fragile'),
('screen-2', 'LED Screen Module', 500, 500, 80, 20.0, true, array[0, 90, 180, 270], false, true, 5.0, 1.0, 'fragile'),
-- Heavy equipment
('generator-1', 'Portable Generator', 1000, 700, 800, 180.0, true, array[0, 180], true, false, 0.0, 1.0, 'heavy'),
('dimmer-1', 'Dimmer Rack', 800, 600, 1200, 150.0, true, array[0, 180], true, false, 0.0, 1.0, 'heavy'),
-- Cables and accessories
('cable-box-1', 'Cable Box Large', 800, 500, 500, 50.0, false, array[0, 90, 180, 270], true, true, 100.0, 0.75, 'cable'),
('cable-box-2', 'Cable Box Medium', 600, 400, 400, 30.0, false, array[0, 90, 180, 270], true, true, 60.0, 0.75, 'cable'),
('truss-1', 'Truss Segment 2m', 2000, 300, 300, 40.0, false, array[0, 90], true, true, 80.0, 0.75, 'truss'),
('truss-2', 'Truss Segment 1m', 1000, 300, 300, 22.0, false, array[0, 90], true, true, 50.0, 0.75, 'truss');
