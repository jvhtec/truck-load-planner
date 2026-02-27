import type { LoadMetrics } from '../core/types';

interface MetricsPanelProps {
  metrics: LoadMetrics | null;
  truck: { axle: { maxFrontKg: number; maxRearKg: number }; balance: { maxLeftRightPercentDiff: number } } | null;
}

export function MetricsPanel({ metrics, truck }: MetricsPanelProps) {
  if (!metrics) {
    return (
      <div className="metrics-panel">
        <h3>Metrics</h3>
        <p className="empty-message">No data yet</p>
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
    <div className="metrics-panel">
      <h3>Metrics</h3>
      
      <div className="metric-group">
        <div className="metric">
          <span className="label">Total Cargo</span>
          <span className="value">{metrics.totalWeightKg.toFixed(1)} kg</span>
        </div>
        
        <div className="metric">
          <span className="label">Max Stack Height</span>
          <span className="value">{(metrics.maxStackHeightMm / 1000).toFixed(2)} m</span>
        </div>
      </div>

      <div className="metric-group">
        <h4>Axle Load</h4>
        
        <div className={`metric ${getStatus(frontPct, 100)}`}>
          <span className="label">Front Axle</span>
          <div className="bar-container">
            <div className="bar" style={{ width: `${Math.min(frontPct, 100)}%` }} />
          </div>
          <span className="value">{metrics.frontAxleKg.toFixed(1)} kg ({frontPct.toFixed(0)}%)</span>
        </div>
        
        <div className={`metric ${getStatus(rearPct, 100)}`}>
          <span className="label">Rear Axle</span>
          <div className="bar-container">
            <div className="bar" style={{ width: `${Math.min(rearPct, 100)}%` }} />
          </div>
          <span className="value">{metrics.rearAxleKg.toFixed(1)} kg ({rearPct.toFixed(0)}%)</span>
        </div>
      </div>

      <div className="metric-group">
        <h4>Balance</h4>
        
        <div className={`metric ${metrics.lrImbalancePercent > (truck?.balance.maxLeftRightPercentDiff || 10) ? 'danger' : 'ok'}`}>
          <span className="label">L/R Imbalance</span>
          <span className="value">{metrics.lrImbalancePercent.toFixed(1)}%</span>
        </div>
        
        <div className="balance-bars">
          <div className="balance-side">
            <span>L</span>
            <div className="balance-bar">
              <div style={{ width: `${(metrics.leftWeightKg / metrics.totalWeightKg) * 100}%` }} />
            </div>
            <span>{metrics.leftWeightKg.toFixed(0)} kg</span>
          </div>
          <div className="balance-side">
            <span>R</span>
            <div className="balance-bar">
              <div style={{ width: `${(metrics.rightWeightKg / metrics.totalWeightKg) * 100}%` }} />
            </div>
            <span>{metrics.rightWeightKg.toFixed(0)} kg</span>
          </div>
        </div>
      </div>

      {metrics.warnings.length > 0 && (
        <div className="warnings">
          <h4>⚠️ Warnings</h4>
          <ul>
            {metrics.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
