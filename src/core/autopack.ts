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
} from './types';
import { createInstance, topZ } from './geometry';
import { validatePlacement, ValidatorContext } from './validate';
import { SupportGraph } from './support';
import { SpatialIndex } from './spatial';
import { computeMetrics, computeAxleLoads, computeCOM } from './weight';

// ============================================================================
// Auto-Pack Configuration
// ============================================================================

export interface AutoPackConfig {
  maxAttempts: number;         // multi-start attempts
  randomSeed?: number;         // for reproducibility

  // Scoring weights
  scoreWeights: {
    stackHeight: number;
    comHeight: number;
    axleBalance: number;
    lrBalance: number;
    compaction: number;
  };
}

const DEFAULT_CONFIG: AutoPackConfig = {
  maxAttempts: 100,
  scoreWeights: {
    stackHeight: 1.0,
    comHeight: 0.5,
    axleBalance: 2.0,
    lrBalance: 1.5,
    compaction: 0.3,
  },
};

// ============================================================================
// Main Auto-Pack Entry
// ============================================================================

export function autoPack(
  truck: TruckType,
  skus: CaseSKU[],
  skuQuantities: Map<string, number>, // skuId -> count
  config: Partial<AutoPackConfig> = {}
): AutoPackResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Build ordered list of cases to place
  const casesToPlace = buildPlacementQueue(skus, skuQuantities);

  if (casesToPlace.length === 0) return createEmptyResult();

  let bestResult: AutoPackResult | null = null;
  let bestScore = -Infinity;

  // Multi-start: attempt 0 is always the default ordering, rest shuffle within tiers
  for (let attempt = 0; attempt < cfg.maxAttempts; attempt++) {
    const result = attemptPlacement(truck, skus, casesToPlace, attempt);

    // Primary: maximize placed count; secondary: score quality
    const placed = result.placed.length;
    const best = bestResult?.placed.length ?? -1;
    if (placed >= best) {
      const score = scoreResult(result, truck, cfg.scoreWeights);
      if (placed > best || score > bestScore) {
        bestScore = score;
        bestResult = result;
      }
    }
  }

  return bestResult || createEmptyResult();
}

// ============================================================================
// Placement Attempt
// ============================================================================

function attemptPlacement(
  truck: TruckType,
  skus: CaseSKU[],
  casesToPlace: PlacementCase[],
  attemptNumber: number
): AutoPackResult {
  const skuMap = new Map(skus.map(s => [s.skuId, s]));
  const skuWeights = new Map(skus.map(s => [s.skuId, s.weightKg]));
  const supportGraph = new SupportGraph(skuWeights);
  const spatialIndex = new SpatialIndex();

  const ctx: ValidatorContext = {
    truck,
    skus: skuMap,
    instances: [],
    supportGraph,
    skuWeights,
    spatialIndex,
  };

  const placed: CaseInstance[] = [];
  const unplaced: string[] = [];
  const reasonSummary: Record<string, number> = {};

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
      a.x < truck.innerDims.x &&
      a.y < truck.innerDims.y &&
      a.z < truck.innerDims.z
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
          const score = scorePlacement(instance, placed, truck, skuWeights);
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

  const metrics = computeMetrics(placed, skuWeights, truck);

  return {
    placed,
    unplaced,
    metrics,
    reasonSummary: reasonSummary as Record<ValidationError, number>,
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
// Placement Scoring
// ============================================================================

function scorePlacement(
  instance: CaseInstance,
  placed: CaseInstance[],
  truck: TruckType,
  skuWeights: Map<string, number>
): number {
  // Prefer lower height (pack from floor up)
  const heightPenalty = instance.aabb.min.z / truck.innerDims.z;

  // Prefer placing toward front axle (front-heavy is usually better for smaller trucks)
  const xCenter = (instance.aabb.min.x + instance.aabb.max.x) / 2;
  const axleMidX = (truck.axle.frontX + truck.axle.rearX) / 2;
  const axleProximity = Math.abs(xCenter - axleMidX) / truck.innerDims.x;

  // Prefer placing toward Y center (minimize L/R imbalance)
  const yCenter = (instance.aabb.min.y + instance.aabb.max.y) / 2;
  const truckMidY = truck.innerDims.y / 2;
  const yDeviationPenalty = Math.abs(yCenter - truckMidY) / truck.innerDims.y;

  // Prefer tight compaction: reward when box touches existing boxes
  let adjacencyBonus = 0;
  if (placed.length > 0) {
    const allWithCandidate = [...placed, instance];
    const totalW = allWithCandidate.reduce((s, i) => s + (skuWeights.get(i.skuId) || 0), 0);
    if (totalW > 0) {
      const com = computeCOM(allWithCandidate, skuWeights);
      const { frontKg, rearKg } = computeAxleLoads(totalW, com.x, truck);
      const axleRatio = truck.axle.maxFrontKg + truck.axle.maxRearKg > 0
        ? Math.abs(frontKg / truck.axle.maxFrontKg - rearKg / truck.axle.maxRearKg)
        : 0;
      adjacencyBonus = -axleRatio; // negative because lower is better
    }
  }

  // Combined score (higher = better placement)
  return (
    -heightPenalty * 2.0
    - axleProximity * 1.0
    - yDeviationPenalty * 1.5
    + adjacencyBonus * 2.0
  );
}

function scoreResult(
  result: AutoPackResult,
  truck: TruckType,
  weights: AutoPackConfig['scoreWeights']
): number {
  let score = result.placed.length * 1000; // Primary: maximize placed count

  // Penalize high stack height (normalized by truck height)
  score -= (result.metrics.maxStackHeightMm / truck.innerDims.z) * weights.stackHeight * 100;

  // Penalize axle imbalance (as % of respective max loads)
  const frontPct = truck.axle.maxFrontKg > 0
    ? result.metrics.frontAxleKg / truck.axle.maxFrontKg
    : 0;
  const rearPct = truck.axle.maxRearKg > 0
    ? result.metrics.rearAxleKg / truck.axle.maxRearKg
    : 0;
  score -= Math.abs(frontPct - rearPct) * weights.axleBalance * 50;

  // Penalize L/R imbalance
  score -= result.metrics.lrImbalancePercent * weights.lrBalance;

  // Reward compactness (fewer unplaced = better, already captured in placed count)
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
