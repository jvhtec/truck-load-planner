/**
 * Auto-pack engine for automatic truck loading
 * Safe-first, constraint-driven placement
 */

import type {
  TruckType,
  CaseSKU,
  CaseInstance,
  AutoPackResult,
  ValidationError,
  VehicleConfig,
  TrailerMetrics,
} from './types';
import { createInstance, topZ } from './geometry';
import { validatePlacement, ValidatorContext } from './validate';
import { SupportGraph } from './support';
import { SpatialIndex } from './spatial';
import { computeMetrics, computeAxleLoads, computeCOM } from './weight';
import { computeTrailerMetrics, computeRigidVehicleAxleLoads } from './trailerStatics';
import { getCargoBodyDims, rigidVehicleToTruckType } from './vehicleAdapter';

// ============================================================================
// Auto-Pack Configuration
// ============================================================================

export interface AutoPackConfig {
  maxAttempts: number;         // multi-start attempts
  randomSeed?: number;         // for reproducibility

  // Scoring weights
  scoreWeights: {
    stackHeight: number;
    axleBalance: number;
    lrBalance: number;
    kingpinLoad: number;  // penalise high kingpin utilization (tractor-trailer)
    steerLoad: number;    // penalise low steer axle load (tractor-trailer)
  };
}

const DEFAULT_CONFIG: AutoPackConfig = {
  maxAttempts: 100,
  scoreWeights: {
    stackHeight: 1.0,
    axleBalance: 2.0,
    lrBalance: 1.5,
    kingpinLoad: 1.5,
    steerLoad: 1.0,
  },
};

// ============================================================================
// Main Auto-Pack Entry
// ============================================================================

/**
 * Auto-pack entry point. Accepts either a legacy TruckType or a VehicleConfig
 * discriminated union. The legacy signature is preserved for backward compat.
 */
export function autoPack(
  truckOrVehicle: TruckType | VehicleConfig,
  skus: CaseSKU[],
  skuQuantities: Map<string, number>, // skuId -> count
  config: Partial<AutoPackConfig> = {}
): AutoPackResult {
  // Normalise to VehicleConfig
  const vehicle: VehicleConfig =
    'kind' in truckOrVehicle
      ? truckOrVehicle
      : { kind: 'rigid', vehicle: truckOrVehicle };

  const cfg: AutoPackConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    scoreWeights: { ...DEFAULT_CONFIG.scoreWeights, ...(config.scoreWeights ?? {}) },
  };

  // Build ordered list of cases to place
  const casesToPlace = buildPlacementQueue(skus, skuQuantities);

  if (casesToPlace.length === 0) return createEmptyResult();

  let bestResult: AutoPackResult | null = null;
  let bestScore = -Infinity;

  // Multi-start: attempt 0 is always the default ordering, rest shuffle within tiers
  for (let attempt = 0; attempt < cfg.maxAttempts; attempt++) {
    // Combine randomSeed (if provided) with attempt number for deterministic seeding
    const seed = cfg.randomSeed !== undefined ? cfg.randomSeed + attempt : attempt;
    const result = attemptPlacementV3(vehicle, skus, casesToPlace, seed);

    // Primary: maximize placed count; secondary: score quality
    const placed = result.placed.length;
    const best = bestResult?.placed.length ?? -1;
    if (placed >= best) {
      const score = scoreResultV3(result, vehicle, cfg.scoreWeights);
      if (placed > best || score > bestScore) {
        bestScore = score;
        bestResult = result;
      }
    }
  }

  return bestResult || createEmptyResult();
}

// ============================================================================
// Placement Attempt (v3 — supports VehicleConfig)
// ============================================================================

