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
├── core/           # Zero-rendering engine logic
│   ├── types.ts    # Data models
│   ├── geometry.ts # AABB, collision
│   ├── validate.ts # Single validation entry
│   ├── support.ts  # Support graph
│   ├── weight.ts   # Axle & balance
│   └── autopack.ts # Auto-pack engine
├── hooks/
│   └── usePlanner.ts # React state management
├── components/     # React UI
├── lib/
│   └── supabase.ts # Database client
└── App.tsx
```

## Phase Progress

- [x] Phase 1: Core engine + validation
- [ ] Phase 2: Manual UI
- [ ] Phase 3: Support/load graph
- [ ] Phase 4: Axle + balance integration
- [ ] Phase 5: Auto-pack v1
- [ ] Phase 6: Performance hardening
- [ ] Phase 7: Stress testing

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
