import { useState, useEffect, useCallback } from 'react';
import type {
  TruckType,
  CaseSKU,
  CaseInstance,
  LoadMetrics,
  ValidationResult,
  ValidationError,
  Yaw,
} from '../core/types';
import {
  createInstance,
  computeMetrics,
  validatePlacement,
  autoPack,
  computeOrientedAABB,
  aabbOverlap,
} from '../core';
import { SupportGraph } from '../core/support';
import { SpatialIndex } from '../core/spatial';
import { supabase } from '../lib/supabase';

interface DbTruck {
  id: string;
  truck_id: string;
  name: string;
  inner_length_mm: number;
  inner_width_mm: number;
  inner_height_mm: number;
  empty_weight_kg: number;
  axle_front_x_mm: number;
  axle_rear_x_mm: number;
  axle_max_front_kg: number;
  axle_max_rear_kg: number;
  max_lr_imbalance_percent: number;
  obstacles: any;
}

interface DbCaseSku {
  id: string;
  sku_id: string;
  name: string;
  length_mm: number;
  width_mm: number;
  height_mm: number;
  weight_kg: number;
  upright_only: boolean;
  allowed_yaw: number[];
  can_be_base: boolean;
  top_contact_allowed: boolean;
  max_load_above_kg: number;
  min_support_ratio: number;
  stack_class: string | null;
  color_hex: string | null;
  tilt_allowed: boolean | null;
  is_container: boolean | string | number | null;
}

interface DbLoadPlan {
  id: string;
  name: string;
  truck_id: string;
  instances: any;
  total_weight_kg: number;
  status: string;
  created_at: string;
}

function dbToTruck(db: DbTruck): TruckType {
  return {
    truckId: db.truck_id,
    name: db.name,
    innerDims: {
      x: db.inner_length_mm,
      y: db.inner_width_mm,
      z: db.inner_height_mm,
    },
    emptyWeightKg: db.empty_weight_kg,
    axle: {
      frontX: db.axle_front_x_mm,
      rearX: db.axle_rear_x_mm,
      maxFrontKg: db.axle_max_front_kg,
      maxRearKg: db.axle_max_rear_kg,
    },
    balance: {
      maxLeftRightPercentDiff: db.max_lr_imbalance_percent,
    },
    obstacles: db.obstacles || [],
  };
}

function parseDbBoolean(value: unknown): boolean {
  if (value === true || value === false) return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === 't' || normalized === '1' || normalized === 'yes' || normalized === 'y') {
      return true;
    }
  }
  return false;
}

function dbToCaseSku(db: DbCaseSku): CaseSKU {
  return {
    skuId: db.sku_id,
    name: db.name,
    dims: {
      l: db.length_mm,
      w: db.width_mm,
      h: db.height_mm,
    },
    weightKg: db.weight_kg,
    uprightOnly: db.upright_only,
    allowedYaw: db.allowed_yaw as Yaw[],
    canBeBase: db.can_be_base,
    topContactAllowed: db.top_contact_allowed,
    maxLoadAboveKg: db.max_load_above_kg,
    minSupportRatio: db.min_support_ratio,
    stackClass: db.stack_class || undefined,
    color: db.color_hex || undefined,
    tiltAllowed: db.tilt_allowed ?? false,
    isContainer: parseDbBoolean(db.is_container),
  };
}

export interface SavedPlan {
  id: string;
  name: string;
  truckId: string;
  status: string;
  totalWeightKg: number;
  createdAt: string;
}

export interface PlannerState {
  trucks: TruckType[];
  cases: CaseSKU[];
  truck: TruckType | null;
  skus: Map<string, CaseSKU>;
  instances: CaseInstance[];
  metrics: LoadMetrics | null;
  selectedInstanceId: string | null;
  validation: ValidationResult | null;
  loading: boolean;
  error: string | null;
}

interface CreateTruckInput {
  truckId: string;
  name: string;
  innerDims: { x: number; y: number; z: number };
  emptyWeightKg: number;
  axle: { frontX: number; rearX: number; maxFrontKg: number; maxRearKg: number };
  maxLeftRightPercentDiff: number;
}

interface UpdateTruckInput {
  name: string;
  innerDims: { x: number; y: number; z: number };
  emptyWeightKg: number;
  axle: { frontX: number; rearX: number; maxFrontKg: number; maxRearKg: number };
  maxLeftRightPercentDiff: number;
}

interface CreateCaseInput {
  skuId: string;
  name: string;
  dims: { l: number; w: number; h: number };
  weightKg: number;
  uprightOnly: boolean;
  allowedYaw: Yaw[];
  canBeBase: boolean;
  topContactAllowed: boolean;
  maxLoadAboveKg: number;
  minSupportRatio: number;
  stackClass?: string;
  color?: string;
  tiltAllowed?: boolean;
  isContainer?: boolean;
}

