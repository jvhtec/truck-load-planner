/**
 * Statics engine for tractor-trailer and multi-axle rigid vehicles.
 * All calculations are O(1) — three beam-model equations.
 *
 * Coordinate convention (trailer body):
 *   X = 0 at front of trailer, increases toward rear.
 *   Axle groups are sorted by xMm ascending (front → rear).
 *
 * Reference equations (PRD §5):
 *   Trailer:
 *     L   = trailerAxleX − kingpinX
 *     d   = cargoComX − kingpinX
 *     R_a = W_t × (d / L)          (trailer axle reaction)
 *     R_k = W_t − R_a              (kingpin / fifth-wheel reaction)
 *
 *   Tractor:
 *     W       = W_tractor_empty + R_k
 *     comX    = (W_tr × comX_tr + R_k × kingpinX_tr) / W
 *     L_t     = driveX − steerX
 *     R_d     = W × (comX − steerX) / L_t
 *     R_s     = W − R_d
 */

import type {
  RigidVehicle,
  TractorTrailer,
  AxleGroup,
  AxleGroupLoad,
  CaseInstance,
  TrailerMetrics,
} from './types';
import { computeCOM } from './weight';

// ============================================================================
// Trailer axle statics
// ============================================================================

export interface TrailerAxleResult {
  /** Reaction at the rearmost trailer axle group (kg). */
  trailerAxleKg: number;
  /** Downward load transferred to the tractor via the kingpin (kg). */
  kingpinKg: number;
  /** The trailer axle group that was used as the rear beam support. */
  trailerAxleGroup: AxleGroup;
}

/**
 * Compute kingpin and trailer-axle reactions for a trailer body.
 *
 * The trailer is modelled as a simply-supported beam:
 *   - support A: kingpin at kingpinXmm (trailer frame)
 *   - support B: rearmost axle group
 *   - distributed load represented as single point load W_t at cargoComXmm
 *
 * @param totalCargoWeightKg  sum of all cargo weights placed in the trailer
 * @param cargoComXmm         X-coordinate of cargo centre-of-mass (trailer frame)
 * @param trailer             trailer RigidVehicle (provides axleGroups)
 * @param kingpinXmm          kingpin X position in the trailer body frame
 */
export function computeTrailerAxleLoads(
  totalCargoWeightKg: number,
  cargoComXmm: number,
  trailer: RigidVehicle,
  kingpinXmm: number,
): TrailerAxleResult {
  // Identify the rearmost axle group (highest xMm)
  const sorted = [...trailer.axleGroups].sort((a, b) => a.xMm - b.xMm);
  const trailerAxleGroup = sorted[sorted.length - 1];

  if (!trailerAxleGroup) {
    return { trailerAxleKg: 0, kingpinKg: totalCargoWeightKg, trailerAxleGroup: { id: 'none', xMm: 0, maxKg: 0 } };
  }

  const L = trailerAxleGroup.xMm - kingpinXmm;

  // Degenerate: axle and kingpin coincide → all load to axle
  if (L <= 0) {
    return { trailerAxleKg: totalCargoWeightKg, kingpinKg: 0, trailerAxleGroup };
  }

  const d = cargoComXmm - kingpinXmm;
  const trailerAxleKg = totalCargoWeightKg * (d / L);
  const kingpinKg = totalCargoWeightKg - trailerAxleKg;

  return {
    trailerAxleKg: Math.max(0, trailerAxleKg),
    kingpinKg: Math.max(0, kingpinKg),
    trailerAxleGroup,
  };
}

// ============================================================================
// Tractor axle statics
// ============================================================================

export interface TractorAxleResult {
  /** Load on the steer (front) axle group (kg). */
  steerKg: number;
  /** Load on the drive (rear) axle group (kg). */
  driveKg: number;
  /** The steer axle group used. */
  steerGroup: AxleGroup;
  /** The drive axle group used. */
  driveGroup: AxleGroup;
}

/**
 * Compute steer and drive axle reactions for the tractor.
 *
 * The tractor is modelled as a two-support beam using the frontmost and
 * rearmost axle groups. The combined load includes:
 *   - tractor's own empty weight acting at its empty COM
 *   - kingpin reaction R_k acting at the fifth-wheel position
 *
 * @param tractorEmptyWeightKg  tractor empty GVW
 * @param tractorEmptyComXmm    tractor empty COM in tractor body frame
 * @param kingpinReactionKg     R_k from trailer statics (downward, on tractor)
 * @param kingpinXonTractorMm   fifth-wheel X position in tractor body frame
 * @param tractor               tractor RigidVehicle (provides axleGroups)
 */
