/**
 * Weight distribution and balance calculations
 */

import type { Vec3, TruckType, CaseInstance, LoadMetrics } from './types';

// ============================================================================
// Center of Mass
// ============================================================================

export function computeCOM(instances: CaseInstance[], skuWeights: Map<string, number>): Vec3 {
  if (instances.length === 0) {
    return { x: 0, y: 0, z: 0 };
  }

  let sumX = 0, sumY = 0, sumZ = 0, totalWeight = 0;

  for (const inst of instances) {
    const weight = skuWeights.get(inst.skuId) || 0;
    const center = {
      x: (inst.aabb.min.x + inst.aabb.max.x) / 2,
      y: (inst.aabb.min.y + inst.aabb.max.y) / 2,
      z: (inst.aabb.min.z + inst.aabb.max.z) / 2,
    };
    
    sumX += center.x * weight;
    sumY += center.y * weight;
    sumZ += center.z * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) {
    return { x: 0, y: 0, z: 0 };
  }

  return {
    x: sumX / totalWeight,
    y: sumY / totalWeight,
    z: sumZ / totalWeight,
  };
}

// ============================================================================
// Axle Load
// ============================================================================

export function computeAxleLoads(
  totalCargoWeight: number,
  comX: number,
  truck: TruckType
): { frontKg: number; rearKg: number } {
  const L = truck.axle.rearX - truck.axle.frontX;
  if (L <= 0) {
    return { frontKg: totalCargoWeight, rearKg: 0 };
  }

  const d = comX - truck.axle.frontX;
  
  // Beam model: RearLoad = W * (d / L)
  const rearKg = totalCargoWeight * (d / L);
  const frontKg = totalCargoWeight - rearKg;

  return {
    frontKg: Math.max(0, frontKg),
    rearKg: Math.max(0, rearKg),
  };
}

// ============================================================================
// Left/Right Balance
// ============================================================================

export function computeLeftRightBalance(
  instances: CaseInstance[],
  skuWeights: Map<string, number>,
  truckWidth: number
): { leftKg: number; rightKg: number; imbalancePercent: number } {
  const midY = truckWidth / 2;
  let leftKg = 0, rightKg = 0;

  for (const inst of instances) {
    const weight = skuWeights.get(inst.skuId) || 0;
    const centerY = (inst.aabb.min.y + inst.aabb.max.y) / 2;
    
    if (centerY < midY) {
      leftKg += weight;
    } else {
      rightKg += weight;
    }
  }

  const totalKg = leftKg + rightKg;
  const imbalancePercent = totalKg > 0 
    ? (Math.abs(leftKg - rightKg) / totalKg) * 100 
    : 0;

  return { leftKg, rightKg, imbalancePercent };
}

// ============================================================================
// Full Metrics
// ============================================================================

export function computeMetrics(
  instances: CaseInstance[],
  skuWeights: Map<string, number>,
  truck: TruckType
): LoadMetrics {
  // Total weight
  let totalWeightKg = 0;
  for (const inst of instances) {
    totalWeightKg += skuWeights.get(inst.skuId) || 0;
  }

  // COM
  const com = computeCOM(instances, skuWeights);

  // Axle loads
  const { frontKg: frontAxleKg, rearKg: rearAxleKg } = computeAxleLoads(
    totalWeightKg,
    com.x,
    truck
  );

  // L/R balance
  const { leftKg: leftWeightKg, rightKg: rightWeightKg, imbalancePercent: lrImbalancePercent } = 
    computeLeftRightBalance(instances, skuWeights, truck.innerDims.y);

  // Max stack height
  let maxStackHeightMm = 0;
  for (const inst of instances) {
    maxStackHeightMm = Math.max(maxStackHeightMm, inst.aabb.max.z);
  }

  // Warnings
  const warnings: string[] = [];
  
  const frontPct = (frontAxleKg / truck.axle.maxFrontKg) * 100;
  const rearPct = (rearAxleKg / truck.axle.maxRearKg) * 100;
  
  if (frontPct > 80) warnings.push(`Front axle at ${frontPct.toFixed(0)}%`);
  if (rearPct > 80) warnings.push(`Rear axle at ${rearPct.toFixed(0)}%`);
  if (lrImbalancePercent > 10) warnings.push(`L/R imbalance at ${lrImbalancePercent.toFixed(1)}%`);

  return {
    totalWeightKg,
    frontAxleKg,
    rearAxleKg,
    leftWeightKg,
    rightWeightKg,
    lrImbalancePercent,
    maxStackHeightMm,
    warnings,
  };
}