function attemptPlacementV3(
  vehicle: VehicleConfig,
  skus: CaseSKU[],
  casesToPlace: PlacementCase[],
  attemptNumber: number
): AutoPackResult {
  const skuMap = new Map(skus.map(s => [s.skuId, s]));
  const skuWeights = new Map(skus.map(s => [s.skuId, s.weightKg]));
  const supportGraph = new SupportGraph(skuWeights);
  const spatialIndex = new SpatialIndex();

  // Resolve the truck used for geometry (bounds + obstacles)
  const truck = resolveGeometryTruck(vehicle);

  const ctx: ValidatorContext = {
    truck,
    vehicle,
    skus: skuMap,
    instances: [],
    supportGraph,
    skuWeights,
    spatialIndex,
  };

  const placed: CaseInstance[] = [];
  const unplaced: string[] = [];
  const reasonSummary: Record<string, number> = {};

  // Cargo space dimensions for anchor filtering
  const bodyDims = getCargoBodyDims(vehicle);

  // Candidate anchor points — start from front-left-floor corner
  let anchors: Vec3[] = [{ x: 0, y: 0, z: 0 }];

  // Shuffle cases within same priority tier for multi-start diversity
  const shuffled = shuffleWithinTiers(casesToPlace, attemptNumber);

  for (const pc of shuffled) {
    const sku = skuMap.get(pc.skuId);
    if (!sku) {
      unplaced.push(pc.skuId);
      continue;
    }

    let bestPlacement: { instance: CaseInstance; score: number } | null = null;
    const lastViolations: ValidationError[] = [];

    // Filter obviously out-of-bounds anchors early
    const candidateAnchors = anchors.filter(a =>
      a.x < bodyDims.x &&
      a.y < bodyDims.y &&
      a.z < bodyDims.z
    );

    // Try each anchor × each allowed yaw
    for (const anchor of candidateAnchors) {
      for (const yaw of sku.allowedYaw) {
        const instance = createInstance(
          `${pc.skuId}-${placed.length}`,
          sku,
          anchor,
          yaw
        );

        const validation = validatePlacement(instance, ctx);

        if (validation.valid) {
          const score = scorePlacementV3(instance, placed, vehicle, skuWeights);
          if (!bestPlacement || score > bestPlacement.score) {
            bestPlacement = { instance, score };
          }
        } else {
          for (const v of validation.violations) {
            lastViolations.push(v);
          }
        }
      }
    }

    if (bestPlacement) {
      placed.push(bestPlacement.instance);
      ctx.instances = placed;
      supportGraph.addInstance(bestPlacement.instance, placed);
      spatialIndex.add(bestPlacement.instance.id, bestPlacement.instance.aabb);

      // Expand anchor set with positions adjacent to this placement
      anchors = updateAnchors(anchors, bestPlacement.instance, sku);
    } else {
      unplaced.push(pc.skuId);
      // Tally the most common rejection reason for this case
      for (const v of lastViolations) {
        reasonSummary[v] = (reasonSummary[v] ?? 0) + 1;
      }
    }
  }

  // Compute metrics — for tractor-trailer, compute once and share with computeResultMetrics
  const trailerMetrics: TrailerMetrics | undefined = vehicle.kind === 'tractor-trailer'
    ? computeTrailerMetrics(placed, skuWeights, vehicle.vehicle)
    : undefined;
  const metrics = computeResultMetrics(placed, skuWeights, vehicle, trailerMetrics);

  return {
    placed,
    unplaced,
    metrics,
    trailerMetrics,
    reasonSummary: reasonSummary as Record<ValidationError, number>,
  };
}

/**
 * Resolve a TruckType for geometry-only checks (OUT_OF_BOUNDS, obstacles).
 * For tractor-trailer, we use the trailer body. For multi-axle, use the vehicle body.
 */
function resolveGeometryTruck(vehicle: VehicleConfig): TruckType {
  if (vehicle.kind === 'tractor-trailer') {
    return rigidVehicleToTruckType(vehicle.vehicle.trailer);
  }
  if (vehicle.kind === 'multi-axle') {
    return rigidVehicleToTruckType(vehicle.vehicle);
  }
  return vehicle.vehicle;
}

/**
 * Build a LoadMetrics bridge from any vehicle config result.
 * Legacy fields (frontAxleKg, rearAxleKg) are populated for backward compat.
 */