export function computeTractorAxleLoads(
  tractorEmptyWeightKg: number,
  tractorEmptyComXmm: number,
  kingpinReactionKg: number,
  kingpinXonTractorMm: number,
  tractor: RigidVehicle,
): TractorAxleResult {
  const sorted = [...tractor.axleGroups].sort((a, b) => a.xMm - b.xMm);
  const steerGroup = sorted[0];
  const driveGroup = sorted[sorted.length - 1];

  // Degenerate: single axle or no axles
  if (!steerGroup || !driveGroup || steerGroup === driveGroup) {
    const total = tractorEmptyWeightKg + kingpinReactionKg;
    const half = total / 2;
    const fallback = steerGroup ?? { id: 'steer', xMm: 0, maxKg: 0 };
    return { steerKg: half, driveKg: half, steerGroup: fallback, driveGroup: fallback };
  }

  // Combined weight and combined COM
  const totalW = tractorEmptyWeightKg + kingpinReactionKg;
  if (totalW <= 0) {
    return { steerKg: 0, driveKg: 0, steerGroup, driveGroup };
  }

  const combinedComX =
    (tractorEmptyWeightKg * tractorEmptyComXmm +
      kingpinReactionKg * kingpinXonTractorMm) /
    totalW;

  const span = driveGroup.xMm - steerGroup.xMm;

  // Degenerate: both axle groups at same position
  if (span <= 0) {
    return { steerKg: totalW / 2, driveKg: totalW / 2, steerGroup, driveGroup };
  }

  const d = combinedComX - steerGroup.xMm;
  const driveKg = totalW * (d / span);
  const steerKg = totalW - driveKg;

  return {
    steerKg: Math.max(0, steerKg),
    driveKg: Math.max(0, driveKg),
    steerGroup,
    driveGroup,
  };
}

// ============================================================================
// Full trailer-rig metrics
// ============================================================================

/**
 * Compute complete TrailerMetrics for a TractorTrailer configuration.
 *
 * Called once per candidate placement during validation and auto-pack scoring.
 * All computation is O(1) after the O(n) computeCOM call.
 */
export function computeTrailerMetrics(
  instances: CaseInstance[],
  skuWeights: Map<string, number>,
  rig: TractorTrailer,
): TrailerMetrics {
  const { tractor, trailer, coupling } = rig;
  const warnings: string[] = [];

  // --- Cargo weight and COM ---
  let totalCargoWeightKg = 0;
  for (const inst of instances) {
    totalCargoWeightKg += skuWeights.get(inst.skuId) ?? 0;
  }
  const com = computeCOM(instances, skuWeights);

  // --- Trailer statics ---
  const { trailerAxleKg, kingpinKg } = computeTrailerAxleLoads(
    totalCargoWeightKg,
    com.x,
    trailer,
    coupling.kingpinX_onTrailerMm,
  );

  // --- Build trailer axle group loads ---
  const trailerAxleLoads: AxleGroupLoad[] = trailer.axleGroups
    .sort((a, b) => a.xMm - b.xMm)
    .map(ag => {
      // For a single axle group: receives the full trailerAxleKg.
      // TODO v3.1: for tandem bogies, split proportionally using trailerAxleGroup.id / trailerAxleKg.
      const loadKg = trailerAxleKg;
      const utilizationPct = ag.maxKg > 0 ? (loadKg / ag.maxKg) * 100 : 0;
      const status: AxleGroupLoad['status'] =
        loadKg > ag.maxKg
          ? 'over'
          : utilizationPct > 80
          ? 'warning'
          : 'ok';
      if (status === 'over') {
        warnings.push(`Trailer axle "${ag.id}" over limit: ${loadKg.toFixed(0)} / ${ag.maxKg} kg`);
      } else if (status === 'warning') {
        warnings.push(`Trailer axle "${ag.id}" at ${utilizationPct.toFixed(0)}%`);
      }
      return { id: ag.id, loadKg, maxKg: ag.maxKg, minKg: ag.minKg, utilizationPct, status };
    });

  // --- Kingpin status ---
  const maxKingpinKg = coupling.maxKingpinKg;
  const kingpinStatus: TrailerMetrics['kingpinStatus'] =
    maxKingpinKg !== undefined && kingpinKg > maxKingpinKg
      ? 'over'
      : maxKingpinKg !== undefined && kingpinKg > maxKingpinKg * 0.8
      ? 'warning'
      : 'ok';
  if (kingpinStatus === 'over') {
    warnings.push(`Kingpin overloaded: ${kingpinKg.toFixed(0)} / ${maxKingpinKg} kg`);
  } else if (kingpinStatus === 'warning') {
    warnings.push(`Kingpin at ${((kingpinKg / (maxKingpinKg ?? kingpinKg)) * 100).toFixed(0)}%`);
  }

  // --- Tractor statics ---
  const { steerKg, driveKg, steerGroup } = computeTractorAxleLoads(
    tractor.emptyWeightKg,
    tractor.emptyComXmm,
    kingpinKg,
    coupling.kingpinX_onTractorMm,
    tractor,
  );

  const tractorAxleLoads: AxleGroupLoad[] = tractor.axleGroups
    .sort((a, b) => a.xMm - b.xMm)
    .map((ag, idx) => {
      // First sorted axle = steer, last = drive
      const isSteer = ag.id === steerGroup.id && idx === 0;
      const loadKg = isSteer ? steerKg : driveKg;
      const utilizationPct = ag.maxKg > 0 ? (loadKg / ag.maxKg) * 100 : 0;
      let status: AxleGroupLoad['status'] =
        loadKg > ag.maxKg
          ? 'over'
          : utilizationPct > 80
          ? 'warning'
          : 'ok';
      if (ag.minKg !== undefined && loadKg < ag.minKg) {
        status = 'under';
      }
      if (status === 'over') {
        warnings.push(`Tractor axle "${ag.id}" over limit: ${loadKg.toFixed(0)} / ${ag.maxKg} kg`);
      } else if (status === 'under') {
        warnings.push(`Steer axle "${ag.id}" below minimum: ${loadKg.toFixed(0)} / ${ag.minKg} kg`);
      } else if (status === 'warning') {
        warnings.push(`Tractor axle "${ag.id}" at ${utilizationPct.toFixed(0)}%`);
      }
      return { id: ag.id, loadKg, maxKg: ag.maxKg, minKg: ag.minKg, utilizationPct, status };
    });

  // --- L/R balance (trailer body only) ---
  const midY = trailer.innerDimsMm.y / 2;
  let leftKg = 0;
  let rightKg = 0;
  for (const inst of instances) {
    const w = skuWeights.get(inst.skuId) ?? 0;
    const centerY = (inst.aabb.min.y + inst.aabb.max.y) / 2;
    if (centerY < midY) leftKg += w;
    else rightKg += w;
  }
  const payloadDenom = Math.max(
    1,
    trailer.axleGroups.reduce((s, ag) => s + ag.maxKg, 0) - trailer.emptyWeightKg,
  );
  const lrImbalancePercent = (Math.abs(leftKg - rightKg) / payloadDenom) * 100;
  if (lrImbalancePercent > trailer.balance.maxLeftRightPercentDiff) {
    warnings.push(
      `L/R imbalance ${lrImbalancePercent.toFixed(1)}% exceeds limit ${trailer.balance.maxLeftRightPercentDiff}%`,
    );
  }

  // --- Max stack height ---
  let maxStackHeightMm = 0;
  for (const inst of instances) {
    maxStackHeightMm = Math.max(maxStackHeightMm, inst.aabb.max.z);
  }

  return {
    totalWeightKg: totalCargoWeightKg,
    trailerAxleLoads,
    kingpinKg,
    kingpinMaxKg: maxKingpinKg,
    kingpinStatus,
    tractorAxleLoads,
    leftWeightKg: leftKg,
    rightWeightKg: rightKg,
    lrImbalancePercent,
    maxStackHeightMm,
    warnings,
  };
}

