import type { LoadMetrics, TrailerMetrics, AxleGroupLoad } from '../core/types';

interface MetricsPanelProps {
  metrics: LoadMetrics | null;
  trailerMetrics?: TrailerMetrics | null;  // v3: present for tractor-trailer rigs
  truck: { axle: { maxFrontKg: number; maxRearKg: number }; balance: { maxLeftRightPercentDiff: number } } | null;
  lang: 'es' | 'en';
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

// ── Label maps ──────────────────────────────────────────────────────────────

const AXLE_LABELS: Record<string, { es: string; en: string }> = {
  steer:   { es: 'Eje Direccional', en: 'Steer Axle' },
  drive:   { es: 'Eje Motriz',      en: 'Drive Axle' },
  trailer: { es: 'Eje Remolque',    en: 'Trailer Axle' },
  tag:     { es: 'Eje Tag',         en: 'Tag Axle' },
  front:   { es: 'Eje Delantero',   en: 'Front Axle' },
  rear:    { es: 'Eje Trasero',     en: 'Rear Axle' },
};

function axleLabel(id: string, lang: 'es' | 'en'): string {
  return AXLE_LABELS[id]?.[lang] ?? id.toUpperCase();
}

// ── Status helpers ───────────────────────────────────────────────────────────

function getStatus(pct: number, max: number): 'ok' | 'warning' | 'danger' {
  if (pct > max) return 'danger';
  if (pct > max * 0.8) return 'warning';
  return 'ok';
}

function statusClass(s: AxleGroupLoad['status']): string {
  if (s === 'over')    return 'danger';
  if (s === 'under')   return 'warning';
  if (s === 'warning') return 'warning';
  return 'ok';
}

// ── Sub-components ───────────────────────────────────────────────────────────

function AxleGroupBar({ group, lang }: { group: AxleGroupLoad; lang: 'es' | 'en' }) {
  const pct = Math.min(group.utilizationPct, 100);
  const cls = statusClass(group.status);
  return (
    <div className={`metric ${cls}`}>
      <span className="label">{axleLabel(group.id, lang)}</span>
      <div className="bar-container">
        <div className="bar" style={{ width: `${pct}%` }} />
      </div>
      <span className="value">
        {group.loadKg.toFixed(1)} kg ({group.utilizationPct.toFixed(0)}%)
        {group.status === 'under' && group.minKg !== undefined &&
          ` — min ${group.minKg} kg`}
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function MetricsPanel({
  metrics,
  trailerMetrics,
  truck,
  lang,
  collapsed,
  onToggleCollapsed,
}: MetricsPanelProps) {
  const t = lang === 'es'
    ? {
        title: 'Metricas',
        expand: 'Expandir',
        collapse: 'Contraer',
        empty: 'Sin datos todavia',
        totalCargo: 'Carga Total',
        maxStackHeight: 'Altura Maxima de Apilado',
        axleLoad: 'Carga por Eje',
        frontAxle: 'Eje Delantero',
        rearAxle: 'Eje Trasero',
        trailerAxles: 'Ejes Remolque',
        tractorAxles: 'Ejes Tractora',
        kingpin: 'Kingpin / 5ta Rueda',
        balance: 'Balance',
        lrImbalance: 'Desbalance I/D',
        warnings: 'Advertencias',
      }
    : {
        title: 'Metrics',
        expand: 'Expand',
        collapse: 'Collapse',
        empty: 'No data yet',
        totalCargo: 'Total Cargo',
        maxStackHeight: 'Max Stack Height',
        axleLoad: 'Axle Load',
        frontAxle: 'Front Axle',
        rearAxle: 'Rear Axle',
        trailerAxles: 'Trailer Axles',
        tractorAxles: 'Tractor Axles',
        kingpin: 'Kingpin / 5th Wheel',
        balance: 'Balance',
        lrImbalance: 'L/R Imbalance',
        warnings: 'Warnings',
      };

  const toggleLabel = collapsed ? t.expand : t.collapse;

  if (!metrics && !trailerMetrics) {
    return (
      <div className={`metrics-panel ${collapsed ? 'collapsed' : ''}`}>
        <div className="metrics-panel-header">
          <h3>{t.title}</h3>
          <button
            type="button"
            className="metrics-toggle-btn"
            onClick={onToggleCollapsed}
            aria-label={toggleLabel}
            aria-expanded={!collapsed}
            title={toggleLabel}
          >
            {collapsed ? '+' : '-'}
          </button>
        </div>
        {!collapsed && <p className="empty-message">{t.empty}</p>}
      </div>
    );
  }

  const totalWeight = trailerMetrics?.totalWeightKg ?? metrics?.totalWeightKg ?? 0;
  const maxStack = trailerMetrics?.maxStackHeightMm ?? metrics?.maxStackHeightMm ?? 0;
  const leftKg = trailerMetrics?.leftWeightKg ?? metrics?.leftWeightKg ?? 0;
  const rightKg = trailerMetrics?.rightWeightKg ?? metrics?.rightWeightKg ?? 0;
  const lrPct = trailerMetrics?.lrImbalancePercent ?? metrics?.lrImbalancePercent ?? 0;
  const maxLRDiff = truck?.balance.maxLeftRightPercentDiff ?? 10;
  const warnings = [
    ...(trailerMetrics?.warnings ?? []),
    ...(metrics?.warnings ?? []),
  ];

  // Legacy two-axle rows (shown when no trailerMetrics and no axleGroupLoads)
  const showLegacyAxles = !trailerMetrics && !metrics?.axleGroupLoads;
  const frontPct = showLegacyAxles && truck
    ? (metrics!.frontAxleKg / truck.axle.maxFrontKg) * 100
    : 0;
  const rearPct = showLegacyAxles && truck
    ? (metrics!.rearAxleKg / truck.axle.maxRearKg) * 100
    : 0;

  return (
    <div className={`metrics-panel ${collapsed ? 'collapsed' : ''}`}>
      <div className="metrics-panel-header">
        <h3>{t.title}</h3>
        <button
          type="button"
          className="metrics-toggle-btn"
          onClick={onToggleCollapsed}
          aria-label={toggleLabel}
          aria-expanded={!collapsed}
          title={toggleLabel}
        >
          {collapsed ? '+' : '-'}
        </button>
      </div>

      {!collapsed && (
        <>
          {/* ── Summary ─────────────────────────────────────────────────── */}
          <div className="metric-group">
            <div className="metric">
              <span className="label">{t.totalCargo}</span>
              <span className="value">{totalWeight.toFixed(1)} kg</span>
            </div>
            <div className="metric">
              <span className="label">{t.maxStackHeight}</span>
              <span className="value">{maxStack.toFixed(0)} mm</span>
            </div>
          </div>

          {/* ── Axle loads ──────────────────────────────────────────────── */}
          {trailerMetrics ? (
            /* v3: per-axle-group rows for tractor-trailer */
            <>
              <div className="metric-group">
                <h4>{t.trailerAxles}</h4>
                {trailerMetrics.trailerAxleLoads.map(ag => (
                  <AxleGroupBar key={ag.id} group={ag} lang={lang} />
                ))}
                {/* Kingpin */}
                <div className={`metric ${trailerMetrics.kingpinStatus === 'over' ? 'danger' : trailerMetrics.kingpinStatus === 'warning' ? 'warning' : 'ok'}`}>
                  <span className="label">{t.kingpin}</span>
                  <span className="value">
                    {trailerMetrics.kingpinKg.toFixed(1)} kg
                    {trailerMetrics.kingpinMaxKg !== undefined &&
                      ` / ${trailerMetrics.kingpinMaxKg} kg`}
                  </span>
                </div>
              </div>
              <div className="metric-group">
                <h4>{t.tractorAxles}</h4>
                {trailerMetrics.tractorAxleLoads.map(ag => (
                  <AxleGroupBar key={ag.id} group={ag} lang={lang} />
                ))}
              </div>
            </>
          ) : metrics?.axleGroupLoads ? (
            /* v3: per-axle-group rows for multi-axle rigid truck */
            <div className="metric-group">
              <h4>{t.axleLoad}</h4>
              {metrics.axleGroupLoads.map(ag => (
                <AxleGroupBar key={ag.id} group={ag} lang={lang} />
              ))}
              {metrics.kingpinKg !== undefined && (() => {
                const denom = metrics.kingpinMaxKg ?? metrics.kingpinKg;
                const percent = denom === 0 ? 0 : (metrics.kingpinKg / denom) * 100;
                return (
                  <div className={`metric ${getStatus(percent, 100)}`}>
                    <span className="label">{t.kingpin}</span>
                    <span className="value">
                      {metrics.kingpinKg.toFixed(1)} kg
                      {metrics.kingpinMaxKg !== undefined && ` / ${metrics.kingpinMaxKg} kg`}
                    </span>
                  </div>
                );
              })()}
            </div>
          ) : (
            /* Legacy: two-axle bars (unchanged) */
            <div className="metric-group">
              <h4>{t.axleLoad}</h4>
              <div className={`metric ${getStatus(frontPct, 100)}`}>
                <span className="label">{t.frontAxle}</span>
                <div className="bar-container">
                  <div className="bar" style={{ width: `${Math.min(frontPct, 100)}%` }} />
                </div>
                <span className="value">
                  {metrics!.frontAxleKg.toFixed(1)} kg ({frontPct.toFixed(0)}%)
                </span>
              </div>
              <div className={`metric ${getStatus(rearPct, 100)}`}>
                <span className="label">{t.rearAxle}</span>
                <div className="bar-container">
                  <div className="bar" style={{ width: `${Math.min(rearPct, 100)}%` }} />
                </div>
                <span className="value">
                  {metrics!.rearAxleKg.toFixed(1)} kg ({rearPct.toFixed(0)}%)
                </span>
              </div>
            </div>
          )}

          {/* ── L/R Balance ─────────────────────────────────────────────── */}
          <div className="metric-group">
            <h4>{t.balance}</h4>
            <div className={`metric ${lrPct > maxLRDiff ? 'danger' : 'ok'}`}>
              <span className="label">{t.lrImbalance}</span>
              <span className="value">{lrPct.toFixed(1)}%</span>
            </div>
            <div className="balance-bars">
              <div className="balance-side">
                <span>L</span>
                <div className="balance-bar">
                  <div style={{ width: `${totalWeight > 0 ? (leftKg / totalWeight) * 100 : 0}%` }} />
                </div>
                <span>{leftKg.toFixed(0)} kg</span>
              </div>
              <div className="balance-side">
                <span>R</span>
                <div className="balance-bar">
                  <div style={{ width: `${totalWeight > 0 ? (rightKg / totalWeight) * 100 : 0}%` }} />
                </div>
                <span>{rightKg.toFixed(0)} kg</span>
              </div>
            </div>
          </div>

          {/* ── Warnings ────────────────────────────────────────────────── */}
          {warnings.length > 0 && (
            <div className="warnings">
              <h4>{t.warnings}</h4>
              <ul>
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
