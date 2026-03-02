import { autoPack } from './src/core/autopack';
import type { TruckType, CaseSKU } from './src/core/types';

const truck: TruckType = {
  truckId: 'TRAILER',
  name: 'EU Trailer',
  innerDims: { x: 13600, y: 2480, z: 2700 },
  emptyWeightKg: 6900,
  axle: { frontX: 2000, rearX: 5700, maxFrontKg: 8000, maxRearKg: 16000 },
  balance: { maxLeftRightPercentDiff: 10 },
};

const k1: CaseSKU = {
  skuId: 'K1 Chariot',
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

for (const qty of [7, 12, 16]) {
  const result = autoPack(truck, [k1], new Map([[k1.skuId, qty]]));
  const maxX = result.placed.reduce((m, p) => Math.max(m, p.aabb.max.x), 0);
  console.log('qty', qty, 'placed', result.placed.length, 'maxX', maxX);
  for (const p of result.placed) {
    console.log(p.position.x, p.position.y, p.position.z, p.yaw);
  }
  console.log('---');
}
