/**
 * Single-entry validation engine
 * All placements must pass through this validator
 */

import type {
  TruckType,
  CaseSKU,
  CaseInstance,
  ValidationResult,
  ValidationError,
  AABB,
  VehicleConfig,
  TractorTrailer,
} from './types';
import {
  aabbContains,
  aabbOverlap,
  bottomZ,
  topZ,
  intersectionAreaXZ,
  bottomArea,
  isApproximately,
} from './geometry';
import { SupportGraph } from './support';
import { SpatialIndex } from './spatial';
import { computeAxleLoads } from './weight';
import {
  computeTrailerAxleLoads,
  computeTractorAxleLoads,
  computeRigidVehicleAxleLoads,
} from './trailerStatics';
import { FLOOR_ONLY_TOKEN } from '../lib/tokens';

const SUPPORT_EPSILON = 5; // 5mm

export interface ValidatorContext {
  truck: TruckType;
  /**
   * When set, overrides the legacy single-axle-pair validation for axle loads,
   * L/R balance, and bounds checking. Must be set together with `truck` for
   * geometry fallback (use rigidVehicleToTruckType for the trailer body).
   */
  vehicle?: VehicleConfig;
  skus: Map<string, CaseSKU>;
  instances: CaseInstance[];
  supportGraph: SupportGraph;
  skuWeights: Map<string, number>;
  /** Optional pre-built spatial index for fast collision queries (O(1) avg). */
  spatialIndex?: SpatialIndex;
}

// ============================================================================
// Main Validator
// ============================================================================

