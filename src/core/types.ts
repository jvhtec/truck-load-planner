/**
 * Core data models for Truck Load Planning System
 * Units: mm (distance), kg (weight), discrete yaw only
 */

// ============================================================================
// Geometry Types
// ============================================================================

export type Yaw = 0 | 90 | 180 | 270;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface AABB {
  min: Vec3;
  max: Vec3;
}

// ============================================================================
// Case SKU Definition
// ============================================================================

export interface CaseSKU {
  skuId: string;
  name: string;
  color?: string;
  
  // Physical dimensions (mm)
  dims: {
    l: number; // length (X axis when yaw=0)
    w: number; // width (Y axis when yaw=0)
    h: number; // height (Z axis)
  };
  
  // Weight (kg)
  weightKg: number;
  
  // Orientation constraints
  uprightOnly: boolean;          // height must remain Z
  allowedYaw: Yaw[];             // permitted rotations
  tiltAllowed?: boolean;         // allow 90deg side tilt on Y axis
  
  // Stacking constraints
  canBeBase: boolean;            // can other cases rest on top?
  topContactAllowed: boolean;    // can anything touch top surface?
  maxLoadAboveKg: number;        // max cumulative weight above (0 = strict no-stack)
  
  // Support requirements
  minSupportRatio: number;       // 0.0-1.0, default 0.75
  
  // Optional stack classification
  stackClass?: string;
}

// ============================================================================
// Case Instance (placed in truck)
// ============================================================================

export interface CaseInstance {
  id: string;
  skuId: string;
  staged?: boolean;
  
  // Position of front-left-bottom corner
  position: Vec3;
  
  // Rotation around Z axis
  yaw: Yaw;

  // Discrete 90-degree side tilt on Y axis only.
  tilt?: {
    y: 0 | 90;
  };
  
  // Computed AABB (cached)
  aabb: AABB;
}

// ============================================================================
// Truck Model
// ============================================================================

export interface TruckType {
  truckId: string;
  name: string;
  
  // Interior dimensions (mm)
  innerDims: Vec3;
  
  // Empty truck weight (kg)
  emptyWeightKg: number;
  
  // Axle configuration
  axle: {
    frontX: number;      // X position of front axle
    rearX: number;       // X position of rear axle
    maxFrontKg: number;  // max load on front axle
    maxRearKg: number;   // max load on rear axle
  };
  
  // Balance constraints
  balance: {
    maxLeftRightPercentDiff: number; // max allowed L/R imbalance %
  };
  
  // Fixed obstacles inside truck
  obstacles?: AABB[];
}

// ============================================================================
// Validation Error Codes
// ============================================================================

export type ValidationError = 
  | 'OUT_OF_BOUNDS'
  | 'COLLISION'
  | 'INVALID_ORIENTATION'
  | 'INSUFFICIENT_SUPPORT'
  | 'BASE_NOT_ALLOWED'
  | 'TOP_CONTACT_FORBIDDEN'
  | 'LOAD_EXCEEDED'
  | 'AXLE_FRONT_OVER'
  | 'AXLE_REAR_OVER'
  | 'LEFT_RIGHT_IMBALANCE';

export interface ValidationResult {
  valid: boolean;
  violations: ValidationError[];
  details?: Record<string, unknown>;
}

// ============================================================================
// Load Plan
// ============================================================================

export interface LoadPlan {
  truckId: string;
  instances: CaseInstance[];
  
  // Computed metrics
  metrics: LoadMetrics;
}

export interface LoadMetrics {
  totalWeightKg: number;
  frontAxleKg: number;
  rearAxleKg: number;
  leftWeightKg: number;
  rightWeightKg: number;
  lrImbalancePercent: number;
  maxStackHeightMm: number;
  
  // Warnings (near thresholds)
  warnings: string[];
}

// ============================================================================
// Auto-Pack Result
// ============================================================================

export interface AutoPackResult {
  placed: CaseInstance[];
  unplaced: string[]; // skuIds that couldn't be placed
  metrics: LoadMetrics;
  reasonSummary: Record<ValidationError, number>;
}