// ============================================================================
// Multi-axle rigid vehicle metrics
// ============================================================================

/**
 * Compute axle-group loads for a multi-axle rigid vehicle.
 *
 * Uses a two-support beam model between the frontmost and rearmost axle groups.
 * Intermediate axles are reported with a proportional share (reserved for v3.1;
 * currently they receive the same split as front/rear).
 */
export function computeRigidVehicleAxleLoads(
  totalCargoWeightKg: number,
  cargoComXmm: number,
  vehicle: RigidVehicle,
): AxleGroupLoad[] {
  const sorted = [...vehicle.axleGroups].sort((a, b) => a.xMm - b.xMm);
  if (sorted.length === 0) return [];

  const front = sorted[0];
  const rear = sorted[sorted.length - 1];

  let frontKg = 0;
  let rearKg = 0;

  const span = rear.xMm - front.xMm;
  if (span > 0) {
    const d = cargoComXmm - front.xMm;
    rearKg = totalCargoWeightKg * (d / span);
    frontKg = totalCargoWeightKg - rearKg;
    frontKg = Math.max(0, frontKg);
    rearKg = Math.max(0, rearKg);
  } else {
    // Single axle or degenerate span
    frontKg = totalCargoWeightKg;
    rearKg = 0;
  }

  return sorted.map((ag, idx) => {
    // First → front share, last → rear share, intermediates → average
    const loadKg =
      idx === 0 ? frontKg :
      idx === sorted.length - 1 ? rearKg :
      (frontKg + rearKg) / 2;  // placeholder; full N-axle model in v3.1

    const utilizationPct = ag.maxKg > 0 ? (loadKg / ag.maxKg) * 100 : 0;
    let status: AxleGroupLoad['status'] =
      loadKg > ag.maxKg ? 'over' :
      utilizationPct > 80 ? 'warning' : 'ok';
    if (ag.minKg !== undefined && loadKg < ag.minKg) status = 'under';

    return { id: ag.id, loadKg, maxKg: ag.maxKg, minKg: ag.minKg, utilizationPct, status };
  });
}