export function validatePlacement(
  candidate: CaseInstance,
  ctx: ValidatorContext
): ValidationResult {
  const violations: ValidationError[] = [];
  const details: Record<string, unknown> = {};

  const sku = ctx.skus.get(candidate.skuId);
  if (!sku) {
    return {
      valid: false,
      violations: ['INVALID_ORIENTATION'],
      details: { error: `Unknown SKU: ${candidate.skuId}` },
    };
  }

  // 1. Geometry bounds
  const truckBounds: AABB = {
    min: { x: 0, y: 0, z: 0 },
    max: ctx.truck.innerDims,
  };

  if (!aabbContains(truckBounds, candidate.aabb)) {
    violations.push('OUT_OF_BOUNDS');
    details.outOfBounds = {
      aabb: candidate.aabb,
      bounds: truckBounds,
    };
    // No point running further expensive checks if it's already out of bounds
    return { valid: false, violations, details };
  }

  // 2. Orientation — fast check before collision scan
  if (!sku.allowedYaw.includes(candidate.yaw)) {
    violations.push('INVALID_ORIENTATION');
    return { valid: false, violations, details };
  }

  const tiltY = candidate.tilt?.y ?? 0;
  if ((candidate as any).tilt?.x) {
    violations.push('INVALID_ORIENTATION');
    details.orientation = { error: 'Only Y-axis tilt is supported' };
    return { valid: false, violations, details };
  }

  const isFloorOnly = (sku.stackClass ?? '')
    .toUpperCase()
    .split(/\s*[,;|]\s*/)
    .includes(FLOOR_ONLY_TOKEN);
  if (isFloorOnly && bottomZ(candidate.aabb) > SUPPORT_EPSILON) {
    violations.push('INVALID_ORIENTATION');
    details.orientation = { error: 'Floor-only SKU must be placed on floor' };
    return { valid: false, violations, details };
  }
  if (tiltY === 90) {
    if (!sku.tiltAllowed) {
      violations.push('INVALID_ORIENTATION');
      details.orientation = { error: 'Tilt not allowed for this SKU' };
      return { valid: false, violations, details };
    }
    if (sku.uprightOnly) {
      violations.push('INVALID_ORIENTATION');
      details.orientation = { error: 'Upright-only SKU cannot be tilted' };
      return { valid: false, violations, details };
    }
  }

  // 3. Collision with fixed truck obstacles / keepouts
  if (ctx.truck.obstacles && ctx.truck.obstacles.length > 0) {
    for (let i = 0; i < ctx.truck.obstacles.length; i++) {
      const obstacle = ctx.truck.obstacles[i];
      if (aabbOverlap(candidate.aabb, obstacle)) {
        violations.push('COLLISION');
        details.collision = { with: 'OBSTACLE', obstacleIndex: i };
        return { valid: false, violations, details };
      }
    }
  }

  // 4. Collision with other instances
  // Use spatial index when available to avoid full O(n) scan
  if (ctx.spatialIndex) {
    // Build instance lookup map for O(1) access
    const instancesById = new Map(ctx.instances.map(i => [i.id, i]));
    for (const otherId of ctx.spatialIndex.candidates(candidate.aabb)) {
      if (otherId === candidate.id) continue;
      const other = instancesById.get(otherId);
      if (other && aabbOverlap(candidate.aabb, other.aabb)) {
        violations.push('COLLISION');
        details.collision = { with: other.id };
        break;
      }
    }
  } else {
    for (const other of ctx.instances) {
      if (other.id === candidate.id) continue;
      if (aabbOverlap(candidate.aabb, other.aabb)) {
        violations.push('COLLISION');
        details.collision = { with: other.id };
        break;
      }
    }
  }

  // 5. Support (if not on floor)
  const candBottomZ = bottomZ(candidate.aabb);
  if (candBottomZ > SUPPORT_EPSILON) {
    const supportRatio = calculateSupportRatio(candidate, ctx.instances);

    if (supportRatio < sku.minSupportRatio) {
      violations.push('INSUFFICIENT_SUPPORT');
      details.supportRatio = supportRatio;
      details.requiredRatio = sku.minSupportRatio;
    }
  }

  // 6. Stacking rules
  const supporters = findSupporters(candidate, ctx.instances);
  const instancesById = new Map(ctx.instances.map(inst => [inst.id, inst]));
  const candidateWeight = sku.weightKg;
  const checkedLoadSupporters = new Set<string>();
  for (const supporter of supporters) {
    const supporterSku = ctx.skus.get(supporter.skuId);
    if (!supporterSku) continue;

    if (!supporterSku.canBeBase) {
      violations.push('BASE_NOT_ALLOWED');
      details.baseNotAllowed = supporter.id;
    }

    if (!supporterSku.topContactAllowed) {
      violations.push('TOP_CONTACT_FORBIDDEN');
      details.topContactForbidden = supporter.id;
    }

    // Check cumulative load on the full support chain (direct supporters + ancestors).
    const affectedSupporters = collectSupportChainIds(supporter.id, ctx.supportGraph);
    for (const affectedId of affectedSupporters) {
      if (checkedLoadSupporters.has(affectedId)) continue;
      checkedLoadSupporters.add(affectedId);

      const affectedInstance = instancesById.get(affectedId);
      if (!affectedInstance) continue;
      const affectedSku = ctx.skus.get(affectedInstance.skuId);
      if (!affectedSku) continue;

      const existingLoadAbove = ctx.supportGraph.getLoadAbove(affectedId);
      if (existingLoadAbove + candidateWeight > affectedSku.maxLoadAboveKg) {
        if (!violations.includes('LOAD_EXCEEDED')) {
          violations.push('LOAD_EXCEEDED');
        }
        const loadExceeded = (details.loadExceeded as Array<Record<string, unknown>> | undefined) ?? [];
        loadExceeded.push({
          supporter: affectedId,
          existingLoad: existingLoadAbove,
          candidateWeight,
          maxAllowed: affectedSku.maxLoadAboveKg,
        });
        details.loadExceeded = loadExceeded;
      }
    }
  }

  // 7 + 8. Axle loads and L/R balance (with candidate included)
  const allInstances = [...ctx.instances, candidate];
  checkAxleAndBalance(allInstances, ctx, violations, details);

  return {
    valid: violations.length === 0,
    violations,
    details,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function calculateSupportRatio(
  candidate: CaseInstance,
  instances: CaseInstance[]
): number {
  const candBottomZ = bottomZ(candidate.aabb);
  const candBottomArea = bottomArea(candidate.aabb);

  if (candBottomArea === 0) return 0;

  let supportedArea = 0;

  for (const other of instances) {
    if (other.id === candidate.id) continue;

    const otherTopZ = topZ(other.aabb);

    if (isApproximately(otherTopZ, candBottomZ, SUPPORT_EPSILON)) {
      supportedArea += intersectionAreaXZ(candidate.aabb, other.aabb);
    }
  }

  return supportedArea / candBottomArea;
}

function findSupporters(
  candidate: CaseInstance,
  instances: CaseInstance[]
): CaseInstance[] {
  const supporters: CaseInstance[] = [];
  const candBottomZ = bottomZ(candidate.aabb);

  for (const other of instances) {
    if (other.id === candidate.id) continue;

    const otherTopZ = topZ(other.aabb);

    if (isApproximately(otherTopZ, candBottomZ, SUPPORT_EPSILON)) {
      const overlap = intersectionAreaXZ(candidate.aabb, other.aabb);
      if (overlap > 0) {
        supporters.push(other);
      }
    }
  }

  return supporters;
}

function collectSupportChainIds(instanceId: string, supportGraph: SupportGraph): Set<string> {
  const result = new Set<string>();
  const queue = [instanceId];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (result.has(id)) continue;
    result.add(id);
    for (const supporterId of supportGraph.getSupporters(id)) {
      queue.push(supporterId);
    }
  }

  return result;
}

// ============================================================================
// Axle load + L/R balance dispatch (v3 multi-vehicle)
// ============================================================================

function computeWeightAndComX(
  allInstances: CaseInstance[],
  skuWeights: Map<string, number>,
): { totalWeight: number; comX: number } {
  let totalWeight = 0;
  let comXNum = 0;
  for (const inst of allInstances) {
    const w = skuWeights.get(inst.skuId) || 0;
    totalWeight += w;
    comXNum += ((inst.aabb.min.x + inst.aabb.max.x) / 2) * w;
  }
  return {
    totalWeight,
    comX: totalWeight > 0 ? comXNum / totalWeight : 0,
  };
}

function checkLRBalance(
  allInstances: CaseInstance[],
  skuWeights: Map<string, number>,
  midY: number,
  maxPayloadKg: number,
  maxDiffPercent: number,
  violationCode: ValidationError,
  violations: ValidationError[],
  details: Record<string, unknown>,
): void {
  let leftKg = 0;
  let rightKg = 0;
  for (const inst of allInstances) {
    const w = skuWeights.get(inst.skuId) || 0;
    const centerY = (inst.aabb.min.y + inst.aabb.max.y) / 2;
    if (centerY < midY) leftKg += w;
    else rightKg += w;
  }
  const imbalance = (Math.abs(leftKg - rightKg) / Math.max(1, maxPayloadKg)) * 100;
  if (imbalance > maxDiffPercent) {
    violations.push(violationCode);
    details.lrImbalance = { left: leftKg, right: rightKg, percent: imbalance, max: maxDiffPercent };
  }
}

function checkAxleAndBalance(
  allInstances: CaseInstance[],
  ctx: ValidatorContext,
  violations: ValidationError[],
  details: Record<string, unknown>,
): void {
  const { vehicle } = ctx;

  // ── Tractor-trailer path ──
  if (vehicle?.kind === 'tractor-trailer') {
    checkTractorTrailerAxleLoads(allInstances, ctx.skuWeights, vehicle.vehicle, violations, details);
    // L/R balance on trailer body
    const trailer = vehicle.vehicle.trailer;
    const maxPayload = Math.max(
      1,
      trailer.axleGroups.reduce((s, ag) => s + ag.maxKg, 0) - trailer.emptyWeightKg,
    );
    checkLRBalance(
      allInstances,
      ctx.skuWeights,
      trailer.innerDimsMm.y / 2,
      maxPayload,
      trailer.balance.maxLeftRightPercentDiff,
      'LEFT_RIGHT_IMBALANCE_TRAILER',
      violations,
      details,
    );
    return;
  }

  // ── Multi-axle rigid path ──
  if (vehicle?.kind === 'multi-axle') {
    const rv = vehicle.vehicle;
    const { totalWeight, comX } = computeWeightAndComX(allInstances, ctx.skuWeights);
    const axleLoads = computeRigidVehicleAxleLoads(totalWeight, comX, rv);
    for (const ag of axleLoads) {
      if (ag.status === 'over') {
        const code: ValidationError = ag.id === 'front' ? 'AXLE_STEER_OVER' : 'AXLE_DRIVE_OVER';
        violations.push(code);
        details[`axle_${ag.id}`] = { load: ag.loadKg, max: ag.maxKg };
      }
    }
    const maxPayload = Math.max(
      1,
      rv.axleGroups.reduce((s, ag) => s + ag.maxKg, 0) - rv.emptyWeightKg,
    );
    checkLRBalance(
      allInstances,
      ctx.skuWeights,
      rv.innerDimsMm.y / 2,
      maxPayload,
      rv.balance.maxLeftRightPercentDiff,
      'LEFT_RIGHT_IMBALANCE',
      violations,
      details,
    );
    return;
  }

  // ── Legacy TruckType path (unchanged) ──
  const { totalWeight, comX } = computeWeightAndComX(allInstances, ctx.skuWeights);
  const { frontKg, rearKg } = computeAxleLoads(totalWeight, comX, ctx.truck);

  if (frontKg > ctx.truck.axle.maxFrontKg) {
    violations.push('AXLE_FRONT_OVER');
    details.axleFront = { load: frontKg, max: ctx.truck.axle.maxFrontKg };
  }
  if (rearKg > ctx.truck.axle.maxRearKg) {
    violations.push('AXLE_REAR_OVER');
    details.axleRear = { load: rearKg, max: ctx.truck.axle.maxRearKg };
  }

  const maxPayloadKg = Math.max(
    1,
    ctx.truck.axle.maxFrontKg + ctx.truck.axle.maxRearKg - ctx.truck.emptyWeightKg,
  );
  checkLRBalance(
    allInstances,
    ctx.skuWeights,
    ctx.truck.innerDims.y / 2,
    maxPayloadKg,
    ctx.truck.balance.maxLeftRightPercentDiff,
    'LEFT_RIGHT_IMBALANCE',
    violations,
    details,
  );
}

function checkTractorTrailerAxleLoads(
  allInstances: CaseInstance[],
  skuWeights: Map<string, number>,
  rig: TractorTrailer,
  violations: ValidationError[],
  details: Record<string, unknown>,
): void {
  const { totalWeight: totalCargo, comX } = computeWeightAndComX(allInstances, skuWeights);

  const { trailerAxleKg, kingpinKg, trailerAxleGroup } = computeTrailerAxleLoads(
    totalCargo,
    comX,
    rig.trailer,
    rig.coupling.kingpinX_onTrailerMm,
  );

  const { steerKg, driveKg, steerGroup, driveGroup } = computeTractorAxleLoads(
    rig.tractor.emptyWeightKg,
    rig.tractor.emptyComXmm,
    kingpinKg,
    rig.coupling.kingpinX_onTractorMm,
    rig.tractor,
  );

  // Trailer axle
  if (trailerAxleGroup.id !== 'none' && trailerAxleKg > trailerAxleGroup.maxKg) {
    violations.push('AXLE_TRAILER_OVER');
    details.axleTrailer = { load: trailerAxleKg, max: trailerAxleGroup.maxKg };
  }

  // Kingpin
  if (rig.coupling.maxKingpinKg !== undefined && kingpinKg > rig.coupling.maxKingpinKg) {
    violations.push('KINGPIN_OVER');
    details.kingpin = { load: kingpinKg, max: rig.coupling.maxKingpinKg };
  }

  // Steer axle
  if (steerKg > steerGroup.maxKg) {
    violations.push('AXLE_STEER_OVER');
    details.axleSteer = { load: steerKg, max: steerGroup.maxKg };
  }
  if (steerGroup.minKg !== undefined && steerKg < steerGroup.minKg) {
    violations.push('STEER_UNDER_MIN');
    details.steerUnder = { load: steerKg, min: steerGroup.minKg };
  }

  // Drive axle
  if (driveKg > driveGroup.maxKg) {
    violations.push('AXLE_DRIVE_OVER');
    details.axleDrive = { load: driveKg, max: driveGroup.maxKg };
  }
}
