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
  computeAABB,
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
}

export interface PlannerActions {
  setTruck: (truck: TruckType) => void;
  placeCase: (skuId: string, position: { x: number; y: number; z: number }, yaw: Yaw) => ValidationResult;
  removeCase: (instanceId: string) => void;
  updateInstance: (
    instanceId: string,
    updates: {
      position?: { x: number; y: number; z: number };
      yaw?: Yaw;
      tilt?: { x: number; y: number };
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
  createCase: (input: CreateCaseInput) => Promise<void>;
  updateCase: (skuId: string, updates: Partial<CreateCaseInput>) => Promise<void>;
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
    return computeMetrics(instances, skuWeights, truck);
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

  const placeCase = useCallback((skuId: string, position: { x: number; y: number; z: number }, yaw: Yaw): ValidationResult => {
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

      const candidate = createInstance(`${skuId}-${Date.now()}`, sku, position, yaw);
      const { supportGraph, spatialIndex, skuWeights } = buildValidationContext(prev.instances, prev.skus);
      const validation = validatePlacement(candidate, {
        truck: prev.truck,
        skus: prev.skus,
        instances: prev.instances,
        supportGraph,
        skuWeights,
        spatialIndex,
      });

      result = validation;
      if (!validation.valid) return { ...prev, validation };

      const newInstances = [...prev.instances, { ...candidate, tilt: { x: 0, y: 0 } }];
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
    updates: { position?: { x: number; y: number; z: number }; yaw?: Yaw; tilt?: { x: number; y: number } }
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
        tilt: updates.tilt ?? current.tilt ?? { x: 0, y: 0 },
      };
      candidate.aabb = computeAABB(sku, candidate.position, candidate.yaw);

      const withoutCurrent = prev.instances.filter(i => i.id !== instanceId);
      const { supportGraph, spatialIndex, skuWeights } = buildValidationContext(withoutCurrent, prev.skus);
      const validation = validatePlacement(candidate, {
        truck: prev.truck,
        skus: prev.skus,
        instances: withoutCurrent,
        supportGraph,
        skuWeights,
        spatialIndex,
      });
      result = validation;

      if (!validation.valid) return { ...prev, validation };

      const newInstances = prev.instances.map(i => (i.id === instanceId ? candidate : i));
      return {
        ...prev,
        instances: newInstances,
        metrics: updateMetrics(newInstances, prev.truck, prev.skus),
        validation: null,
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

      const sourceUpdated = { ...source, position: target.position };
      const targetUpdated = { ...target, position: source.position };
      const sourceSku = prev.skus.get(source.skuId);
      const targetSku = prev.skus.get(target.skuId);
      if (!sourceSku || !targetSku) return prev;

      sourceUpdated.aabb = computeAABB(sourceSku, sourceUpdated.position, sourceUpdated.yaw);
      targetUpdated.aabb = computeAABB(targetSku, targetUpdated.position, targetUpdated.yaw);

      const others = prev.instances.filter(i => i.id !== sourceId && i.id !== targetId);
      const { supportGraph, spatialIndex, skuWeights } = buildValidationContext(others, prev.skus);

      const v1 = validatePlacement(sourceUpdated, {
        truck: prev.truck,
        skus: prev.skus,
        instances: others,
        supportGraph,
        skuWeights,
        spatialIndex,
      });
      if (!v1.valid) {
        result = v1;
        return { ...prev, validation: v1 };
      }

      supportGraph.addInstance(sourceUpdated, [...others, sourceUpdated]);
      spatialIndex.add(sourceUpdated.id, sourceUpdated.aabb);

      const v2 = validatePlacement(targetUpdated, {
        truck: prev.truck,
        skus: prev.skus,
        instances: [...others, sourceUpdated],
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
      const placed = result.placed.map(inst => ({ ...inst, tilt: { x: 0, y: 0 } }));

      return {
        ...prev,
        instances: placed,
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
        instances: currentState.instances.map(inst => ({
          id: inst.id,
          skuId: inst.skuId,
          position: inst.position,
          yaw: inst.yaw,
          tilt: inst.tilt ?? { x: 0, y: 0 },
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
        tilt?: { x: number; y: number };
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
          tilt: saved.tilt ?? { x: 0, y: 0 },
          aabb: computeAABB(sku, saved.position, saved.yaw),
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
      top_contact_allowed: input.topContactAllowed,
      max_load_above_kg: input.maxLoadAboveKg,
      min_support_ratio: input.minSupportRatio,
      stack_class: input.stackClass || null,
      color_hex: input.color || null,
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
        topContactAllowed: input.topContactAllowed,
        maxLoadAboveKg: input.maxLoadAboveKg,
        minSupportRatio: input.minSupportRatio,
        stackClass: input.stackClass,
        color: input.color,
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
    if (updates.topContactAllowed !== undefined) payload.top_contact_allowed = updates.topContactAllowed;
    if (updates.maxLoadAboveKg !== undefined) payload.max_load_above_kg = updates.maxLoadAboveKg;
    if (updates.minSupportRatio !== undefined) payload.min_support_ratio = updates.minSupportRatio;
    if (updates.stackClass !== undefined) payload.stack_class = updates.stackClass || null;
    if (updates.color !== undefined) payload.color_hex = updates.color || null;

    const { error } = await supabase.from('case_skus').update(payload).eq('sku_id', skuId);
    if (error) throw error;

    setState(prev => {
      const existing = prev.skus.get(skuId);
      if (!existing) return prev;
      const updated: CaseSKU = {
        ...existing,
        ...(updates.name !== undefined ? { name: updates.name } : {}),
        ...(updates.weightKg !== undefined ? { weightKg: updates.weightKg } : {}),
        ...(updates.uprightOnly !== undefined ? { uprightOnly: updates.uprightOnly } : {}),
        ...(updates.allowedYaw !== undefined ? { allowedYaw: updates.allowedYaw } : {}),
        ...(updates.canBeBase !== undefined ? { canBeBase: updates.canBeBase } : {}),
        ...(updates.topContactAllowed !== undefined ? { topContactAllowed: updates.topContactAllowed } : {}),
        ...(updates.maxLoadAboveKg !== undefined ? { maxLoadAboveKg: updates.maxLoadAboveKg } : {}),
        ...(updates.minSupportRatio !== undefined ? { minSupportRatio: updates.minSupportRatio } : {}),
        ...(updates.stackClass !== undefined ? { stackClass: updates.stackClass } : {}),
        ...(updates.color !== undefined ? { color: updates.color } : {}),
        ...(updates.dims ? { dims: updates.dims } : {}),
      };

      const cases = prev.cases.map(c => (c.skuId === skuId ? updated : c));
      const skus = new Map(prev.skus);
      skus.set(skuId, updated);
      return { ...prev, cases, skus };
    });
  }, []);

  return [state, {
    setTruck,
    placeCase,
    removeCase,
    updateInstance,
    swapInstancePositions,
    runAutoPack,
    clearAll,
    selectInstance,
    savePlan,
    loadPlan,
    listPlans,
    createTruck,
    createCase,
    updateCase,
  }];
}