const AUTOPLACE_STEP_MM = 100;
const AUTOPLACE_COMPACTION_STEPS = [100, 20, 5, 1];

function normalizeTilt(input?: { x?: number; y?: number } | null): { y: 0 | 90 } {
  const y = input?.y === 90 ? 90 : 0;
  if (y === 90) return { y: 90 };
  return { y: 0 };
}

function buildScanValues(maxCoord: number): number[] {
  const values: number[] = [];
  for (let v = 0; v <= maxCoord; v += AUTOPLACE_STEP_MM) {
    values.push(v);
  }
  if (values.length === 0 || values[values.length - 1] !== maxCoord) {
    values.push(maxCoord);
  }
  return values;
}

function compactAutoPlacedCandidate(
  initial: CaseInstance,
  sku: CaseSKU,
  validator: (candidate: CaseInstance) => boolean
): CaseInstance {
  let current = initial;

  const compactMin = (axis: 'x' | 'y') => {
    for (const step of AUTOPLACE_COMPACTION_STEPS) {
      let moved = true;
      while (moved) {
        const nextCoord = current.position[axis] - step;
        if (nextCoord < 0) {
          moved = false;
          continue;
        }

        const nextPos = { ...current.position, [axis]: nextCoord };
        const next: CaseInstance = {
          ...current,
          position: nextPos,
          aabb: computeOrientedAABB(sku, nextPos, current.yaw, normalizeTilt(current.tilt)),
        };
        if (validator(next)) {
          current = next;
        } else {
          moved = false;
        }
      }
    }
  };

  const MAX_PASSES = 4;
  for (let i = 0; i < MAX_PASSES; i++) {
    const before = current.position;
    compactMin('x');
    compactMin('y');
    compactMin('x');

    if (
      current.position.x === before.x &&
      current.position.y === before.y &&
      current.position.z === before.z
    ) {
      break;
    }
  }

  return current;
}

export interface PlannerActions {
  setTruck: (truck: TruckType) => void;
  placeCase: (skuId: string, _position: { x: number; y: number; z: number }, yaw: Yaw) => ValidationResult;
  autoPlaceInstances: (instanceIds: string[]) => ValidationResult;
  removeCase: (instanceId: string) => void;
  updateInstance: (
    instanceId: string,
    updates: {
      position?: { x: number; y: number; z: number };
      yaw?: Yaw;
      tilt?: { y: number };
    }
  ) => ValidationResult;
  swapInstancePositions: (sourceId: string, targetId: string) => ValidationResult;
  runAutoPack: (skuQuantities: Map<string, number>) => void;
  clearAll: () => void;
  selectInstance: (instanceId: string | null) => void;
  savePlan: (name: string) => Promise<void>;
  loadPlan: (planId: string) => Promise<void>;
  listPlans: () => Promise<SavedPlan[]>;
  createTruck: (input: CreateTruckInput) => Promise<void>;
  updateTruck: (truckId: string, input: UpdateTruckInput) => Promise<void>;
  deleteTruck: (truckId: string) => Promise<void>;
  createCase: (input: CreateCaseInput) => Promise<void>;
  updateCase: (skuId: string, updates: Partial<CreateCaseInput>) => Promise<void>;
  deleteCase: (skuId: string) => Promise<void>;
}

function buildValidationContext(instances: CaseInstance[], skus: Map<string, CaseSKU>) {
  const skuWeights = new Map<string, number>();
  skus.forEach((sku, id) => skuWeights.set(id, sku.weightKg));

  const supportGraph = new SupportGraph(skuWeights);
  const spatialIndex = new SpatialIndex();
  for (const inst of instances) {
    supportGraph.addInstance(inst, instances);
    spatialIndex.add(inst.id, inst.aabb);
  }

  return { supportGraph, spatialIndex, skuWeights };
}

function inTruckBounds(aabb: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }, truck: TruckType): boolean {
  return (
    aabb.min.x >= 0 &&
    aabb.min.y >= 0 &&
    aabb.min.z >= 0 &&
    aabb.max.x <= truck.innerDims.x &&
    aabb.max.y <= truck.innerDims.y &&
    aabb.max.z <= truck.innerDims.z
  );
}

