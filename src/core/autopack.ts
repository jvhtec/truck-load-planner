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
import { computeMetrics } from './weight';

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
  };
}

const DEFAULT_CONFIG: AutoPackConfig = {
  maxAttempts: 100,
  scoreWeights: {
    stackHeight: 1.0,
    axleBalance: 2.0,
    lrBalance: 1.5,
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
    // Combine randomSeed (if provided) with attempt number for deterministic seeding
    const seed = cfg.randomSeed !== undefined ? cfg.randomSeed + attempt : attempt;
    const result = attemptPlacement(truck, skus, casesToPlace, seed);

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
      anchors = updateAnchors(anchors, bestPlacement.instance, sku, placed);
      // Remove anchors that now fall strictly inside the placed box
      anchors = pruneAnchors(anchors, bestPlacement.instance);
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
  sku: CaseSKU,
  allPlaced: CaseInstance[]
): Vec3[] {
  const newAnchors: Vec3[] = [...current];

  const minX = placed.position.x;
  const minY = placed.position.y;
  const minZ = placed.position.z;
  const maxX = placed.aabb.max.x;
  const maxY = placed.aabb.max.y;
  const topZVal = topZ(placed.aabb);

  // Adjacent to right side (same row, next column)
  newAnchors.push({ x: minX, y: maxY, z: minZ });

  // Adjacent behind (next row along length)
  newAnchors.push({ x: maxX, y: minY, z: minZ });

  // Corner diagonal (next row + next column)
  newAnchors.push({ x: maxX, y: maxY, z: minZ });

  // On top (if this case can be used as a base)
  if (sku.canBeBase) {
    newAnchors.push({ x: minX, y: minY, z: topZVal });
    newAnchors.push({ x: minX, y: maxY, z: topZVal });
    newAnchors.push({ x: maxX, y: minY, z: topZVal });
    // Diagonal stacking corner (previously missing)
    newAnchors.push({ x: maxX, y: maxY, z: topZVal });
  }

  // Extreme-point cross-projections: combine this box's new edges with the
  // edges of recently placed boxes.  This generates anchors inside concave
  // spaces that the simple adjacent-only method cannot reach.
  // Example: two boxes in a row with different lengths leave a recess that
  // only a (maxX_other, maxY_new, z) anchor can address.
  const CROSS_WINDOW = 20; // only look at the most recent boxes to stay O(1) average
  const recentStart = Math.max(0, allPlaced.length - CROSS_WINDOW);
  for (let i = recentStart; i < allPlaced.length; i++) {
    const other = allPlaced[i];
    if (other.id === placed.id) continue;
    const oMaxX = other.aabb.max.x;
    const oMaxY = other.aabb.max.y;
    // Project placed box's X-edge against other box's Y-edge (floor level)
    newAnchors.push({ x: maxX, y: oMaxY, z: minZ });
    // Project other box's X-edge against placed box's Y-edge (floor level)
    newAnchors.push({ x: oMaxX, y: maxY, z: minZ });
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

/** Remove anchors that fall strictly inside a placed box (they will always collide). */
function pruneAnchors(anchors: Vec3[], justPlaced: CaseInstance): Vec3[] {
  const { min, max } = justPlaced.aabb;
  return anchors.filter(a =>
    !(a.x > min.x && a.x < max.x &&
      a.y > min.y && a.y < max.y &&
      a.z > min.z && a.z < max.z)
  );
}

// ============================================================================
// Placement Scoring
// ============================================================================

/** Distance (mm) within which two surfaces are considered "touching". */
const TOUCH_DIST = 2;

function scorePlacement(
  instance: CaseInstance,
  placed: CaseInstance[],
  truck: TruckType,
  _skuWeights: Map<string, number>
): number {
  const a = instance.aabb;

  // Prefer lower height (pack from floor up)
  const heightPenalty = a.min.z / truck.innerDims.z;

  // Prefer placing toward axle midpoint
  const xCenter = (a.min.x + a.max.x) / 2;
  const axleMidX = (truck.axle.frontX + truck.axle.rearX) / 2;
  const axleProximity = Math.abs(xCenter - axleMidX) / truck.innerDims.x;

  // Prefer placing toward Y center (minimize L/R imbalance)
  const yCenter = (a.min.y + a.max.y) / 2;
  const truckMidY = truck.innerDims.y / 2;
  const yDeviationPenalty = Math.abs(yCenter - truckMidY) / truck.innerDims.y;

  // Reward tight compaction: count faces touching walls or other placed boxes.
  // This directly incentivises gap-free packing rather than the former approach
  // which proxied compactness via axle-balance ratio (and could penalise valid
  // wall-hugging positions).
  let touchCount = 0;

  // Wall / floor adjacency
  if (a.min.z <= TOUCH_DIST) touchCount += 2; // floor is the most important surface
  if (a.min.x <= TOUCH_DIST) touchCount += 1; // front wall
  if (a.min.y <= TOUCH_DIST) touchCount += 1; // left wall
  if (a.max.y >= truck.innerDims.y - TOUCH_DIST) touchCount += 1; // right wall

  // Box-to-box face adjacency
  for (const p of placed) {
    const b = p.aabb;
    const yOverlap = a.min.y < b.max.y - TOUCH_DIST && a.max.y > b.min.y + TOUCH_DIST;
    const xOverlap = a.min.x < b.max.x - TOUCH_DIST && a.max.x > b.min.x + TOUCH_DIST;
    const zOverlap = a.min.z < b.max.z - TOUCH_DIST && a.max.z > b.min.z + TOUCH_DIST;

    if (zOverlap && yOverlap) {
      if (Math.abs(a.min.x - b.max.x) <= TOUCH_DIST) touchCount++;
      if (Math.abs(a.max.x - b.min.x) <= TOUCH_DIST) touchCount++;
    }
    if (zOverlap && xOverlap) {
      if (Math.abs(a.min.y - b.max.y) <= TOUCH_DIST) touchCount++;
      if (Math.abs(a.max.y - b.min.y) <= TOUCH_DIST) touchCount++;
    }
  }

  // Normalise to [0, 1]: max realistic touches = floor(2) + front(1) + side(1) + 2 box faces = 6
  const adjacencyBonus = Math.min(touchCount, 6) / 6;

  // Combined score (higher = better placement)
  return (
    -heightPenalty * 2.0
    - axleProximity * 1.0
    - yDeviationPenalty * 1.5
    + adjacencyBonus * 3.0  // raised weight: tight packing is the primary spatial goal
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
