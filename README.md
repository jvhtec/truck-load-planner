# Truck Load Planning System

A deterministic, constraint-driven truck loading planner for case SKUs and predefined truck geometries.

**Repo:** https://github.com/jvhtec/truck-load-planner  
**Supabase Project:** `btkhleqotertvroohzux`

## Quick Start

```bash
# Clone
git clone https://github.com/jvhtec/truck-load-planner.git
cd truck-load-planner

# Install
npm install

# Configure environment
cp .env.example .env
# Edit .env and add your SUPABASE_ANON_KEY
# Optional for subpath deploys (GitHub Pages, etc.): set VITE_BASE_PATH=/truck-load-planner/

# Run
npm run dev
```

## Supabase Setup

1. Go to [Supabase Dashboard](https://supabase.com/dashboard/project/btkhleqotertvroohzux)
2. Copy the **anon/public** key from Settings → API
3. Paste it in `.env` as `VITE_SUPABASE_ANON_KEY`
4. Run `supabase/schema.sql` in the SQL Editor
5. (Optional) Run `supabase/seed.sql` for sample data

## Design Principles

1. Core logic contains zero rendering code
2. All placements pass a single validator
3. Weight and balance are first-class constraints
4. Auto-pack cannot bypass manual rules
5. Deterministic inputs produce deterministic results

## Coordinate Model

- **Units**: millimeters (distance), kilograms (weight)
- **Axes**: X = front→rear, Y = left→right, Z = floor→ceiling
- **Origin**: front-left-floor interior corner
- **Rotations**: discrete yaw only (0/90/180/270)

## Project Structure

```
src/
├── core/                  # Zero-rendering engine logic
│   ├── types.ts           # Data models
│   ├── geometry.ts        # AABB, collision, support area
│   ├── validate.ts        # Single validation entry point
│   ├── support.ts         # Support graph & load propagation
│   ├── weight.ts          # Axle load & balance calculations
│   ├── spatial.ts         # Uniform-grid spatial index (O(1) collision queries)
│   ├── autopack.ts        # Auto-pack engine (multi-start, axle-aware scoring)
│   ├── index.ts           # Core exports
│   └── __tests__/         # Vitest unit tests (60 tests)
├── hooks/
│   └── usePlanner.ts      # React state management (place, remove, save, load)
├── components/            # React UI components
│   ├── TruckView3D.tsx    # 3D visualization (React Three Fiber)
│   ├── TruckSelector.tsx  # Truck picker
│   ├── CaseCatalog.tsx    # Case browser & manual placement controls
│   └── MetricsPanel.tsx   # Load metrics & warnings display
├── lib/
│   └── supabase.ts        # Database client
└── App.tsx                # Root: layout, save/load dialogs, auto-pack controls
```

## Phase Progress

- [x] Phase 1: Core engine + validation
- [x] Phase 2: Manual UI — truck/case selection, manual placement, save/load plans, selected-case inspector
- [x] Phase 3: Support/load graph — topological load propagation, per-instance cumulative load tracking
- [x] Phase 4: Axle + balance integration — beam-model axle load, L/R balance, all checks in single validator
- [x] Phase 5: Auto-pack v1 — multi-start, tier-shuffled ordering, axle-aware placement scoring, reason tracking
- [x] Phase 6: Performance hardening — `SpatialIndex` (uniform grid) for O(1) avg collision queries, anchor pre-filtering
- [x] Phase 7: Stress testing — 60 vitest tests covering geometry, weight, support graph, validator, auto-pack, spatial index

## Scripts

```bash
npm run dev      # Start dev server
npm run build    # Build for production
npm run test     # Run tests
npm run lint     # Lint code
```

## What This System Is

- Deterministic
- Constraint-first
- Physics-aware
- Dataset-driven
- Production viable

## What It Is Not

- Continuous rotation simulator
- Physics engine
- Friction model
- AI magic box
// rebuild
