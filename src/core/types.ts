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

  // Whether this case can hold loose contents (shows notes field on labels)
  isContainer?: boolean;
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
  | 'LEFT_RIGHT_IMBALANCE'
  // v3 multi-axle / tractor-trailer codes
  | 'AXLE_STEER_OVER'
  | 'AXLE_DRIVE_OVER'
  | 'AXLE_TRAILER_OVER'
  | 'KINGPIN_OVER'
  | 'STEER_UNDER_MIN'
  | 'LEFT_RIGHT_IMBALANCE_TRAILER';

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

  // v3: per-axle-group breakdown (present for multi-axle / tractor-trailer)
  axleGroupLoads?: AxleGroupLoad[];
  kingpinKg?: number;
  kingpinMaxKg?: number;
}

// ============================================================================
// Auto-Pack Result
// ============================================================================

export interface AutoPackResult {
  placed: CaseInstance[];
  unplaced: string[]; // skuIds that couldn't be placed
  metrics: LoadMetrics;
  trailerMetrics?: TrailerMetrics; // present only for tractor-trailer
  reasonSummary: Record<ValidationError, number>;
}

// ============================================================================
// Multi-Axle / Tractor-Trailer Types  (Engine v3.x)
// ============================================================================

/** One physical axle group with its position and load limits. */
export interface AxleGroup {
  id: string;      // e.g. "steer" | "drive" | "trailer" | "tag"
  xMm: number;     // X position along this body's cargo-space origin (mm)
  maxKg: number;   // maximum legal load on this group (kg)
  minKg?: number;  // optional minimum load (e.g. steer axle steering authority)
}

/** Per-axle-group load result used in metrics display. */
export interface AxleGroupLoad {
  id: string;
  loadKg: number;
  maxKg: number;
  minKg?: number;
  utilizationPct: number;
  status: 'ok' | 'warning' | 'over' | 'under';
}

/** A rigid vehicle body with N axle groups (replaces TruckType for multi-axle rigs). */
export interface RigidVehicle {
  vehicleId: string;
  name: string;
  /** Interior cargo space (mm). X = front→rear, Y = left→right, Z = floor→ceiling. */
  innerDimsMm: { x: number; y: number; z: number };
  emptyWeightKg: number;
  /** X coordinate of the vehicle's own empty-vehicle COM (mm, from front of body). */
  emptyComXmm: number;
  axleGroups: AxleGroup[];
  balance: { maxLeftRightPercentDiff: number };
  obstacles?: AABB[];
}

/** Tractor + semi-trailer coupled via a fifth-wheel/kingpin. */
export interface TractorTrailer {
  id: string;
  name: string;
  tractor: RigidVehicle;
  trailer: RigidVehicle; // cargo is placed in the trailer body
  coupling: {
    /** Kingpin X offset measured from the front of the trailer body (mm). */
    kingpinX_onTrailerMm: number;
    /** Fifth-wheel X offset measured from the front of the tractor body (mm). */
    kingpinX_onTractorMm: number;
    maxKingpinKg?: number;
  };
}

/** Discriminated union for all supported vehicle configurations. */
export type VehicleConfig =
  | { kind: 'rigid'; vehicle: TruckType }
  | { kind: 'multi-axle'; vehicle: RigidVehicle }
  | { kind: 'tractor-trailer'; vehicle: TractorTrailer };

/** Complete metrics for a tractor-trailer rig placement. */
export interface TrailerMetrics {
  totalWeightKg: number;
  trailerAxleLoads: AxleGroupLoad[];
  kingpinKg: number;
  kingpinMaxKg?: number;
  kingpinStatus: 'ok' | 'warning' | 'over';
  tractorAxleLoads: AxleGroupLoad[];
  leftWeightKg: number;
  rightWeightKg: number;
  lrImbalancePercent: number;
  maxStackHeightMm: number;
  warnings: string[];
}
