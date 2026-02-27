/**
 * Geometry utilities for AABB operations
 * All units in millimeters
 */

import type { AABB, Vec3, Yaw, CaseSKU, CaseInstance } from './types';

const EPSILON = 1; // 1mm tolerance

// ============================================================================
// AABB Operations
// ============================================================================

export function createAABB(position: Vec3, dims: Vec3): AABB {
  return {
    min: { ...position },
    max: {
      x: position.x + dims.x,
      y: position.y + dims.y,
      z: position.z + dims.z,
    },
  };
}

export function getRotatedDims(dims: Vec3, yaw: Yaw): Vec3 {
  // Yaw rotates around Z axis
  // 0/180: l->X, w->Y
  // 90/270: w->X, l->Y
  if (yaw === 0 || yaw === 180) {
    return { x: dims.x, y: dims.y, z: dims.z };
  } else {
    return { x: dims.y, y: dims.x, z: dims.z };
  }
}

export function computeAABB(sku: CaseSKU, position: Vec3, yaw: Yaw): AABB {
  const rotated = getRotatedDims(
    { x: sku.dims.l, y: sku.dims.w, z: sku.dims.h },
    yaw
  );
  return createAABB(position, rotated);
}

// ============================================================================
// Collision Detection
// ============================================================================

export function aabbOverlap(a: AABB, b: AABB): boolean {
  return (
    a.min.x < b.max.x - EPSILON &&
    a.max.x > b.min.x + EPSILON &&
    a.min.y < b.max.y - EPSILON &&
    a.max.y > b.min.y + EPSILON &&
    a.min.z < b.max.z - EPSILON &&
    a.max.z > b.min.z + EPSILON
  );
}

export function aabbContains(outer: AABB, inner: AABB): boolean {
  return (
    inner.min.x >= outer.min.x &&
    inner.min.y >= outer.min.y &&
    inner.min.z >= outer.min.z &&
    inner.max.x <= outer.max.x &&
    inner.max.y <= outer.max.y &&
    inner.max.z <= outer.max.z
  );
}

// ============================================================================
// Support Area Calculation
// ============================================================================

export function intersectionAreaXZ(a: AABB, b: AABB): number {
  // Floor footprint overlap: X-Y plane (X = front→rear, Y = left→right, Z = height)
  // "XZ" name is legacy; this is the top-down (bird's-eye) overlap used for support checks.
  const xOverlap = Math.max(0, Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x));
  const yOverlap = Math.max(0, Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y));
  return xOverlap * yOverlap;
}

export function bottomArea(aabb: AABB): number {
  const dx = aabb.max.x - aabb.min.x;
  const dy = aabb.max.y - aabb.min.y;
  return dx * dy;
}

export function topZ(aabb: AABB): number {
  return aabb.max.z;
}

export function bottomZ(aabb: AABB): number {
  return aabb.min.z;
}

// ============================================================================
// Utility
// ============================================================================

export function isApproximately(a: number, b: number, tolerance: number = EPSILON): boolean {
  return Math.abs(a - b) <= tolerance;
}

export function createInstance(
  id: string,
  sku: CaseSKU,
  position: Vec3,
  yaw: Yaw
): CaseInstance {
  return {
    id,
    skuId: sku.skuId,
    position: { ...position },
    yaw,
    aabb: computeAABB(sku, position, yaw),
  };
}
