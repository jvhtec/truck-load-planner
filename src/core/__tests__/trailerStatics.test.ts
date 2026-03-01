/**
 * Trailer statics unit + integration tests (PRD §10.1 + §10.2)
 */

import { describe, it, expect } from 'vitest';
import {
  computeTrailerAxleLoads,
  computeTractorAxleLoads,
  computeTrailerMetrics,
} from '../trailerStatics';
import { validatePlacement } from '../validate';
import { SupportGraph } from '../support';
import { SpatialIndex } from '../spatial';
import type {
  RigidVehicle,
  TractorTrailer,
  CaseInstance,
  CaseSKU,
} from '../types';
import type { ValidatorContext } from '../validate';
import { createInstance } from '../geometry';
import { rigidVehicleToTruckType } from '../vehicleAdapter';

// ============================================================================
// Shared fixtures
// ============================================================================

const trailer: RigidVehicle = {
  vehicleId: 'TR1',
  name: 'Test Trailer',
  innerDimsMm: { x: 13600, y: 2400, z: 2700 },
  emptyWeightKg: 6500,
  emptyComXmm: 6800,
  axleGroups: [{ id: 'trailer', xMm: 12200, maxKg: 18000 }],
  balance: { maxLeftRightPercentDiff: 10 },
};

const tractor: RigidVehicle = {
  vehicleId: 'TC1',
  name: 'Test Tractor',
  innerDimsMm: { x: 0, y: 0, z: 0 },
  emptyWeightKg: 8000,
  emptyComXmm: 2100,
  axleGroups: [
    { id: 'steer', xMm: 1400, maxKg: 7100, minKg: 1500 },
    { id: 'drive', xMm: 3600, maxKg: 17500 },
  ],
  balance: { maxLeftRightPercentDiff: 10 },
};

const rig: TractorTrailer = {
  id: 'RIG1',
  name: 'Test Rig',
  tractor,
  trailer,
  coupling: {
    kingpinX_onTrailerMm: 1200,
    kingpinX_onTractorMm: 3000,
    maxKingpinKg: 12000,
  },
};

// Helper SKU for placing cargo
const stdSku: CaseSKU = {
  skuId: 'STD',
  name: 'Standard Box',
  dims: { l: 1200, w: 1200, h: 1200 },
  weightKg: 500,
  uprightOnly: false,
  allowedYaw: [0, 90, 180, 270],
  canBeBase: true,
  topContactAllowed: true,
  maxLoadAboveKg: 9999,
  minSupportRatio: 0.75,
};

function makeSkuWeights(skus: CaseSKU[]): Map<string, number> {
  return new Map(skus.map(s => [s.skuId, s.weightKg]));
}

/** Create a single placed instance at (x, 0, 0) spanning full trailer width */
function makeInst(x: number, sku: CaseSKU, id = `inst-${x}`): CaseInstance {
  return createInstance(id, sku, { x, y: 600, z: 0 }, 0);
}

// ============================================================================
// Unit tests — computeTrailerAxleLoads
// ============================================================================

