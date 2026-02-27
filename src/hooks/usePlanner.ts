import { useState, useEffect, useCallback } from 'react';
import type {
  TruckType,
  CaseSKU,
  CaseInstance,
  LoadMetrics,
  ValidationResult,
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

// ============================================================================
// Types from Supabase
// ============================================================================

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

// ============================================================================
// Converters
// ============================================================================

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
  };
}

// ============================================================================
// Public types
// ============================================================================

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

export interface PlannerActions {
  setTruck: (truck: TruckType) => void;
  placeCase: (skuId: string, position: { x: number; y: number; z: number }, yaw: Yaw) => ValidationResult;
  removeCase: (instanceId: string) => void;
  runAutoPack: (skuQuantities: Map<string, number>) => void;
  clearAll: () => void;
  selectInstance: (instanceId: string | null) => void;
  savePlan: (name: string) => Promise<void>;
  loadPlan: (planId: string) => Promise<void>;
  listPlans: () => Promise<SavedPlan[]>;
}

// ============================================================================
// Hook
// ============================================================================

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

  const [supportGraph, setSupportGraph] = useState<SupportGraph | null>(null);
  const [spatialIndex, setSpatialIndex] = useState<SpatialIndex>(() => new SpatialIndex());

  // Load data from Supabase
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

        setState(prev => ({
          ...prev,
          trucks,
          cases,
          skus,
          loading: false,
        }));
      } catch (error: any) {
        setState(prev => ({
          ...prev,
          loading: false,
          error: error.message || 'Failed to load data',
        }));
      }
    }

    loadData();
  }, []);

  const updateMetrics = useCallback((instances: CaseInstance[], truck: TruckType | null, skus: Map<string, CaseSKU>) => {
    if (!truck) return null;
    const skuWeights = new Map<string, number>();
    skus.forEach((sku, id) => {
      skuWeights.set(id, sku.weightKg);
    });
    return computeMetrics(instances, skuWeights, truck);
  }, []);

  const setTruck = useCallback((truck: TruckType) => {
    const skuWeights = new Map<string, number>();
    setState(prev => {
      prev.skus.forEach((sku, id) => {
        skuWeights.set(id, sku.weightKg);
      });
      const graph = new SupportGraph(skuWeights);
      setSupportGraph(graph);
      setSpatialIndex(new SpatialIndex());
      return {
        ...prev,
        truck,
        instances: [],
        metrics: updateMetrics([], truck, prev.skus),
        validation: null,
      };
    });
  }, [updateMetrics]);

  const placeCase = useCallback((
    skuId: string,
    position: { x: number; y: number; z: number },
    yaw: Yaw
  ): ValidationResult => {
    let result: ValidationResult = { valid: false, violations: [] };

    setState(prev => {
      if (!prev.truck || !supportGraph) {
        result = { valid: false, violations: ['OUT_OF_BOUNDS'], details: { error: 'No truck selected' } };
        return prev;
      }

      const sku = prev.skus.get(skuId);
      if (!sku) {
        result = { valid: false, violations: ['INVALID_ORIENTATION'], details: { error: `Unknown SKU: ${skuId}` } };
        return prev;
      }

      const instance = createInstance(
        `${skuId}-${Date.now()}`,
        sku,
        position,
        yaw
      );

      const skuWeights = new Map<string, number>();
      prev.skus.forEach((s, id) => {
        skuWeights.set(id, s.weightKg);
      });

      const validation = validatePlacement(instance, {
        truck: prev.truck,
        skus: prev.skus,
        instances: prev.instances,
        supportGraph,
        skuWeights,
        spatialIndex,
      });

      result = validation;

      if (validation.valid) {
        const newInstances = [...prev.instances, instance];
        supportGraph.addInstance(instance, newInstances);
        spatialIndex.add(instance.id, instance.aabb);

        return {
          ...prev,
          instances: newInstances,
          metrics: updateMetrics(newInstances, prev.truck, prev.skus),
          validation: null,
        };
      }

      return { ...prev, validation };
    });

    return result;
  }, [supportGraph, updateMetrics]);

  const removeCase = useCallback((instanceId: string) => {
    setState(prev => {
      if (!prev.truck || !supportGraph) return prev;

      const newInstances = prev.instances.filter(i => i.id !== instanceId);
      supportGraph.removeInstance(instanceId);
      spatialIndex.remove(instanceId);

      return {
        ...prev,
        instances: newInstances,
        metrics: updateMetrics(newInstances, prev.truck, prev.skus),
        selectedInstanceId: prev.selectedInstanceId === instanceId ? null : prev.selectedInstanceId,
      };
    });
  }, [supportGraph, updateMetrics]);

  const runAutoPack = useCallback((skuQuantities: Map<string, number>) => {
    setState(prev => {
      if (!prev.truck) return prev;

      const skus = Array.from(prev.skus.values());
      const result = autoPack(prev.truck, skus, skuQuantities);

      return {
        ...prev,
        instances: result.placed,
        metrics: result.metrics,
        validation: result.unplaced.length > 0
          ? {
              valid: false,
              violations: ['OUT_OF_BOUNDS'],
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

    const metrics = currentState.metrics;

    // Look up the truck's UUID in Supabase
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
        })),
        total_weight_kg: metrics?.totalWeightKg ?? 0,
        front_axle_kg: metrics?.frontAxleKg ?? 0,
        rear_axle_kg: metrics?.rearAxleKg ?? 0,
        left_weight_kg: metrics?.leftWeightKg ?? 0,
        right_weight_kg: metrics?.rightWeightKg ?? 0,
        lr_imbalance_percent: metrics?.lrImbalancePercent ?? 0,
        max_stack_height_mm: metrics?.maxStackHeightMm ?? 0,
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

      // Reconstruct instances from saved data
      const savedInstances = plan.instances as Array<{
        id: string;
        skuId: string;
        position: { x: number; y: number; z: number };
        yaw: Yaw;
      }>;

      const instances: CaseInstance[] = savedInstances.map(saved => {
        const sku = prev.skus.get(saved.skuId);
        if (!sku) {
          throw new Error(
            `Failed to load plan: SKU ${saved.skuId} for instance ${saved.id} is not in current catalog. ` +
            `The plan may have been created with different SKUs.`
          );
        }
        return {
          id: saved.id,
          skuId: saved.skuId,
          position: saved.position,
          yaw: saved.yaw,
          aabb: computeAABB(sku, saved.position, saved.yaw),
        };
      });

      // Rebuild support graph and spatial index
      const skuWeights = new Map<string, number>();
      prev.skus.forEach((sku, id) => {
        skuWeights.set(id, sku.weightKg);
      });
      const graph = new SupportGraph(skuWeights);
      const idx = new SpatialIndex();
      for (const inst of instances) {
        graph.addInstance(inst, instances);
        idx.add(inst.id, inst.aabb);
      }
      setSupportGraph(graph);
      setSpatialIndex(idx);

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

  return [state, {
    setTruck,
    placeCase,
    removeCase,
    runAutoPack,
    clearAll,
    selectInstance,
    savePlan,
    loadPlan,
    listPlans,
  }];
}
