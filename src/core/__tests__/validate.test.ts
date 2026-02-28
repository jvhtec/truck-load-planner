import { describe, it, expect } from 'vitest';
import { validatePlacement, ValidatorContext } from '../validate';
import { SupportGraph } from '../support';
import { createInstance } from '../geometry';
import type { CaseSKU, TruckType } from '../types';

// Truck with generous balance tolerance so single-case tests don't trip the L/R check
const truck: TruckType = {
  truckId: 'T1',
  name: 'Test Truck',
  innerDims: { x: 7200, y: 2400, z: 2400 },
  emptyWeightKg: 3500,
  axle: { frontX: 1000, rearX: 5500, maxFrontKg: 4000, maxRearKg: 8000 },
  balance: { maxLeftRightPercentDiff: 100 }, // disable balance check for most tests
};

// Truck with strict balance for the balance-specific test
const strictTruck: TruckType = {
  ...truck,
  balance: { maxLeftRightPercentDiff: 10 },
};

// Base case: l=1000, w=1200, h=400 — centered at y=1200 (truck midY) when placed at y=600
// This keeps the Y center of mass exactly at truck midline to avoid spurious L/R failures.
const baseSku: CaseSKU = {
  skuId: 'BASE',
  name: 'Base Case',
  dims: { l: 1000, w: 1200, h: 400 },
  weightKg: 20,
  uprightOnly: false,
  allowedYaw: [0, 90, 180, 270],
  canBeBase: true,
  topContactAllowed: true,
  maxLoadAboveKg: 200,
  minSupportRatio: 0.75,
};

const fragSku: CaseSKU = {
  skuId: 'FRAG',
  name: 'Fragile Case',
  dims: { l: 800, w: 1200, h: 500 },
  weightKg: 15,
  uprightOnly: true,
  allowedYaw: [0, 180],
  canBeBase: false,
  topContactAllowed: false,
  maxLoadAboveKg: 0,
  minSupportRatio: 0.80,
};

// Place at y=600 so the case spans y=600..1800, centered at y=1200 (== truckMidY)
const CENTER_Y = 600;

function makeCtx(instances: ReturnType<typeof createInstance>[] = [], skuMap?: Map<string, CaseSKU>, overrideTruck?: TruckType): ValidatorContext {
  const t = overrideTruck ?? truck;
  const skus = skuMap ?? new Map([['BASE', baseSku], ['FRAG', fragSku]]);
  const skuWeights = new Map<string, number>();
  skus.forEach((s, id) => {
    skuWeights.set(id, s.weightKg);
  });
  const supportGraph = new SupportGraph(skuWeights);
  const placedSoFar: ReturnType<typeof createInstance>[] = [];
  for (const inst of instances) {
    placedSoFar.push(inst);
    supportGraph.addInstance(inst, placedSoFar);
  }
  return { truck: t, skus, instances, supportGraph, skuWeights };
}

describe('validatePlacement – OUT_OF_BOUNDS', () => {
  it('rejects case that starts past truck length', () => {
    const inst = createInstance('i1', baseSku, { x: 7000, y: CENTER_Y, z: 0 }, 0);
    const result = validatePlacement(inst, makeCtx());
    expect(result.valid).toBe(false);
    expect(result.violations).toContain('OUT_OF_BOUNDS');
  });

  it('accepts case that fits in truck', () => {
    const inst = createInstance('i1', baseSku, { x: 0, y: CENTER_Y, z: 0 }, 0);
    const result = validatePlacement(inst, makeCtx());
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });
});

describe('validatePlacement – COLLISION', () => {
  it('rejects overlapping case', () => {
    const first = createInstance('i1', baseSku, { x: 0, y: CENTER_Y, z: 0 }, 0);
    const ctx = makeCtx([first]);
    const second = createInstance('i2', baseSku, { x: 500, y: CENTER_Y, z: 0 }, 0);
    const result = validatePlacement(second, ctx);
    expect(result.violations).toContain('COLLISION');
  });

  it('accepts adjacent non-overlapping case', () => {
    const first = createInstance('i1', baseSku, { x: 0, y: CENTER_Y, z: 0 }, 0);
    const ctx = makeCtx([first]);
    const second = createInstance('i2', baseSku, { x: 1000, y: CENTER_Y, z: 0 }, 0);
    const result = validatePlacement(second, ctx);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });
});

describe('validatePlacement – INVALID_ORIENTATION', () => {
  it('rejects disallowed yaw', () => {
    // fragSku only allows 0/180; yaw=90 must be rejected
    const inst = createInstance('i1', fragSku, { x: 0, y: CENTER_Y, z: 0 }, 90);
    const result = validatePlacement(inst, makeCtx());
    expect(result.violations).toContain('INVALID_ORIENTATION');
  });
});

