import { describe, it, expect } from 'vitest';
import { autoPack } from '../autopack';
import { validatePlacement, type ValidatorContext } from '../validate';
import { SupportGraph } from '../support';
import type { CaseSKU, TruckType, TractorTrailer, RigidVehicle, VehicleConfig } from '../types';

const truck: TruckType = {
  truckId: 'T1',
  name: 'Test Truck',
  innerDims: { x: 7200, y: 2400, z: 2400 },
  emptyWeightKg: 3500,
  axle: { frontX: 1000, rearX: 5500, maxFrontKg: 40000, maxRearKg: 80000 },
  // Disable L/R and axle constraints so packing tests focus on geometry
  balance: { maxLeftRightPercentDiff: 100 },
};

const stdCase: CaseSKU = {
  skuId: 'STD',
  name: 'Standard Case',
  dims: { l: 1000, w: 600, h: 400 },
  weightKg: 20,
  uprightOnly: false,
  allowedYaw: [0, 90, 180, 270],
  canBeBase: true,
  topContactAllowed: true,
  maxLoadAboveKg: 200,
  minSupportRatio: 0.75,
};

const fragCase: CaseSKU = {
  skuId: 'FRAG',
  name: 'Fragile',
  dims: { l: 800, w: 600, h: 500 },
  weightKg: 10,
  uprightOnly: true,
  allowedYaw: [0, 180],
  canBeBase: false,
  topContactAllowed: false,
  maxLoadAboveKg: 0,
  minSupportRatio: 0.80,
};

const axleTightTruck: TruckType = {
  ...truck,
  axle: { frontX: 1000, rearX: 5500, maxFrontKg: 120, maxRearKg: 5000 },
  balance: { maxLeftRightPercentDiff: 100 },
};

const axleConstrainedCase: CaseSKU = {
  ...stdCase,
  skuId: 'AXLE',
  name: 'Axle Constrained',
  weightKg: 80,
};

