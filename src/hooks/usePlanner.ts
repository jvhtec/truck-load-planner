import { useState, useCallback } from 'react';
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

export interface PlannerState {
  truck: TruckType | null;
  skus: Map<string, CaseSKU>;
  instances: CaseInstance[];
  metrics: LoadMetrics | null;
  selectedInstanceId: string | null;
  validation: ValidationResult | null;
}

export interface PlannerActions {
  setTruck: (truck: TruckType) => void;
  addSku: (sku: CaseSKU) => void;
  removeSku: (skuId: string) => void;
  placeCase: (skuId: string, position: { x: number; y: number; z: number }, yaw: Yaw) => ValidationResult;
  removeCase: (instanceId: string) => void;
  moveCase: (instanceId: string, newPosition: { x: number; y: number; z: number }) => ValidationResult;
  rotateCase: (instanceId: string, yaw: Yaw) => ValidationResult;
  runAutoPack: (skuQuantities: Map<string, number>) => void;
  clearAll: () => void;
  selectInstance: (instanceId: string | null) => void;
}

export function usePlanner(): [PlannerState, PlannerActions] {
  const [state, setState] = useState<PlannerState>(() => ({
    truck: null,
    skus: new Map(),
    instances: [],
    metrics: null,
    selectedInstanceId: null,
    validation: null,
  }));
  
  const [supportGraph, setSupportGraph] = useState<SupportGraph | null>(null);
  
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
  
  const addSku = useCallback((sku: CaseSKU) => {
    setState(prev => {
      const newSkus = new Map(prev.skus);
      newSkus.set(sku.skuId, sku);
      return { ...prev, skus: newSkus };
    });
  }, []);
  
  const removeSku = useCallback((skuId: string) => {
    setState(prev => {
      const newSkus = new Map(prev.skus);
      newSkus.delete(skuId);
      return { ...prev, skus: newSkus };
    });
  }, []);
  
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
  
  const moveCase = useCallback((
    instanceId: string,
    newPosition: { x: number; y: number; z: number }
  ): ValidationResult => {
    // TODO: Implement move validation
    return { valid: true, violations: [] };
  }, []);
  
  const rotateCase = useCallback((instanceId: string, yaw: Yaw): ValidationResult => {
    // TODO: Implement rotation validation
    return { valid: true, violations: [] };
  }, []);
  
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
  
  return [state, {
    setTruck,
    addSku,
    removeSku,
    placeCase,
    removeCase,
    moveCase,
    rotateCase,
    runAutoPack,
    clearAll,
    selectInstance,
  }];
}
