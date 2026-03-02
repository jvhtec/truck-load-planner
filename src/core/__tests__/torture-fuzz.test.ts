import { describe, it } from 'vitest';
import type {
  AABB,
  CaseInstance,
  CaseSKU,
  LoadMetrics,
  TruckType,
  ValidationError,
  Yaw,
} from '../types';
import { autoPack } from '../autopack';
import { aabbOverlap, computeOrientedAABB } from '../geometry';
import { validatePlacement, type ValidatorContext } from '../validate';
import { SupportGraph } from '../support';
import { SpatialIndex } from '../spatial';
import { computeMetrics } from '../weight';
import {
  buildStackClass,
  formatCaseCsv,
  parseCaseCsv,
  sanitizeSkuId,
  type CaseSheetRow,
} from '../../lib/caseCsv';
import { FLOOR_ONLY_TOKEN } from '../../lib/tokens';

const SUPPORT_EPSILON = 5;
const FLOAT_TOLERANCE = 1e-6;

const ITERATIONS = envPositiveInt('FUZZ_ITERATIONS', 100);
const SEED_OFFSET = envInt('FUZZ_SEED_OFFSET', 0);
const PROFILE = process.env.FUZZ_PROFILE ?? 'local';
const TEST_TIMEOUT_MS = envPositiveInt('FUZZ_TIMEOUT_MS', 30 * 60 * 1000);
const BASE_MAX_ATTEMPTS = envPositiveInt('FUZZ_BASE_MAX_ATTEMPTS', 4);

interface TruckPreset extends TruckType {
  obstacles: AABB[];
}

const TRUCK_PRESETS: TruckPreset[] = [
  {
    truckId: 'STANDARD_7_5T',
    name: 'Standard 7.5T Box Truck',
    innerDims: { x: 7200, y: 2400, z: 2400 },
    emptyWeightKg: 3500,
    axle: { frontX: 1000, rearX: 5500, maxFrontKg: 4000, maxRearKg: 8000 },
    balance: { maxLeftRightPercentDiff: 10 },
    obstacles: [],
  },
  {
    truckId: 'LARGE_18T',
    name: 'Large 18T Truck',
    innerDims: { x: 12000, y: 2500, z: 2700 },
    emptyWeightKg: 8000,
    axle: { frontX: 1500, rearX: 9500, maxFrontKg: 6000, maxRearKg: 15000 },
    balance: { maxLeftRightPercentDiff: 12 },
    obstacles: [],
  },
  {
    truckId: 'VAN_3_5T',
    name: 'Sprinter Van 3.5T',
    innerDims: { x: 4200, y: 1800, z: 1900 },
    emptyWeightKg: 2200,
    axle: { frontX: 800, rearX: 3500, maxFrontKg: 1800, maxRearKg: 3200 },
    balance: { maxLeftRightPercentDiff: 10 },
    obstacles: [
      {
        min: { x: 1700, y: 700, z: 0 },
        max: { x: 2300, y: 1100, z: 550 },
      },
    ],
  },
  {
    truckId: 'MEDIUM_12T',
    name: 'Medium Truck 12T',
    innerDims: { x: 9500, y: 2450, z: 2500 },
    emptyWeightKg: 5500,
    axle: { frontX: 1200, rearX: 7500, maxFrontKg: 5000, maxRearKg: 10000 },
    balance: { maxLeftRightPercentDiff: 12 },
    obstacles: [],
  },
  {
    truckId: 'SEMI_TRAILER',
    name: 'Semi-Trailer 40ft',
    innerDims: { x: 12000, y: 2440, z: 2800 },
    emptyWeightKg: 12000,
    axle: { frontX: 1800, rearX: 10500, maxFrontKg: 8000, maxRearKg: 20000 },
    balance: { maxLeftRightPercentDiff: 15 },
    obstacles: [],
  },
  {
    truckId: 'MEGA_TRUCK',
    name: 'Mega Truck Jumbo',
    innerDims: { x: 13500, y: 2480, z: 3000 },
    emptyWeightKg: 14000,
    axle: { frontX: 2000, rearX: 11500, maxFrontKg: 9000, maxRearKg: 24000 },
    balance: { maxLeftRightPercentDiff: 15 },
    obstacles: [],
  },
  {
    truckId: 'CITY_10T',
    name: 'City Rigid 10T',
    innerDims: { x: 8600, y: 2400, z: 2400 },
    emptyWeightKg: 4800,
    axle: { frontX: 1100, rearX: 6900, maxFrontKg: 4200, maxRearKg: 9000 },
    balance: { maxLeftRightPercentDiff: 11 },
    obstacles: [
      {
        min: { x: 3400, y: 940, z: 0 },
        max: { x: 4200, y: 1460, z: 500 },
      },
    ],
  },
  {
    truckId: 'RIGID_26T',
    name: 'Rigid 26T',
    innerDims: { x: 10500, y: 2500, z: 2650 },
    emptyWeightKg: 9000,
    axle: { frontX: 1400, rearX: 8300, maxFrontKg: 7000, maxRearKg: 18000 },
    balance: { maxLeftRightPercentDiff: 13 },
    obstacles: [],
  },
];

