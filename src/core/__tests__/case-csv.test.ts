import { describe, it, expect } from 'vitest';
import { parseCaseCsv, formatCaseCsv, buildStackClass } from '../../lib/caseCsv';
import type { CaseSKU } from '../types';

describe('caseCsv', () => {
  it('parses required schema in fixed column order', () => {
    const text = [
      'BoxName,Count,Color (HEX),Length,Width,Height,Weight,No Tilt,No Rotate,No Stack,On floor',
      'Small Box,12,#112233,1200,800,500,42,true,false,true,1',
    ].join('\n');

    const rows = parseCaseCsv(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      boxName: 'Small Box',
      count: 12,
      colorHex: '#112233',
      length: 1200,
      width: 800,
      height: 500,
      weight: 42,
      noTilt: true,
      noRotate: false,
      noStack: true,
      onFloor: true,
    });
  });

  it('exports fixed header order', () => {
    const cases: CaseSKU[] = [
      {
        skuId: 'sku-a',
        name: 'A',
        color: '#abcdef',
        dims: { l: 1000, w: 600, h: 400 },
        weightKg: 33,
        uprightOnly: false,
        allowedYaw: [0],
        tiltAllowed: false,
        canBeBase: false,
        topContactAllowed: false,
        maxLoadAboveKg: 0,
        minSupportRatio: 0.75,
        stackClass: 'FLOOR_ONLY',
      },
    ];

    const csv = formatCaseCsv(cases, { 'sku-a': 9 });
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('BoxName,Count,Color (HEX),Length,Width,Height,Weight,No Tilt,No Rotate,No Stack,On floor');
    expect(lines[1]).toContain('A,9,#abcdef,1000,600,400,33,true,true,true,true');
  });

  it('adds and removes floor-only token', () => {
    expect(buildStackClass(undefined, true)).toBe('FLOOR_ONLY');
    expect(buildStackClass('A,FLOOR_ONLY', false)).toBe('A');
  });
});