function computeResultMetrics(
  placed: CaseInstance[],
  skuWeights: Map<string, number>,
  vehicle: VehicleConfig,
  precomputedTrailerMetrics?: TrailerMetrics,
): AutoPackResult['metrics'] {
  if (vehicle.kind === 'rigid') {
    return computeMetrics(placed, skuWeights, vehicle.vehicle);
  }
  if (vehicle.kind === 'tractor-trailer') {
    const tm = precomputedTrailerMetrics ?? computeTrailerMetrics(placed, skuWeights, vehicle.vehicle);
    const steer = tm.tractorAxleLoads[0];
    const trailerAxle = tm.trailerAxleLoads[0];
    return {
      totalWeightKg: tm.totalWeightKg,
      frontAxleKg: steer?.loadKg ?? 0,
      rearAxleKg: trailerAxle?.loadKg ?? 0,
      leftWeightKg: tm.leftWeightKg,
      rightWeightKg: tm.rightWeightKg,
      lrImbalancePercent: tm.lrImbalancePercent,
      maxStackHeightMm: tm.maxStackHeightMm,
      warnings: tm.warnings,
      axleGroupLoads: [...tm.trailerAxleLoads, ...tm.tractorAxleLoads],
      kingpinKg: tm.kingpinKg,
      kingpinMaxKg: tm.kingpinMaxKg,
    };
  }
  // multi-axle rigid
  const rv = vehicle.vehicle;
  let totalWeightKg = 0;
  for (const inst of placed) totalWeightKg += skuWeights.get(inst.skuId) ?? 0;
  let comXNum = 0;
  for (const inst of placed) {
    const w = skuWeights.get(inst.skuId) ?? 0;
    comXNum += ((inst.aabb.min.x + inst.aabb.max.x) / 2) * w;
  }
  const comX = totalWeightKg > 0 ? comXNum / totalWeightKg : 0;
  const axleGroupLoads = computeRigidVehicleAxleLoads(totalWeightKg, comX, rv);
  const midY = rv.innerDimsMm.y / 2;
  let leftKg = 0, rightKg = 0, maxH = 0;
  const warnings: string[] = [];
  for (const inst of placed) {
    const w = skuWeights.get(inst.skuId) ?? 0;
    const cy = (inst.aabb.min.y + inst.aabb.max.y) / 2;
    if (cy < midY) leftKg += w; else rightKg += w;
    maxH = Math.max(maxH, inst.aabb.max.z);
  }
  const payload = Math.max(1, rv.axleGroups.reduce((s, ag) => s + ag.maxKg, 0) - rv.emptyWeightKg);
  const lrPct = (Math.abs(leftKg - rightKg) / payload) * 100;
  if (lrPct > rv.balance.maxLeftRightPercentDiff) warnings.push(`L/R imbalance ${lrPct.toFixed(1)}%`);
  return {
    totalWeightKg,
    frontAxleKg: axleGroupLoads[0]?.loadKg ?? 0,
    rearAxleKg: axleGroupLoads[axleGroupLoads.length - 1]?.loadKg ?? 0,
    leftWeightKg: leftKg,
    rightWeightKg: rightKg,
    lrImbalancePercent: lrPct,
    maxStackHeightMm: maxH,
    warnings,
    axleGroupLoads,
  };
}

// ============================================================================
// Placement Queue
// ============================================================================

interface PlacementCase {
  skuId: string;
  weightKg: number;
  canBeBase: boolean;
  uprightOnly: boolean;
  footprintMm2: number;
}