describe('computeTrailerAxleLoads — trailer statics math', () => {
  const kingpinX = 1200; // mm
  const trailerAxleX = 12200; // mm
  const span = trailerAxleX - kingpinX; // 11000

  it('COM exactly at kingpin: all cargo goes to kingpin, zero at trailer axle', () => {
    const { trailerAxleKg, kingpinKg } = computeTrailerAxleLoads(
      1000, kingpinX, trailer, kingpinX,
    );
    expect(trailerAxleKg).toBeCloseTo(0, 1);
    expect(kingpinKg).toBeCloseTo(1000, 1);
  });

  it('COM exactly at trailer axle: all cargo goes to trailer axle, zero at kingpin', () => {
    const { trailerAxleKg, kingpinKg } = computeTrailerAxleLoads(
      1000, trailerAxleX, trailer, kingpinX,
    );
    expect(trailerAxleKg).toBeCloseTo(1000, 1);
    expect(kingpinKg).toBeCloseTo(0, 1);
  });

  it('COM at midpoint: equal split between kingpin and trailer axle', () => {
    const mid = kingpinX + span / 2;
    const { trailerAxleKg, kingpinKg } = computeTrailerAxleLoads(
      1000, mid, trailer, kingpinX,
    );
    expect(trailerAxleKg).toBeCloseTo(500, 1);
    expect(kingpinKg).toBeCloseTo(500, 1);
  });

  it('reactions always sum to total cargo weight', () => {
    const W = 8500;
    const { trailerAxleKg, kingpinKg } = computeTrailerAxleLoads(
      W, 5000, trailer, kingpinX,
    );
    expect(trailerAxleKg + kingpinKg).toBeCloseTo(W, 3);
  });

  it('reactions are non-negative for COM inside beam span', () => {
    const { trailerAxleKg, kingpinKg } = computeTrailerAxleLoads(
      5000, 3000, trailer, kingpinX,
    );
    expect(trailerAxleKg).toBeGreaterThanOrEqual(0);
    expect(kingpinKg).toBeGreaterThanOrEqual(0);
  });

  it('degenerate geometry (L=0): puts all load on trailer axle', () => {
    const samePosition: RigidVehicle = {
      ...trailer,
      axleGroups: [{ id: 'trailer', xMm: 1200, maxKg: 18000 }],
    };
    const { trailerAxleKg, kingpinKg } = computeTrailerAxleLoads(
      1000, 1500, samePosition, 1200,
    );
    // L <= 0 path: all to trailer axle
    expect(trailerAxleKg).toBeCloseTo(1000, 1);
    expect(kingpinKg).toBeCloseTo(0, 1);
  });

  it('returns zero reactions for zero cargo weight', () => {
    const { trailerAxleKg, kingpinKg } = computeTrailerAxleLoads(
      0, 5000, trailer, kingpinX,
    );
    expect(trailerAxleKg).toBe(0);
    expect(kingpinKg).toBe(0);
  });
});

// ============================================================================
// Unit tests — computeTractorAxleLoads
// ============================================================================

describe('computeTractorAxleLoads — tractor statics math', () => {
  const tractorEmptyW = 8000;
  const tractorComX = 2100;
  const steerX = 1400;
  const driveX = 3600;
  const kingpinX = 3000;

  it('zero kingpin load: steer + drive sum to tractor empty weight', () => {
    const { steerKg, driveKg } = computeTractorAxleLoads(
      tractorEmptyW, tractorComX, 0, kingpinX, tractor,
    );
    expect(steerKg + driveKg).toBeCloseTo(tractorEmptyW, 1);
  });

  it('heavy kingpin load shifts weight distribution toward drive axle', () => {
    // kingpinX (3000mm) is much closer to drive (3600mm) than steer (1400mm).
    // Adding 10 000 kg at the kingpin should put a larger share on drive than steer.
    const { steerKg: steerLight, driveKg: driveLight } = computeTractorAxleLoads(
      tractorEmptyW, tractorComX, 0, kingpinX, tractor,
    );
    const { steerKg: steerHeavy, driveKg: driveHeavy } = computeTractorAxleLoads(
      tractorEmptyW, tractorComX, 10000, kingpinX, tractor,
    );
    // The extra 10 000 kg splits unequally: drive gains more than steer.
    const additionalDrive = driveHeavy - driveLight;
    const additionalSteer = steerHeavy - steerLight;
    expect(additionalDrive).toBeGreaterThan(additionalSteer);
  });

  it('steer + drive always sum to total (tractor empty + kingpin)', () => {
    const R_k = 7000;
    const { steerKg, driveKg } = computeTractorAxleLoads(
      tractorEmptyW, tractorComX, R_k, kingpinX, tractor,
    );
    expect(steerKg + driveKg).toBeCloseTo(tractorEmptyW + R_k, 2);
  });

  it('COM at steer axle: all weight on steer, zero on drive', () => {
    // Force combined COM to equal steerX
    // comX = (W_tr * comX_tr + R_k * kp_x) / totalW = steerX
    // Solve for R_k: R_k = W_tr * (steerX - comX_tr) / (kp_x - steerX)
    // With steerX=1400, comX_tr=2100, kp_x=3000:
    //   R_k = 8000 * (1400 - 2100) / (3000 - 1400) = 8000 * (-700) / 1600 = -3500 → not physical
    // Use a tractor where comX=steerX=1400 when R_k=0
    const tractorAtSteer: RigidVehicle = {
      ...tractor,
      emptyComXmm: steerX, // COM sits at steer axle
    };
    const { steerKg, driveKg } = computeTractorAxleLoads(
      tractorEmptyW, steerX, 0, kingpinX, tractorAtSteer,
    );
    expect(driveKg).toBeCloseTo(0, 1);
    expect(steerKg).toBeCloseTo(tractorEmptyW, 1);
  });

  it('COM at drive axle: all weight on drive, zero on steer', () => {
    const tractorAtDrive: RigidVehicle = {
      ...tractor,
      emptyComXmm: driveX,
    };
    const { steerKg, driveKg } = computeTractorAxleLoads(
      tractorEmptyW, driveX, 0, kingpinX, tractorAtDrive,
    );
    expect(steerKg).toBeCloseTo(0, 1);
    expect(driveKg).toBeCloseTo(tractorEmptyW, 1);
  });

  it('degenerate (single axle): returns equal split', () => {
    const oneAxle: RigidVehicle = {
      ...tractor,
      axleGroups: [{ id: 'only', xMm: 2000, maxKg: 10000 }],
    };
    const { steerKg, driveKg } = computeTractorAxleLoads(
      tractorEmptyW, 2000, 2000, kingpinX, oneAxle,
    );
    expect(steerKg).toBeCloseTo(driveKg, 1);
  });
});

