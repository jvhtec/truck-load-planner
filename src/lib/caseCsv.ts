import type { CaseSKU } from '../core/types';

export const CASE_IO_HEADERS = [
  'BoxName',
  'Count',
  'Color (HEX)',
  'Length',
  'Width',
  'Height',
  'Weight',
  'No Tilt',
  'No Rotate',
  'No Stack',
  'On floor',
] as const;

const FLOOR_ONLY_TOKEN = 'FLOOR_ONLY';

export interface CaseSheetRow {
  boxName: string;
  count: number;
  colorHex: string;
  length: number;
  width: number;
  height: number;
  weight: number;
  noTilt: boolean;
  noRotate: boolean;
  noStack: boolean;
  onFloor: boolean;
}

function parseBoolean(raw: string): boolean {
  const value = raw.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'y';
}

function escapeCsv(value: string | number | boolean): string {
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  cells.push(current.trim());
  return cells;
}

export function parseCaseCsv(csvText: string): CaseSheetRow[] {
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const header = splitCsvLine(lines[0]);
  const headerMap = new Map<string, number>();
  header.forEach((name, index) => headerMap.set(name.trim().toLowerCase(), index));

  const required = CASE_IO_HEADERS.map((h) => h.toLowerCase());
  for (const col of required) {
    if (!headerMap.has(col)) {
      throw new Error(`Missing required column: ${col}`);
    }
  }

  const rows: CaseSheetRow[] = [];
  for (let lineIdx = 1; lineIdx < lines.length; lineIdx += 1) {
    const row = splitCsvLine(lines[lineIdx]);
    const get = (col: string) => row[headerMap.get(col.toLowerCase()) ?? -1] ?? '';

    const boxName = get('BoxName');
    if (!boxName) continue;

    rows.push({
      boxName,
      count: Math.max(0, Number(get('Count') || 0)),
      colorHex: get('Color (HEX)') || '#6366f1',
      length: Number(get('Length') || 0),
      width: Number(get('Width') || 0),
      height: Number(get('Height') || 0),
      weight: Number(get('Weight') || 0),
      noTilt: parseBoolean(get('No Tilt')),
      noRotate: parseBoolean(get('No Rotate')),
      noStack: parseBoolean(get('No Stack')),
      onFloor: parseBoolean(get('On floor')),
    });
  }

  return rows;
}

export function formatCaseCsv(cases: CaseSKU[], quantities: Record<string, number>): string {
  const lines: string[] = [CASE_IO_HEADERS.join(',')];
  for (const c of cases) {
    const noRotate = c.allowedYaw.length <= 1;
    const noTilt = !c.tiltAllowed;
    const noStack = !c.canBeBase || c.maxLoadAboveKg <= 0;
    const onFloor = (c.stackClass ?? '').toUpperCase().split(/\s*[,;|]\s*/).includes(FLOOR_ONLY_TOKEN);

    const row = [
      c.name,
      Math.max(0, Number(quantities[c.skuId] ?? 0)),
      c.color ?? '#6366f1',
      c.dims.l,
      c.dims.w,
      c.dims.h,
      c.weightKg,
      noTilt,
      noRotate,
      noStack,
      onFloor,
    ].map(escapeCsv).join(',');

    lines.push(row);
  }

  return `${lines.join('\n')}\n`;
}

export function buildStackClass(base: string | undefined, onFloor: boolean): string | undefined {
  const parts = (base ?? '').split(/\s*[,;|]\s*/).filter(Boolean);
  const normalized = new Set(parts.map((v) => v.toUpperCase()));

  if (onFloor) {
    normalized.add(FLOOR_ONLY_TOKEN);
  } else {
    normalized.delete(FLOOR_ONLY_TOKEN);
  }

  if (normalized.size === 0) return undefined;
  return [...normalized].join(',');
}

export function sanitizeSkuId(name: string, existing: Set<string>): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'box';

  let next = base;
  let count = 1;
  while (existing.has(next)) {
    count += 1;
    next = `${base}-${count}`;
  }
  existing.add(next);
  return next;
}
