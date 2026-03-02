import type { CaseSKU } from '../core/types';
import { composeStackClass, parseStackClass } from './stackRules';

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

function safeNumber(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
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
  let fieldQuoted = false;

  const pushCurrent = () => {
    cells.push(fieldQuoted ? current : current.trim());
    current = '';
    fieldQuoted = false;
  };

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (!inQuotes && current.trim().length === 0) {
        fieldQuoted = true;
      }
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      pushCurrent();
      continue;
    }

    current += ch;
  }

  pushCurrent();
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
  for (const [index, name] of header.entries()) {
    headerMap.set(name.trim().toLowerCase(), index);
  }

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
      count: Math.max(0, safeNumber(get('Count'))),
      colorHex: get('Color (HEX)') || '#6366f1',
      length: safeNumber(get('Length')),
      width: safeNumber(get('Width')),
      height: safeNumber(get('Height')),
      weight: safeNumber(get('Weight')),
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
    const noStack = !c.canBeBase || !c.topContactAllowed || c.maxLoadAboveKg <= 0;
    const onFloor = parseStackClass(c.stackClass).floorOnly;

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
  const parsed = parseStackClass(base);
  return composeStackClass({
    ...parsed,
    floorOnly: onFloor,
  });
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
