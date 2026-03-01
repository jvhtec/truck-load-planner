/**
 * Adapters between TruckType (legacy) and the v3 VehicleConfig discriminated union.
 * All functions are pure and free of side-effects.
 */

import type { TruckType, RigidVehicle, TractorTrailer, VehicleConfig } from './types';

// ============================================================================
// TruckType → VehicleConfig
// ============================================================================

/**
 * Wrap a legacy TruckType as a VehicleConfig for use with unified APIs.
 * The existing TruckType is not modified.
 */
export function truckTypeToConfig(truck: TruckType): VehicleConfig {
  return { kind: 'rigid', vehicle: truck };
}

/**
 * Convert a TruckType to a RigidVehicle for use by multi-axle statics routines.
 *
 * The empty COM X is estimated as the midpoint between the two axles, which is
 * conservative and produces the same beam-model output as the original TruckType
 * axle math when cargo COM is at the axle midpoint.
 */
export function truckTypeToRigidVehicle(truck: TruckType): RigidVehicle {
  return {
    vehicleId: truck.truckId,
    name: truck.name,
    innerDimsMm: {
      x: truck.innerDims.x,
      y: truck.innerDims.y,
      z: truck.innerDims.z,
    },
    emptyWeightKg: truck.emptyWeightKg,
    emptyComXmm: (truck.axle.frontX + truck.axle.rearX) / 2,
    axleGroups: [
      { id: 'front', xMm: truck.axle.frontX, maxKg: truck.axle.maxFrontKg },
      { id: 'rear', xMm: truck.axle.rearX, maxKg: truck.axle.maxRearKg },
    ],
    balance: { maxLeftRightPercentDiff: truck.balance.maxLeftRightPercentDiff },
    obstacles: truck.obstacles,
  };
}

/**
 * Build a synthetic TruckType from a trailer body (for geometry-only validation
 * in validatePlacement, which still uses truck.innerDims for OUT_OF_BOUNDS checks).
 */
export function rigidVehicleToTruckType(vehicle: RigidVehicle): TruckType {
  const sorted = [...vehicle.axleGroups].sort((a, b) => a.xMm - b.xMm);
  const front = sorted[0];
  const rear = sorted[sorted.length - 1];
  return {
    truckId: vehicle.vehicleId,
    name: vehicle.name,
    innerDims: { x: vehicle.innerDimsMm.x, y: vehicle.innerDimsMm.y, z: vehicle.innerDimsMm.z },
    emptyWeightKg: vehicle.emptyWeightKg,
    axle: {
      frontX: front?.xMm ?? 0,
      rearX: rear?.xMm ?? vehicle.innerDimsMm.x,
      maxFrontKg: front?.maxKg ?? 9999999,
      maxRearKg: rear?.maxKg ?? 9999999,
    },
    balance: { maxLeftRightPercentDiff: vehicle.balance.maxLeftRightPercentDiff },
    obstacles: vehicle.obstacles,
  };
}

// ============================================================================
// Type guards
// ============================================================================

export function isTractorTrailerConfig(
  cfg: VehicleConfig,
): cfg is { kind: 'tractor-trailer'; vehicle: TractorTrailer } {
  return cfg.kind === 'tractor-trailer';
}

export function isMultiAxleConfig(
  cfg: VehicleConfig,
): cfg is { kind: 'multi-axle'; vehicle: RigidVehicle } {
  return cfg.kind === 'multi-axle';
}

export function isRigidConfig(
  cfg: VehicleConfig,
): cfg is { kind: 'rigid'; vehicle: TruckType } {
  return cfg.kind === 'rigid';
}

/**
 * Extract the cargo space dimensions from any VehicleConfig.
 */
export function getCargoBodyDims(
  cfg: VehicleConfig,
): { x: number; y: number; z: number } {
  if (cfg.kind === 'tractor-trailer') return cfg.vehicle.trailer.innerDimsMm;
  if (cfg.kind === 'multi-axle') return cfg.vehicle.innerDimsMm;
  return cfg.vehicle.innerDims;
}