interface GeneratedRequest {
  quantities: Map<string, number>;
  totalRequested: number;
}

interface PlanValidationResult {
  valid: boolean;
  index?: number;
  instanceId?: string;
  violations?: ValidationError[];
}

interface PersistedInstance {
  id: string;
  skuId: string;
  position: { x: number; y: number; z: number };
  yaw: Yaw;
  tilt?: { y: 0 | 90 };
}

describe('torture fuzz harness', () => {
  it(
    `runs ${ITERATIONS} deterministic torture iterations [profile=${PROFILE}]`,
    () => {
      for (let i = 0; i < ITERATIONS; i++) {
        const seed = SEED_OFFSET + i + 1;
        const seedTag = `seed=${seed} iteration=${i + 1}/${ITERATIONS} profile=${PROFILE}`;
        const rng = new Rng(seed);

        const truck = cloneTruck(rng.pick(TRUCK_PRESETS));
        const skus = generateSkus(rng, truck, seed);
        const skuMap = new Map(skus.map((sku) => [sku.skuId, sku]));
        const request = generateRequest(rng, skus);

        const maxAttempts = request.totalRequested >= 150
          ? Math.max(1, Math.floor(BASE_MAX_ATTEMPTS / 2))
          : BASE_MAX_ATTEMPTS;

        const pack = autoPack(truck, skus, request.quantities, {
          maxAttempts,
          randomSeed: seed,
        });

        const replay = validatePlanSequential(pack.placed, truck, skuMap);
        ensure(replay.valid, `${seedTag}: autopack replay failed at ${replay.instanceId} with ${replay.violations?.join(',')}`);

        assertHardInvariants(pack.placed, truck, skuMap, `${seedTag} [autopack]`);
        assertMetricsMatch(computeMetrics(pack.placed, skuWeightMap(skuMap), truck), pack.metrics, `${seedTag}: autopack metrics drift`);

        const persisted = serializePlan(pack.placed);
        const reloaded = deserializePlan(persisted, skuMap);
        assertCanonicalPlanMatch(pack.placed, reloaded, `${seedTag}: save/load canonical mismatch`);

        assertMetricsMatch(
          computeMetrics(pack.placed, skuWeightMap(skuMap), truck),
          computeMetrics(reloaded, skuWeightMap(skuMap), truck),
          `${seedTag}: save/load metrics mismatch`,
        );

        const reloadReplay = validatePlanSequential(reloaded, truck, skuMap);
        ensure(reloadReplay.valid, `${seedTag}: save/load replay invalid at ${reloadReplay.instanceId}`);
        assertHardInvariants(reloaded, truck, skuMap, `${seedTag} [save-load]`);

        runManualEditFlow(rng, reloaded, truck, skuMap, seedTag);
        runCsvRoundTripFlow(rng, truck, skus, request, seedTag);
      }
    },
    TEST_TIMEOUT_MS,
  );
});

function runManualEditFlow(
  rng: Rng,
  baseline: CaseInstance[],
  truck: TruckType,
  skuMap: Map<string, CaseSKU>,
  seedTag: string,
): void {
  let working = cloneInstances(baseline);
  const initialValidation = validatePlanSequential(working, truck, skuMap);
  ensure(initialValidation.valid, `${seedTag}: manual-edit baseline is invalid`);

  const moved = attemptMoveBaseSlightly(rng, working, truck, skuMap);
  const moveValidation = validatePlanSequential(moved, truck, skuMap);
  if (moveValidation.valid) {
    assertHardInvariants(moved, truck, skuMap, `${seedTag} [edit:move-base]`);
    working = moved;
  } else {
    ensure((moveValidation.violations?.length ?? 0) > 0, `${seedTag}: move edit failed without violations`);
  }

  const deleted = attemptDeleteMiddleOfStack(working, truck, skuMap);
  const deleteValidation = validatePlanSequential(deleted, truck, skuMap);
  if (deleteValidation.valid) {
    assertHardInvariants(deleted, truck, skuMap, `${seedTag} [edit:delete-middle]`);
    working = deleted;
  } else {
    ensure((deleteValidation.violations?.length ?? 0) > 0, `${seedTag}: delete-middle failed without violations`);
  }

  const rotated = attemptRotateNearWall(rng, working, truck, skuMap);
  const rotateValidation = validatePlanSequential(rotated, truck, skuMap);
  if (rotateValidation.valid) {
    assertHardInvariants(rotated, truck, skuMap, `${seedTag} [edit:rotate-near-wall]`);
    working = rotated;
  } else {
    ensure((rotateValidation.violations?.length ?? 0) > 0, `${seedTag}: rotate edit failed without violations`);
  }

  attemptIllegalPlacements(rng, working, truck, skuMap, seedTag);
}

