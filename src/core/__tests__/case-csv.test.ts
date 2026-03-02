import { describe, it, expect } from 'vitest';
import { parseCaseCsv, formatCaseCsv, buildStackClass } from '../../lib/caseCsv';
import type { CaseSKU } from '../types';
import { FLOOR_ONLY_TOKEN } from '../../lib/tokens';

describe('caseCsv', () => {

  it('uses shared FLOOR_ONLY token constant', () => {
    expect(FLOOR_ONLY_TOKEN).toBe('FLOOR_ONLY');
  });

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


  it('preserves intentional whitespace for quoted CSV fields', () => {
    const text = [
      'BoxName,Count,Color (HEX),Length,Width,Height,Weight,No Tilt,No Rotate,No Stack,On floor',
      '"  Padded Box  ",1,#112233,100,100,100,10,false,false,false,false',
    ].join('\n');

    const rows = parseCaseCsv(text);
    expect(rows[0]?.boxName).toBe('  Padded Box  ');
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


  it('exports No Stack=true when top contact is blocked', () => {
    const cases: CaseSKU[] = [
      {
        skuId: 'sku-top-blocked',
        name: 'TopBlocked',
        color: '#abcdef',
        dims: { l: 1200, w: 800, h: 500 },
        weightKg: 50,
        uprightOnly: false,
        allowedYaw: [0, 90],
        tiltAllowed: true,
        canBeBase: true,
        topContactAllowed: false,
        maxLoadAboveKg: 100,
        minSupportRatio: 0.75,
      },
    ];

    const csv = formatCaseCsv(cases, { 'sku-top-blocked': 1 });
    const lines = csv.trim().split('\n');
    expect(lines[1]).toContain('TopBlocked,1,#abcdef,1200,800,500,50,false,false,true,false');
  });

  it('derives On floor=true when FLOOR_ONLY appears with labels', () => {
    const cases: CaseSKU[] = [
      {
        skuId: 'sku-mixed-floor',
        name: 'MixedFloor',
        color: '#abcdef',
        dims: { l: 1000, w: 600, h: 400 },
        weightKg: 22,
        uprightOnly: false,
        allowedYaw: [0, 90],
        tiltAllowed: false,
        canBeBase: true,
        topContactAllowed: true,
        maxLoadAboveKg: 50,
        minSupportRatio: 0.75,
        stackClass: 'small,FLOOR_ONLY',
      },
    ];

    const csv = formatCaseCsv(cases, { 'sku-mixed-floor': 3 });
    const lines = csv.trim().split('\n');
    expect(lines[1]).toContain('MixedFloor,3,#abcdef,1000,600,400,22,true,false,false,true');
  });

  it('adds and removes floor-only token', () => {
    expect(buildStackClass(undefined, true)).toBe('FLOOR_ONLY');
    expect(buildStackClass('A,FLOOR_ONLY', false)).toBe('A');
    expect(buildStackClass(FLOOR_ONLY_TOKEN, true)).toBe(FLOOR_ONLY_TOKEN);
    expect(buildStackClass('A', false)).toBe('A');
  });
});