function buildPlacementQueue(
  skus: CaseSKU[],
  quantities: Map<string, number>
): PlacementCase[] {
  const queue: PlacementCase[] = [];

  for (const sku of skus) {
    const count = quantities.get(sku.skuId) || 0;
    for (let i = 0; i < count; i++) {
      queue.push({
        skuId: sku.skuId,
        weightKg: sku.weightKg,
        canBeBase: sku.canBeBase,
        uprightOnly: sku.uprightOnly,
        footprintMm2: sku.dims.l * sku.dims.w,
      });
    }
  }

  // Sort by placement priority
  return queue.sort((a, b) => {
    // 1. Heaviest first (floor-level dense base)
    if (a.weightKg !== b.weightKg) return b.weightKg - a.weightKg;
    // 2. Good bases before fragile items
    if (a.canBeBase !== b.canBeBase) return a.canBeBase ? -1 : 1;
    // 3. Upright-only first (most constrained)
    if (a.uprightOnly !== b.uprightOnly) return a.uprightOnly ? -1 : 1;
    // 4. Largest footprint first
    return b.footprintMm2 - a.footprintMm2;
  });
}

function shuffleWithinTiers(
  cases: PlacementCase[],
  seed: number
): PlacementCase[] {
  if (seed === 0) return cases; // attempt 0 uses canonical order

  const tiers: PlacementCase[][] = [];
  let currentTier: PlacementCase[] = [];

  for (let i = 0; i < cases.length; i++) {
    if (i > 0 && !sameTier(cases[i - 1], cases[i])) {
      if (currentTier.length > 0) tiers.push(currentTier);
      currentTier = [];
    }
    currentTier.push(cases[i]);
  }
  if (currentTier.length > 0) tiers.push(currentTier);

  const result: PlacementCase[] = [];
  for (const tier of tiers) {
    const shuffled = [...tier];
    // Linear congruential seeded shuffle (deterministic)
    let s = seed;
    for (let i = shuffled.length - 1; i > 0; i--) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const j = s % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    result.push(...shuffled);
  }

  return result;
}

function sameTier(a: PlacementCase, b: PlacementCase): boolean {
  return (
    a.weightKg === b.weightKg &&
    a.canBeBase === b.canBeBase &&
    a.uprightOnly === b.uprightOnly
  );
}

// ============================================================================
// Anchor Point Management
// ============================================================================

interface Vec3 { x: number; y: number; z: number }

function updateAnchors(
  current: Vec3[],
  placed: CaseInstance,
  sku: CaseSKU
): Vec3[] {
  const newAnchors: Vec3[] = [...current];

  const maxX = placed.aabb.max.x;
  const maxY = placed.aabb.max.y;
  const topZVal = topZ(placed.aabb);

  // Adjacent to right side (same row, next column)
  newAnchors.push({ x: placed.position.x, y: maxY, z: placed.position.z });

  // Adjacent behind (next row along length)
  newAnchors.push({ x: maxX, y: placed.position.y, z: placed.position.z });

  // Corner diagonal (next row + next column)
  newAnchors.push({ x: maxX, y: maxY, z: placed.position.z });

  // On top (if this case can be used as a base)
  if (sku.canBeBase) {
    newAnchors.push({ x: placed.position.x, y: placed.position.y, z: topZVal });
    newAnchors.push({ x: placed.position.x, y: maxY, z: topZVal });
    newAnchors.push({ x: maxX, y: placed.position.y, z: topZVal });
  }

  return deduplicateAnchors(newAnchors);
}