function runCsvRoundTripFlow(
  rng: Rng,
  truck: TruckType,
  skus: CaseSKU[],
  request: GeneratedRequest,
  seedTag: string,
): void {
  const quantityRecord = Object.fromEntries(request.quantities.entries());
  const csv = formatCaseCsv(skus, quantityRecord);
  const rows = parseCaseCsv(csv);

  const expectedCanonicalRows = canonicalRowsFromSkus(skus, request.quantities);
  const parsedCanonicalRows = canonicalRowsFromRows(rows);
  ensure(
    JSON.stringify(expectedCanonicalRows) === JSON.stringify(parsedCanonicalRows),
    `${seedTag}: CSV canonical model mismatch`,
  );

  const imported = importRowsToSkus(rows);
  const importedPack = autoPack(truck, imported.skus, imported.quantities, {
    maxAttempts: 1,
    randomSeed: rng.nextInt(1, 1_000_000),
  });

  const importedSkuMap = new Map(imported.skus.map((sku) => [sku.skuId, sku]));
  const importedReplay = validatePlanSequential(importedPack.placed, truck, importedSkuMap);
  ensure(importedReplay.valid, `${seedTag}: imported CSV autopack replay failed at ${importedReplay.instanceId}`);
  assertHardInvariants(importedPack.placed, truck, importedSkuMap, `${seedTag} [csv-roundtrip]`);
}

function attemptMoveBaseSlightly(
  rng: Rng,
  instances: CaseInstance[],
  _truck: TruckType,
  skuMap: Map<string, CaseSKU>,
): CaseInstance[] {
  if (instances.length === 0) return instances;

  const graph = buildSupportGraph(instances, skuWeightMap(skuMap));
  const candidate = instances.find((inst) => graph.getDependents(inst.id).length > 0);
  if (!candidate) return instances;

  const sku = skuMap.get(candidate.skuId);
  if (!sku) return instances;

  const delta = { x: rng.nextInt(-120, 120), y: rng.nextInt(-120, 120), z: 0 };
  const nextPos = {
    x: candidate.position.x + delta.x,
    y: candidate.position.y + delta.y,
    z: candidate.position.z,
  };

  const updated = withPlacement(candidate, sku, nextPos, candidate.yaw, normalizeTilt(candidate.tilt));
  const copy = cloneInstances(instances);
  const idx = copy.findIndex((inst) => inst.id === candidate.id);
  if (idx >= 0) copy[idx] = updated;
  return copy;
}

function attemptDeleteMiddleOfStack(
  instances: CaseInstance[],
  _truck: TruckType,
  skuMap: Map<string, CaseSKU>,
): CaseInstance[] {
  if (instances.length < 3) return instances;

  const graph = buildSupportGraph(instances, skuWeightMap(skuMap));
  const middle = instances.find((inst) => {
    const supporters = graph.getSupporters(inst.id);
    const dependents = graph.getDependents(inst.id);
    return supporters.size > 0 && dependents.length > 0;
  });

  if (!middle) return instances;
  return cloneInstances(instances.filter((inst) => inst.id !== middle.id));
}

function attemptRotateNearWall(
  rng: Rng,
  instances: CaseInstance[],
  truck: TruckType,
  skuMap: Map<string, CaseSKU>,
): CaseInstance[] {
  if (instances.length === 0) return instances;

  const nearWall = instances.find((inst) => {
    const nearFront = inst.aabb.min.x < 100;
    const nearRear = truck.innerDims.x - inst.aabb.max.x < 100;
    const nearLeft = inst.aabb.min.y < 100;
    const nearRight = truck.innerDims.y - inst.aabb.max.y < 100;
    return nearFront || nearRear || nearLeft || nearRight;
  });
  if (!nearWall) return instances;

  const sku = skuMap.get(nearWall.skuId);
  if (!sku) return instances;
  const alternatives = sku.allowedYaw.filter((yaw) => yaw !== nearWall.yaw);
  if (alternatives.length === 0) return instances;

  const nextYaw = rng.pick(alternatives);
  const updated = withPlacement(
    nearWall,
    sku,
    { ...nearWall.position },
    nextYaw,
    normalizeTilt(nearWall.tilt),
  );
  const copy = cloneInstances(instances);
  const idx = copy.findIndex((inst) => inst.id === nearWall.id);
  if (idx >= 0) copy[idx] = updated;
  return copy;
}

