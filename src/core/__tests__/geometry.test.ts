import { describe, it, expect } from 'vitest';
import {
  createAABB,
  getRotatedDims,
  computeAABB,
  aabbOverlap,
  aabbContains,
  intersectionAreaXZ,
  bottomArea,
  topZ,
  bottomZ,
  isApproximately,
  createInstance,
} from '../geometry';
import type { CaseSKU } from '../types';

const simpleSku: CaseSKU = {
  skuId: 'TEST',
  name: 'Test',
  dims: { l: 1000, w: 600, h: 400 },
  weightKg: 20,
  uprightOnly: false,
  allowedYaw: [0, 90, 180, 270],
  canBeBase: true,
  topContactAllowed: true,
  maxLoadAboveKg: 100,
  minSupportRatio: 0.75,
};

describe('createAABB', () => {
  it('creates correct AABB from position and dims', () => {
    const aabb = createAABB({ x: 100, y: 200, z: 0 }, { x: 1000, y: 600, z: 400 });
    expect(aabb.min).toEqual({ x: 100, y: 200, z: 0 });
    expect(aabb.max).toEqual({ x: 1100, y: 800, z: 400 });
  });
});

describe('getRotatedDims', () => {
  it('yaw 0: no rotation', () => {
    expect(getRotatedDims({ x: 1000, y: 600, z: 400 }, 0)).toEqual({ x: 1000, y: 600, z: 400 });
  });
  it('yaw 90: swaps X and Y', () => {
    expect(getRotatedDims({ x: 1000, y: 600, z: 400 }, 90)).toEqual({ x: 600, y: 1000, z: 400 });
  });
  it('yaw 180: same as 0', () => {
    expect(getRotatedDims({ x: 1000, y: 600, z: 400 }, 180)).toEqual({ x: 1000, y: 600, z: 400 });
  });
  it('yaw 270: same as 90', () => {
    expect(getRotatedDims({ x: 1000, y: 600, z: 400 }, 270)).toEqual({ x: 600, y: 1000, z: 400 });
  });
});

describe('computeAABB', () => {
  it('accounts for yaw rotation', () => {
    const aabb = computeAABB(simpleSku, { x: 0, y: 0, z: 0 }, 90);
    // l=1000, w=600 swapped: x-extent=600, y-extent=1000
    expect(aabb.max.x).toBe(600);
    expect(aabb.max.y).toBe(1000);
    expect(aabb.max.z).toBe(400);
  });
});

describe('aabbOverlap', () => {
  const a = createAABB({ x: 0, y: 0, z: 0 }, { x: 1000, y: 600, z: 400 });

  it('overlaps when boxes intersect', () => {
    const b = createAABB({ x: 500, y: 0, z: 0 }, { x: 1000, y: 600, z: 400 });
    expect(aabbOverlap(a, b)).toBe(true);
  });

  it('no overlap when boxes are side-by-side', () => {
    const b = createAABB({ x: 1000, y: 0, z: 0 }, { x: 1000, y: 600, z: 400 });
    expect(aabbOverlap(a, b)).toBe(false);
  });

  it('no overlap when boxes are separated', () => {
    const b = createAABB({ x: 2000, y: 0, z: 0 }, { x: 1000, y: 600, z: 400 });
    expect(aabbOverlap(a, b)).toBe(false);
  });

  it('no overlap when stacked vertically', () => {
    const b = createAABB({ x: 0, y: 0, z: 400 }, { x: 1000, y: 600, z: 400 });
    expect(aabbOverlap(a, b)).toBe(false);
  });
});

describe('aabbContains', () => {
  const outer = createAABB({ x: 0, y: 0, z: 0 }, { x: 5000, y: 3000, z: 2000 });

  it('contains when inner is inside', () => {
    const inner = createAABB({ x: 100, y: 100, z: 0 }, { x: 1000, y: 600, z: 400 });
    expect(aabbContains(outer, inner)).toBe(true);
  });

  it('does not contain when inner extends outside', () => {
    const inner = createAABB({ x: 4500, y: 100, z: 0 }, { x: 1000, y: 600, z: 400 });
    expect(aabbContains(outer, inner)).toBe(false);
  });
});

describe('intersectionAreaXZ', () => {
  it('returns area of XY overlap', () => {
    const a = createAABB({ x: 0, y: 0, z: 0 }, { x: 1000, y: 600, z: 400 });
    const b = createAABB({ x: 500, y: 0, z: 0 }, { x: 1000, y: 600, z: 400 });
    // X overlap: 500mm, Y overlap: 600mm → area = 300000
    expect(intersectionAreaXZ(a, b)).toBe(300000);
  });

  it('returns 0 when no overlap', () => {
    const a = createAABB({ x: 0, y: 0, z: 0 }, { x: 1000, y: 600, z: 400 });
    const b = createAABB({ x: 2000, y: 0, z: 0 }, { x: 1000, y: 600, z: 400 });
    expect(intersectionAreaXZ(a, b)).toBe(0);
  });
});

describe('bottomArea', () => {
  it('calculates XY footprint', () => {
    const aabb = createAABB({ x: 0, y: 0, z: 0 }, { x: 1000, y: 600, z: 400 });
    expect(bottomArea(aabb)).toBe(600000);
  });
});

describe('topZ / bottomZ', () => {
  it('returns correct z values', () => {
    const aabb = createAABB({ x: 0, y: 0, z: 100 }, { x: 1000, y: 600, z: 400 });
    expect(bottomZ(aabb)).toBe(100);
    expect(topZ(aabb)).toBe(500);
  });
});

describe('isApproximately', () => {
  it('returns true within tolerance', () => {
    expect(isApproximately(100, 103, 5)).toBe(true);
    expect(isApproximately(100, 106, 5)).toBe(false);
  });
});

describe('createInstance', () => {
  it('builds an instance with correct AABB', () => {
    const inst = createInstance('id1', simpleSku, { x: 0, y: 0, z: 0 }, 0);
    expect(inst.id).toBe('id1');
    expect(inst.skuId).toBe('TEST');
    expect(inst.aabb.max).toEqual({ x: 1000, y: 600, z: 400 });
  });
});
