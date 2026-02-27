/**
 * Support graph for tracking case stacking relationships
 */

import type { CaseInstance, CaseSKU } from './types';
import { bottomZ, topZ, intersectionAreaXZ, bottomArea, isApproximately } from './geometry';

const SUPPORT_EPSILON = 5; // 5mm tolerance for support detection

// ============================================================================
// Support Graph
// ============================================================================

export class SupportGraph {
  // Map from instance id -> set of supporter instance ids
  private supporters: Map<string, Set<string>> = new Map();
  
  // Map from instance id -> cumulative load above (kg)
  private loadAbove: Map<string, number> = new Map();
  
  // SKU weights for load calculation
  private skuWeights: Map<string, number> = new Map();

  constructor(skuWeights: Map<string, number>) {
    this.skuWeights = skuWeights;
  }

  // ---------------------------------------------------------------------------
  // Graph Operations
  // ---------------------------------------------------------------------------

  addInstance(instance: CaseInstance, allInstances: CaseInstance[]): void {
    this.supporters.set(instance.id, new Set());
    this.loadAbove.set(instance.id, 0);
    
    // Find supporters
    const instBottomZ = bottomZ(instance.aabb);
    
    if (instBottomZ > 0) {
      for (const other of allInstances) {
        if (other.id === instance.id) continue;
        
        const otherTopZ = topZ(other.aabb);
        
        // Check if other is directly below
        if (isApproximately(otherTopZ, instBottomZ, SUPPORT_EPSILON)) {
          // Check X-Y overlap
          const overlapArea = intersectionAreaXZ(instance.aabb, other.aabb);
          if (overlapArea > 0) {
            this.supporters.get(instance.id)!.add(other.id);
          }
        }
      }
    }
    
    // Update load propagation for instances above
    this.propagateLoad(instance.id);
  }

  removeInstance(instanceId: string): void {
    // Find all instances that this one supports
    const dependents = this.findDependents(instanceId);
    
    this.supporters.delete(instanceId);
    this.loadAbove.delete(instanceId);
    
    // Recalculate loads for dependents
    for (const depId of dependents) {
      this.recalculateLoad(depId);
    }
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
      // On floor - full support
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

  private propagateLoad(instanceId: string): void {
    // Add this instance's weight to all supporters
    // TODO: implement proper load propagation
  }

  private recalculateLoad(instanceId: string): void {
    // Recalculate cumulative load for this instance
    // TODO: implement
  }

  private findDependents(instanceId: string): string[] {
    const dependents: string[] = [];
    
    for (const [id, supporters] of this.supporters) {
      if (supporters.has(instanceId)) {
        dependents.push(id);
      }
    }
    
    return dependents;
  }
}