describe('validatePlacement – INSUFFICIENT_SUPPORT', () => {
  it('rejects floating case (no support below)', () => {
    const inst = createInstance('i1', baseSku, { x: 0, y: CENTER_Y, z: 400 }, 0);
    const result = validatePlacement(inst, makeCtx());
    expect(result.violations).toContain('INSUFFICIENT_SUPPORT');
  });

  it('accepts case on floor (z=0)', () => {
    const inst = createInstance('i1', baseSku, { x: 0, y: CENTER_Y, z: 0 }, 0);
    const result = validatePlacement(inst, makeCtx());
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('accepts case fully supported by base below', () => {
    const base = createInstance('base', baseSku, { x: 0, y: CENTER_Y, z: 0 }, 0);
    const ctx = makeCtx([base]);
    const top = createInstance('top', baseSku, { x: 0, y: CENTER_Y, z: 400 }, 0);
    const result = validatePlacement(top, ctx);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('rejects when support ratio is below threshold with one supporter', () => {
    const topSku: CaseSKU = { ...baseSku, skuId: 'TOP', minSupportRatio: 0.75 };
    const halfBaseSku: CaseSKU = { ...baseSku, skuId: 'HALF', dims: { l: 500, w: 1200, h: 400 } };
    const skus = new Map([
      ['TOP', topSku],
      ['HALF', halfBaseSku],
    ]);
    const base = createInstance('base', halfBaseSku, { x: 0, y: CENTER_Y, z: 0 }, 0);
    const ctx = makeCtx([base], skus);
    const top = createInstance('top', topSku, { x: 0, y: CENTER_Y, z: 400 }, 0);
    const result = validatePlacement(top, ctx);
    expect(result.valid).toBe(false);
    expect(result.violations).toContain('INSUFFICIENT_SUPPORT');
  });

  it('accepts when two supporters provide sufficient union support', () => {
    const topSku: CaseSKU = { ...baseSku, skuId: 'TOP', minSupportRatio: 0.75 };
    const supportSku: CaseSKU = {
      ...baseSku,
      skuId: 'SUP',
      dims: { l: 400, w: 1200, h: 400 },
      maxLoadAboveKg: 1000,
    };
    const skus = new Map([
      ['TOP', topSku],
      ['SUP', supportSku],
    ]);
    const leftSupport = createInstance('sup-left', supportSku, { x: 0, y: CENTER_Y, z: 0 }, 0);
    const rightSupport = createInstance('sup-right', supportSku, { x: 600, y: CENTER_Y, z: 0 }, 0);
    const ctx = makeCtx([leftSupport, rightSupport], skus);
    const top = createInstance('top', topSku, { x: 0, y: CENTER_Y, z: 400 }, 0);
    const result = validatePlacement(top, ctx);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });
});

describe('validatePlacement – BASE_NOT_ALLOWED / TOP_CONTACT_FORBIDDEN', () => {
  it('rejects stacking on fragile case (canBeBase=false)', () => {
    const frag = createInstance('frag', fragSku, { x: 0, y: CENTER_Y, z: 0 }, 0);
    const ctx = makeCtx([frag]);
    // frag height=500; place base on top at z=500
    const top = createInstance('top', baseSku, { x: 0, y: CENTER_Y, z: 500 }, 0);
    const result = validatePlacement(top, ctx);
    expect(result.violations).toContain('BASE_NOT_ALLOWED');
    expect(result.violations).toContain('TOP_CONTACT_FORBIDDEN');
  });
});

describe('validatePlacement – LOAD_EXCEEDED', () => {
  it('accepts when placed weight is within maxLoadAboveKg', () => {
    const limitedBase: CaseSKU = { ...baseSku, skuId: 'LIM', maxLoadAboveKg: 50 };
    const lightTop: CaseSKU = { ...baseSku, skuId: 'LIGHT', weightKg: 20 };
    const skus = new Map([['LIM', limitedBase], ['LIGHT', lightTop]]);
    const base = createInstance('base', limitedBase, { x: 0, y: CENTER_Y, z: 0 }, 0);
    const ctx = makeCtx([base], skus);
    const top = createInstance('top', lightTop, { x: 0, y: CENTER_Y, z: 400 }, 0);
    const result = validatePlacement(top, ctx);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('rejects when placed weight exceeds maxLoadAboveKg', () => {
    const limitedBase: CaseSKU = { ...baseSku, skuId: 'LIMITED', weightKg: 40, maxLoadAboveKg: 30 };
    const heavyTop: CaseSKU = { ...baseSku, skuId: 'HEAVY_TOP', weightKg: 50 };
    const skus = new Map([['LIMITED', limitedBase], ['HEAVY_TOP', heavyTop]]);
    const base = createInstance('base', limitedBase, { x: 0, y: CENTER_Y, z: 0 }, 0);
    const ctx = makeCtx([base], skus);
    const top = createInstance('top', heavyTop, { x: 0, y: CENTER_Y, z: 400 }, 0);
    const result = validatePlacement(top, ctx);
    expect(result.violations).toContain('LOAD_EXCEEDED');
  });

  it('rejects cumulative load on ancestor supporters', () => {
    const base: CaseSKU = {
      ...baseSku,
      skuId: 'BASE60',
      maxLoadAboveKg: 60,
      weightKg: 30,
    };
    const mid: CaseSKU = {
      ...baseSku,
      skuId: 'MID20',
      weightKg: 20,
      maxLoadAboveKg: 100,
    };
    const top: CaseSKU = {
      ...baseSku,
      skuId: 'TOP50',
      weightKg: 50,
    };
    const skus = new Map([
      ['BASE60', base],
      ['MID20', mid],
      ['TOP50', top],
    ]);

    const baseInst = createInstance('base', base, { x: 0, y: CENTER_Y, z: 0 }, 0);
    const midInst = createInstance('mid', mid, { x: 0, y: CENTER_Y, z: 400 }, 0);
    const ctx = makeCtx([baseInst, midInst], skus);
    const topInst = createInstance('top', top, { x: 0, y: CENTER_Y, z: 800 }, 0);

    const result = validatePlacement(topInst, ctx);
    expect(result.valid).toBe(false);
    expect(result.violations).toContain('LOAD_EXCEEDED');
  });
});

describe('validatePlacement – axle loads', () => {
  it('rejects case that pushes front axle over limit', () => {
    // 5000 kg centered near front axle (x=1000); maxFrontKg=4000
    const heavySku: CaseSKU = { ...baseSku, skuId: 'MEGA', weightKg: 5000 };
    const skus = new Map([['MEGA', heavySku]]);
    // Place at x=900..1900, center x=1400, comX≈1400
    const inst = createInstance('m', heavySku, { x: 900, y: CENTER_Y, z: 0 }, 0);
    const ctx = makeCtx([], skus);
    const result = validatePlacement(inst, ctx);
    expect(result.violations).toContain('AXLE_FRONT_OVER');
    expect(result.violations).not.toContain('AXLE_REAR_OVER');
  });

  it('rejects case that pushes rear axle over limit', () => {
    // 9000 kg centered at rear axle x=5500; maxRearKg=8000
    const heavySku: CaseSKU = { ...baseSku, skuId: 'MEGA_REAR', weightKg: 9000 };
    const skus = new Map([['MEGA_REAR', heavySku]]);
    // x=5000..6000, center x=5500 (rear axle)
    const inst = createInstance('m-rear', heavySku, { x: 5000, y: CENTER_Y, z: 0 }, 0);
    const ctx = makeCtx([], skus);
    const result = validatePlacement(inst, ctx);
    expect(result.violations).toContain('AXLE_REAR_OVER');
    expect(result.violations).not.toContain('AXLE_FRONT_OVER');
  });
});

describe('validatePlacement – LEFT_RIGHT_IMBALANCE', () => {
  it('rejects case that creates >10% L/R imbalance', () => {
    // Narrow case placed on left side: w=200, y=0..200, center y=100 << midY=1200
    const heavySku: CaseSKU = { ...baseSku, skuId: 'HEAVY', weightKg: 2000, dims: { l: 1000, w: 200, h: 400 } };
    const skus = new Map([['HEAVY', heavySku]]);
    const inst = createInstance('h', heavySku, { x: 0, y: 0, z: 0 }, 0);
    const result = validatePlacement(inst, makeCtx([], skus, strictTruck));
    expect(result.violations).toContain('LEFT_RIGHT_IMBALANCE');
  });

  it('classifies centerline case deterministically when centerY == midY', () => {
    const centerlineTruck: TruckType = {
      ...truck,
      balance: { maxLeftRightPercentDiff: 0 },
    };
    const centeredSku: CaseSKU = { ...baseSku, skuId: 'CENTERLINE', weightKg: 100 };
    const skus = new Map([['CENTERLINE', centeredSku]]);
    // baseSku at y=600..1800 => centerY=1200 exactly (truck midline)
    const inst = createInstance('c', centeredSku, { x: 0, y: CENTER_Y, z: 0 }, 0);
    const result = validatePlacement(inst, makeCtx([], skus, centerlineTruck));

    expect(result.violations).toContain('LEFT_RIGHT_IMBALANCE');
    const lr = result.details?.lrImbalance as { left: number; right: number } | undefined;
    expect(lr?.left).toBe(0);
    expect(lr?.right).toBe(100);
  });
});
