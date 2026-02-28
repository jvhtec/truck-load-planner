# Truck Load Planning System

A deterministic, constraint-driven truck loading planner for case SKUs and predefined truck geometries. Physics-aware, dataset-driven, and production-ready.

**Repo:** https://github.com/jvhtec/truck-load-planner
**Live app:** https://jvhtec.github.io/truck-load-planner/

---

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Supabase Setup](#supabase-setup)
- [Project Structure](#project-structure)
- [Core Concepts](#core-concepts)
- [Data Models](#data-models)
- [Auto-Pack Engine](#auto-pack-engine)
- [Validation Rules](#validation-rules)
- [Scripts](#scripts)
- [Deployment](#deployment)
- [Architecture](#architecture)
- [Testing](#testing)
- [Design Principles](#design-principles)

---

## Features

- **Interactive 3D visualization** — Real-time WebGL truck view with React Three Fiber; click to select, drag to move cases
- **Manual placement** — Select a case SKU and specify exact position (X/Y/Z) and yaw rotation
- **Auto-pack engine** — Multi-start, constraint-driven algorithm that automatically fills a truck optimally
- **Full constraint validation** — Bounds checking, collision detection, orientation rules, stacking limits, support ratio enforcement, axle load limits, and left/right balance — all in a single validator
- **Live load metrics** — Total weight, per-axle load (kg and % of limit), left/right balance percentage, and warning messages
- **Truck & case management** — Create, edit, and delete truck configurations and case SKU definitions
- **Save / load plans** — Persist and restore named load plans via Supabase
- **Multi-language UI** — English and Spanish
- **GitHub Pages deployment** — CI/CD via GitHub Actions with PR preview environments

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/jvhtec/truck-load-planner.git
cd truck-load-planner

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env and add your VITE_SUPABASE_ANON_KEY (see Supabase Setup below)

# 4. Start the dev server
npm run dev
# → http://localhost:5173
```

---

## Configuration

Copy `.env.example` to `.env` and fill in the values:

```dotenv
# Required: Supabase project URL (public, safe to commit)
VITE_SUPABASE_URL=https://btkhleqotertvroohzux.supabase.co

# Required: Supabase anonymous/public key (safe to expose in browser builds)
VITE_SUPABASE_ANON_KEY=<your-anon-key>

# Optional: base path for sub-path deployments (e.g. GitHub Pages)
# Leave as "/" for root deployments
VITE_BASE_PATH=/
```

---

## Supabase Setup

1. Open the [Supabase Dashboard](https://supabase.com/dashboard/project/btkhleqotertvroohzux)
2. Go to **Settings → API** and copy the **anon / public** key
3. Paste it into `.env` as `VITE_SUPABASE_ANON_KEY`
4. In the **SQL Editor**, run `supabase/schema.sql` to create all tables and views
5. *(Optional)* Run `supabase/seed.sql` to load sample trucks and case SKUs

### Database Schema

| Table | Description |
|-------|-------------|
| `trucks` | Truck definitions (interior dims, axle positions, balance limits) |
| `case_skus` | Case type definitions (dims, weight, orientation & stacking constraints) |
| `load_plans` | Named saved plans (truck reference, computed metrics) |
| `load_plan_items` | Individual case placements within a plan |

---

## Project Structure

```
src/
├── core/                  # Zero-rendering physics engine
│   ├── types.ts           # All shared data models (see Data Models)
│   ├── geometry.ts        # AABB creation, collision, rotation helpers
│   ├── validate.ts        # Single validatePlacement() entry point
│   ├── support.ts         # SupportGraph — stacking & load propagation
│   ├── weight.ts          # Center-of-mass, axle loads, L/R balance
│   ├── spatial.ts         # SpatialIndex — uniform grid for O(1) collision pre-filter
│   ├── autopack.ts        # autoPack() — multi-start auto-loading engine
│   ├── index.ts           # Re-exports for external consumers
│   └── __tests__/         # 60+ Vitest unit tests
│       ├── geometry.test.ts
│       ├── validate.test.ts
│       ├── support.test.ts
│       ├── weight.test.ts
│       ├── spatial.test.ts
│       └── autopack.test.ts
├── components/
│   ├── TruckView3D.tsx    # 3D WebGL view (React Three Fiber)
│   ├── TruckSelector.tsx  # Truck picker & editor
│   ├── CaseCatalog.tsx    # Case browser, manual placement, case editor
│   ├── MetricsPanel.tsx   # Live load metrics & warnings
│   └── ErrorBoundary.tsx  # Crash recovery
├── hooks/
│   └── usePlanner.ts      # Central React state: place, remove, move, save, load, auto-pack
├── lib/
│   └── supabase.ts        # Supabase client singleton
├── App.tsx                # Root layout, dialogs, auto-pack controls
├── main.tsx               # React entry point
└── vite-env.d.ts          # Vite env type declarations

supabase/
├── schema.sql             # Table definitions and views
├── seed.sql               # Sample data
├── migrations/            # Incremental schema migrations
└── config.toml            # Local Supabase dev config

.github/workflows/
├── deploy.yml             # Production deploy to GitHub Pages (on push to main)
└── pr-preview.yml         # Temporary preview deploy for each PR
```

---

## Core Concepts

### Coordinate System

All distances are in **millimeters**, all weights in **kilograms**.

```
          Z (ceiling)
          ↑
          │      ╔══════════╗
          │     ╱          ╱║
          │    ╔══════════╗ ║
          │    ║  Truck   ║ ║
          │    ║ Interior ║ ╝
          │    ╚══════════╝
          └──────────────────→ X (rear)
         ╱
        Y (right)
```

| Axis | Direction | Range |
|------|-----------|-------|
| X | Front → Rear | `0` → `truck.innerDims.x` |
| Y | Left → Right | `0` → `truck.innerDims.y` |
| Z | Floor → Ceiling | `0` → `truck.innerDims.z` |

**Origin**: front-left-floor interior corner of the truck.

A `CaseInstance.position` is the **front-left-bottom** corner of that case.

### Rotations

Cases support **discrete yaw only** (rotation around the Z / vertical axis):

| Yaw | Effect |
|-----|--------|
| `0°` | Default orientation — length along X, width along Y |
| `90°` | Width along X, length along Y |
| `180°` | Length along X (reversed) |
| `270°` | Width along X (reversed), length along Y |

Some SKUs also support a **90° side tilt** on the Y axis (`tilt.y = 90`), rotating the case so its height becomes horizontal.

---

## Data Models

All types are defined in `src/core/types.ts`.

### `CaseSKU`

Defines a reusable case type in the catalog.

```ts
interface CaseSKU {
  skuId: string;
  name: string;
  color?: string;

  dims: {
    l: number;  // length mm (along X at yaw=0)
    w: number;  // width  mm (along Y at yaw=0)
    h: number;  // height mm (along Z)
  };
  weightKg: number;

  // Orientation
  uprightOnly: boolean;       // height must stay on Z axis
  allowedYaw: Yaw[];          // e.g. [0, 90, 180, 270]
  tiltAllowed?: boolean;      // allow 90° side tilt on Y axis

  // Stacking
  canBeBase: boolean;         // other cases may rest on top
  topContactAllowed: boolean; // anything may touch the top surface
  maxLoadAboveKg: number;     // max cumulative kg resting above (0 = no stacking)

  // Support
  minSupportRatio: number;    // fraction of base area that must be supported (0.0–1.0)

  stackClass?: string;        // optional grouping for stacking rules
}
```

### `CaseInstance`

A specific placement of a `CaseSKU` inside a truck.

```ts
interface CaseInstance {
  id: string;
  skuId: string;
  staged?: boolean;          // true while being positioned (not yet committed)

  position: Vec3;            // front-left-bottom corner (mm from origin)
  yaw: Yaw;                  // 0 | 90 | 180 | 270
  tilt?: { y: 0 | 90 };     // optional side tilt

  aabb: AABB;                // cached bounding box (computed, do not set manually)
}
```

### `TruckType`

Defines the physical properties of a truck.

```ts
interface TruckType {
  truckId: string;
  name: string;

  innerDims: Vec3;           // usable interior space (mm)
  emptyWeightKg: number;

  axle: {
    frontX: number;          // X position of front axle (mm from origin)
    rearX: number;           // X position of rear axle
    maxFrontKg: number;      // front axle load limit (kg)
    maxRearKg: number;       // rear axle load limit (kg)
  };

  balance: {
    maxLeftRightPercentDiff: number; // max allowed L/R weight difference (%)
  };

  obstacles?: AABB[];        // fixed obstructions (e.g. wheel arches)
}
```

### `LoadMetrics`

Computed live whenever the load changes.

```ts
interface LoadMetrics {
  totalWeightKg: number;
  frontAxleKg: number;
  rearAxleKg: number;
  leftWeightKg: number;
  rightWeightKg: number;
  lrImbalancePercent: number;  // |left - right| / total * 100
  maxStackHeightMm: number;
  warnings: string[];
}
```

### `ValidationResult`

Returned by every call to `validatePlacement()`.

```ts
interface ValidationResult {
  valid: boolean;
  violations: ValidationError[];
  details?: Record<string, unknown>;
}

type ValidationError =
  | 'OUT_OF_BOUNDS'
  | 'COLLISION'
  | 'INVALID_ORIENTATION'
  | 'INSUFFICIENT_SUPPORT'
  | 'BASE_NOT_ALLOWED'
  | 'TOP_CONTACT_FORBIDDEN'
  | 'LOAD_EXCEEDED'
  | 'AXLE_FRONT_OVER'
  | 'AXLE_REAR_OVER'
  | 'LEFT_RIGHT_IMBALANCE';
```

---

## Auto-Pack Engine

`autoPack()` in `src/core/autopack.ts` automatically loads a truck given a set of case SKUs and quantities.

### Signature

```ts
function autoPack(
  truck: TruckType,
  skus: CaseSKU[],
  skuQuantities: Map<string, number>, // skuId → desired count
  config?: Partial<AutoPackConfig>
): AutoPackResult;
```

### Algorithm

1. **Build placement queue** — expand SKUs × quantities into a flat list sorted by priority:
   - Heaviest first (dense base layer)
   - Good bases (`canBeBase = true`) before fragile items
   - Most-constrained (upright-only) first
   - Largest footprint first

2. **Multi-start** — runs up to `maxAttempts` (default 100) independent attempts. Attempt 0 uses the canonical ordering; subsequent attempts shuffle cases within the same priority tier using a seeded linear congruential shuffle.

3. **Per-attempt placement** — for each case, tries every candidate anchor point × every allowed yaw. Accepts the highest-scoring valid placement (validated via `validatePlacement()`). Expands the anchor set after each successful placement.

4. **Scoring** — placement quality is scored on:
   - Height penalty (prefer floor-level placements)
   - Axle proximity (prefer near the axle midpoint)
   - Y-center deviation (prefer balanced left/right)
   - Axle-load quality

5. **Best result selection** — primary metric is total placed count; ties are broken by result-level score (penalises high stack height, axle imbalance, and L/R imbalance).

### Configuration

```ts
interface AutoPackConfig {
  maxAttempts: number;          // default: 100
  randomSeed?: number;          // set for fully reproducible results

  scoreWeights: {
    stackHeight: number;        // default: 1.0
    axleBalance: number;        // default: 2.0
    lrBalance: number;          // default: 1.5
  };
}
```

### Return value

```ts
interface AutoPackResult {
  placed: CaseInstance[];
  unplaced: string[];                          // skuIds that could not be placed
  metrics: LoadMetrics;
  reasonSummary: Record<ValidationError, number>; // rejection tallies
}
```

---

## Validation Rules

Every placement — manual or auto-pack — passes through the single `validatePlacement()` function. Rules are checked in this order:

| # | Rule | Error code |
|---|------|------------|
| 1 | Case AABB must fit within truck interior | `OUT_OF_BOUNDS` |
| 2 | Yaw must be in `sku.allowedYaw`; tilt must be permitted | `INVALID_ORIENTATION` |
| 3 | No overlap with existing instances or obstacles | `COLLISION` |
| 4 | At least `minSupportRatio` of the base area must be supported (floor counts as full support) | `INSUFFICIENT_SUPPORT` |
| 5 | Instances below must have `canBeBase = true` | `BASE_NOT_ALLOWED` |
| 6 | If anything rests on top of this case, `topContactAllowed` must be true | `TOP_CONTACT_FORBIDDEN` |
| 7 | Cumulative weight above each case must not exceed `maxLoadAboveKg` | `LOAD_EXCEEDED` |
| 8 | Front axle load must not exceed `truck.axle.maxFrontKg` | `AXLE_FRONT_OVER` |
| 9 | Rear axle load must not exceed `truck.axle.maxRearKg` | `AXLE_REAR_OVER` |
| 10 | L/R imbalance must not exceed `truck.balance.maxLeftRightPercentDiff` | `LEFT_RIGHT_IMBALANCE` |

---

## Scripts

```bash
npm run dev      # Start Vite dev server (http://localhost:5173)
npm run build    # TypeScript type-check + Vite production build
npm run preview  # Serve the production build locally
npm run test     # Run all Vitest unit tests (watch mode: npx vitest)
npm run lint     # ESLint with zero-warning policy
```

---

## Deployment

### GitHub Pages (production)

Pushing to `main` triggers `.github/workflows/deploy.yml`, which:
1. Installs dependencies
2. Runs `npm run build` (sets `VITE_BASE_PATH=/truck-load-planner/`)
3. Publishes the `dist/` folder to the `gh-pages` branch

### PR Preview

Opening a pull request triggers `.github/workflows/pr-preview.yml`, which deploys a temporary preview at a unique sub-path so reviewers can test changes live.

### Environment Variables for Deployment

Set these in GitHub Actions. Prefer repository **Variables** (`vars`) for these `VITE_*` values so PR previews from forks can build; secrets are used as fallback.

| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `VITE_BASE_PATH` | Deployment sub-path (e.g. `/truck-load-planner/`) |

---

## Architecture

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for a detailed technical overview of the core engine, React layer, data flow, and performance design.

---

## Testing

The test suite lives in `src/core/__tests__/` and uses [Vitest](https://vitest.dev/).

| File | Lines | What it covers |
|------|-------|----------------|
| `geometry.test.ts` | 145 | AABB creation, overlap, containment, rotation, tilt |
| `validate.test.ts` | 189 | All 10 validation rules, edge cases, multi-violation scenarios |
| `support.test.ts` | 87 | SupportGraph topology, cumulative load propagation |
| `weight.test.ts` | 115 | Center-of-mass, axle load beam model, L/R balance |
| `spatial.test.ts` | 50 | SpatialIndex grid bucketing, candidate queries |
| `autopack.test.ts` | 108 | Multi-start placement, result quality, reason tracking |

Run the tests:

```bash
npm run test              # single run
npx vitest                # interactive watch mode
npx vitest --coverage     # with coverage report
```

---

## Design Principles

1. **Core logic contains zero rendering code** — `src/core/` is pure TypeScript with no React or Three.js imports. It can be used in any environment (Node.js, Web Workers, tests).
2. **All placements pass a single validator** — `validatePlacement()` is the only gate. Manual placement and auto-pack go through identical checks.
3. **Weight and balance are first-class constraints** — axle loads and L/R balance are evaluated on every placement, not as an afterthought.
4. **Auto-pack cannot bypass manual rules** — the auto-pack engine uses `validatePlacement()` for every candidate, so it cannot produce a plan that violates any constraint.
5. **Deterministic inputs produce deterministic results** — given the same truck, SKUs, quantities, and `randomSeed`, `autoPack()` always returns the same result.

## What This System Is Not

- A continuous physics / friction simulator
- An AI or ML-based solver
- A routing or fleet management system
- A weight-compliance legal authority (always verify with certified scales)