describe('autoPack', () => {
  it('returns empty result for zero quantities', () => {
    const result = autoPack(truck, [stdCase], new Map([['STD', 0]]));
    expect(result.placed).toHaveLength(0);
    expect(result.unplaced).toHaveLength(0);
  });

  it('places a single case at floor-front-left', () => {
    const result = autoPack(truck, [stdCase], new Map([['STD', 1]]), { maxAttempts: 1 });
    expect(result.placed).toHaveLength(1);
    expect(result.placed[0].position.z).toBe(0);
  });

  it('places multiple identical cases without collision', () => {
    const qty = 5;
    const result = autoPack(truck, [stdCase], new Map([['STD', qty]]), { maxAttempts: 10 });
    expect(result.placed.length + result.unplaced.length).toBe(qty);

    // Check no two placed cases overlap
    const placed = result.placed;
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i].aabb;
        const b = placed[j].aabb;
        const overlaps =
          a.min.x < b.max.x - 1 && a.max.x > b.min.x + 1 &&
          a.min.y < b.max.y - 1 && a.max.y > b.min.y + 1 &&
          a.min.z < b.max.z - 1 && a.max.z > b.min.z + 1;
        expect(overlaps).toBe(false);
      }
    }
  });

  it('all placed instances are within truck bounds', () => {
    const result = autoPack(truck, [stdCase, fragCase], new Map([['STD', 4], ['FRAG', 2]]));
    for (const inst of result.placed) {
      expect(inst.aabb.min.x).toBeGreaterThanOrEqual(0);
      expect(inst.aabb.min.y).toBeGreaterThanOrEqual(0);
      expect(inst.aabb.min.z).toBeGreaterThanOrEqual(0);
      expect(inst.aabb.max.x).toBeLessThanOrEqual(truck.innerDims.x);
      expect(inst.aabb.max.y).toBeLessThanOrEqual(truck.innerDims.y);
      expect(inst.aabb.max.z).toBeLessThanOrEqual(truck.innerDims.z);
    }
  });

  it('all placed output remains fully valid when replayed sequentially', () => {
    const result = autoPack(truck, [stdCase, fragCase], new Map([['STD', 6], ['FRAG', 3]]), {
      maxAttempts: 5,
      randomSeed: 7,
    });

    const skus = new Map<string, CaseSKU>([
      ['STD', stdCase],
      ['FRAG', fragCase],
    ]);
    const skuWeights = new Map<string, number>([
      ['STD', stdCase.weightKg],
      ['FRAG', fragCase.weightKg],
    ]);
    const supportGraph = new SupportGraph(skuWeights);
    const placedSoFar: typeof result.placed = [];

    for (const inst of result.placed) {
      const ctx: ValidatorContext = {
        truck,
        skus,
        instances: placedSoFar,
        supportGraph,
        skuWeights,
      };
      const validation = validatePlacement(inst, ctx);
      expect(validation.valid).toBe(true);
      expect(validation.violations).toEqual([]);

      placedSoFar.push(inst);
      supportGraph.addInstance(inst, placedSoFar);
    }
  });

  it('metrics totalWeightKg matches placed cases', () => {
    const result = autoPack(truck, [stdCase], new Map([['STD', 3]]));
    const expected = result.placed.length * stdCase.weightKg;
    expect(result.metrics.totalWeightKg).toBeCloseTo(expected, 3);
  });

  it('deterministic at attempt 0 (same inputs → same result)', () => {
    const r1 = autoPack(truck, [stdCase], new Map([['STD', 3]]), { maxAttempts: 1 });
    const r2 = autoPack(truck, [stdCase], new Map([['STD', 3]]), { maxAttempts: 1 });
    expect(r1.placed.length).toBe(r2.placed.length);
    r1.placed.forEach((p, i) => {
      expect(p.position).toEqual(r2.placed[i].position);
    });
  });

  it('deterministic with explicit seed across multi-attempt runs', () => {
    const cfg = { maxAttempts: 8, randomSeed: 42 };
    const r1 = autoPack(truck, [stdCase, fragCase], new Map([['STD', 8], ['FRAG', 4]]), cfg);
    const r2 = autoPack(truck, [stdCase, fragCase], new Map([['STD', 8], ['FRAG', 4]]), cfg);

    const layout = (r: ReturnType<typeof autoPack>) =>
      r.placed.map(p => ({ skuId: p.skuId, position: p.position, yaw: p.yaw }));

    expect(layout(r1)).toEqual(layout(r2));
    expect(r1.unplaced).toEqual(r2.unplaced);
    expect(r1.reasonSummary).toEqual(r2.reasonSummary);
  });

  it('returns partial placement and axle rejection reason when constrained by front axle', () => {
    const result = autoPack(axleTightTruck, [axleConstrainedCase], new Map([['AXLE', 2]]), { maxAttempts: 1 });

    expect(result.placed).toHaveLength(1);
    expect(result.unplaced).toHaveLength(1);
    expect(result.reasonSummary.AXLE_FRONT_OVER ?? 0).toBeGreaterThan(0);
  });

  it('stress: packs 20 standard cases', () => {
    const result = autoPack(truck, [stdCase], new Map([['STD', 20]]));
    // Truck is 7.2m × 2.4m × 2.4m. Floor area = 7200×2400 = 17,280,000 mm².
    // Case footprint = 1000×600 = 600,000 mm². 20 cases need 12,000,000 mm² → should all fit on one layer.
    expect(result.placed.length).toBe(20);
    expect(result.unplaced).toHaveLength(0);
  });
});

// ============================================================================
// PRD §10.3 — Tractor-trailer autopack tests
// ============================================================================

