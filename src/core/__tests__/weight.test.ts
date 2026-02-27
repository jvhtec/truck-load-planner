import { describe, it, expect } from 'vitest';
import { computeCOM, computeAxleLoads, computeLeftRightBalance, computeMetrics } from '../weight';
import type { CaseInstance, TruckType } from '../types';
import { createAABB } from '../geometry';

function makeInst(id: string, skuId: string, x: number, y: number, z: number, l: number, w: number, h: number): CaseInstance {
  return {
    id,
    skuId,
    position: { x, y, z },
    yaw: 0,
    aabb: createAABB({ x, y, z }, { x: l, y: w, z: h }),
  };
}

const truck: TruckType = {
  truckId: 'T1',
  name: 'Test Truck',
  innerDims: { x: 7200, y: 2400, z: 2400 },
  emptyWeightKg: 3500,
  axle: { frontX: 1000, rearX: 5500, maxFrontKg: 4000, maxRearKg: 8000 },
  balance: { maxLeftRightPercentDiff: 10 },
};

describe('computeCOM', () => {
  it('returns origin for no instances', () => {
    expect(computeCOM([], new Map())).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('single instance: COM is at center of AABB', () => {
    const inst = makeInst('a', 'SKU1', 0, 0, 0, 1000, 600, 400);
    const weights = new Map([['SKU1', 100]]);
    const com = computeCOM([inst], weights);
    expect(com.x).toBeCloseTo(500);
    expect(com.y).toBeCloseTo(300);
    expect(com.z).toBeCloseTo(200);
  });

  it('two equal-weight instances: COM is average of centers', () => {
    const a = makeInst('a', 'SKU1', 0, 0, 0, 1000, 600, 400);
    const b = makeInst('b', 'SKU1', 1000, 0, 0, 1000, 600, 400);
    const weights = new Map([['SKU1', 100]]);
    const com = computeCOM([a, b], weights);
    expect(com.x).toBeCloseTo(1000); // (500 + 1500) / 2
  });
});

describe('computeAxleLoads', () => {
  it('zero weight => zero loads', () => {
    const { frontKg, rearKg } = computeAxleLoads(0, 3000, truck);
    expect(frontKg).toBe(0);
    expect(rearKg).toBe(0);
  });

  it('COM at front axle => all weight on front', () => {
    const { frontKg, rearKg } = computeAxleLoads(1000, 1000, truck);
    expect(frontKg).toBeCloseTo(1000);
    expect(rearKg).toBeCloseTo(0);
  });

  it('COM at rear axle => all weight on rear', () => {
    const { frontKg, rearKg } = computeAxleLoads(1000, 5500, truck);
    expect(frontKg).toBeCloseTo(0);
    expect(rearKg).toBeCloseTo(1000);
  });

  it('COM in middle => evenly split', () => {
    const midX = (1000 + 5500) / 2; // 3250
    const { frontKg, rearKg } = computeAxleLoads(1000, midX, truck);
    expect(frontKg).toBeCloseTo(500, 1);
    expect(rearKg).toBeCloseTo(500, 1);
  });
});

describe('computeLeftRightBalance', () => {
  it('case on left side: weight on left, imbalance relative to payload', () => {
    const inst = makeInst('a', 'SKU1', 0, 0, 0, 1000, 600, 400);
    // Y center at 300, truck mid = 1200: left side
    const weights = new Map([['SKU1', 100]]);
    // truck payload = 4000 + 8000 - 3500 = 8500 kg
    const { leftKg, rightKg, imbalancePercent } = computeLeftRightBalance([inst], weights, truck);
    expect(leftKg).toBe(100);
    expect(rightKg).toBe(0);
    // imbalance = 100 / 8500 * 100 ≈ 1.18%
    expect(imbalancePercent).toBeCloseTo(100 / 8500 * 100, 2);
  });

  it('case centered: balanced', () => {
    // Place a case centered at Y=1200 exactly (truckWidth/2)
    const inst = makeInst('a', 'SKU1', 0, 1200, 0, 1000, 0, 400); // zero-width box to sit exactly at 1200
    const weights = new Map([['SKU1', 100]]);
    const { leftKg, rightKg } = computeLeftRightBalance([inst], weights, truck);
    // center = 1200 = midY, goes to right (>=)
    expect(rightKg).toBe(100);
    expect(leftKg).toBe(0);
  });
});

describe('computeMetrics', () => {
  it('returns zero metrics for empty instances', () => {
    const m = computeMetrics([], new Map(), truck);
    expect(m.totalWeightKg).toBe(0);
    expect(m.frontAxleKg).toBe(0);
    expect(m.rearAxleKg).toBe(0);
    expect(m.warnings).toHaveLength(0);
  });

  it('generates warning when axle load > 80%', () => {
    // Place a heavy case near front axle
    const inst = makeInst('a', 'SKU1', 900, 0, 0, 200, 2400, 400); // COM at 1000 = front axle
    const weights = new Map([['SKU1', 3500]]); // 3500 / 4000 = 87.5%
    const m = computeMetrics([inst], weights, truck);
    expect(m.warnings.some(w => w.includes('Front axle'))).toBe(true);
  });
});