function attemptIllegalPlacements(
  rng: Rng,
  instances: CaseInstance[],
  truck: TruckType,
  skuMap: Map<string, CaseSKU>,
  seedTag: string,
): void {
  if (instances.length === 0 || skuMap.size === 0) return;

  const context = buildValidatorContext(truck, skuMap, instances);
  const victim = instances[0];
  const victimSku = skuMap.get(victim.skuId);
  if (!victimSku) return;

  // Illegal: direct collision with existing placement.
  const colliding = withPlacement(
    victim,
    victimSku,
    { ...victim.position },
    victim.yaw,
    normalizeTilt(victim.tilt),
    `${victim.id}-illegal-collision`,
  );
  const collisionValidation = validatePlacement(colliding, context);
  ensure(!collisionValidation.valid, `${seedTag}: illegal collision placement was accepted`);
  ensure(collisionValidation.violations.includes('COLLISION'), `${seedTag}: illegal collision missing COLLISION violation`);

  // Illegal: out-of-bounds placement.
  const outOfBounds = withPlacement(
    victim,
    victimSku,
    { x: truck.innerDims.x - 10, y: 0, z: 0 },
    victim.yaw,
    normalizeTilt(victim.tilt),
    `${victim.id}-illegal-oob`,
  );
  const oobValidation = validatePlacement(outOfBounds, context);
  ensure(!oobValidation.valid, `${seedTag}: illegal out-of-bounds placement was accepted`);
  ensure(oobValidation.violations.includes('OUT_OF_BOUNDS'), `${seedTag}: illegal out-of-bounds missing OUT_OF_BOUNDS`);

  // Illegal: unsupported floating placement.
  const floatingCandidates = Array.from(skuMap.values()).filter((sku) => !isFloorOnly(sku));
  if (floatingCandidates.length === 0) return;
  const randomSku = rng.pick(floatingCandidates);
  const unsupportedYaw = randomSku.allowedYaw[0] ?? 0;
  const unsupportedDims = orientedDims(randomSku, unsupportedYaw, { y: 0 });
  const floatingZ = Math.max(50, Math.floor((truck.innerDims.z - unsupportedDims.z) / 2));
  if (floatingZ > SUPPORT_EPSILON && floatingZ + unsupportedDims.z < truck.innerDims.z) {
    const floatingPos = {
      x: Math.max(0, Math.floor((truck.innerDims.x - unsupportedDims.x) / 3)),
      y: Math.max(0, Math.floor((truck.innerDims.y - unsupportedDims.y) / 3)),
      z: floatingZ,
    };
    const floating: CaseInstance = {
      id: `${randomSku.skuId}-illegal-floating`,
      skuId: randomSku.skuId,
      position: floatingPos,
      yaw: unsupportedYaw,
      tilt: { y: 0 },
      aabb: computeOrientedAABB(randomSku, floatingPos, unsupportedYaw, { y: 0 }),
    };
    const floatingValidation = validatePlacement(floating, context);
    ensure(!floatingValidation.valid, `${seedTag}: illegal floating placement was accepted`);
    ensure((floatingValidation.violations.length ?? 0) > 0, `${seedTag}: illegal floating placement has no violations`);
  }
}

function assertHardInvariants(
  instances: CaseInstance[],
  truck: TruckType,
  skuMap: Map<string, CaseSKU>,
  tag: string,
): void {
  assertNoOverlaps(instances, tag);
  assertInBoundsAndKeepouts(instances, truck, tag);
  assertSupportAndLoadInvariants(instances, skuMap, tag);
  assertBalanceInvariants(instances, truck, skuMap, tag);
}

function assertNoOverlaps(instances: CaseInstance[], tag: string): void {
  for (let i = 0; i < instances.length; i++) {
    for (let j = i + 1; j < instances.length; j++) {
      if (aabbOverlap(instances[i].aabb, instances[j].aabb)) {
        throw new Error(`${tag}: overlap between ${instances[i].id} and ${instances[j].id}`);
      }
    }
  }
}

