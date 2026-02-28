import { describe, it, expect, beforeEach } from 'vitest';
import { SupportGraph } from '../support';
import type { CaseInstance } from '../types';
import { createAABB } from '../geometry';

function makeInst(id: string, skuId: string, x: number, y: number, z: number, l: number, w: number, h: number): CaseInstance {
  return {
    id,
    skuId,
    position: { x, y, z },
    yaw: 0,
    aabb: createAABB({ x, y, z }, { x: l, y: w, z: h }),
  };
}

const skuWeights = new Map([
  ['A', 100],
  ['B', 50],
  ['C', 30],
]);

describe('SupportGraph', () => {
  let graph: SupportGraph;

  beforeEach(() => {
    graph = new SupportGraph(new Map(skuWeights));
  });

  it('floor instance has full support ratio', () => {
    const inst = makeInst('a', 'A', 0, 0, 0, 1000, 600, 400);
    graph.addInstance(inst, [inst]);
    expect(graph.getSupportRatio(inst, [inst])).toBe(1.0);
  });

  it('stacked instance detects supporter below', () => {
    const base = makeInst('base', 'A', 0, 0, 0, 1000, 600, 400);
    const top = makeInst('top', 'B', 0, 0, 400, 1000, 600, 400);
    graph.addInstance(base, [base]);
    graph.addInstance(top, [base, top]);

    const supporters = graph.getSupporters('top');
    expect(supporters.has('base')).toBe(true);
  });

  it('getLoadAbove is non-zero for base after top is added', () => {
    const base = makeInst('base', 'A', 0, 0, 0, 1000, 600, 400);
    const top = makeInst('top', 'B', 0, 0, 400, 1000, 600, 400);
    graph.addInstance(base, [base]);
    graph.addInstance(top, [base, top]);

    // top weighs 50kg; base should carry 50kg above
    expect(graph.getLoadAbove('base')).toBeCloseTo(50, 1);
  });

  it('getLoadAbove resets after instance removed', () => {
    const base = makeInst('base', 'A', 0, 0, 0, 1000, 600, 400);
    const top = makeInst('top', 'B', 0, 0, 400, 1000, 600, 400);
    graph.addInstance(base, [base]);
    graph.addInstance(top, [base, top]);
    graph.removeInstance('top');

    expect(graph.getLoadAbove('base')).toBeCloseTo(0, 1);
  });

  it('three-tier stack accumulates load correctly', () => {
    // A (100kg) at z=0, B (50kg) at z=400, C (30kg) at z=800
    const a = makeInst('a', 'A', 0, 0, 0, 1000, 600, 400);
    const b = makeInst('b', 'B', 0, 0, 400, 1000, 600, 400);
    const c = makeInst('c', 'C', 0, 0, 800, 1000, 600, 400);
    graph.addInstance(a, [a]);
    graph.addInstance(b, [a, b]);
    graph.addInstance(c, [a, b, c]);

    // A carries B + C = 80kg
    expect(graph.getLoadAbove('a')).toBeCloseTo(80, 1);
    // B carries C = 30kg
    expect(graph.getLoadAbove('b')).toBeCloseTo(30, 1);
    // C carries nothing
    expect(graph.getLoadAbove('c')).toBeCloseTo(0, 1);
  });

  it('getSupportRatio is 0 for floating instance with no support', () => {
    const base = makeInst('base', 'A', 0, 0, 0, 1000, 600, 400);
    const floating = makeInst('float', 'B', 5000, 0, 400, 1000, 600, 400);
    expect(graph.getSupportRatio(floating, [base, floating])).toBe(0);
  });

  it('getSupportRatio captures partial support below threshold', () => {
    const base = makeInst('base', 'A', 0, 0, 0, 500, 600, 400);
    const top = makeInst('top', 'B', 0, 0, 400, 1000, 600, 400);

    // 500x600 overlap over 1000x600 bottom area => 0.50 support ratio
    expect(graph.getSupportRatio(top, [base, top])).toBeCloseTo(0.5, 3);
  });

  it('getSupportRatio uses union support from multiple supporters', () => {
    const baseA = makeInst('base-a', 'A', 0, 0, 0, 400, 600, 400);
    const baseB = makeInst('base-b', 'A', 600, 0, 0, 400, 600, 400);
    const top = makeInst('top', 'B', 0, 0, 400, 1000, 600, 400);

    // (400 + 400) x 600 overlap over 1000x600 bottom area => 0.80 support ratio
    expect(graph.getSupportRatio(top, [baseA, baseB, top])).toBeCloseTo(0.8, 3);
  });
});
