# Architecture

This document describes the internal architecture of the Truck Load Planning System.

---

## Overview

The system is split into two completely independent layers:

```
┌─────────────────────────────────────────────────────┐
│                   React UI Layer                     │
│  App  ←→  usePlanner  ←→  Components  ←→  Supabase  │
└────────────────────┬────────────────────────────────┘
                     │ pure function calls
┌────────────────────▼────────────────────────────────┐
│                 Core Engine (src/core/)               │
│  geometry · validate · support · weight · spatial ·  │
│  autopack                                            │
└─────────────────────────────────────────────────────┘
```

**Core engine** — zero-dependency TypeScript. No React, no Three.js, no Supabase. Pure functions and plain classes operating on plain objects. Fully unit-testable in Node.js.

**React UI layer** — consumes the core via the `usePlanner` hook and renders with React Three Fiber.

---

## Core Engine

### `geometry.ts` — AABB Operations

Provides helpers for axis-aligned bounding boxes (AABBs):

- `createAABB(min, max)` — construct an AABB
- `computeAABB(position, dims)` — derive an AABB from a position and dimension vector
- `aabbOverlap(a, b, epsilon?)` — returns `true` if boxes overlap (with optional epsilon tolerance)
- `aabbContains(outer, inner)` — returns `true` if `outer` fully contains `inner`
- `getRotatedDims(sku, yaw, tilt?)` — returns effective `{x, y, z}` dimensions after applying yaw and tilt rotations
- `createInstance(id, sku, position, yaw, tilt?)` — constructs a fully populated `CaseInstance` with a cached AABB
- `topZ(aabb)` — convenience helper returning `aabb.max.z`

All collision detection uses 1 mm epsilon to avoid floating-point false positives.

Rotation is discrete (no interpolation):

| Yaw | `x` dim | `y` dim |
|-----|---------|---------|
| 0° / 180° | `sku.dims.l` | `sku.dims.w` |
| 90° / 270° | `sku.dims.w` | `sku.dims.l` |

---

### `validate.ts` — Single Validation Entry Point

```ts
function validatePlacement(
  candidate: CaseInstance,
  ctx: ValidatorContext
): ValidationResult
```

`ValidatorContext` bundles all state needed for validation:

```ts
interface ValidatorContext {
  truck: TruckType;
  skus: Map<string, CaseSKU>;
  instances: CaseInstance[];       // currently placed (excluding candidate)
  supportGraph: SupportGraph;
  skuWeights: Map<string, number>;
  spatialIndex: SpatialIndex;
}
```

Rules are evaluated in order and all violations are collected (not short-circuited), so callers receive the complete list of problems at once.

**Support ratio calculation**: The support check projects the candidate's floor footprint onto all instances directly below it (and the truck floor at Z=0). The fraction of the footprint area that is covered by supporters must be ≥ `sku.minSupportRatio`.

**Axle loads**: Computed via the beam model in `weight.ts`. Adding the candidate's weight at its center-of-mass X position shifts both axle loads. If either exceeds the truck limit, the placement is rejected.

---

### `support.ts` — Support Graph

`SupportGraph` tracks stacking relationships between case instances.

```
        ┌────────┐
        │   C    │   ← cumulative load above B includes C's weight
        └───┬────┘
        ┌───▼────┐
        │   B    │   ← rests on A
        └───┬────┘
    ────────▼──────── truck floor (Z=0)
            A
```

Key operations:

| Method | Description |
|--------|-------------|
| `addInstance(inst, all)` | Adds an instance and links it to its supporters |
| `removeInstance(id)` | Removes an instance and recomputes affected loads |
| `getCumulativeLoadAbove(id)` | Topological sum of weights of all instances above |
| `getDirectSupport(id)` | Set of instance IDs that directly support this instance |
| `recompute(all)` | Full O(n²) recomputation after bulk changes |

Load propagation uses a topological traversal: start at floor-level instances, propagate weights upward. Each instance accumulates the weight of everything above it in its stack chain.

---

### `weight.ts` — Weight and Balance

#### Center of Mass

```
        COM_x = Σ(instance.weight × instance.centerX) / Σ(instance.weight)
```

All three axes are computed, but only X is used for axle loads and only Y for left/right balance.

#### Axle Loads (Beam Model)

The truck is modelled as a simply supported beam with supports at `axle.frontX` and `axle.rearX`. The load from the cargo (at center of mass X = `d`) is distributed as:

```
rearKg  = totalCargoKg × (d - frontX) / (rearX - frontX)
frontKg = totalCargoKg - rearKg
```

The empty truck weight is added to both axles proportionally based on the truck's own center.

#### Left / Right Balance

```
lrImbalancePercent = |leftKg - rightKg| / totalKg × 100
```

---

### `spatial.ts` — Uniform Grid Spatial Index

`SpatialIndex` provides fast candidate retrieval for collision checking.

- Cell size: **500 mm** (configurable)
- An AABB is inserted into all grid cells it overlaps
- Queries return the set of candidate IDs whose cells overlap the query AABB
- Deduplication via a `Set` ensures each candidate is returned once

Collision checking without the index is O(n). With the index, the pre-filter reduces the candidate set to ~constant size for typical loads, making the overall pipeline O(1) average per placement.

