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

const SUPPORT_EPSILON = 5; // 5mm

export interface ValidatorContext {
  truck: TruckType;
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

  // 3. Collision with other instances
  // Use spatial index when available to avoid full O(n) scan
  const collidables: Iterable<string | CaseInstance> = ctx.spatialIndex
    ? ctx.spatialIndex.candidates(candidate.aabb)
    : ctx.instances;

  if (ctx.spatialIndex) {
    for (const otherId of collidables as Set<string>) {
      if (otherId === candidate.id) continue;
      const other = ctx.instances.find(i => i.id === otherId);
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

  // 4. Support (if not on floor)
  const candBottomZ = bottomZ(candidate.aabb);
  if (candBottomZ > SUPPORT_EPSILON) {
    const supportRatio = calculateSupportRatio(candidate, ctx.instances);

    if (supportRatio < sku.minSupportRatio) {
      violations.push('INSUFFICIENT_SUPPORT');
      details.supportRatio = supportRatio;
      details.requiredRatio = sku.minSupportRatio;
    }
  }

  // 5. Stacking rules
  const supporters = findSupporters(candidate, ctx.instances);
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

    // Check cumulative load
    const existingLoadAbove = ctx.supportGraph.getLoadAbove(supporter.id);
    const candidateWeight = sku.weightKg;

    if (existingLoadAbove + candidateWeight > supporterSku.maxLoadAboveKg) {
      violations.push('LOAD_EXCEEDED');
      details.loadExceeded = {
        supporter: supporter.id,
        existingLoad: existingLoadAbove,
        candidateWeight,
        maxAllowed: supporterSku.maxLoadAboveKg,
      };
    }
  }

  // 6. Axle load (with candidate included)
  const allInstances = [...ctx.instances, candidate];
  const totalWeight = allInstances.reduce(
    (sum, inst) => sum + (ctx.skuWeights.get(inst.skuId) || 0),
    0
  );

  // Calculate cargo COM X
  let comX = 0;
  for (const inst of allInstances) {
    const w = ctx.skuWeights.get(inst.skuId) || 0;
    comX += ((inst.aabb.min.x + inst.aabb.max.x) / 2) * w;
  }
  comX = totalWeight > 0 ? comX / totalWeight : 0;

  const { frontKg, rearKg } = computeAxleLoads(totalWeight, comX, ctx.truck);

  if (frontKg > ctx.truck.axle.maxFrontKg) {
    violations.push('AXLE_FRONT_OVER');
    details.axleFront = { load: frontKg, max: ctx.truck.axle.maxFrontKg };
  }

  if (rearKg > ctx.truck.axle.maxRearKg) {
    violations.push('AXLE_REAR_OVER');
    details.axleRear = { load: rearKg, max: ctx.truck.axle.maxRearKg };
  }

  // 7. L/R balance (with candidate included)
  const midY = ctx.truck.innerDims.y / 2;
  let leftKg = 0, rightKg = 0;

  for (const inst of allInstances) {
    const w = ctx.skuWeights.get(inst.skuId) || 0;
    const centerY = (inst.aabb.min.y + inst.aabb.max.y) / 2;
    if (centerY < midY) leftKg += w;
    else rightKg += w;
  }

  const imbalance = totalWeight > 0
    ? (Math.abs(leftKg - rightKg) / totalWeight) * 100
    : 0;

  if (imbalance > ctx.truck.balance.maxLeftRightPercentDiff) {
    violations.push('LEFT_RIGHT_IMBALANCE');
    details.lrImbalance = {
      left: leftKg,
      right: rightKg,
      percent: imbalance,
      max: ctx.truck.balance.maxLeftRightPercentDiff,
    };
  }

  return {
    valid: violations.length === 0,
    violations,
    details,
  };
}

// ============================================================================
// Helpers
// ============================================================================

interface AABB {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

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
