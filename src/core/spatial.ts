/**
 * Spatial index for fast AABB collision queries.
 *
 * Uses a uniform grid partitioned in X and Y (the two axes where packing
 * density is highest). Z is intentionally not indexed because the stack
 * height is usually small and the hot-path is the per-layer collision check.
 *
 * All coordinates are in millimeters.
 */

import type { AABB } from './types';

const CELL_SIZE = 500; // 500 mm grid cells

function cellKey(cx: number, cy: number): number {
  // Pack two 16-bit integers into a 32-bit number for use as a Map key.
  // Max grid dimension per axis: 65535 cells × 500 mm = 32 767 500 mm — plenty.
  return ((cx & 0xffff) << 16) | (cy & 0xffff);
}

export class SpatialIndex {
  // cell key -> set of instance ids overlapping that cell
  private cells: Map<number, Set<string>> = new Map();

  // instance id -> list of cell keys it occupies
  private instanceCells: Map<string, number[]> = new Map();

  add(id: string, aabb: AABB): void {
    const keys = this.cellsFor(aabb);
    this.instanceCells.set(id, keys);
    for (const k of keys) {
      let bucket = this.cells.get(k);
      if (!bucket) {
        bucket = new Set();
        this.cells.set(k, bucket);
      }
      bucket.add(id);
    }
  }

  remove(id: string): void {
    const keys = this.instanceCells.get(id);
    if (!keys) return;
    for (const k of keys) {
      this.cells.get(k)?.delete(id);
    }
    this.instanceCells.delete(id);
  }

  /**
   * Return all instance ids whose grid cells overlap with the query AABB.
   * The caller must still do the precise AABB–AABB test; this is just a
   * pre-filter to avoid O(n) scans.
   */
  candidates(aabb: AABB): Set<string> {
    const result = new Set<string>();
    for (const k of this.cellsFor(aabb)) {
      const bucket = this.cells.get(k);
      if (bucket) {
        for (const id of bucket) {
          result.add(id);
        }
      }
    }
    return result;
  }

  private cellsFor(aabb: AABB): number[] {
    const minCX = Math.floor(aabb.min.x / CELL_SIZE);
    const maxCX = Math.floor((aabb.max.x - 1) / CELL_SIZE);
    const minCY = Math.floor(aabb.min.y / CELL_SIZE);
    const maxCY = Math.floor((aabb.max.y - 1) / CELL_SIZE);

    const keys: number[] = [];
    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        keys.push(cellKey(cx, cy));
      }
    }
    return keys;
  }
}
