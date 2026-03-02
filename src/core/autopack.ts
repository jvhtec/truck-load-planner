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
  Yaw,
} from './types';
import {
  createInstance,
  computeOrientedAABB,
  topZ,
  intersectionAreaXZ,
  bottomArea,
  isApproximately,
} from './geometry';
import { validatePlacement, ValidatorContext } from './validate';
import { SupportGraph } from './support';
import { SpatialIndex } from './spatial';
import { computeMetrics } from './weight';
import { parseStackClass } from '../lib/stackRules';

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
  const targetPlacedCount = casesToPlace.length;

  if (casesToPlace.length === 0) return createEmptyResult();

  let bestResult: AutoPackResult | null = null;
  let bestScore = -Infinity;
  let noImproveStreak = 0;

  // Keep explicit caller maxAttempts untouched, but use an adaptive default cap.
  const effectiveMaxAttempts = config.maxAttempts ?? Math.max(8, Math.min(40, targetPlacedCount * 2));

  // Multi-start: attempt 0 is always the default ordering, rest shuffle within tiers
  for (let attempt = 0; attempt < effectiveMaxAttempts; attempt++) {
    // Combine randomSeed (if provided) with attempt number for deterministic seeding
    const seed = cfg.randomSeed !== undefined ? cfg.randomSeed + attempt : attempt;
    const result = attemptPlacement(truck, skus, casesToPlace, skuQuantities, seed);

    // Primary: maximize placed count; secondary: score quality
    const placed = result.placed.length;
    const best = bestResult?.placed.length ?? -1;
    let improved = false;
    if (placed >= best) {
      const score = scoreResult(result, truck, cfg.scoreWeights);
      if (placed > best || score > bestScore) {
        bestScore = score;
        bestResult = result;
        improved = true;
      }
    }

    if (bestResult && bestResult.placed.length === targetPlacedCount) {
      noImproveStreak = improved ? 0 : noImproveStreak + 1;
      // In default-attempt mode, stop once full placement has plateaued.
      if (config.maxAttempts === undefined && noImproveStreak >= 8) {
        break;
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
  skuQuantities: Map<string, number>,
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

  // Inject wall-edge anchors at the start and periodically to ensure
  // the algorithm explores positions against all truck boundaries.
  anchors = addWallAnchors(anchors, truck);

  // Shuffle cases within same priority tier for multi-start diversity
  const shuffled = shuffleWithinTiers(casesToPlace, attemptNumber);
  const preferredOrientationsBySku = buildPreferredOrientationMap(truck, skus, skuQuantities);

  for (const pc of shuffled) {
    const sku = skuMap.get(pc.skuId);
    if (!sku) {
      unplaced.push(pc.skuId);
      continue;
    }

    let bestPlacement: { instance: CaseInstance; score: number } | null = null;
    const lastViolations: ValidationError[] = [];
    const preferredCandidates: CaseInstance[] = [];
    const fallbackCandidates: CaseInstance[] = [];
    const preferredOrientations = preferredOrientationsBySku.get(pc.skuId);

    // Filter obviously out-of-bounds anchors early
    const floorExtremeAnchors = buildFloorExtremeAnchors(placed, truck);
    const candidateAnchors = prioritizeCandidateAnchors(
      deduplicateAnchors([...anchors, ...floorExtremeAnchors]).filter(a =>
        a.x < truck.innerDims.x &&
        a.y < truck.innerDims.y &&
        a.z < truck.innerDims.z
      ),
      getCurrentMaxX(placed),
      truck
    );

    // Try each anchor × each allowed yaw × each allowed tilt
    for (const anchor of candidateAnchors) {
      for (const yaw of sku.allowedYaw) {
        for (const tiltY of getAllowedTilts(sku)) {
          let instance = createInstance(
            `${pc.skuId}-${placed.length}`,
            sku,
            anchor,
            yaw
          );
          if (tiltY === 90) {
            instance = {
              ...instance,
              tilt: { y: 90 },
              aabb: computeOrientedAABB(sku, anchor, yaw, { y: 90 }),
            };
          }

          const validation = validatePlacement(instance, ctx);

          if (validation.valid) {
            const compacted = compactPlacementVariants(instance, sku, ctx, truck);
            const orientation = orientationKey(yaw, tiltY);
            if (preferredOrientations && preferredOrientations.has(orientation)) {
              preferredCandidates.push(...compacted);
            } else {
              fallbackCandidates.push(...compacted);
            }
          } else {
            for (const v of validation.violations) {
              lastViolations.push(v);
            }
          }
        }
      }
    }

    const candidatePool = preferredCandidates.length > 0 ? preferredCandidates : fallbackCandidates;

    if (candidatePool.length > 0) {
      const deduped = deduplicateInstances(candidatePool);
      const floorPreferred = isFloorPreferredSku(sku);
      const floorCandidates = deduped.filter(candidate => candidate.position.z <= SUPPORT_EPS_MM);
      const prioritized = floorPreferred && floorCandidates.length > 0
        ? floorCandidates
        : deduped;
      const currentMaxX = getCurrentMaxX(placed);
      const X_PRIORITY_TOLERANCE_MM = 5;
      const minProjectedMaxX = prioritized.reduce(
        (best, candidate) => Math.min(best, Math.max(currentMaxX, candidate.aabb.max.x)),
        Number.POSITIVE_INFINITY
      );
      const xPriority = prioritized.filter(
        candidate => Math.max(currentMaxX, candidate.aabb.max.x) <= minProjectedMaxX + X_PRIORITY_TOLERANCE_MM
      );

      const floorVoidByKey = new Map<string, number>();
      for (const candidate of xPriority) {
        const key = instancePositionKey(candidate);
        floorVoidByKey.set(key, projectedFloorVoidRatio(placed, candidate));
      }
      const minVoid = xPriority.reduce((best, candidate) => {
        const key = instancePositionKey(candidate);
        const candidateVoid = floorVoidByKey.get(key) ?? Number.POSITIVE_INFINITY;
        return Math.min(best, candidateVoid);
      }, Number.POSITIVE_INFINITY);
      const FLOOR_VOID_TOLERANCE = 0.01;
      const compactnessPriority = xPriority.filter(candidate => {
        const key = instancePositionKey(candidate);
        const candidateVoid = floorVoidByKey.get(key) ?? Number.POSITIVE_INFINITY;
        return candidateVoid <= minVoid + FLOOR_VOID_TOLERANCE;
      });

      const minZ = compactnessPriority.reduce(
        (lowest, candidate) => Math.min(lowest, candidate.position.z),
        Number.POSITIVE_INFINITY
      );
      const Z_PRIORITY_TOLERANCE_MM = 5;
      const zPriority = compactnessPriority.filter(
        candidate => candidate.position.z <= minZ + Z_PRIORITY_TOLERANCE_MM
      );

      let finalPriority = zPriority;
      if (zPriority.some(candidate => candidate.position.z > SUPPORT_EPS_MM)) {
        const minY = zPriority.reduce(
          (lowest, candidate) => Math.min(lowest, candidate.position.y),
          Number.POSITIVE_INFINITY
        );
        const Y_PRIORITY_TOLERANCE_MM = 5;
        finalPriority = zPriority.filter(
          candidate => candidate.position.y <= minY + Y_PRIORITY_TOLERANCE_MM
        );
      }

      for (const candidate of finalPriority) {
        const score = scorePlacement(candidate, placed, truck);
        if (!bestPlacement || score > bestPlacement.score) {
          bestPlacement = { instance: candidate, score };
        }
      }
    }

    if (bestPlacement) {
      placed.push(bestPlacement.instance);
      ctx.instances = placed;
      supportGraph.addInstance(bestPlacement.instance, placed);
      spatialIndex.add(bestPlacement.instance.id, bestPlacement.instance.aabb);

      // Expand anchor set with positions adjacent to this placement
      anchors = updateAnchors(anchors, bestPlacement.instance, sku, placed, truck);
      // Remove anchors that now fall strictly inside the placed box
      anchors = pruneAnchors(anchors, bestPlacement.instance);
      // Periodically re-inject wall anchors to reduce gaps as we fill the truck
      if (placed.length % 3 === 0) {
        anchors = addWallAnchors(anchors, truck);
      }
      anchors = trimAnchorPool(anchors, getCurrentMaxX(placed), truck);
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

function buildPreferredOrientationMap(
  truck: TruckType,
  skus: CaseSKU[],
  quantities: Map<string, number>
): Map<string, Set<string>> {
  const preferred = new Map<string, Set<string>>();

  for (const sku of skus) {
    const qty = quantities.get(sku.skuId) ?? 0;
    if (qty <= 0) continue;

    const orientations = new Map<string, { xSpan: number; ySpan: number; keys: string[] }>();

    for (const yaw of sku.allowedYaw) {
      for (const tiltY of getAllowedTilts(sku)) {
        const { xSpan, ySpan } = getFootprintForOrientation(sku, yaw, tiltY);
        const key = `${xSpan}|${ySpan}`;
        const existing = orientations.get(key);
        const oKey = orientationKey(yaw, tiltY);
        if (existing) {
          existing.keys.push(oKey);
        } else {
          orientations.set(key, { xSpan, ySpan, keys: [oKey] });
        }
      }
    }
    let best: { score: number; columns: number; keys: string[] } | null = null;
    for (const option of orientations.values()) {
      const columns = Math.floor(truck.innerDims.y / option.ySpan);
      if (columns <= 0) continue;

      const rows = Math.ceil(qty / columns);
      const requiredLength = rows * option.xSpan;
      const widthSlack = truck.innerDims.y - columns * option.ySpan;
      const score = requiredLength + widthSlack * 0.5;

      if (!best || score < best.score || (score === best.score && columns > best.columns)) {
        best = { score, columns, keys: option.keys };
      }
    }

    if (best) {
      preferred.set(sku.skuId, new Set(best.keys));
    }
  }

  return preferred;
}

function getAllowedTilts(sku: CaseSKU): Array<0 | 90> {
  const rules = parseStackClass(sku.stackClass);
  if (rules.tiltRequired) return [90];
  if (sku.tiltAllowed && !sku.uprightOnly) return [0, 90];
  return [0];
}

function orientationKey(yaw: Yaw, tiltY: 0 | 90): string {
  return `${yaw}|${tiltY}`;
}

function getFootprintForOrientation(
  sku: CaseSKU,
  yaw: Yaw,
  tiltY: 0 | 90
): { xSpan: number; ySpan: number } {
  const oriented = computeOrientedAABB(
    sku,
    { x: 0, y: 0, z: 0 },
    yaw,
    { y: tiltY }
  );
  return { xSpan: oriented.max.x - oriented.min.x, ySpan: oriented.max.y - oriented.min.y };
}

// ============================================================================
// Anchor Point Management
// ============================================================================

interface Vec3 { x: number; y: number; z: number }

const COMPACTION_STEPS = [500, 100, 20, 5, 1];

/**
 * Locally compact a valid candidate by sliding it toward blocking surfaces.
 * This fills "missed" recesses even when no anchor exists at the exact tight position.
 */
function compactPlacementVariants(
  instance: CaseInstance,
  sku: CaseSKU,
  ctx: ValidatorContext,
  truck: TruckType
): CaseInstance[] {
  // First settle vertically. Then iteratively compact X <-> Y until convergence.
  // This closes holes that appear when a Y move enables an additional X move.
  const settled = minimizeAlongAxis(instance, sku, ctx, 'z');
  const leftPacked = compactToCorner(settled, sku, ctx, truck, 'left');
  const rightPacked = compactToCorner(settled, sku, ctx, truck, 'right');
  const pushedFront = minimizeAlongAxis(settled, sku, ctx, 'x');

  return deduplicateInstances([
    pushedFront,
    leftPacked,
    rightPacked,
  ]);
}

function compactToCorner(
  initial: CaseInstance,
  sku: CaseSKU,
  ctx: ValidatorContext,
  truck: TruckType,
  side: 'left' | 'right'
): CaseInstance {
  let current = initial;
  const MAX_ITERS = 6;

  for (let i = 0; i < MAX_ITERS; i++) {
    const before = current.position;
    current = minimizeAlongAxis(current, sku, ctx, 'x');
    current = side === 'left'
      ? minimizeAlongAxis(current, sku, ctx, 'y')
      : maximizeAlongAxis(current, sku, ctx, truck, 'y');
    current = minimizeAlongAxis(current, sku, ctx, 'x');

    if (
      current.position.x === before.x &&
      current.position.y === before.y &&
      current.position.z === before.z
    ) {
      break;
    }
  }

  return current;
}

function minimizeAlongAxis(
  initial: CaseInstance,
  sku: CaseSKU,
  ctx: ValidatorContext,
  axis: 'x' | 'y' | 'z'
): CaseInstance {
  let current = initial;
  for (const step of COMPACTION_STEPS) {
    let moved = true;
    while (moved) {
      const nextPos = { ...current.position, [axis]: current.position[axis] - step };
      if (nextPos[axis] < 0) {
        moved = false;
        continue;
      }

      const next = moveInstance(current, sku, nextPos);
      const validation = validatePlacement(next, ctx);
      if (validation.valid) {
        current = next;
      } else {
        moved = false;
      }
    }
  }
  return current;
}

function maximizeAlongAxis(
  initial: CaseInstance,
  sku: CaseSKU,
  ctx: ValidatorContext,
  truck: TruckType,
  axis: 'x' | 'y' | 'z'
): CaseInstance {
  let current = initial;
  for (const step of COMPACTION_STEPS) {
    let moved = true;
    while (moved) {
      const extent = current.aabb.max[axis] - current.aabb.min[axis];
      const maxOrigin = truck.innerDims[axis] - extent;
      const target = current.position[axis] + step;
      const nextCoord = Math.min(target, maxOrigin);
      if (nextCoord <= current.position[axis]) {
        moved = false;
        continue;
      }

      const nextPos = { ...current.position, [axis]: nextCoord };
      const next = moveInstance(current, sku, nextPos);
      const validation = validatePlacement(next, ctx);
      if (validation.valid) {
        current = next;
      } else {
        moved = false;
      }
    }
  }
  return current;
}

function moveInstance(instance: CaseInstance, sku: CaseSKU, position: Vec3): CaseInstance {
  return {
    ...instance,
    position,
    aabb: computeOrientedAABB(sku, position, instance.yaw, instance.tilt),
  };
}

function deduplicateInstances(instances: CaseInstance[]): CaseInstance[] {
  const seen = new Set<string>();
  return instances.filter(inst => {
    const key = `${inst.position.x},${inst.position.y},${inst.position.z},${inst.yaw},${inst.tilt?.y ?? 0}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const MAX_CANDIDATE_ANCHORS = 240;
const MAX_ANCHOR_POOL = 1200;

function anchorPriority(anchor: Vec3, currentMaxX: number, truck: TruckType): number {
  const midY = truck.innerDims.y / 2;
  const xSoftLimit = currentMaxX + 2500;
  const xBackPenalty = anchor.x > xSoftLimit ? (anchor.x - xSoftLimit) * 2 : 0;
  const zPenalty = anchor.z * 8;
  const yPenalty = Math.abs(anchor.y - midY) * 0.25;
  return anchor.x + zPenalty + yPenalty + xBackPenalty;
}

function prioritizeCandidateAnchors(
  anchors: Vec3[],
  currentMaxX: number,
  truck: TruckType
): Vec3[] {
  if (anchors.length <= MAX_CANDIDATE_ANCHORS) return anchors;
  return [...anchors]
    .sort((a, b) => anchorPriority(a, currentMaxX, truck) - anchorPriority(b, currentMaxX, truck))
    .slice(0, MAX_CANDIDATE_ANCHORS);
}

function trimAnchorPool(
  anchors: Vec3[],
  currentMaxX: number,
  truck: TruckType
): Vec3[] {
  if (anchors.length <= MAX_ANCHOR_POOL) return anchors;
  return [...anchors]
    .sort((a, b) => anchorPriority(a, currentMaxX, truck) - anchorPriority(b, currentMaxX, truck))
    .slice(0, MAX_ANCHOR_POOL);
}

/**
 * Build deterministic floor anchors from recent placed-box edges.
 * This guarantees that tight row/column slots are considered even if the
 * incremental anchor updater missed a cross-combination.
 */
function buildFloorExtremeAnchors(
  placed: CaseInstance[],
  truck: TruckType
): Vec3[] {
  if (placed.length === 0) return [];

  const EDGE_WINDOW = 16;
  const start = Math.max(0, placed.length - EDGE_WINDOW);

  const xs = new Set<number>([0]);
  const ys = new Set<number>([0]);

  for (let i = start; i < placed.length; i++) {
    const p = placed[i];
    xs.add(Math.round(p.position.x));
    xs.add(Math.round(p.aabb.max.x));
    ys.add(Math.round(p.position.y));
    ys.add(Math.round(p.aabb.max.y));
  }

  const xVals = Array.from(xs).filter(x => x >= 0 && x < truck.innerDims.x);
  const yVals = Array.from(ys).filter(y => y >= 0 && y < truck.innerDims.y);
  const anchors: Vec3[] = [];

  for (const x of xVals) {
    for (const y of yVals) {
      anchors.push({ x, y, z: 0 });
    }
  }

  return anchors;
}

/** Add anchor points at truck walls to reduce gaps at boundaries. */
function addWallAnchors(current: Vec3[], truck: TruckType): Vec3[] {
  const newAnchors: Vec3[] = [...current];
  const inner = truck.innerDims;

  // Front wall (x = 0) - already covered by initial anchor
  // Left wall (y = 0) - already covered by initial anchor
  // Floor (z = 0) - already covered by initial anchor

  // Right wall anchors (reduce horizontal gaps between cases and right wall)
  newAnchors.push({ x: 0, y: inner.y, z: 0 });        // front-right-floor
  newAnchors.push({ x: inner.x, y: 0, z: 0 });        // rear-left-floor
  newAnchors.push({ x: inner.x, y: inner.y, z: 0 });  // rear-right-floor

  // Rear wall anchors (reduce gaps at back of truck)
  newAnchors.push({ x: inner.x, y: 0, z: 0 });
  newAnchors.push({ x: inner.x, y: inner.y, z: 0 });

  // Ceiling anchors (reduce vertical gaps at top of truck)
  newAnchors.push({ x: 0, y: 0, z: inner.z });
  newAnchors.push({ x: 0, y: inner.y, z: inner.z });
  newAnchors.push({ x: inner.x, y: 0, z: inner.z });
  newAnchors.push({ x: inner.x, y: inner.y, z: inner.z });

  return deduplicateAnchors(newAnchors);
}

function updateAnchors(
  current: Vec3[],
  placed: CaseInstance,
  sku: CaseSKU,
  allPlaced: CaseInstance[],
  truck: TruckType
): Vec3[] {
  const newAnchors: Vec3[] = [...current];
  const inner = truck.innerDims;

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

  // Vertical gap reduction: anchor at ceiling when there's vertical headroom
  if (topZVal < inner.z - 50) {
    newAnchors.push({ x: minX, y: minY, z: inner.z });
    newAnchors.push({ x: maxX, y: minY, z: inner.z });
    if (sku.canBeBase) {
      newAnchors.push({ x: minX, y: maxY, z: inner.z });
      newAnchors.push({ x: maxX, y: maxY, z: inner.z });
    }
  }

  // Horizontal gap reduction: anchor at right wall when there's Y headroom
  if (maxY < inner.y - 50) {
    newAnchors.push({ x: minX, y: inner.y, z: minZ });
    newAnchors.push({ x: maxX, y: inner.y, z: minZ });
    if (sku.canBeBase) {
      newAnchors.push({ x: minX, y: inner.y, z: topZVal });
      newAnchors.push({ x: maxX, y: inner.y, z: topZVal });
    }
  }

  // Back-of-truck gap reduction: anchor at rear wall when there's X headroom
  if (maxX < inner.x - 50) {
    newAnchors.push({ x: inner.x, y: minY, z: minZ });
    newAnchors.push({ x: inner.x, y: maxY, z: minZ });
    if (sku.canBeBase) {
      newAnchors.push({ x: inner.x, y: minY, z: topZVal });
      newAnchors.push({ x: inner.x, y: maxY, z: topZVal });
    }
  }

  // Extreme-point cross-projections: combine this box's new edges with the
  // edges of recently placed boxes.  This generates anchors inside concave
  // spaces that the simple adjacent-only method cannot reach.
  // Example: two boxes in a row with different lengths leave a recess that
  // only a (maxX_other, maxY_new, z) anchor can address.
  const CROSS_WINDOW = 12; // only look at the most recent boxes to stay O(1) average
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

    // Cross-projections at stacking level — fills recesses on upper layers
    if (sku.canBeBase) {
      newAnchors.push({ x: maxX, y: oMaxY, z: topZVal });
      newAnchors.push({ x: oMaxX, y: maxY, z: topZVal });
    }
    const oTopZ = topZ(other.aabb);
    if (oTopZ > 0) {
      newAnchors.push({ x: maxX, y: oMaxY, z: oTopZ });
      newAnchors.push({ x: oMaxX, y: maxY, z: oTopZ });
    }

    // Wall-edge projections: fill gaps by projecting edges back to walls
    newAnchors.push({ x: oMaxX, y: 0, z: minZ });
    newAnchors.push({ x: maxX, y: 0, z: minZ });
  }

  // Multi-layer vertical anchors: add intermediate Z levels to reduce vertical gaps.
  // When there's significant vertical space, generate anchors at intermediate heights.
  if (sku.canBeBase && topZVal > 0 && topZVal < inner.z - 100) {
    // Add anchors at 25%, 50%, and 75% of remaining vertical space
    const remaining = inner.z - topZVal;
    if (remaining > 300) {
      const layer1 = topZVal + Math.floor(remaining * 0.25);
      const layer2 = topZVal + Math.floor(remaining * 0.5);
      newAnchors.push({ x: minX, y: minY, z: layer1 });
      newAnchors.push({ x: maxX, y: minY, z: layer1 });
      newAnchors.push({ x: minX, y: maxY, z: layer1 });
      newAnchors.push({ x: maxX, y: maxY, z: layer1 });
      newAnchors.push({ x: minX, y: minY, z: layer2 });
      newAnchors.push({ x: maxX, y: minY, z: layer2 });
      newAnchors.push({ x: minX, y: maxY, z: layer2 });
      newAnchors.push({ x: maxX, y: maxY, z: layer2 });
    }
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
const SUPPORT_EPS_MM = 5;

function computeStackSupportStats(
  candidate: CaseInstance,
  placed: CaseInstance[]
): { supportRatio: number; edgeAligned: boolean } {
  const candidateBottom = candidate.aabb.min.z;
  if (candidateBottom <= SUPPORT_EPS_MM) {
    return { supportRatio: 1, edgeAligned: true };
  }

  const candidateArea = bottomArea(candidate.aabb);
  if (candidateArea <= 0) {
    return { supportRatio: 0, edgeAligned: false };
  }

  let supportedArea = 0;
  let edgeAligned = false;
  for (const other of placed) {
    if (!isApproximately(topZ(other.aabb), candidateBottom, SUPPORT_EPS_MM)) continue;

    const overlap = intersectionAreaXZ(candidate.aabb, other.aabb);
    if (overlap <= 0) continue;
    supportedArea += overlap;

    const xAligned =
      Math.abs(candidate.aabb.min.x - other.aabb.min.x) <= TOUCH_DIST ||
      Math.abs(candidate.aabb.max.x - other.aabb.max.x) <= TOUCH_DIST;
    const yAligned =
      Math.abs(candidate.aabb.min.y - other.aabb.min.y) <= TOUCH_DIST ||
      Math.abs(candidate.aabb.max.y - other.aabb.max.y) <= TOUCH_DIST;
    if (xAligned && yAligned) {
      edgeAligned = true;
    }
  }

  return {
    supportRatio: Math.min(1, supportedArea / candidateArea),
    edgeAligned,
  };
}

function scorePlacement(
  instance: CaseInstance,
  placed: CaseInstance[],
  truck: TruckType
): number {
  const a = instance.aabb;

  // Prefer lower height (pack from floor up)
  const heightPenalty = a.min.z / truck.innerDims.z;

  // Pack front-to-back: reward placing closer to the front of the truck.
  // The old axle-proximity metric pulled items toward the truck center,
  // which split cargo into two groups with a gap in between.  Axle limits
  // are already enforced by validation, so let the scoring just drive
  // compact front-to-back filling.
  const xForwardBias = (a.min.x + a.max.x) / 2 / truck.innerDims.x;

  // Weak Y-center preference — just enough to break ties in favour of
  // balanced loads, but not strong enough to override wall-adjacency.
  const yCenter = (a.min.y + a.max.y) / 2;
  const truckMidY = truck.innerDims.y / 2;
  const yDeviationPenalty = Math.abs(yCenter - truckMidY) / truck.innerDims.y;

  // Penalize extending the used truck length when existing rows still have room.
  let currentMaxX = 0;
  for (const p of placed) {
    if (p.aabb.max.x > currentMaxX) currentMaxX = p.aabb.max.x;
  }
  const nextMaxX = Math.max(currentMaxX, a.max.x);
  const xGrowthPenalty = placed.length === 0
    ? nextMaxX / truck.innerDims.x
    : (nextMaxX - currentMaxX) / truck.innerDims.x;

  const supportStats = computeStackSupportStats(instance, placed);
  const supportPenalty = Math.max(0, 1 - supportStats.supportRatio);
  const supportAlignmentBonus = supportStats.edgeAligned ? 1 : 0;
  const stackedLateralPenalty = instance.position.z > SUPPORT_EPS_MM
    ? a.min.y / truck.innerDims.y
    : 0;

  // Reward tight compaction: count faces touching walls or other placed boxes.
  let touchCount = 0;

  // Wall / floor adjacency
  if (a.min.z <= TOUCH_DIST) touchCount += 2; // floor is the most important surface
  if (a.min.x <= TOUCH_DIST) touchCount += 1; // front wall
  if (a.min.y <= TOUCH_DIST) touchCount += 1; // left wall
  if (a.max.y >= truck.innerDims.y - TOUCH_DIST) touchCount += 1; // right wall
  if (a.max.x >= truck.innerDims.x - TOUCH_DIST) touchCount += 1; // rear wall
  if (a.max.z >= truck.innerDims.z - TOUCH_DIST) touchCount += 1; // ceiling

  // Box-to-box face adjacency (X, Y, and Z axes)
  for (const p of placed) {
    const b = p.aabb;
    const yOverlap = a.min.y < b.max.y - TOUCH_DIST && a.max.y > b.min.y + TOUCH_DIST;
    const xOverlap = a.min.x < b.max.x - TOUCH_DIST && a.max.x > b.min.x + TOUCH_DIST;
    const zOverlap = a.min.z < b.max.z - TOUCH_DIST && a.max.z > b.min.z + TOUCH_DIST;

    // X-axis faces (front/rear)
    if (zOverlap && yOverlap) {
      if (Math.abs(a.min.x - b.max.x) <= TOUCH_DIST) touchCount++;
      if (Math.abs(a.max.x - b.min.x) <= TOUCH_DIST) touchCount++;
    }
    // Y-axis faces (left/right)
    if (zOverlap && xOverlap) {
      if (Math.abs(a.min.y - b.max.y) <= TOUCH_DIST) touchCount++;
      if (Math.abs(a.max.y - b.min.y) <= TOUCH_DIST) touchCount++;
    }
    // Z-axis faces (top/bottom stacking contact)
    if (xOverlap && yOverlap) {
      if (Math.abs(a.min.z - b.max.z) <= TOUCH_DIST) touchCount++;
      if (Math.abs(a.max.z - b.min.z) <= TOUCH_DIST) touchCount++;
    }
  }

  // Normalise to [0, 1]: max realistic touches ≈ floor(2) + front(1) + left(1) + right(1) + rear(1) + ceiling(1) + 4 box faces = 11
  const adjacencyBonus = Math.min(touchCount, 11) / 11;

  // Combined score (higher = better placement)
  return (
    -heightPenalty * 2.0
    - xForwardBias * 3.0           // strong front-to-back fill
    - yDeviationPenalty * 0.5      // weak L/R centering (adjacency handles wall-hugging)
    - xGrowthPenalty * 2.5         // avoid opening new rear rows too early
    - supportPenalty * 6.0         // discourage partial-overlap stacks
    - stackedLateralPenalty * 2.0  // fill upper-layer bays in order before edge-hugging
    + supportAlignmentBonus * 1.5  // prefer clean column alignment when stacking
    + adjacencyBonus * 5.0         // dominant tight-packing reward
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

  // Reward compactness: prefer solutions where cargo uses less truck length.
  // Lower max-X extent → tighter, more consolidated pack.
  if (result.placed.length > 0) {
    let maxExtentX = 0;
    for (const inst of result.placed) {
      if (inst.aabb.max.x > maxExtentX) maxExtentX = inst.aabb.max.x;
    }
    score -= (maxExtentX / truck.innerDims.x) * 150;
  }

  // Reward compactness (fewer unplaced = better, already captured in placed count)
  score -= result.unplaced.length * 500;

  return score;
}

// ============================================================================
// Helpers
// ============================================================================

function getCurrentMaxX(instances: CaseInstance[]): number {
  let maxX = 0;
  for (const inst of instances) {
    if (inst.aabb.max.x > maxX) maxX = inst.aabb.max.x;
  }
  return maxX;
}

function instancePositionKey(inst: CaseInstance): string {
  return `${inst.position.x},${inst.position.y},${inst.position.z},${inst.yaw},${inst.tilt?.y ?? 0}`;
}

function projectedFloorVoidRatio(placed: CaseInstance[], candidate: CaseInstance): number {
  const FLOOR_Z_EPS = 5;
  const floorItems = placed.filter(inst => inst.position.z <= FLOOR_Z_EPS);
  const all = candidate.position.z <= FLOOR_Z_EPS
    ? [...floorItems, candidate]
    : [...floorItems];
  if (all.length <= 1) return 0;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = 0;
  let maxY = 0;
  let occupiedArea = 0;

  for (const inst of all) {
    const a = inst.aabb;
    if (a.min.x < minX) minX = a.min.x;
    if (a.min.y < minY) minY = a.min.y;
    if (a.max.x > maxX) maxX = a.max.x;
    if (a.max.y > maxY) maxY = a.max.y;
    occupiedArea += (a.max.x - a.min.x) * (a.max.y - a.min.y);
  }

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const bboxArea = spanX * spanY;
  if (bboxArea <= 0) return 0;

  const fillRatio = Math.min(1, occupiedArea / bboxArea);
  return 1 - fillRatio;
}

function isFloorPreferredSku(sku: CaseSKU): boolean {
  const stackRules = parseStackClass(sku.stackClass);
  return Boolean(sku.tiltAllowed) && stackRules.labels.some(label => label.toLowerCase() === 'cable');
}

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