function findMagneticSnapCandidate(
  candidate: CaseInstance,
  sku: CaseSKU,
  truck: TruckType,
  others: CaseInstance[],
  skus: Map<string, CaseSKU>
): CaseInstance | null {
  const sizeX = candidate.aabb.max.x - candidate.aabb.min.x;
  const sizeY = candidate.aabb.max.y - candidate.aabb.min.y;
  const maxX = Math.max(0, truck.innerDims.x - sizeX);
  const maxY = Math.max(0, truck.innerDims.y - sizeY);
  const requested = candidate.position;

  const blockers = others.filter(other => aabbOverlap(candidate.aabb, other.aabb));
  if (blockers.length === 0) return null;

  const seen = new Set<string>();
  const positions: Array<{ x: number; y: number; z: number }> = [];
  const push = (xRaw: number, yRaw: number, zRaw: number) => {
    const pos = {
      x: Math.max(0, Math.min(Math.round(xRaw), maxX)),
      y: Math.max(0, Math.min(Math.round(yRaw), maxY)),
      z: Math.max(0, Math.round(zRaw)),
    };
    const key = `${pos.x}|${pos.y}|${pos.z}`;
    if (seen.has(key)) return;
    seen.add(key);
    positions.push(pos);
  };

  // Candidate positions around each blocking box:
  // - single-axis snaps (left/right/front/back)
  // - corner snaps to resolve two-axis overlaps
  for (const blocker of blockers) {
    const leftX = blocker.aabb.min.x - sizeX;
    const rightX = blocker.aabb.max.x;
    const frontY = blocker.aabb.min.y - sizeY;
    const backY = blocker.aabb.max.y;
    const z = requested.z;

    push(leftX, requested.y, z);
    push(rightX, requested.y, z);
    push(requested.x, frontY, z);
    push(requested.x, backY, z);

    push(leftX, frontY, z);
    push(leftX, backY, z);
    push(rightX, frontY, z);
    push(rightX, backY, z);
  }

  let best: { dist: number; inst: CaseInstance } | null = null;
  for (const pos of positions) {
    const snapped: CaseInstance = {
      ...candidate,
      position: pos,
      aabb: computeOrientedAABB(sku, pos, candidate.yaw, normalizeTilt(candidate.tilt)),
    };
    const { supportGraph, spatialIndex, skuWeights } = buildValidationContext(others, skus);
    const validation = validatePlacement(snapped, {
      truck,
      skus,
      instances: others,
      supportGraph,
      skuWeights,
      spatialIndex,
    });
    if (!validation.valid) continue;

    const dx = snapped.position.x - requested.x;
    const dy = snapped.position.y - requested.y;
    const dz = snapped.position.z - requested.z;
    const dist = dx * dx + dy * dy + dz * dz;
    if (!best || dist < best.dist) {
      best = { dist, inst: snapped };
    }
  }

  return best?.inst ?? null;
}