describe('autoPack — tractor-trailer (PRD §10.3)', () => {
  // ── Shared fixture: 18T semi (6×4 tractor + 13.6m trailer) ──────────────
  const trailerBody: RigidVehicle = {
    vehicleId: 'semi-trailer-13600',
    name: '13.6m Curtainsider Trailer',
    innerDimsMm: { x: 13600, y: 2400, z: 2700 },
    emptyWeightKg: 6500,
    emptyComXmm: 6800,
    axleGroups: [
      { id: 'trailer', xMm: 12200, maxKg: 18000 },
    ],
    balance: { maxLeftRightPercentDiff: 10 },
  };

  const tractorBody: RigidVehicle = {
    vehicleId: 'tractor-6x4-eu',
    name: '6×4 Tractor Unit (EU)',
    innerDimsMm: { x: 0, y: 0, z: 0 },
    emptyWeightKg: 8000,
    emptyComXmm: 2100,
    axleGroups: [
      { id: 'steer', xMm: 1400, maxKg: 7100, minKg: 1500 },
      { id: 'drive', xMm: 3600, maxKg: 17500 },
    ],
    balance: { maxLeftRightPercentDiff: 10 },
  };

  const standardRig: TractorTrailer = {
    id: '18t-semi-6x4-eu',
    name: '18T Semi (6×4 tractor + 13.6m trailer)',
    tractor: tractorBody,
    trailer: trailerBody,
    coupling: {
      kingpinX_onTrailerMm: 1200,
      kingpinX_onTractorMm: 3000,
      maxKingpinKg: 12000,
    },
  };

  const standardConfig: VehicleConfig = { kind: 'tractor-trailer', vehicle: standardRig };

  it('packs cases within all axle limits and populates trailerMetrics (PRD §10.3.1)', () => {
    // 5 light cases (5 × 20 kg = 100 kg) — well below all limits.
    const result = autoPack(standardConfig, [stdCase], new Map([['STD', 5]]), {
      maxAttempts: 3,
    });

    expect(result.placed.length).toBe(5);
    expect(result.unplaced).toHaveLength(0);

    // trailerMetrics must be populated for tractor-trailer configs
    expect(result.trailerMetrics).toBeDefined();
    const tm = result.trailerMetrics!;

    // All trailer axle loads within their limits
    for (const axle of tm.trailerAxleLoads) {
      expect(axle.loadKg).toBeLessThanOrEqual(axle.maxKg);
    }
    // Kingpin within limit
    if (tm.kingpinMaxKg !== undefined) {
      expect(tm.kingpinKg).toBeLessThanOrEqual(tm.kingpinMaxKg);
    }
    // All tractor axle loads within their limits
    for (const axle of tm.tractorAxleLoads) {
      expect(axle.loadKg).toBeLessThanOrEqual(axle.maxKg);
    }
  });

  it('returns partial result when axle limits prevent full packing (PRD §10.3.2)', () => {
    // Purpose-built tight rig: kingpin and trailer axle each capped at 200 kg.
    // The greedy front-to-back placement makes the load front-heavy (high R_k).
    // By case ~11 the combined COM has moved just past the kingpin, pushing
    // R_k over 200 kg at all available anchor positions. Cases ~11-20 are
    // therefore rejected with KINGPIN_OVER and go to unplaced.
    //
    // Notes on the fixture:
    //   emptyWeightKg: 0  → L/R balance denominator = trailerAxleMaxKg = 200 kg
    //                        (avoids spurious LEFT_RIGHT_IMBALANCE_TRAILER from
    //                         the emptyWeight >> trailerAxleMaxKg anomaly)
    //   maxLeftRightPercentDiff: 100 → L/R balance effectively disabled
    //   Tractor limits: very high → only kingpin / trailer axle constrain packing
    const tightTrailer: RigidVehicle = {
      vehicleId: 'tight-trailer',
      name: 'Tight Trailer',
      innerDimsMm: { x: 13600, y: 2400, z: 2700 },
      emptyWeightKg: 0,
      emptyComXmm: 6800,
      axleGroups: [{ id: 'trailer', xMm: 12200, maxKg: 200 }],
      balance: { maxLeftRightPercentDiff: 100 },
    };
    const simpleTractor: RigidVehicle = {
      vehicleId: 'simple-tractor',
      name: 'Simple Tractor',
      innerDimsMm: { x: 0, y: 0, z: 0 },
      emptyWeightKg: 8000,
      emptyComXmm: 2100,
      axleGroups: [
        { id: 'steer', xMm: 1400, maxKg: 99999 },
        { id: 'drive', xMm: 3600, maxKg: 99999 },
      ],
      balance: { maxLeftRightPercentDiff: 100 },
    };
    const tightRig: TractorTrailer = {
      id: 'tight-rig',
      name: 'Tight Rig',
      tractor: simpleTractor,
      trailer: tightTrailer,
      coupling: {
        kingpinX_onTrailerMm: 1200,
        kingpinX_onTractorMm: 3000,
        maxKingpinKg: 200,
      },
    };
    const tightConfig: VehicleConfig = { kind: 'tractor-trailer', vehicle: tightRig };

    const result = autoPack(tightConfig, [stdCase], new Map([['STD', 20]]), {
      maxAttempts: 1,
    });

    expect(result.placed.length).toBeLessThan(20);
    expect(result.unplaced.length).toBeGreaterThan(0);
    const axleViolations =
      (result.reasonSummary.KINGPIN_OVER ?? 0) +
      (result.reasonSummary.AXLE_TRAILER_OVER ?? 0);
    expect(axleViolations).toBeGreaterThan(0);
  });

  it('produces deterministic results with same seed and trailer config (PRD §10.3.3)', () => {
    const cfg = { maxAttempts: 5, randomSeed: 99 };
    const r1 = autoPack(standardConfig, [stdCase, fragCase], new Map([['STD', 6], ['FRAG', 3]]), cfg);
    const r2 = autoPack(standardConfig, [stdCase, fragCase], new Map([['STD', 6], ['FRAG', 3]]), cfg);

    const layout = (r: ReturnType<typeof autoPack>) =>
      r.placed.map(p => ({ skuId: p.skuId, position: p.position, yaw: p.yaw }));

    expect(layout(r1)).toEqual(layout(r2));
    expect(r1.unplaced).toEqual(r2.unplaced);
    expect(r1.reasonSummary).toEqual(r2.reasonSummary);
  });
});