function deduplicateAnchors(anchors: Vec3[]): Vec3[] {
  const seen = new Set<string>();
  return anchors.filter(a => {
    const key = `${a.x},${a.y},${a.z}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ============================================================================
// Placement Scoring (v3 — supports VehicleConfig)
// ============================================================================

function scorePlacementV3(
  instance: CaseInstance,
  placed: CaseInstance[],
  vehicle: VehicleConfig,
  skuWeights: Map<string, number>
): number {
  const bodyDims = getCargoBodyDims(vehicle);

  // Prefer lower height (pack from floor up)
  const heightPenalty = instance.aabb.min.z / bodyDims.z;

  // Prefer placing toward Y center (minimize L/R imbalance)
  const yCenter = (instance.aabb.min.y + instance.aabb.max.y) / 2;
  const yDeviationPenalty = Math.abs(yCenter - bodyDims.y / 2) / bodyDims.y;

  let axleBonus = 0;
  if (placed.length > 0) {
    if (vehicle.kind === 'tractor-trailer') {
      const rig = vehicle.vehicle;
      const all = [...placed, instance];
      const tm = computeTrailerMetrics(all, skuWeights, rig);
      const trailerUtil = (tm.trailerAxleLoads[0]?.utilizationPct ?? 0) / 100;
      const kingpinUtil = rig.coupling.maxKingpinKg
        ? (tm.kingpinKg / rig.coupling.maxKingpinKg)
        : 0;
      axleBonus = -(trailerUtil + kingpinUtil);
    } else if (vehicle.kind === 'rigid') {
      const truck = vehicle.vehicle;
      const all = [...placed, instance];
      const totalW = all.reduce((s, i) => s + (skuWeights.get(i.skuId) || 0), 0);
      if (totalW > 0) {
        const com = computeCOM(all, skuWeights);
        const { frontKg, rearKg } = computeAxleLoads(totalW, com.x, truck);
        const denom = truck.axle.maxFrontKg + truck.axle.maxRearKg;
        const axleRatio = denom > 0
          ? Math.abs(frontKg / truck.axle.maxFrontKg - rearKg / truck.axle.maxRearKg)
          : 0;
        axleBonus = -axleRatio;
      }
    }
  }

  // Combined score (higher = better placement)
  return (
    -heightPenalty * 2.0
    - yDeviationPenalty * 1.5
    + axleBonus * 2.0
  );
}

function scoreResultV3(
  result: AutoPackResult,
  vehicle: VehicleConfig,
  weights: AutoPackConfig['scoreWeights']
): number {
  let score = result.placed.length * 1000; // Primary: maximize placed count

  const bodyDims = getCargoBodyDims(vehicle);
  score -= (result.metrics.maxStackHeightMm / bodyDims.z) * weights.stackHeight * 100;
  score -= result.metrics.lrImbalancePercent * weights.lrBalance;

  if (vehicle.kind === 'tractor-trailer' && result.trailerMetrics) {
    const tm = result.trailerMetrics;
    const trailerAx = tm.trailerAxleLoads[0];
    if (trailerAx) {
      score -= (trailerAx.utilizationPct / 100) * weights.axleBalance * 50;
    }
    if (vehicle.vehicle.coupling.maxKingpinKg && tm.kingpinKg > 0) {
      const kingpinUtil = tm.kingpinKg / vehicle.vehicle.coupling.maxKingpinKg;
      score -= kingpinUtil * weights.kingpinLoad * 50;
    }
    // Penalise low steer
    const steer = tm.tractorAxleLoads[0];
    if (steer?.minKg !== undefined) {
      score -= Math.max(0, steer.minKg - steer.loadKg) * weights.steerLoad;
    }
  } else {
    // Legacy or multi-axle
    const axleLoads = result.metrics.axleGroupLoads;
    if (axleLoads && axleLoads.length >= 2) {
      const maxUtil = Math.max(...axleLoads.map(ag => ag.loadKg / ag.maxKg));
      score -= maxUtil * weights.axleBalance * 50;
    } else if (vehicle.kind === 'rigid') {
      const truck = vehicle.vehicle;
      const frontPct = truck.axle.maxFrontKg > 0
        ? result.metrics.frontAxleKg / truck.axle.maxFrontKg : 0;
      const rearPct = truck.axle.maxRearKg > 0
        ? result.metrics.rearAxleKg / truck.axle.maxRearKg : 0;
      score -= Math.abs(frontPct - rearPct) * weights.axleBalance * 50;
    }
  }

  score -= result.unplaced.length * 500;
  return score;
}

// ============================================================================
// Helpers
// ============================================================================

function createEmptyResult(): AutoPackResult {
  return {
    placed: [],
    unplaced: [],
    metrics: {
      totalWeightKg: 0,
      frontAxleKg: 0,
      rearAxleKg: 0,
      leftWeightKg: 0,
      rightWeightKg: 0,
      lrImbalancePercent: 0,
      maxStackHeightMm: 0,
      warnings: [],
    },
    reasonSummary: {} as Record<ValidationError, number>,
  };
}