export function usePlanner(): [PlannerState, PlannerActions] {
  const [state, setState] = useState<PlannerState>(() => ({
    trucks: [],
    cases: [],
    truck: null,
    skus: new Map(),
    instances: [],
    metrics: null,
    selectedInstanceId: null,
    validation: null,
    loading: true,
    error: null,
  }));

  useEffect(() => {
    async function loadData() {
      try {
        const [trucksRes, casesRes] = await Promise.all([
          supabase.from('trucks').select('*'),
          supabase.from('case_skus').select('*'),
        ]);

        if (trucksRes.error) throw trucksRes.error;
        if (casesRes.error) throw casesRes.error;

        const trucks = (trucksRes.data as DbTruck[]).map(dbToTruck);
        const cases = (casesRes.data as DbCaseSku[]).map(dbToCaseSku);
        const skus = new Map(cases.map(c => [c.skuId, c]));

        setState(prev => ({ ...prev, trucks, cases, skus, loading: false }));
      } catch (error: any) {
        setState(prev => ({ ...prev, loading: false, error: error.message || 'Failed to load data' }));
      }
    }

    loadData();
  }, []);

  const updateMetrics = useCallback((instances: CaseInstance[], truck: TruckType | null, skus: Map<string, CaseSKU>) => {
    if (!truck) return null;
    const skuWeights = new Map<string, number>();
    skus.forEach((sku, id) => skuWeights.set(id, sku.weightKg));
    return computeMetrics(instances.filter(i => !i.staged), skuWeights, truck);
  }, []);

  const setTruck = useCallback((truck: TruckType) => {
    setState(prev => ({
      ...prev,
      truck,
      instances: [],
      metrics: updateMetrics([], truck, prev.skus),
      validation: null,
      selectedInstanceId: null,
    }));
  }, [updateMetrics]);

  const placeCase = useCallback((skuId: string, _position: { x: number; y: number; z: number }, yaw: Yaw): ValidationResult => {
    let result: ValidationResult = { valid: false, violations: [] };

    setState(prev => {
      if (!prev.truck) {
        result = { valid: false, violations: ['OUT_OF_BOUNDS'], details: { error: 'No truck selected' } };
        return prev;
      }

      const sku = prev.skus.get(skuId);
      if (!sku) {
        result = { valid: false, violations: ['INVALID_ORIENTATION'], details: { error: `Unknown SKU: ${skuId}` } };
        return prev;
      }

      const stagedCount = prev.instances.filter(i => i.staged).length;
      const stagedCol = stagedCount % 4;
      const stagedRow = Math.floor(stagedCount / 4);
      const stagedX = stagedCol * (sku.dims.l + 150);
      const stagedY = -((stagedRow + 1) * (sku.dims.w + 250));
      const stagedPosition = { x: stagedX, y: stagedY, z: 0 };
      const candidate = createInstance(`${skuId}-${Date.now()}`, sku, stagedPosition, yaw);
      const staged = { ...candidate, staged: true, tilt: { y: 0 } as const, aabb: computeOrientedAABB(sku, stagedPosition, yaw, { y: 0 }) };
      const newInstances = [...prev.instances, staged];
      result = { valid: true, violations: [] };
      return {
        ...prev,
        instances: newInstances,
        metrics: updateMetrics(newInstances, prev.truck, prev.skus),
        validation: null,
      };
    });

    return result;
  }, [updateMetrics]);

  const updateInstance = useCallback((
    instanceId: string,
    updates: { position?: { x: number; y: number; z: number }; yaw?: Yaw; tilt?: { y: number } }
  ): ValidationResult => {
    let result: ValidationResult = { valid: false, violations: [] };

    setState(prev => {
      if (!prev.truck) return prev;
      const current = prev.instances.find(i => i.id === instanceId);
      if (!current) return prev;
      const sku = prev.skus.get(current.skuId);
      if (!sku) return prev;

      const candidate: CaseInstance = {
        ...current,
        position: updates.position ?? current.position,
        yaw: updates.yaw ?? current.yaw,
        tilt: normalizeTilt(updates.tilt ?? current.tilt),
      };
      candidate.aabb = computeOrientedAABB(sku, candidate.position, candidate.yaw, candidate.tilt);

      if (current.staged && !inTruckBounds(candidate.aabb, prev.truck)) {
        result = { valid: true, violations: [] };
        const stagedUpdate = { ...candidate, staged: true };
        const stagedInstances = prev.instances.map(i => (i.id === instanceId ? stagedUpdate : i));
        return {
          ...prev,
          instances: stagedInstances,
          metrics: updateMetrics(stagedInstances, prev.truck, prev.skus),
          validation: null,
        };
      }

      const placedWithoutCurrent = prev.instances.filter(i => !i.staged && i.id !== instanceId);
      const { supportGraph, spatialIndex, skuWeights } = buildValidationContext(placedWithoutCurrent, prev.skus);
      const validation = validatePlacement(candidate, {
        truck: prev.truck,
        skus: prev.skus,
        instances: placedWithoutCurrent,
        supportGraph,
        skuWeights,
        spatialIndex,
      });
      result = validation;

      if (!validation.valid) {
        if (updates.position && validation.violations.includes('COLLISION')) {
          const snapped = findMagneticSnapCandidate(candidate, sku, prev.truck, placedWithoutCurrent, prev.skus);
          if (snapped) {
            result = { valid: true, violations: [] };
            const movedInside = { ...snapped, staged: false };
            const snappedInstances = prev.instances.map(i => (i.id === instanceId ? movedInside : i));
            return {
              ...prev,
              instances: snappedInstances,
              metrics: updateMetrics(snappedInstances, prev.truck, prev.skus),
              validation: null,
            };
          }
        }
        return { ...prev, validation };
      }

      const movedInside = { ...candidate, staged: false };
      const newInstances = prev.instances.map(i => (i.id === instanceId ? movedInside : i));
      return {
        ...prev,
        instances: newInstances,
        metrics: updateMetrics(newInstances, prev.truck, prev.skus),
        validation: null,
      };
    });

    return result;
  }, [updateMetrics]);

  const autoPlaceInstances = useCallback((instanceIds: string[]): ValidationResult => {
    let result: ValidationResult = { valid: false, violations: [] };

    setState(prev => {
      if (!prev.truck || instanceIds.length === 0) return prev;
      const truck = prev.truck;

      const ids = new Set(instanceIds);
      const stagedToPlace = prev.instances.filter(i => i.staged && ids.has(i.id));
      if (stagedToPlace.length === 0) {
        result = { valid: false, violations: ['INVALID_ORIENTATION'], details: { error: 'No staged items selected' } };
        return prev;
      }

      const allInstances = [...prev.instances];
      const failed: string[] = [];
      const placedNow: CaseInstance[] = allInstances.filter(i => !i.staged);

      for (const staged of stagedToPlace) {
        const sku = prev.skus.get(staged.skuId);
        if (!sku) {
          failed.push(staged.id);
          continue;
        }

        let placedCandidate: CaseInstance | null = null;
        const zLevels = Array.from(new Set([0, ...placedNow.map(i => i.aabb.max.z)])).sort((a, b) => a - b);

        for (const z of zLevels) {
          if (placedCandidate) break;
          const maxX = Math.max(0, truck.innerDims.x - (staged.aabb.max.x - staged.aabb.min.x));
          const maxY = Math.max(0, truck.innerDims.y - (staged.aabb.max.y - staged.aabb.min.y));
          const xValues = buildScanValues(maxX);
          const yValues = buildScanValues(maxY);
          const { supportGraph, spatialIndex, skuWeights } = buildValidationContext(placedNow, prev.skus);
          const isValid = (candidate: CaseInstance) => validatePlacement(candidate, {
            truck,
            skus: prev.skus,
            instances: placedNow,
            supportGraph,
            skuWeights,
            spatialIndex,
          }).valid;

          for (const x of xValues) {
            if (placedCandidate) break;
            for (const y of yValues) {
              const candidate: CaseInstance = {
                ...staged,
                position: { x, y, z },
                aabb: computeOrientedAABB(sku, { x, y, z }, staged.yaw, normalizeTilt(staged.tilt)),
                staged: false,
              };
              if (isValid(candidate)) {
                placedCandidate = compactAutoPlacedCandidate(candidate, sku, isValid);
                break;
              }
            }
          }
        }

        if (!placedCandidate) {
          failed.push(staged.id);
          continue;
        }

        const ix = allInstances.findIndex(i => i.id === staged.id);
        if (ix >= 0) allInstances[ix] = placedCandidate;
        placedNow.push(placedCandidate);
      }

      result = failed.length === 0
        ? { valid: true, violations: [] }
        : { valid: false, violations: ['COLLISION'], details: { failedIds: failed } };

      return {
        ...prev,
        instances: allInstances,
        metrics: updateMetrics(allInstances, prev.truck, prev.skus),
        validation: failed.length === 0 ? null : result,
      };
    });

    return result;
  }, [updateMetrics]);

  const swapInstancePositions = useCallback((sourceId: string, targetId: string): ValidationResult => {
    let result: ValidationResult = { valid: false, violations: [] };

    setState(prev => {
      if (!prev.truck || sourceId === targetId) return prev;

      const source = prev.instances.find(i => i.id === sourceId);
      const target = prev.instances.find(i => i.id === targetId);
      if (!source || !target) return prev;
      if (source.staged || target.staged) return prev;

      const sourceUpdated = { ...source, position: target.position };
      const targetUpdated = { ...target, position: source.position };
      const sourceSku = prev.skus.get(source.skuId);
      const targetSku = prev.skus.get(target.skuId);
      if (!sourceSku || !targetSku) return prev;

      sourceUpdated.aabb = computeOrientedAABB(sourceSku, sourceUpdated.position, sourceUpdated.yaw, normalizeTilt(sourceUpdated.tilt));
      targetUpdated.aabb = computeOrientedAABB(targetSku, targetUpdated.position, targetUpdated.yaw, normalizeTilt(targetUpdated.tilt));

      const others = prev.instances.filter(i => i.id !== sourceId && i.id !== targetId);
      const placedOthers = others.filter(i => !i.staged);
      const { supportGraph, spatialIndex, skuWeights } = buildValidationContext(placedOthers, prev.skus);

      const v1 = validatePlacement(sourceUpdated, {
        truck: prev.truck,
        skus: prev.skus,
        instances: placedOthers,
        supportGraph,
        skuWeights,
        spatialIndex,
      });
      if (!v1.valid) {
        result = v1;
        return { ...prev, validation: v1 };
      }

      supportGraph.addInstance(sourceUpdated, [...placedOthers, sourceUpdated]);
      spatialIndex.add(sourceUpdated.id, sourceUpdated.aabb);

      const v2 = validatePlacement(targetUpdated, {
        truck: prev.truck,
        skus: prev.skus,
        instances: [...placedOthers, sourceUpdated],
        supportGraph,
        skuWeights,
        spatialIndex,
      });
      if (!v2.valid) {
        result = v2;
        return { ...prev, validation: v2 };
      }

      result = { valid: true, violations: [] };
      const newInstances = prev.instances.map(i => {
        if (i.id === sourceId) return sourceUpdated;
        if (i.id === targetId) return targetUpdated;
        return i;
      });

      return {
        ...prev,
        instances: newInstances,
        metrics: updateMetrics(newInstances, prev.truck, prev.skus),
        validation: null,
      };
    });

    return result;
  }, [updateMetrics]);

  const removeCase = useCallback((instanceId: string) => {
    setState(prev => {
      if (!prev.truck) return prev;
      const newInstances = prev.instances.filter(i => i.id !== instanceId);
      return {
        ...prev,
        instances: newInstances,
        metrics: updateMetrics(newInstances, prev.truck, prev.skus),
        selectedInstanceId: prev.selectedInstanceId === instanceId ? null : prev.selectedInstanceId,
      };
    });
  }, [updateMetrics]);

  const runAutoPack = useCallback((skuQuantities: Map<string, number>) => {
    setState(prev => {
      if (!prev.truck) return prev;
      const skus = Array.from(prev.skus.values());
      const result = autoPack(prev.truck, skus, skuQuantities);
      const placed = result.placed.map(inst => ({ ...inst, tilt: { y: 0 } as const }));
      const staged = prev.instances.filter(i => i.staged);

      return {
        ...prev,
        instances: [...staged, ...placed],
        metrics: result.metrics,
        validation: result.unplaced.length > 0
          ? {
              valid: false,
              violations: (Object.entries(result.reasonSummary)
                .sort((a, b) => b[1] - a[1])
                .map(([k]) => k)) as ValidationError[],
              details: { unplaced: result.unplaced, reasons: result.reasonSummary }
            }
          : null,
      };
    });
  }, []);

  const clearAll = useCallback(() => {
    setState(prev => ({
      ...prev,
      instances: [],
      metrics: prev.truck ? updateMetrics([], prev.truck, prev.skus) : null,
      selectedInstanceId: null,
      validation: null,
    }));
  }, [updateMetrics]);

  const selectInstance = useCallback((instanceId: string | null) => {
    setState(prev => ({ ...prev, selectedInstanceId: instanceId }));
  }, []);

  const savePlan = useCallback(async (name: string) => {
    const currentState = state;
    if (!currentState.truck) return;

    const { data: truckRow, error: truckError } = await supabase
      .from('trucks')
      .select('id')
      .eq('truck_id', currentState.truck.truckId)
      .single();

    if (truckError || !truckRow) {
      setState(prev => ({ ...prev, error: 'Could not find truck in database' }));
      return;
    }

    const { error: saveError } = await supabase
      .from('load_plans')
      .insert({
        name,
        truck_id: truckRow.id,
        instances: currentState.instances
        .filter(inst => !inst.staged)
        .map(inst => ({
          id: inst.id,
          skuId: inst.skuId,
          position: inst.position,
          yaw: inst.yaw,
          tilt: normalizeTilt(inst.tilt),
        })),
        total_weight_kg: currentState.metrics?.totalWeightKg ?? 0,
        front_axle_kg: currentState.metrics?.frontAxleKg ?? 0,
        rear_axle_kg: currentState.metrics?.rearAxleKg ?? 0,
        left_weight_kg: currentState.metrics?.leftWeightKg ?? 0,
        right_weight_kg: currentState.metrics?.rightWeightKg ?? 0,
        lr_imbalance_percent: currentState.metrics?.lrImbalancePercent ?? 0,
        max_stack_height_mm: currentState.metrics?.maxStackHeightMm ?? 0,
        status: 'validated',
      });

    if (saveError) {
      setState(prev => ({ ...prev, error: `Save failed: ${saveError.message}` }));
    }
  }, [state]);

  const loadPlan = useCallback(async (planId: string) => {
    const { data, error: loadError } = await supabase
      .from('load_plans')
      .select('*, trucks!inner(truck_id)')
      .eq('id', planId)
      .single();

    if (loadError || !data) {
      setState(prev => ({ ...prev, error: 'Could not load plan' }));
      return;
    }

    const plan = data as DbLoadPlan & { trucks: { truck_id: string } };
    const truckId = plan.trucks.truck_id;

    setState(prev => {
      const truck = prev.trucks.find(t => t.truckId === truckId);
      if (!truck) return { ...prev, error: 'Truck not found for this plan' };

      const savedInstances = plan.instances as Array<{
        id: string;
        skuId: string;
        position: { x: number; y: number; z: number };
        yaw: Yaw;
        tilt?: { y: number };
      }>;

      const instances: CaseInstance[] = savedInstances.map(saved => {
        const sku = prev.skus.get(saved.skuId);
        if (!sku) {
          throw new Error(`Failed to load plan: SKU ${saved.skuId} is not in current catalog.`);
        }
        return {
          id: saved.id,
          skuId: saved.skuId,
          position: saved.position,
          yaw: saved.yaw,
          tilt: normalizeTilt(saved.tilt),
          staged: false,
          aabb: computeOrientedAABB(sku, saved.position, saved.yaw, normalizeTilt(saved.tilt)),
        };
      });

      return {
        ...prev,
        truck,
        instances,
        metrics: updateMetrics(instances, truck, prev.skus),
        validation: null,
        error: null,
      };
    });
  }, [updateMetrics]);

  const listPlans = useCallback(async (): Promise<SavedPlan[]> => {
    const { data, error: listError } = await supabase
      .from('load_plans')
      .select('id, name, truck_id, status, total_weight_kg, created_at')
      .order('created_at', { ascending: false });

    if (listError || !data) return [];

    return (data as DbLoadPlan[]).map(p => ({
      id: p.id,
      name: p.name,
      truckId: p.truck_id,
      status: p.status,
      totalWeightKg: p.total_weight_kg,
      createdAt: p.created_at,
    }));
  }, []);

  const createTruck = useCallback(async (input: CreateTruckInput) => {
    const { error } = await supabase.from('trucks').insert({
      truck_id: input.truckId,
      name: input.name,
      inner_length_mm: input.innerDims.x,
      inner_width_mm: input.innerDims.y,
      inner_height_mm: input.innerDims.z,
      empty_weight_kg: input.emptyWeightKg,
      axle_front_x_mm: input.axle.frontX,
      axle_rear_x_mm: input.axle.rearX,
      axle_max_front_kg: input.axle.maxFrontKg,
      axle_max_rear_kg: input.axle.maxRearKg,
      max_lr_imbalance_percent: input.maxLeftRightPercentDiff,
      obstacles: [],
    });

    if (error) throw error;

    setState(prev => {
      const truck: TruckType = {
        truckId: input.truckId,
        name: input.name,
        innerDims: input.innerDims,
        emptyWeightKg: input.emptyWeightKg,
        axle: input.axle,
        balance: { maxLeftRightPercentDiff: input.maxLeftRightPercentDiff },
        obstacles: [],
      };
      return { ...prev, trucks: [truck, ...prev.trucks] };
    });
  }, []);

  const updateTruck = useCallback(async (truckId: string, input: UpdateTruckInput) => {
    const { error } = await supabase.from('trucks').update({
      name: input.name,
      inner_length_mm: input.innerDims.x,
      inner_width_mm: input.innerDims.y,
      inner_height_mm: input.innerDims.z,
      empty_weight_kg: input.emptyWeightKg,
      axle_front_x_mm: input.axle.frontX,
      axle_rear_x_mm: input.axle.rearX,
      axle_max_front_kg: input.axle.maxFrontKg,
      axle_max_rear_kg: input.axle.maxRearKg,
      max_lr_imbalance_percent: input.maxLeftRightPercentDiff,
    }).eq('truck_id', truckId);
    if (error) throw error;

    setState(prev => {
      const trucks = prev.trucks.map(t => {
        if (t.truckId !== truckId) return t;
        return {
          ...t,
          name: input.name,
          innerDims: input.innerDims,
          emptyWeightKg: input.emptyWeightKg,
          axle: input.axle,
          balance: { maxLeftRightPercentDiff: input.maxLeftRightPercentDiff },
        };
      });
      const truck = prev.truck?.truckId === truckId
        ? trucks.find(t => t.truckId === truckId) ?? prev.truck
        : prev.truck;
      const nextTruck = truck ?? null;
      return {
        ...prev,
        trucks,
        truck: nextTruck,
        metrics: nextTruck ? updateMetrics(prev.instances, nextTruck, prev.skus) : prev.metrics,
      };
    });
  }, [updateMetrics]);

  const deleteTruck = useCallback(async (truckId: string) => {
    const { error } = await supabase
      .from('trucks')
      .delete()
      .eq('truck_id', truckId);
    if (error) throw error;

    setState(prev => {
      const trucks = prev.trucks.filter(t => t.truckId !== truckId);
      const removedSelected = prev.truck?.truckId === truckId;
      return {
        ...prev,
        trucks,
        truck: removedSelected ? null : prev.truck,
        instances: removedSelected ? [] : prev.instances,
        metrics: removedSelected ? null : prev.metrics,
        selectedInstanceId: removedSelected ? null : prev.selectedInstanceId,
        validation: removedSelected ? null : prev.validation,
      };
    });
  }, []);

  const createCase = useCallback(async (input: CreateCaseInput) => {
    const { error } = await supabase.from('case_skus').insert({
      sku_id: input.skuId,
      name: input.name,
      length_mm: input.dims.l,
      width_mm: input.dims.w,
      height_mm: input.dims.h,
      weight_kg: input.weightKg,
      upright_only: input.uprightOnly,
      allowed_yaw: input.allowedYaw,
      can_be_base: input.canBeBase,
      tilt_allowed: input.tiltAllowed ?? false,
      top_contact_allowed: input.topContactAllowed,
      max_load_above_kg: input.maxLoadAboveKg,
      min_support_ratio: input.minSupportRatio,
      stack_class: input.stackClass || null,
      color_hex: input.color || null,
      is_container: input.isContainer ?? false,
    });

    if (error) throw error;

    setState(prev => {
      const created: CaseSKU = {
        skuId: input.skuId,
        name: input.name,
        dims: input.dims,
        weightKg: input.weightKg,
        uprightOnly: input.uprightOnly,
        allowedYaw: input.allowedYaw,
        canBeBase: input.canBeBase,
        tiltAllowed: input.tiltAllowed ?? false,
        topContactAllowed: input.topContactAllowed,
        maxLoadAboveKg: input.maxLoadAboveKg,
        minSupportRatio: input.minSupportRatio,
        stackClass: input.stackClass,
        color: input.color,
        isContainer: input.isContainer ?? false,
      };
      const cases = [created, ...prev.cases];
      const skus = new Map(prev.skus);
      skus.set(created.skuId, created);
      return { ...prev, cases, skus };
    });
  }, []);



  const updateCase = useCallback(async (skuId: string, updates: Partial<CreateCaseInput>) => {
    const payload: Record<string, unknown> = {};
    if (updates.name !== undefined) payload.name = updates.name;
    if (updates.dims?.l !== undefined) payload.length_mm = updates.dims.l;
    if (updates.dims?.w !== undefined) payload.width_mm = updates.dims.w;
    if (updates.dims?.h !== undefined) payload.height_mm = updates.dims.h;
    if (updates.weightKg !== undefined) payload.weight_kg = updates.weightKg;
    if (updates.uprightOnly !== undefined) payload.upright_only = updates.uprightOnly;
    if (updates.allowedYaw !== undefined) payload.allowed_yaw = updates.allowedYaw;
    if (updates.canBeBase !== undefined) payload.can_be_base = updates.canBeBase;
    if (updates.tiltAllowed !== undefined) payload.tilt_allowed = updates.tiltAllowed;
    if (updates.topContactAllowed !== undefined) payload.top_contact_allowed = updates.topContactAllowed;
    if (updates.maxLoadAboveKg !== undefined) payload.max_load_above_kg = updates.maxLoadAboveKg;
    if (updates.minSupportRatio !== undefined) payload.min_support_ratio = updates.minSupportRatio;
    if (updates.stackClass !== undefined) payload.stack_class = updates.stackClass || null;
    if (updates.color !== undefined) payload.color_hex = updates.color || null;
    if (updates.isContainer !== undefined) payload.is_container = updates.isContainer;

    const { data, error } = await supabase
      .from('case_skus')
      .update(payload)
      .eq('sku_id', skuId)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new Error(`No case row updated for sku_id=${skuId}. Check RLS policy and table grants.`);
    }
    const updated = dbToCaseSku(data as DbCaseSku);

    setState(prev => {
      if (!prev.skus.has(skuId)) return prev;
      const cases = prev.cases.map(c => (c.skuId === skuId ? updated : c));
      const skus = new Map(prev.skus);
      skus.set(updated.skuId, updated);
      return { ...prev, cases, skus };
    });
  }, []);

  const deleteCase = useCallback(async (skuId: string) => {
    const { error } = await supabase
      .from('case_skus')
      .delete()
      .eq('sku_id', skuId);
    if (error) throw error;

    setState(prev => {
      const cases = prev.cases.filter(c => c.skuId !== skuId);
      const skus = new Map(prev.skus);
      skus.delete(skuId);
      const instances = prev.instances.filter(i => i.skuId !== skuId);
      const selectedRemoved = prev.selectedInstanceId
        ? prev.instances.some(i => i.id === prev.selectedInstanceId && i.skuId === skuId)
        : false;
      return {
        ...prev,
        cases,
        skus,
        instances,
        selectedInstanceId: selectedRemoved ? null : prev.selectedInstanceId,
        metrics: updateMetrics(instances, prev.truck, skus),
        validation: null,
      };
    });
  }, [updateMetrics]);

  return [state, {
    setTruck,
    placeCase,
    removeCase,
    updateInstance,
    swapInstancePositions,
    autoPlaceInstances,
    runAutoPack,
    clearAll,
    selectInstance,
    savePlan,
    loadPlan,
    listPlans,
    createTruck,
    updateTruck,
    deleteTruck,
    createCase,
    updateCase,
    deleteCase,
  }];
}