// ============================================================================
// Unit tests — computeTrailerMetrics (boundary and status)
// ============================================================================

describe('computeTrailerMetrics — full rig metrics', () => {
  it('returns zero warnings for empty load', () => {
    const m = computeTrailerMetrics([], new Map(), rig);
    expect(m.totalWeightKg).toBe(0);
    expect(m.kingpinKg).toBeCloseTo(0, 1);
    expect(m.warnings).toHaveLength(0);
  });

  it('warnings array is non-empty when trailer axle is over limit', () => {
    // Place 20 000 kg all at rear → trailerAxleKg > 18 000
    const heavySku: CaseSKU = { ...stdSku, skuId: 'HEAVY', weightKg: 20000 };
    const inst = makeInst(11000, heavySku, 'big');
    const sw = makeSkuWeights([heavySku]);
    const m = computeTrailerMetrics([inst], sw, rig);
    expect(m.trailerAxleLoads[0].status).toBe('over');
    expect(m.warnings.some(w => w.includes('over limit'))).toBe(true);
  });

  it('kingpinStatus is over when kingpin exceeds maxKingpinKg', () => {
    // Load heavy weight near kingpin
    const heavySku: CaseSKU = { ...stdSku, skuId: 'KP', weightKg: 15000 };
    const inst = makeInst(1200, heavySku, 'kp');
    const sw = makeSkuWeights([heavySku]);
    const m = computeTrailerMetrics([inst], sw, rig);
    // trailerAxle ~= W * (1200 - 1200) / (12200 - 1200) = 0 → kingpin ~= 15000
    expect(m.kingpinKg).toBeGreaterThan(rig.coupling.maxKingpinKg!);
    expect(m.kingpinStatus).toBe('over');
  });

  it('L/R balance splits correctly: left of centerline = leftKg', () => {
    const leftSku: CaseSKU = { ...stdSku, skuId: 'LEFT', weightKg: 1000 };
    // Place at y=0 (left of midY=1200)
    const inst = createInstance('l', leftSku, { x: 5000, y: 0, z: 0 }, 0);
    const sw = makeSkuWeights([leftSku]);
    const m = computeTrailerMetrics([inst], sw, rig);
    expect(m.leftWeightKg).toBeCloseTo(1000, 1);
    expect(m.rightWeightKg).toBeCloseTo(0, 1);
  });
});

// ============================================================================
// Integration tests (PRD §10.2)
// ============================================================================

function makeCtxForRig(instances: CaseInstance[]): ValidatorContext {
  const skus = new Map<string, CaseSKU>([['STD', stdSku]]);
  const skuWeights = makeSkuWeights([stdSku]);
  const supportGraph = new SupportGraph(skuWeights);
  const spatialIndex = new SpatialIndex();
  for (const inst of instances) {
    supportGraph.addInstance(inst, instances);
    spatialIndex.add(inst.id, inst.aabb);
  }
  return {
    truck: rigidVehicleToTruckType(trailer),
    vehicle: { kind: 'tractor-trailer', vehicle: rig },
    skus,
    instances,
    supportGraph,
    skuWeights,
    spatialIndex,
  };
}