```ts
class SpatialIndex {
  add(id: string, aabb: AABB): void;
  remove(id: string): void;
  query(aabb: AABB): Set<string>;   // candidate ids
  clear(): void;
}
```

---

### `autopack.ts` — Auto-Pack Engine

See also [Auto-Pack Engine](./README.md#auto-pack-engine) in the main README.

#### Placement Queue Priority

Cases are sorted before placement:

1. Heaviest → lightest (heavy items form the floor base)
2. `canBeBase = true` before `canBeBase = false`
3. Upright-only before tilt-allowed (most constrained first)
4. Largest footprint first

#### Multi-Start Diversity

Attempt 0 uses the canonical sorted order. Attempts 1–99 shuffle items **within** each priority tier using a seeded linear congruential generator (LCG):

```
s = (s × 1664525 + 1013904223) mod 2³²   // Knuth LCG
```

This preserves priority ordering while exploring different within-tier orderings.

#### Anchor Point Set

After placing each case, three categories of new anchor points are added:

- **Right-adjacent**: same row, next column (`y = placed.aabb.max.y`)
- **Rear-adjacent**: next row (`x = placed.aabb.max.x`)
- **Diagonal**: next row + next column
- **On top** (only if `canBeBase`): stacked anchors at `z = placed.aabb.max.z`

Anchors are deduplicated by exact coordinate string key.

---

## React Layer

### `usePlanner` Hook

Central state container for the UI. Manages:

- Lists of available trucks and case SKUs (loaded from Supabase)
- Currently selected truck and case
- Active `CaseInstance[]` (the current load plan)
- Save/load operations

Key actions:

| Action | Description |
|--------|-------------|
| `placeCase(sku, position, yaw)` | Validates and adds a case to the plan |
| `removeCase(id)` | Removes a case and rebuilds the support graph |
| `moveCase(id, position, yaw)` | Remove + re-place with new position/yaw |
| `runAutoPack(skus, quantities)` | Runs the auto-pack engine and replaces the current plan |
| `savePlan(name)` | Persists the current plan to Supabase |
| `loadPlan(id)` | Restores a saved plan from Supabase |

### Component Tree

```
App
├── TruckSelector          (left sidebar — pick / create / edit trucks)
├── CaseCatalog            (left sidebar — browse SKUs, manual placement)
├── TruckView3D            (center — 3D WebGL canvas)
│   ├── <Canvas>           (React Three Fiber)
│   │   ├── truck geometry mesh
│   │   ├── obstacle meshes
│   │   ├── CaseMesh[] (one per CaseInstance)
│   │   └── OrbitControls
│   └── camera preset buttons (top / isometric / side)
└── MetricsPanel           (right sidebar — load metrics and warnings)
```

### 3D Rendering (`TruckView3D`)

- **React Three Fiber** renders Three.js declaratively inside React
- **React Three Drei** provides `OrbitControls`, `Text`, `Box` helpers
- Each `CaseInstance` becomes a `<mesh>` with a `BoxGeometry` sized to its AABB
- Cases are coloured by `sku.color` with a slight emissive boost when selected
- Drag-to-move uses Three.js raycasting against the truck floor plane
- Item numbers are rendered as `<Text>` billboards, ordered left→right, bottom→top

---

## Data Flow

```
User interaction (click / drag / form submit)
        │
        ▼
usePlanner action (placeCase / removeCase / runAutoPack …)
        │
        ├──► validatePlacement()   ← core/validate.ts
        │         │
        │    [if valid]
        │         ▼
        ├──► SupportGraph.addInstance()
        ├──► SpatialIndex.add()
        └──► setState(newInstances)
                  │
                  ▼
         React re-render
                  │
         ┌────────┴────────┐
         ▼                 ▼
    TruckView3D        MetricsPanel
   (3D meshes)     (computeMetrics())
```

---

## Performance Notes

| Concern | Solution |
|---------|----------|
| Collision checks are O(n) per placement | `SpatialIndex` reduces candidates to ~constant |
| Support graph is O(n²) on full recompute | Only recomputed on load/undo, not per-placement |
| Auto-pack tries 100 × candidates × yaws | Anchor pre-filtering rejects obviously invalid anchors early; SpatialIndex keeps each check cheap |
| WebGL draw calls | One mesh per case; no instanced rendering needed at typical load sizes (< 200 cases) |

---

## Extending the System

### Adding a new validation rule

1. Add a new error code to the `ValidationError` union in `types.ts`
2. Implement the check inside `validatePlacement()` in `validate.ts`
3. Add unit tests in `validate.test.ts`
4. Update the `MetricsPanel` or warning logic if the user needs feedback

### Adding a new core module

Follow the pattern of existing modules:
- No React imports
- Export pure functions or a single class
- Re-export from `core/index.ts`
- Cover with Vitest tests in `__tests__/`

### Changing the database schema

1. Write a new migration file in `supabase/migrations/`
2. Apply it in the Supabase dashboard SQL editor
3. Update `supabase/schema.sql` to reflect the current full schema
4. Update TypeScript types in `types.ts` or `lib/supabase.ts` as needed
