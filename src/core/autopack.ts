/**
 * Auto-pack engine for automatic truck loading
 * Safe-first, constraint-driven placement
 */

import type { 
  TruckType, 
  CaseSKU, 
  CaseInstance, 
  AutoPackResult,
  LoadMetrics,
  ValidationError,
  Yaw,
} from './types';
import { createInstance, bottomZ, topZ } from './geometry';
import { validatePlacement, ValidatorContext } from './validate';
import { SupportGraph } from './support';
import { computeMetrics } from './weight';

// ============================================================================
// Auto-Pack Configuration
// ============================================================================

export interface AutoPackConfig {
  maxAttempts: number;          // multi-start attempts
  randomSeed?: number;          // for reproducibility
  
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
  
  let bestResult: AutoPackResult | null = null;
  let bestScore = -Infinity;
  
  // Multi-start
  for (let attempt = 0; attempt < cfg.maxAttempts; attempt++) {
    const result = attemptPlacement(truck, skus, casesToPlace, attempt);
    
    if (result.placed.length > (bestResult?.placed.length || 0)) {
      const score = scoreResult(result, truck, cfg.scoreWeights);
      if (score > bestScore) {
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
  
  const ctx: ValidatorContext = {
    truck,
    skus: skuMap,
    instances: [],
    supportGraph,
    skuWeights,
  };
  
  const placed: CaseInstance[] = [];
  const unplaced: string[] = [];
  const reasonSummary: Record<ValidationError, number> = {} as any;
  
  // Candidate anchor points
  let anchors: Vec3[] = [{ x: 0, y: 0, z: 0 }];
  
  // Shuffle cases within same priority tier
  const shuffled = shuffleWithinTiers(casesToPlace, attemptNumber);
  
  for (const pc of shuffled) {
    const sku = skuMap.get(pc.skuId);
    if (!sku) {
      unplaced.push(pc.skuId);
      continue;
    }
    
    let bestPlacement: { instance: CaseInstance; score: number } | null = null;
    
    // Try each anchor point
    for (const anchor of anchors) {
      // Try each allowed yaw
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
        }
      }
    }
    
    if (bestPlacement) {
      placed.push(bestPlacement.instance);
      ctx.instances = placed;
      supportGraph.addInstance(bestPlacement.instance, placed);
      
      // Generate new anchors
      anchors = updateAnchors(anchors, bestPlacement.instance, sku);
    } else {
      unplaced.push(pc.skuId);
      // Track why it failed
      // (simplified - would need to track last validation result)
    }
  }
  
  const metrics = computeMetrics(placed, skuWeights, truck);
  
  return {
    placed,
    unplaced,
    metrics,
    reasonSummary,
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
  
  // Sort by priority
  return queue.sort((a, b) => {
    // 1. Heaviest first
    if (a.weightKg !== b.weightKg) return b.weightKg - a.weightKg;
    // 2. Non-stackable first
    if (a.canBeBase !== b.canBeBase) return a.canBeBase ? 1 : -1;
    // 3. Upright-only first
    if (a.uprightOnly !== b.uprightOnly) return a.uprightOnly ? -1 : 1;
    // 4. Largest footprint first
    return b.footprintMm2 - a.footprintMm2;
  });
}

function shuffleWithinTiers(
  cases: PlacementCase[],
  seed: number
): PlacementCase[] {
  // Group by tier (same priority)
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
  
  // Shuffle each tier
  const result: PlacementCase[] = [];
  for (const tier of tiers) {
    const shuffled = [...tier];
    // Simple seeded shuffle
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = (seed * (i + 1)) % (i + 1);
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
  
  // Add corners of placed box
  const maxX = placed.aabb.max.x;
  const maxY = placed.aabb.max.y;
  const maxZ = topZ(placed.aabb);
  
  // Right side
  newAnchors.push({ x: placed.position.x, y: maxY, z: placed.position.z });
  
  // Front (behind)
  newAnchors.push({ x: maxX, y: placed.position.y, z: placed.position.z });
  
  // On top (if stackable)
  if (sku.canBeBase) {
    newAnchors.push({ x: placed.position.x, y: placed.position.y, z: maxZ });
  }
  
  // Remove duplicates and out-of-bounds
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
// Scoring
// ============================================================================

function scorePlacement(
  instance: CaseInstance,
  placed: CaseInstance[],
  truck: TruckType,
  skuWeights: Map<string, number>
): number {
  // Prefer lower placements, toward the front
  const heightScore = -instance.aabb.min.z;
  const frontScore = -instance.aabb.min.x;
  
  return heightScore * 2 + frontScore;
}

function scoreResult(
  result: AutoPackResult,
  truck: TruckType,
  weights: AutoPackConfig['scoreWeights']
): number {
  let score = result.placed.length * 1000; // Primary: more placed = better
  
  // Penalize high stack height
  score -= result.metrics.maxStackHeightMm * weights.stackHeight / 1000;
  
  // Penalize axle imbalance
  const axleImbalance = Math.abs(
    result.metrics.frontAxleKg - result.metrics.rearAxleKg
  );
  score -= axleImbalance * weights.axleBalance / 100;
  
  // Penalize L/R imbalance
  score -= result.metrics.lrImbalancePercent * weights.lrBalance;
  
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
    reasonSummary: {} as any,
  };
}
