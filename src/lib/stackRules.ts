import { FLOOR_ONLY_TOKEN } from './tokens';

export const TILT_REQUIRED_TOKEN = 'TILT_REQUIRED';
export const MAX_LEVEL_PREFIX = 'MAX_LEVEL_';

export interface StackRules {
  labels: string[];
  floorOnly: boolean;
  tiltRequired: boolean;
  maxStackLevel?: number;
}

export type StackToken = 'FLOOR_ONLY' | 'TILT_REQUIRED' | 'MAX_LEVEL';

function splitParts(raw?: string | null): string[] {
  return (raw ?? '')
    .split(/\s*[,;|]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function parseStackClass(raw?: string | null): StackRules {
  const labels: string[] = [];
  const labelSeen = new Set<string>();
  let floorOnly = false;
  let tiltRequired = false;
  let maxStackLevel: number | undefined;

  for (const part of splitParts(raw)) {
    const upper = part.toUpperCase();
    if (upper === FLOOR_ONLY_TOKEN) {
      floorOnly = true;
      continue;
    }
    if (upper === TILT_REQUIRED_TOKEN) {
      tiltRequired = true;
      continue;
    }
    const maxMatch = /^MAX_LEVEL_(\d+)$/.exec(upper);
    if (maxMatch) {
      const parsed = Number(maxMatch[1]);
      if (Number.isFinite(parsed) && parsed >= 1) {
        maxStackLevel = maxStackLevel === undefined ? parsed : Math.min(maxStackLevel, parsed);
      }
      continue;
    }

    if (labelSeen.has(upper)) continue;
    labelSeen.add(upper);
    labels.push(part);
  }

  return { labels, floorOnly, tiltRequired, maxStackLevel };
}

export function composeStackClass(input: StackRules): string | undefined {
  const labels: string[] = [];
  const labelSeen = new Set<string>();

  for (const raw of input.labels) {
    const label = raw.trim();
    if (!label) continue;
    const upper = label.toUpperCase();
    if (upper === FLOOR_ONLY_TOKEN || upper === TILT_REQUIRED_TOKEN || /^MAX_LEVEL_\d+$/.test(upper)) continue;
    if (labelSeen.has(upper)) continue;
    labelSeen.add(upper);
    labels.push(label);
  }

  const parts = [...labels];
  if (input.floorOnly) parts.push(FLOOR_ONLY_TOKEN);
  if (input.tiltRequired) parts.push(TILT_REQUIRED_TOKEN);
  if (input.maxStackLevel !== undefined) {
    const normalized = Math.max(1, Math.floor(input.maxStackLevel));
    parts.push(`${MAX_LEVEL_PREFIX}${normalized}`);
  }

  if (parts.length === 0) return undefined;
  return parts.join(',');
}

export function hasStackToken(raw: string | undefined | null, token: StackToken): boolean {
  const parsed = parseStackClass(raw);
  if (token === 'FLOOR_ONLY') return parsed.floorOnly;
  if (token === 'TILT_REQUIRED') return parsed.tiltRequired;
  return parsed.maxStackLevel !== undefined;
}
