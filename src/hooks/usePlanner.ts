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
} from '../core';
import { SupportGraph } from '../core/support';
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
// Hook
// ============================================================================

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
  
  const [supportGraph, setSupportGraph] = useState<SupportGraph | null>(null);
  
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
    skus.forEach((sku, id) => skuWeights.set(id, sku.weightKg));
    return computeMetrics(instances, skuWeights, truck);
  }, []);
  
  const setTruck = useCallback((truck: TruckType) => {
    const skuWeights = new Map<string, number>();
    setState(prev => {
      prev.skus.forEach((sku, id) => skuWeights.set(id, sku.weightKg));
      const graph = new SupportGraph(skuWeights);
      setSupportGraph(graph);
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
      prev.skus.forEach((s, id) => skuWeights.set(id, s.weightKg));
      
      const validation = validatePlacement(instance, {
        truck: prev.truck,
        skus: prev.skus,
        instances: prev.instances,
        supportGraph,
        skuWeights,
      });
      
      result = validation;
      
      if (validation.valid) {
        const newInstances = [...prev.instances, instance];
        supportGraph.addInstance(instance, newInstances);
        
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
    // TODO: Implement save to Supabase
    console.log('Save plan:', name);
  }, []);
  
  return [state, {
    setTruck,
    placeCase,
    removeCase,
    runAutoPack,
    clearAll,
    selectInstance,
    savePlan,
  }];
}
