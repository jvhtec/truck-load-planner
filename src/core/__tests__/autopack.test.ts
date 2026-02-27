import { describe, it, expect } from 'vitest';
import { autoPack } from '../autopack';
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

  it('stress: packs 20 standard cases', () => {
    const result = autoPack(truck, [stdCase], new Map([['STD', 20]]));
    // Truck is 7.2m × 2.4m × 2.4m. Floor area = 7200×2400 = 17,280,000 mm².
    // Case footprint = 1000×600 = 600,000 mm². 20 cases need 12,000,000 mm² → should all fit on one layer.
    expect(result.placed.length).toBe(20);
    expect(result.unplaced).toHaveLength(0);
  });
});
