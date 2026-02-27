/**
 * Support graph for tracking case stacking relationships
 */

import type { CaseInstance } from './types';
import { bottomZ, topZ, intersectionAreaXZ, bottomArea, isApproximately } from './geometry';

const SUPPORT_EPSILON = 5; // 5mm tolerance for support detection

// ============================================================================
// Support Graph
// ============================================================================

export class SupportGraph {
  // Map from instance id -> set of supporter instance ids (instances directly below)
  private supporters: Map<string, Set<string>> = new Map();

  // Map from instance id -> cumulative load above (kg)
  private loadAbove: Map<string, number> = new Map();

  // SKU weights for load calculation (skuId -> weightKg)
  private skuWeights: Map<string, number> = new Map();

  // Track instance id -> skuId so we can look up weights without parsing IDs
  private instanceSkuId: Map<string, string> = new Map();

  constructor(skuWeights: Map<string, number>) {
    this.skuWeights = skuWeights;
  }

  // ---------------------------------------------------------------------------
  // Graph Operations
  // ---------------------------------------------------------------------------

  addInstance(instance: CaseInstance, allInstances: CaseInstance[]): void {
    this.supporters.set(instance.id, new Set());
    this.loadAbove.set(instance.id, 0);
    this.instanceSkuId.set(instance.id, instance.skuId);

    // Find supporters directly below this instance
    const instBottomZ = bottomZ(instance.aabb);

    if (instBottomZ > SUPPORT_EPSILON) {
      for (const other of allInstances) {
        if (other.id === instance.id) continue;

        const otherTopZ = topZ(other.aabb);

        // Check if other is directly below (within epsilon)
        if (isApproximately(otherTopZ, instBottomZ, SUPPORT_EPSILON)) {
          // Check X-Y footprint overlap
          const overlapArea = intersectionAreaXZ(instance.aabb, other.aabb);
          if (overlapArea > 0) {
            this.supporters.get(instance.id)!.add(other.id);
          }
        }
      }
    }

    // Recompute all loads after adding this instance
    this.recomputeAllLoads();
  }

  removeInstance(instanceId: string): void {
    this.supporters.delete(instanceId);
    this.loadAbove.delete(instanceId);
    this.instanceSkuId.delete(instanceId);

    // Remove this instance from all supporter sets
    for (const supporterSet of this.supporters.values()) {
      supporterSet.delete(instanceId);
    }

    // Recompute all loads after removal
    this.recomputeAllLoads();
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  getSupporters(instanceId: string): Set<string> {
    return this.supporters.get(instanceId) || new Set();
  }

  getLoadAbove(instanceId: string): number {
    return this.loadAbove.get(instanceId) || 0;
  }

  getSupportRatio(
    instance: CaseInstance,
    allInstances: CaseInstance[]
  ): number {
    const instBottomZ = bottomZ(instance.aabb);

    if (instBottomZ <= SUPPORT_EPSILON) {
      // On floor — full support
      return 1.0;
    }

    const instBottomArea = bottomArea(instance.aabb);
    if (instBottomArea === 0) return 0;

    let supportedArea = 0;

    for (const other of allInstances) {
      if (other.id === instance.id) continue;

      const otherTopZ = topZ(other.aabb);

      if (isApproximately(otherTopZ, instBottomZ, SUPPORT_EPSILON)) {
        supportedArea += intersectionAreaXZ(instance.aabb, other.aabb);
      }
    }

    return supportedArea / instBottomArea;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private recomputeAllLoads(): void {
    // Reset all cumulative loads
    for (const id of this.loadAbove.keys()) {
      this.loadAbove.set(id, 0);
    }

    const allIds = Array.from(this.supporters.keys());
    if (allIds.length === 0) return;

    // Build reverse map: dependentsMap[id] = list of instances that sit ON TOP of id
    const dependentsMap = new Map<string, string[]>();
    for (const id of allIds) {
      dependentsMap.set(id, []);
    }
    for (const [id, sups] of this.supporters) {
      for (const supId of sups) {
        dependentsMap.get(supId)?.push(id);
      }
    }

    // Topological sort: start from instances with nothing on top (leaves)
    const inDegree = new Map<string, number>();
    for (const id of allIds) {
      inDegree.set(id, dependentsMap.get(id)?.length ?? 0);
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    // Process top-to-bottom: propagate (weight + loadAbove) downward to supporters
    while (queue.length > 0) {
      const id = queue.shift()!;
      const myWeight = this.getInstanceWeight(id);
      const myLoad = this.loadAbove.get(id) ?? 0;

      const mySupporters = this.supporters.get(id);
      if (mySupporters && mySupporters.size > 0) {
        // Distribute load equally among all direct supporters
        const share = (myWeight + myLoad) / mySupporters.size;
        for (const supId of mySupporters) {
          this.loadAbove.set(supId, (this.loadAbove.get(supId) ?? 0) + share);

          const newDeg = (inDegree.get(supId) ?? 1) - 1;
          inDegree.set(supId, newDeg);
          if (newDeg === 0) {
            queue.push(supId);
          }
        }
      }
    }
  }

  private getInstanceWeight(instanceId: string): number {
    const skuId = this.instanceSkuId.get(instanceId);
    if (!skuId) return 0;
    return this.skuWeights.get(skuId) ?? 0;
  }

  /** Returns the ids of instances that sit directly on top of instanceId. */
  getDependents(instanceId: string): string[] {
    const dependents: string[] = [];
    for (const [id, supporters] of this.supporters) {
      if (supporters.has(instanceId)) {
        dependents.push(id);
      }
    }
    return dependents;
  }
}
