import type { LoadMetrics } from '../core/types';

interface MetricsPanelProps {
  metrics: LoadMetrics | null;
  truck: { axle: { maxFrontKg: number; maxRearKg: number }; balance: { maxLeftRightPercentDiff: number } } | null;
  lang: 'es' | 'en';
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export function MetricsPanel({ metrics, truck, lang, collapsed, onToggleCollapsed }: MetricsPanelProps) {
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
        balance: 'Balance',
        lrImbalance: 'L/R Imbalance',
        warnings: 'Warnings',
      };

  const toggleLabel = collapsed ? t.expand : t.collapse;

  if (!metrics) {
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

  const frontPct = truck ? (metrics.frontAxleKg / truck.axle.maxFrontKg) * 100 : 0;
  const rearPct = truck ? (metrics.rearAxleKg / truck.axle.maxRearKg) * 100 : 0;

  const getStatus = (pct: number, max: number) => {
    if (pct > 100) return 'danger';
    if (pct > max * 0.8) return 'warning';
    return 'ok';
  };

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
          <div className="metric-group">
            <div className="metric">
              <span className="label">{t.totalCargo}</span>
              <span className="value">{metrics.totalWeightKg.toFixed(1)} kg</span>
            </div>

            <div className="metric">
              <span className="label">{t.maxStackHeight}</span>
              <span className="value">{metrics.maxStackHeightMm.toFixed(0)} mm</span>
            </div>
          </div>

          <div className="metric-group">
            <h4>{t.axleLoad}</h4>

            <div className={`metric ${getStatus(frontPct, 100)}`}>
              <span className="label">{t.frontAxle}</span>
              <div className="bar-container">
                <div className="bar" style={{ width: `${Math.min(frontPct, 100)}%` }} />
              </div>
              <span className="value">{metrics.frontAxleKg.toFixed(1)} kg ({frontPct.toFixed(0)}%)</span>
            </div>

            <div className={`metric ${getStatus(rearPct, 100)}`}>
              <span className="label">{t.rearAxle}</span>
              <div className="bar-container">
                <div className="bar" style={{ width: `${Math.min(rearPct, 100)}%` }} />
              </div>
              <span className="value">{metrics.rearAxleKg.toFixed(1)} kg ({rearPct.toFixed(0)}%)</span>
            </div>
          </div>

          <div className="metric-group">
            <h4>{t.balance}</h4>

            <div className={`metric ${metrics.lrImbalancePercent > (truck?.balance.maxLeftRightPercentDiff || 10) ? 'danger' : 'ok'}`}>
              <span className="label">{t.lrImbalance}</span>
              <span className="value">{metrics.lrImbalancePercent.toFixed(1)}%</span>
            </div>

            <div className="balance-bars">
              <div className="balance-side">
                <span>L</span>
                <div className="balance-bar">
                  <div style={{ width: `${metrics.totalWeightKg > 0 ? (metrics.leftWeightKg / metrics.totalWeightKg) * 100 : 0}%` }} />
                </div>
                <span>{metrics.leftWeightKg.toFixed(0)} kg</span>
              </div>
              <div className="balance-side">
                <span>R</span>
                <div className="balance-bar">
                  <div style={{ width: `${metrics.totalWeightKg > 0 ? (metrics.rightWeightKg / metrics.totalWeightKg) * 100 : 0}%` }} />
                </div>
                <span>{metrics.rightWeightKg.toFixed(0)} kg</span>
              </div>
            </div>
          </div>

          {metrics.warnings.length > 0 && (
            <div className="warnings">
              <h4>{t.warnings}</h4>
              <ul>
                {metrics.warnings.map((w, i) => (
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
