import { describe, it, expect } from 'vitest';
import { autoPack } from '../autopack';
import { validatePlacement, type ValidatorContext } from '../validate';
import { SupportGraph } from '../support';
import type { CaseSKU, TruckType } from '../types';

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

const wideTrailerTruck: TruckType = {
  truckId: 'TRAILER',
  name: 'Wide Trailer',
  innerDims: { x: 13600, y: 2480, z: 2700 },
  emptyWeightKg: 6900,
  axle: { frontX: 2000, rearX: 5700, maxFrontKg: 50000, maxRearKg: 50000 },
  balance: { maxLeftRightPercentDiff: 100 },
};

const tallChariotCase: CaseSKU = {
  skuId: 'K1',
  name: '4xK1',
  dims: { l: 1450, w: 610, h: 2032 },
  weightKg: 471,
  uprightOnly: true,
  allowedYaw: [0, 90, 180, 270],
  canBeBase: true,
  topContactAllowed: true,
  maxLoadAboveKg: 100,
  minSupportRatio: 0.75,
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

  it('keeps placements on floor while floor space exists for the SKU', () => {
    const qty = 8;
    const result = autoPack(truck, [stdCase], new Map([['STD', qty]]), { maxAttempts: 1 });

    expect(result.placed).toHaveLength(qty);
    const elevated = result.placed.filter(inst => inst.position.z > 0);
    expect(elevated).toHaveLength(0);
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

  it('packs tall 4xK1 cases with width-efficient yaw to avoid long void channels', () => {
    const qty = 16;
    const result = autoPack(
      wideTrailerTruck,
      [tallChariotCase],
      new Map([[tallChariotCase.skuId, qty]]),
      { maxAttempts: 5, randomSeed: 3 }
    );

    expect(result.placed).toHaveLength(qty);
    expect(result.unplaced).toHaveLength(0);

    const maxExtentX = result.placed.reduce((maxX, inst) => Math.max(maxX, inst.aabb.max.x), 0);
    // 16 items with 1450mm depth and 4 columns should use ~5800mm length.
    // Allow slack for tie-breaks and tolerance, but block the previous >8m channel layout.
    expect(maxExtentX).toBeLessThanOrEqual(6200);
  });

  it('stress: packs 20 standard cases', () => {
    const result = autoPack(truck, [stdCase], new Map([['STD', 20]]));
    // Truck is 7.2m × 2.4m × 2.4m. Floor area = 7200×2400 = 17,280,000 mm².
    // Case footprint = 1000×600 = 600,000 mm². 20 cases need 12,000,000 mm² → should all fit on one layer.
    expect(result.placed.length).toBe(20);
    expect(result.unplaced).toHaveLength(0);
  });
});