function assertInBoundsAndKeepouts(instances: CaseInstance[], truck: TruckType, tag: string): void {
  for (const inst of instances) {
    ensure(inst.aabb.min.x >= -FLOAT_TOLERANCE, `${tag}: ${inst.id} min.x out of bounds`);
    ensure(inst.aabb.min.y >= -FLOAT_TOLERANCE, `${tag}: ${inst.id} min.y out of bounds`);
    ensure(inst.aabb.min.z >= -FLOAT_TOLERANCE, `${tag}: ${inst.id} min.z out of bounds`);
    ensure(inst.aabb.max.x <= truck.innerDims.x + FLOAT_TOLERANCE, `${tag}: ${inst.id} max.x out of bounds`);
    ensure(inst.aabb.max.y <= truck.innerDims.y + FLOAT_TOLERANCE, `${tag}: ${inst.id} max.y out of bounds`);
    ensure(inst.aabb.max.z <= truck.innerDims.z + FLOAT_TOLERANCE, `${tag}: ${inst.id} max.z out of bounds`);

    for (const obstacle of truck.obstacles ?? []) {
      ensure(!aabbOverlap(inst.aabb, obstacle), `${tag}: ${inst.id} overlaps keepout obstacle`);
    }
  }
}

function assertSupportAndLoadInvariants(
  instances: CaseInstance[],
  skuMap: Map<string, CaseSKU>,
  tag: string,
): void {
  const graph = buildSupportGraph(instances, skuWeightMap(skuMap));
  for (const inst of instances) {
    const sku = skuMap.get(inst.skuId);
    ensure(!!sku, `${tag}: missing SKU for instance ${inst.id}`);

    if (inst.aabb.min.z > SUPPORT_EPSILON) {
      const support = graph.getSupportRatio(inst, instances);
      ensure(
        support + FLOAT_TOLERANCE >= sku.minSupportRatio,
        `${tag}: ${inst.id} support ratio ${support.toFixed(4)} < ${sku.minSupportRatio.toFixed(4)}`,
      );
    }

    const loadAbove = graph.getLoadAbove(inst.id);
    ensure(
      loadAbove <= sku.maxLoadAboveKg + FLOAT_TOLERANCE,
      `${tag}: ${inst.id} loadAbove ${loadAbove.toFixed(3)} > ${sku.maxLoadAboveKg.toFixed(3)}`,
    );
  }
}

function assertBalanceInvariants(
  instances: CaseInstance[],
  truck: TruckType,
  skuMap: Map<string, CaseSKU>,
  tag: string,
): void {
  const metrics = computeMetrics(instances, skuWeightMap(skuMap), truck);
  ensure(
    metrics.frontAxleKg <= truck.axle.maxFrontKg + FLOAT_TOLERANCE,
    `${tag}: front axle ${metrics.frontAxleKg.toFixed(3)} > ${truck.axle.maxFrontKg.toFixed(3)}`,
  );
  ensure(
    metrics.rearAxleKg <= truck.axle.maxRearKg + FLOAT_TOLERANCE,
    `${tag}: rear axle ${metrics.rearAxleKg.toFixed(3)} > ${truck.axle.maxRearKg.toFixed(3)}`,
  );
  ensure(
    metrics.lrImbalancePercent <= truck.balance.maxLeftRightPercentDiff + FLOAT_TOLERANCE,
    `${tag}: L/R imbalance ${metrics.lrImbalancePercent.toFixed(3)} > ${truck.balance.maxLeftRightPercentDiff.toFixed(3)}`,
  );
}

function validatePlanSequential(
  instances: CaseInstance[],
  truck: TruckType,
  skuMap: Map<string, CaseSKU>,
): PlanValidationResult {
  const skuWeights = skuWeightMap(skuMap);
  const supportGraph = new SupportGraph(skuWeights);
  const spatial = new SpatialIndex();
  const placed: CaseInstance[] = [];

  for (let idx = 0; idx < instances.length; idx++) {
    const candidate = instances[idx];
    const ctx: ValidatorContext = {
      truck,
      skus: skuMap,
      instances: placed,
      supportGraph,
      skuWeights,
      spatialIndex: spatial,
    };

    const validation = validatePlacement(candidate, ctx);
    if (!validation.valid) {
      return {
        valid: false,
        index: idx,
        instanceId: candidate.id,
        violations: validation.violations,
      };
    }

    placed.push(candidate);
    supportGraph.addInstance(candidate, placed);
    spatial.add(candidate.id, candidate.aabb);
  }

  return { valid: true };
}

function buildValidatorContext(
  truck: TruckType,
  skuMap: Map<string, CaseSKU>,
  instances: CaseInstance[],
): ValidatorContext {
  const skuWeights = skuWeightMap(skuMap);
  const supportGraph = new SupportGraph(skuWeights);
  const spatial = new SpatialIndex();
  const placed: CaseInstance[] = [];

  for (const inst of instances) {
    placed.push(inst);
    supportGraph.addInstance(inst, placed);
    spatial.add(inst.id, inst.aabb);
  }

  return {
    truck,
    skus: skuMap,
    instances,
    supportGraph,
    skuWeights,
    spatialIndex: spatial,
  };
}

