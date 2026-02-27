# Truck Load Planning System

A deterministic, constraint-driven truck loading planner for case SKUs and predefined truck geometries.

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
├── components/     # React UI
├── hooks/          # React hooks for engine
└── App.tsx
```

## Phase Progress

- [ ] Phase 1: Core engine + validation
- [ ] Phase 2: Manual UI
- [ ] Phase 3: Support/load graph
- [ ] Phase 4: Axle + balance integration
- [ ] Phase 5: Auto-pack v1
- [ ] Phase 6: Performance hardening
- [ ] Phase 7: Stress testing

## Supabase

Project ID: `btkhleqotertvroohzux`

## Quick Start

```bash
npm install
npm run dev
```
