import { describe, expect, it } from 'vitest';
import {
  composeStackClass,
  hasStackToken,
  parseStackClass,
  TILT_REQUIRED_TOKEN,
} from '../../lib/stackRules';

describe('stackRules', () => {
  it('parses mixed labels and known tokens', () => {
    const parsed = parseStackClass('small, FLOOR_ONLY, max_level_2, fragile');
    expect(parsed.labels).toEqual(['small', 'fragile']);
    expect(parsed.floorOnly).toBe(true);
    expect(parsed.tiltRequired).toBe(false);
    expect(parsed.maxStackLevel).toBe(2);
  });

  it('parses tokens case-insensitively', () => {
    const parsed = parseStackClass(`floor_only, ${TILT_REQUIRED_TOKEN.toLowerCase()}, Max_Level_3`);
    expect(parsed.floorOnly).toBe(true);
    expect(parsed.tiltRequired).toBe(true);
    expect(parsed.maxStackLevel).toBe(3);
  });

  it('ignores malformed max-level tokens', () => {
    const parsed = parseStackClass('MAX_LEVEL_X,MAX_LEVEL_0,MAX_LEVEL_-2');
    expect(parsed.maxStackLevel).toBeUndefined();
  });

  it('composes canonical output with dedupe and fixed token order', () => {
    const composed = composeStackClass({
      labels: ['small', 'Small', 'fragile'],
      floorOnly: true,
      tiltRequired: true,
      maxStackLevel: 2,
    });
    expect(composed).toBe('small,fragile,FLOOR_ONLY,TILT_REQUIRED,MAX_LEVEL_2');
  });

  it('supports token presence checks', () => {
    expect(hasStackToken('tiny,FLOOR_ONLY', 'FLOOR_ONLY')).toBe(true);
    expect(hasStackToken('tiny,max_level_4', 'MAX_LEVEL')).toBe(true);
    expect(hasStackToken('tiny', 'TILT_REQUIRED')).toBe(false);
  });
});