function buildSupportGraph(instances: CaseInstance[], skuWeights: Map<string, number>): SupportGraph {
  const graph = new SupportGraph(skuWeights);
  const built: CaseInstance[] = [];
  for (const inst of instances) {
    built.push(inst);
    graph.addInstance(inst, built);
  }
  return graph;
}

function serializePlan(instances: CaseInstance[]): PersistedInstance[] {
  return instances.map((inst) => ({
    id: inst.id,
    skuId: inst.skuId,
    position: { ...inst.position },
    yaw: inst.yaw,
    tilt: normalizeTilt(inst.tilt),
  }));
}

function deserializePlan(saved: PersistedInstance[], skuMap: Map<string, CaseSKU>): CaseInstance[] {
  return saved.map((item) => {
    const sku = skuMap.get(item.skuId);
    if (!sku) {
      throw new Error(`deserializePlan: missing SKU ${item.skuId}`);
    }
    const tilt = normalizeTilt(item.tilt);
    return {
      id: item.id,
      skuId: item.skuId,
      position: { ...item.position },
      yaw: item.yaw,
      tilt,
      aabb: computeOrientedAABB(sku, item.position, item.yaw, tilt),
    };
  });
}

function assertCanonicalPlanMatch(original: CaseInstance[], reloaded: CaseInstance[], tag: string): void {
  const canonical = (instances: CaseInstance[]) =>
    [...instances]
      .map((inst) => ({
        id: inst.id,
        skuId: inst.skuId,
        position: {
          x: roundTo(inst.position.x, 3),
          y: roundTo(inst.position.y, 3),
          z: roundTo(inst.position.z, 3),
        },
        yaw: inst.yaw,
        tiltY: normalizeTilt(inst.tilt).y,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));

  const left = canonical(original);
  const right = canonical(reloaded);
  ensure(JSON.stringify(left) === JSON.stringify(right), tag);
}

function assertMetricsMatch(a: LoadMetrics, b: LoadMetrics, tag: string): void {
  ensure(Math.abs(a.totalWeightKg - b.totalWeightKg) <= FLOAT_TOLERANCE, `${tag}: totalWeight mismatch`);
  ensure(Math.abs(a.frontAxleKg - b.frontAxleKg) <= FLOAT_TOLERANCE, `${tag}: frontAxle mismatch`);
  ensure(Math.abs(a.rearAxleKg - b.rearAxleKg) <= FLOAT_TOLERANCE, `${tag}: rearAxle mismatch`);
  ensure(Math.abs(a.leftWeightKg - b.leftWeightKg) <= FLOAT_TOLERANCE, `${tag}: leftWeight mismatch`);
  ensure(Math.abs(a.rightWeightKg - b.rightWeightKg) <= FLOAT_TOLERANCE, `${tag}: rightWeight mismatch`);
  ensure(Math.abs(a.lrImbalancePercent - b.lrImbalancePercent) <= FLOAT_TOLERANCE, `${tag}: lrImbalance mismatch`);
  ensure(Math.abs(a.maxStackHeightMm - b.maxStackHeightMm) <= FLOAT_TOLERANCE, `${tag}: maxStackHeight mismatch`);
  ensure(a.warnings.join('|') === b.warnings.join('|'), `${tag}: warning list mismatch`);
}

function canonicalRowsFromSkus(skus: CaseSKU[], quantities: Map<string, number>): CaseSheetRow[] {
  return skus
    .map((sku) => ({
      boxName: sku.name,
      count: Math.max(0, quantities.get(sku.skuId) ?? 0),
      colorHex: sku.color ?? '#6366f1',
      length: sku.dims.l,
      width: sku.dims.w,
      height: sku.dims.h,
      weight: sku.weightKg,
      noTilt: !sku.tiltAllowed,
      noRotate: sku.allowedYaw.length <= 1,
      noStack: !sku.canBeBase || !sku.topContactAllowed || sku.maxLoadAboveKg <= 0,
      onFloor: isFloorOnly(sku),
    }))
    .sort((a, b) => a.boxName.localeCompare(b.boxName));
}

function canonicalRowsFromRows(rows: CaseSheetRow[]): CaseSheetRow[] {
  return [...rows]
    .map((row) => ({
      boxName: row.boxName,
      count: row.count,
      colorHex: row.colorHex,
      length: row.length,
      width: row.width,
      height: row.height,
      weight: row.weight,
      noTilt: row.noTilt,
      noRotate: row.noRotate,
      noStack: row.noStack,
      onFloor: row.onFloor,
    }))
    .sort((a, b) => a.boxName.localeCompare(b.boxName));
}

function importRowsToSkus(rows: CaseSheetRow[]): { skus: CaseSKU[]; quantities: Map<string, number> } {
  const existing = new Set<string>();
  const skus: CaseSKU[] = [];
  const quantities = new Map<string, number>();

  for (const row of rows) {
    const skuId = sanitizeSkuId(row.boxName, existing);
    const noStack = row.noStack;

    const sku: CaseSKU = {
      skuId,
      name: row.boxName,
      color: row.colorHex,
      dims: {
        l: Math.max(50, Math.round(row.length)),
        w: Math.max(50, Math.round(row.width)),
        h: Math.max(50, Math.round(row.height)),
      },
      weightKg: Math.max(1, row.weight),
      uprightOnly: row.noTilt,
      allowedYaw: row.noRotate ? [0] : [0, 90, 180, 270],
      tiltAllowed: !row.noTilt,
      canBeBase: !noStack,
      topContactAllowed: !noStack,
      maxLoadAboveKg: noStack ? 0 : Math.max(10, row.weight * 3),
      minSupportRatio: 0.75,
      stackClass: buildStackClass(undefined, row.onFloor),
    };

    skus.push(sku);
    quantities.set(skuId, Math.max(0, Math.round(row.count)));
  }

  return { skus, quantities };
}

function generateSkus(rng: Rng, truck: TruckType, seed: number): CaseSKU[] {
  const count = rng.nextInt(8, 18);
  const skus: CaseSKU[] = [];

  for (let i = 0; i < count; i++) {
    const huge = i < Math.max(1, Math.floor(count * 0.15));
    const noStackBias = i < Math.max(2, Math.floor(count * 0.3));

    const maxL = Math.max(350, Math.floor(Math.min(truck.innerDims.x * (huge ? 0.45 : 0.32), 2600)));
    const maxW = Math.max(350, Math.floor(Math.min(truck.innerDims.y * (huge ? 0.75 : 0.55), 1400)));
    const maxH = Math.max(300, Math.floor(Math.min(truck.innerDims.z * (huge ? 0.75 : 0.55), 2000)));

    const l = roundDim(rng.nextInt(250, maxL));
    const w = roundDim(rng.nextInt(250, maxW));
    const h = roundDim(rng.nextInt(220, maxH));
    const volumeM3 = (l * w * h) / 1_000_000_000;
    const density = rng.nextFloat(110, 450);
    const variance = rng.nextFloat(0.65, 1.4);
    const weightKg = roundTo(Math.max(5, volumeM3 * density * variance), 3);

    const uprightOnly = rng.nextBool(0.45);
    const tiltAllowed = !uprightOnly && rng.nextBool(0.35);
    const allowedYaw = randomAllowedYawSubset(rng);

    const forcedNoStack = noStackBias && rng.nextBool(0.7);
    const canBeBase = forcedNoStack ? false : rng.nextBool(0.72);
    const topContactAllowed = forcedNoStack ? false : (canBeBase ? rng.nextBool(0.85) : false);
    const maxLoadAboveKg =
      !canBeBase || !topContactAllowed || rng.nextBool(0.18)
        ? 0
        : roundTo(Math.max(weightKg * rng.nextFloat(1.4, 9.0), 20), 3);

    const minSupportRatio = roundTo(rng.nextFloat(0.5, 0.9), 3);
    const floorOnly = rng.nextBool(0.12);

    skus.push({
      skuId: `SKU_${seed}_${i + 1}`,
      name: `Case ${seed}-${i + 1}`,
      color: randomColor(rng),
      dims: { l, w, h },
      weightKg,
      uprightOnly,
      allowedYaw,
      tiltAllowed,
      canBeBase,
      topContactAllowed,
      maxLoadAboveKg,
      minSupportRatio,
      stackClass: buildStackClass(undefined, floorOnly),
    });
  }

  return rng.shuffle(skus);
}

function generateRequest(rng: Rng, skus: CaseSKU[]): GeneratedRequest {
  const stress = rng.nextBool(0.06);
  const totalRequested = stress ? rng.nextInt(150, 220) : rng.nextInt(10, 80);
  const quantities = new Map<string, number>();

  const weights = skus.map((sku) => {
    const footprint = sku.dims.l * sku.dims.w;
    let weight = 1;
    if (!sku.canBeBase || !sku.topContactAllowed || sku.maxLoadAboveKg <= 0) weight += 4;
    if (footprint > 1_200_000) weight += 2;
    if (Math.max(sku.dims.l, sku.dims.w, sku.dims.h) > 1400) weight += 1;
    return weight;
  });

  for (let i = 0; i < totalRequested; i++) {
    const idx = weightedPick(rng, weights);
    const skuId = skus[idx].skuId;
    quantities.set(skuId, (quantities.get(skuId) ?? 0) + 1);
  }

  return { quantities, totalRequested };
}

function randomAllowedYawSubset(rng: Rng): Yaw[] {
  const yaws: Yaw[] = [0, 90, 180, 270];
  if (rng.nextBool(0.2)) {
    return [0];
  }
  if (rng.nextBool(0.2)) {
    return [0, 180];
  }
  const shuffled = rng.shuffle(yaws);
  const count = rng.nextInt(2, 4);
  return [...new Set(shuffled.slice(0, count))] as Yaw[];
}

function randomColor(rng: Rng): string {
  const channel = () => rng.nextInt(0, 255).toString(16).padStart(2, '0');
  return `#${channel()}${channel()}${channel()}`;
}

function weightedPick(rng: Rng, weights: number[]): number {
  const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
  if (total <= 0) return 0;

  let pick = rng.nextFloat(0, total);
  for (let i = 0; i < weights.length; i++) {
    pick -= Math.max(0, weights[i]);
    if (pick <= 0) return i;
  }
  return weights.length - 1;
}

function isFloorOnly(sku: CaseSKU): boolean {
  return (sku.stackClass ?? '')
    .toUpperCase()
    .split(/\s*[,;|]\s*/)
    .includes(FLOOR_ONLY_TOKEN);
}

function withPlacement(
  base: CaseInstance,
  sku: CaseSKU,
  position: { x: number; y: number; z: number },
  yaw: Yaw,
  tilt: { y: 0 | 90 },
  idOverride?: string,
): CaseInstance {
  return {
    id: idOverride ?? base.id,
    skuId: base.skuId,
    position: { ...position },
    yaw,
    tilt,
    staged: base.staged,
    aabb: computeOrientedAABB(sku, position, yaw, tilt),
  };
}

function orientedDims(sku: CaseSKU, yaw: Yaw, tilt: { y: 0 | 90 }): { x: number; y: number; z: number } {
  const yawDims = yaw === 0 || yaw === 180
    ? { x: sku.dims.l, y: sku.dims.w, z: sku.dims.h }
    : { x: sku.dims.w, y: sku.dims.l, z: sku.dims.h };
  if (tilt.y === 90) {
    return { x: yawDims.z, y: yawDims.y, z: yawDims.x };
  }
  return yawDims;
}

function normalizeTilt(tilt?: { y?: number } | null): { y: 0 | 90 } {
  return tilt?.y === 90 ? { y: 90 } : { y: 0 };
}

function skuWeightMap(skuMap: Map<string, CaseSKU>): Map<string, number> {
  const map = new Map<string, number>();
  for (const [skuId, sku] of skuMap.entries()) {
    map.set(skuId, sku.weightKg);
  }
  return map;
}

function cloneInstances(instances: CaseInstance[]): CaseInstance[] {
  return instances.map((inst) => ({
    id: inst.id,
    skuId: inst.skuId,
    staged: inst.staged,
    position: { ...inst.position },
    yaw: inst.yaw,
    tilt: normalizeTilt(inst.tilt),
    aabb: {
      min: { ...inst.aabb.min },
      max: { ...inst.aabb.max },
    },
  }));
}

function cloneTruck(truck: TruckPreset): TruckType {
  return {
    truckId: truck.truckId,
    name: truck.name,
    innerDims: { ...truck.innerDims },
    emptyWeightKg: truck.emptyWeightKg,
    axle: { ...truck.axle },
    balance: { ...truck.balance },
    obstacles: (truck.obstacles ?? []).map((o) => ({
      min: { ...o.min },
      max: { ...o.max },
    })),
  };
}

function roundDim(value: number): number {
  return Math.max(50, Math.round(value / 10) * 10);
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw !== undefined ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return fallback;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw !== undefined ? Number(raw) : NaN;
  if (Number.isFinite(parsed)) return Math.floor(parsed);
  return fallback;
}

function ensure(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state * 1664525 + 1013904223) >>> 0;
    return this.state / 0x1_0000_0000;
  }

  nextBool(probabilityTrue = 0.5): boolean {
    return this.next() < probabilityTrue;
  }

  nextInt(min: number, max: number): number {
    if (max < min) return min;
    const span = max - min + 1;
    return min + Math.floor(this.next() * span);
  }

  nextFloat(min: number, max: number): number {
    if (max <= min) return min;
    return min + this.next() * (max - min);
  }

  pick<T>(values: T[]): T {
    return values[this.nextInt(0, values.length - 1)];
  }

  shuffle<T>(values: T[]): T[] {
    const out = [...values];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}