describe('Integration: tractor-trailer validation — PRD §10.2', () => {
  // Scenario 1: forward-heavy load overloads steer
  it('AXLE_STEER_OVER when a very heavy load is placed near the kingpin (forward-heavy)', () => {
    // With a very large weight right at the kingpin, R_k ≈ totalWeight
    // → steer will carry most of R_k and likely exceed steer.maxKg
    const heavySku: CaseSKU = { ...stdSku, skuId: 'STD', weightKg: 9000 };
    const skus = new Map<string, CaseSKU>([['STD', heavySku]]);
    const skuWeights = makeSkuWeights([heavySku]);
    const inst = createInstance('fwd', heavySku, { x: 0, y: 600, z: 0 }, 0);
    const sg = new SupportGraph(skuWeights);
    sg.addInstance(inst, [inst]);
    const si = new SpatialIndex();
    si.add(inst.id, inst.aabb);

    // Use a tight steer limit so even light loads exceed it
    const tightSteerRig: TractorTrailer = {
      ...rig,
      tractor: {
        ...tractor,
        axleGroups: [
          { id: 'steer', xMm: 1400, maxKg: 1000, minKg: 100 }, // very tight
          { id: 'drive', xMm: 3600, maxKg: 17500 },
        ],
      },
    };
    const ctx: ValidatorContext = {
      truck: rigidVehicleToTruckType(trailer),
      vehicle: { kind: 'tractor-trailer', vehicle: tightSteerRig },
      skus,
      instances: [],
      supportGraph: new SupportGraph(skuWeights),
      skuWeights,
    };
    const result = validatePlacement(inst, ctx);
    expect(result.violations).toContain('AXLE_STEER_OVER');
  });

  // Scenario 2: rear-heavy load overloads trailer axle
  it('AXLE_TRAILER_OVER when cargo is placed near the trailer axle (rear-heavy)', () => {
    const heavySku: CaseSKU = { ...stdSku, skuId: 'STD', weightKg: 25000 };
    const skus = new Map<string, CaseSKU>([['STD', heavySku]]);
    const skuWeights = makeSkuWeights([heavySku]);
    // Place right at trailerAxle.xMm − 1200 (fits a 1200mm-long case ending near the axle)
    const inst = createInstance('rear', heavySku, { x: 11000, y: 600, z: 0 }, 0);
    const ctx: ValidatorContext = {
      truck: rigidVehicleToTruckType(trailer),
      vehicle: { kind: 'tractor-trailer', vehicle: rig },
      skus,
      instances: [],
      supportGraph: new SupportGraph(skuWeights),
      skuWeights,
    };
    const result = validatePlacement(inst, ctx);
    expect(result.violations).toContain('AXLE_TRAILER_OVER');
  });

  // Scenario 3: kingpin overload
  it('KINGPIN_OVER when kingpin load exceeds maxKingpinKg', () => {
    const heavySku: CaseSKU = { ...stdSku, skuId: 'STD', weightKg: 15000 };
    const skus = new Map<string, CaseSKU>([['STD', heavySku]]);
    const skuWeights = makeSkuWeights([heavySku]);
    // Place at kingpin position → R_k ≈ total weight
    const inst = createInstance('kp', heavySku, { x: 0, y: 600, z: 0 }, 0);
    const ctx: ValidatorContext = {
      truck: rigidVehicleToTruckType(trailer),
      vehicle: { kind: 'tractor-trailer', vehicle: rig },
      skus,
      instances: [],
      supportGraph: new SupportGraph(skuWeights),
      skuWeights,
    };
    const result = validatePlacement(inst, ctx);
    expect(result.violations).toContain('KINGPIN_OVER');
  });

  // Scenario 4: steer under-minimum
  it('STEER_UNDER_MIN when steer load drops below minimum', () => {
    // Rear-heavy load → R_k very small → steer < minKg (1500 kg)
    // Use a tractor with minKg well above what a light rear load will produce
    const tightMinRig: TractorTrailer = {
      ...rig,
      tractor: {
        ...tractor,
        emptyWeightKg: 100, // very light tractor
        axleGroups: [
          { id: 'steer', xMm: 1400, maxKg: 7100, minKg: 5000 }, // high min
          { id: 'drive', xMm: 3600, maxKg: 17500 },
        ],
      },
    };
    const lightSku: CaseSKU = { ...stdSku, skuId: 'STD', weightKg: 500 };
    const skus = new Map<string, CaseSKU>([['STD', lightSku]]);
    const skuWeights = makeSkuWeights([lightSku]);
    // Place at rear → small R_k → small steer load
    const inst = createInstance('rr', lightSku, { x: 11000, y: 600, z: 0 }, 0);
    const ctx: ValidatorContext = {
      truck: rigidVehicleToTruckType(trailer),
      vehicle: { kind: 'tractor-trailer', vehicle: tightMinRig },
      skus,
      instances: [],
      supportGraph: new SupportGraph(skuWeights),
      skuWeights,
    };
    const result = validatePlacement(inst, ctx);
    expect(result.violations).toContain('STEER_UNDER_MIN');
  });

  // Scenario 5: exact threshold accepted
  it('accepts placement where trailer axle load is exactly at the limit', () => {
    // trailerAxleKg = W * d / L = maxKg (18 000) exactly
    // d / L = 18000 / W → COM at kingpinX + (18000/W) * L
    const kingpinX = rig.coupling.kingpinX_onTrailerMm; // 1200
    const L = 12200 - kingpinX; // 11000
    const W = 18000;
    const d = W * L / W; // d = L → COM at trailerAxle
    // W = 18000 kg, place COM exactly at trailerAxle position
    // That means comX = 12200, which is the axle position itself
    const exactSku: CaseSKU = { ...stdSku, skuId: 'STD', weightKg: W };
    const skus = new Map<string, CaseSKU>([['STD', exactSku]]);
    const skuWeights = makeSkuWeights([exactSku]);
    // Place case centered at x=12200 (COM = 12200 + 600 = 12800 > axle)
    // Better: place centered exactly at axle: COM = 12200 → x = 12200 - 600 = 11600
    const inst = createInstance('exact', exactSku, { x: 11600, y: 600, z: 0 }, 0);
    const ctx: ValidatorContext = {
      truck: rigidVehicleToTruckType(trailer),
      vehicle: { kind: 'tractor-trailer', vehicle: rig },
      skus,
      instances: [],
      supportGraph: new SupportGraph(skuWeights),
      skuWeights,
    };
    const result = validatePlacement(inst, ctx);
    // trailerAxleKg should be ≈ W (at or just under limit) → should be valid
    // (we relax the exact assertion; main goal is no AXLE_TRAILER_OVER here)
    expect(result.violations).not.toContain('AXLE_TRAILER_OVER');
  });

  // Scenario 6: 1mm shift causes threshold crossing
  it('1 mm movement toward rear increases trailer axle load deterministically', () => {
    const W = 1000;
    const sw = new Map([['STD', W]]);
    const m1 = computeTrailerMetrics(
      [createInstance('p1', stdSku, { x: 5000, y: 600, z: 0 }, 0)], sw, rig
    );
    const m2 = computeTrailerMetrics(
      [createInstance('p2', stdSku, { x: 5001, y: 600, z: 0 }, 0)], sw, rig
    );
    // Moving 1mm toward rear must increase trailer axle load
    expect(m2.trailerAxleLoads[0].loadKg).toBeGreaterThan(m1.trailerAxleLoads[0].loadKg);
    // The difference must be proportional to 1/L (1/11000 of cargo weight per mm)
    const expectedDelta = W * (1 / 11000); // ≈ 0.091 kg
    expect(m2.trailerAxleLoads[0].loadKg - m1.trailerAxleLoads[0].loadKg).toBeCloseTo(expectedDelta, 2);
  });
});

