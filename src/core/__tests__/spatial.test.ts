import { describe, it, expect } from 'vitest';
import { SpatialIndex } from '../spatial';
import { createAABB } from '../geometry';

describe('SpatialIndex', () => {
  it('finds candidate after add', () => {
    const idx = new SpatialIndex();
    const aabb = createAABB({ x: 0, y: 0, z: 0 }, { x: 1000, y: 600, z: 400 });
    idx.add('a', aabb);
    const candidates = idx.candidates(aabb);
    expect(candidates.has('a')).toBe(true);
  });

  it('does not find removed instance', () => {
    const idx = new SpatialIndex();
    const aabb = createAABB({ x: 0, y: 0, z: 0 }, { x: 1000, y: 600, z: 400 });
    idx.add('a', aabb);
    idx.remove('a');
    const candidates = idx.candidates(aabb);
    expect(candidates.has('a')).toBe(false);
  });

  it('does not return distant instances as candidates', () => {
    const idx = new SpatialIndex();
    const a = createAABB({ x: 0, y: 0, z: 0 }, { x: 1000, y: 600, z: 400 });
    const b = createAABB({ x: 5000, y: 2000, z: 0 }, { x: 1000, y: 600, z: 400 });
    idx.add('a', a);
    const candidates = idx.candidates(b);
    expect(candidates.has('a')).toBe(false);
  });

  it('returns multiple overlapping instances', () => {
    const idx = new SpatialIndex();
    const base = createAABB({ x: 0, y: 0, z: 0 }, { x: 1000, y: 600, z: 400 });
    idx.add('a', base);
    idx.add('b', createAABB({ x: 200, y: 0, z: 0 }, { x: 1000, y: 600, z: 400 }));
    const query = createAABB({ x: 100, y: 0, z: 0 }, { x: 800, y: 600, z: 400 });
    const candidates = idx.candidates(query);
    expect(candidates.has('a')).toBe(true);
    expect(candidates.has('b')).toBe(true);
  });

  it('handles large coordinates correctly', () => {
    const idx = new SpatialIndex();
    const aabb = createAABB({ x: 6000, y: 1800, z: 2000 }, { x: 1000, y: 600, z: 400 });
    idx.add('far', aabb);
    const candidates = idx.candidates(aabb);
    expect(candidates.has('far')).toBe(true);
  });
});
