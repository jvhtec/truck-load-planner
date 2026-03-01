-- Migration: Multi-axle rigid vehicles and tractor-trailer rigs
-- Engine v3.x — adds support for N-axle groups and coupled tractor+trailer

-- ============================================================================
-- RIGID VEHICLES (multi-axle body — used for trailer bodies and multi-axle trucks)
-- ============================================================================

create table if not exists public.rigid_vehicles (
  id                       uuid primary key default gen_random_uuid(),
  vehicle_id               text unique not null,
  name                     text not null,
  inner_length_mm          integer not null,
  inner_width_mm           integer not null,
  inner_height_mm          integer not null,
  empty_weight_kg          numeric(10,3) not null,
  -- X coordinate of vehicle's own empty centre-of-mass (from front of body, mm)
  empty_com_x_mm           numeric(10,3) not null,
  max_lr_imbalance_percent numeric(5,2)  not null default 10.0,
  -- Optional JSON array of AABB keepouts [{min:{x,y,z},max:{x,y,z}}, ...]
  obstacles                jsonb,
  created_at               timestamptz default now(),
  updated_at               timestamptz default now()
);

-- ============================================================================
-- AXLE GROUPS (belong to a rigid_vehicle; one row per physical axle group)
-- ============================================================================

create table if not exists public.axle_groups (
  id                uuid primary key default gen_random_uuid(),
  -- The rigid_vehicle this axle group belongs to
  vehicle_id        uuid not null references public.rigid_vehicles(id) on delete cascade,
  -- Short identifier: "steer" | "drive" | "trailer" | "tag" | custom
  axle_id           text not null,
  -- Position from front of vehicle body (mm)
  x_mm              numeric(10,3) not null,
  -- Maximum legal load on this axle group (kg)
  max_kg            numeric(10,3) not null,
  -- Optional minimum load (e.g. steer axle steering authority; kg)
  min_kg            numeric(10,3),
  -- Display/sort order (0 = front-most)
  sort_order        integer not null default 0,
  created_at        timestamptz default now()
);

create index if not exists idx_axle_groups_vehicle_id on public.axle_groups(vehicle_id);

-- ============================================================================
-- TRACTOR-TRAILER RIGS (couples two rigid_vehicles via a kingpin)
-- ============================================================================

create table if not exists public.tractor_trailer_rigs (
  id                            uuid primary key default gen_random_uuid(),
  -- Short human-readable identifier (e.g. "18t-semi-6x4")
  rig_id                        text unique not null,
  name                          text not null,
  -- Foreign keys to the two rigid_vehicle bodies
  tractor_id                    uuid not null references public.rigid_vehicles(id),
  trailer_id                    uuid not null references public.rigid_vehicles(id),
  -- Kingpin position in the trailer body frame (mm from front of trailer)
  kingpin_x_on_trailer_mm       numeric(10,3) not null,
  -- Fifth-wheel / kingpin position in the tractor body frame (mm from front of tractor)
  kingpin_x_on_tractor_mm       numeric(10,3) not null,
  -- Optional maximum vertical kingpin load (kg); null = unconstrained
  max_kingpin_kg                numeric(10,3),
  created_at                    timestamptz default now(),
  updated_at                    timestamptz default now()
);

create index if not exists idx_tractor_trailer_rigs_tractor_id
  on public.tractor_trailer_rigs(tractor_id);
create index if not exists idx_tractor_trailer_rigs_trailer_id
  on public.tractor_trailer_rigs(trailer_id);

-- ============================================================================
-- LOAD PLANS — extend to support tractor-trailer metrics
-- ============================================================================

alter table public.load_plans
  add column if not exists rig_id           uuid references public.tractor_trailer_rigs(id),
  add column if not exists kingpin_kg       numeric(10,3),
  -- Serialised AxleGroupLoad[] — all axle group loads for the saved plan
  add column if not exists axle_group_loads jsonb;

-- ============================================================================
-- ROW LEVEL SECURITY (mirrors existing policy on trucks table)
-- ============================================================================

alter table public.rigid_vehicles        enable row level security;
alter table public.axle_groups           enable row level security;
alter table public.tractor_trailer_rigs  enable row level security;

-- Public read access (same pattern as existing trucks table)
create policy "Allow public read rigid_vehicles"
  on public.rigid_vehicles for select using (true);

create policy "Allow authenticated write rigid_vehicles"
  on public.rigid_vehicles for all
  using (true) with check (true);

create policy "Allow public read axle_groups"
  on public.axle_groups for select using (true);

create policy "Allow authenticated write axle_groups"
  on public.axle_groups for all
  using (true) with check (true);

create policy "Allow public read tractor_trailer_rigs"
  on public.tractor_trailer_rigs for select using (true);

create policy "Allow authenticated write tractor_trailer_rigs"
  on public.tractor_trailer_rigs for all
  using (true) with check (true);

-- ============================================================================
-- SEED DATA: sample 40-ft EU semi-trailer rig (tractor 6×4 + 13.6m trailer)
-- ============================================================================

-- Step 1: Insert trailer body
with trailer_ins as (
  insert into public.rigid_vehicles
    (vehicle_id, name,
     inner_length_mm, inner_width_mm, inner_height_mm,
     empty_weight_kg, empty_com_x_mm,
     max_lr_imbalance_percent)
  values
    ('semi-trailer-13600', '13.6m Curtainsider Trailer',
     13600, 2400, 2700,
     6500, 6800,
     10.0)
  on conflict (vehicle_id) do nothing
  returning id
),

-- Step 2: Insert axle group for trailer
trailer_axle_ins as (
  insert into public.axle_groups
    (vehicle_id, axle_id, x_mm, max_kg, min_kg, sort_order)
  select t.id, 'trailer', 12200, 18000, null, 0
  from trailer_ins t
  returning vehicle_id as t_id
),

-- Step 3: Insert tractor body
tractor_ins as (
  insert into public.rigid_vehicles
    (vehicle_id, name,
     inner_length_mm, inner_width_mm, inner_height_mm,
     empty_weight_kg, empty_com_x_mm,
     max_lr_imbalance_percent)
  values
    ('tractor-6x4-eu', '6×4 Tractor Unit (EU)',
     0, 0, 0,
     8000, 2100,
     10.0)
  on conflict (vehicle_id) do nothing
  returning id
),

-- Step 4: Insert steer and drive axle groups for tractor
tractor_axles_ins as (
  insert into public.axle_groups
    (vehicle_id, axle_id, x_mm, max_kg, min_kg, sort_order)
  select tc.id, 'steer', 1400, 7100, 1500, 0
  from tractor_ins tc
  union all
  select tc.id, 'drive', 3600, 17500, null, 1
  from tractor_ins tc
  returning vehicle_id as tc_id
)

-- Step 5: Create the rig coupling tractor → trailer
insert into public.tractor_trailer_rigs
  (rig_id, name,
   tractor_id, trailer_id,
   kingpin_x_on_trailer_mm, kingpin_x_on_tractor_mm,
   max_kingpin_kg)
select
  '18t-semi-6x4-eu',
  '18T Semi (6×4 tractor + 13.6m trailer)',
  (select id from tractor_ins),
  (select id from trailer_ins),
  1200,   -- kingpin sits 1200mm from trailer front
  3000,   -- fifth-wheel sits 3000mm from tractor front
  12000
where
  exists (select 1 from trailer_ins) and
  exists (select 1 from tractor_ins)
on conflict (rig_id) do nothing;