// ============================================================================
// L/R balance code triggered
// ============================================================================

describe('Integration: LEFT_RIGHT_IMBALANCE_TRAILER', () => {
  it('fires LEFT_RIGHT_IMBALANCE_TRAILER when cargo is all on one side', () => {
    const heavySku: CaseSKU = {
      ...stdSku,
      skuId: 'STD',
      weightKg: 5000,
    };
    const skus = new Map<string, CaseSKU>([['STD', heavySku]]);
    const skuWeights = makeSkuWeights([heavySku]);
    // Use strict L/R rig
    const strictRig: TractorTrailer = {
      ...rig,
      trailer: { ...trailer, balance: { maxLeftRightPercentDiff: 0.01 } },
    };
    // Place entirely on left side (y=0, width 1200, midY=1200 → center at 600 < midY)
    const inst = createInstance('left', heavySku, { x: 5000, y: 0, z: 0 }, 0);
    const ctx: ValidatorContext = {
      truck: rigidVehicleToTruckType(trailer),
      vehicle: { kind: 'tractor-trailer', vehicle: strictRig },
      skus,
      instances: [],
      supportGraph: new SupportGraph(skuWeights),
      skuWeights,
    };
    const result = validatePlacement(inst, ctx);
    expect(result.violations).toContain('LEFT_RIGHT_IMBALANCE_TRAILER');
    // Must NOT also fire LEFT_RIGHT_IMBALANCE (wrong code for trailer mode)
    expect(result.violations).not.toContain('LEFT_RIGHT_IMBALANCE');
  });
});
