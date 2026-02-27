import { useState, useEffect } from 'react';
import { TruckView3D } from './components/TruckView3D';
import { TruckSelector } from './components/TruckSelector';
import { CaseCatalog } from './components/CaseCatalog';
import { MetricsPanel } from './components/MetricsPanel';
import { usePlanner } from './hooks/usePlanner';
import type { SavedPlan } from './hooks/usePlanner';
import './App.css';

function App() {
  const [state, actions] = usePlanner();
  const [autoPackQuantities, setAutoPackQuantities] = useState<Record<string, number>>({});
  const [planName, setPlanName] = useState('');
  const [savedPlans, setSavedPlans] = useState<SavedPlan[]>([]);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (showLoadDialog) {
      actions.listPlans().then(setSavedPlans);
    }
  }, [showLoadDialog, actions]);

  if (state.loading) {
    return (
      <div className="app loading">
        <div className="spinner" />
        <p>Loading data from Supabase...</p>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="app error">
        <h2>Error</h2>
        <p>{state.error}</p>
        <p className="hint">Make sure you've run schema.sql and seed.sql in Supabase</p>
      </div>
    );
  }

  const selectedInstance = state.instances.find(i => i.id === state.selectedInstanceId);
  const selectedSku = selectedInstance ? state.skus.get(selectedInstance.skuId) : null;

  return (
    <div className="app">
      <header className="app-header">
        <h1>Truck Load Planner</h1>
        <div className="header-actions">
          <button onClick={() => setShowSaveDialog(true)} disabled={!state.truck || state.instances.length === 0}>
            Save Plan
          </button>
          <button onClick={() => setShowLoadDialog(true)}>
            Load Plan
          </button>
          <button onClick={() => actions.clearAll()} disabled={state.instances.length === 0}>
            Clear All
          </button>
          <button
            onClick={() => {
              const qty = new Map(Object.entries(autoPackQuantities).map(([k, v]) => [k, Number(v)]));
              actions.runAutoPack(qty);
            }}
            disabled={!state.truck}
          >
            Auto Pack
          </button>
        </div>
      </header>

      <main className="app-main">
        <aside className="sidebar left">
          <TruckSelector
            trucks={state.trucks}
            selected={state.truck}
            onSelect={actions.setTruck}
          />

          <div className="auto-pack-section">
            <h3>Auto Pack Quantities</h3>
            <div className="quantity-inputs">
              {state.cases.map(c => (
                <label key={c.skuId}>
                  <span>{c.name}</span>
                  <input
                    type="number"
                    min="0"
                    value={autoPackQuantities[c.skuId] || 0}
                    onChange={(e) => setAutoPackQuantities(prev => ({
                      ...prev,
                      [c.skuId]: Number(e.target.value)
                    }))}
                  />
                </label>
              ))}
            </div>
          </div>
        </aside>

        <section className="main-view">
          <TruckView3D
            truck={state.truck}
            instances={state.instances}
            selectedId={state.selectedInstanceId}
            onSelect={actions.selectInstance}
          />

          {state.validation && !state.validation.valid && (
            <div className="validation-error">
              <h4>Cannot Place</h4>
              <ul>
                {state.validation.violations.map((v, i) => (
                  <li key={i}>{v}</li>
                ))}
              </ul>
              {state.validation.details && (
                <pre>{JSON.stringify(state.validation.details, null, 2)}</pre>
              )}
            </div>
          )}
        </section>

        <aside className="sidebar right">
          <CaseCatalog
            cases={state.cases}
            onPlace={(skuId, pos, yaw) => {
              const result = actions.placeCase(skuId, pos, yaw);
              if (!result.valid) {
                console.warn('Placement failed:', result);
              }
            }}
          />

          <MetricsPanel
            metrics={state.metrics}
            truck={state.truck}
          />

          {selectedInstance && (
            <div className="selected-instance">
              <h4>Selected Case</h4>
              {selectedSku && <p className="selected-name">{selectedSku.name}</p>}
              <div className="selected-details">
                <span>ID: {selectedInstance.id}</span>
                <span>Position: ({selectedInstance.position.x}, {selectedInstance.position.y}, {selectedInstance.position.z}) mm</span>
                <span>Yaw: {selectedInstance.yaw}&deg;</span>
                {selectedSku && <span>Weight: {selectedSku.weightKg} kg</span>}
                {selectedSku && <span>Dims: {selectedSku.dims.l}&times;{selectedSku.dims.w}&times;{selectedSku.dims.h} mm</span>}
              </div>
              <button onClick={() => actions.removeCase(state.selectedInstanceId!)}>
                Remove
              </button>
            </div>
          )}
        </aside>
      </main>

      {/* Save Plan Dialog */}
      {showSaveDialog && (
        <div className="dialog-overlay" onClick={() => setShowSaveDialog(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Save Load Plan</h3>
            <input
              type="text"
              placeholder="Plan name..."
              value={planName}
              onChange={(e) => setPlanName(e.target.value)}
              autoFocus
            />
            <div className="dialog-actions">
              <button onClick={() => setShowSaveDialog(false)}>Cancel</button>
              <button
                className="primary"
                disabled={!planName.trim() || saving}
                onClick={async () => {
                  setSaving(true);
                  await actions.savePlan(planName.trim());
                  setSaving(false);
                  setPlanName('');
                  setShowSaveDialog(false);
                }}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Load Plan Dialog */}
      {showLoadDialog && (
        <div className="dialog-overlay" onClick={() => setShowLoadDialog(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Load Plan</h3>
            {savedPlans.length === 0 ? (
              <p className="empty-message">No saved plans</p>
            ) : (
              <div className="plan-list">
                {savedPlans.map(plan => (
                  <button
                    key={plan.id}
                    className="plan-card"
                    onClick={async () => {
                      await actions.loadPlan(plan.id);
                      setShowLoadDialog(false);
                    }}
                  >
                    <div className="plan-name">{plan.name}</div>
                    <div className="plan-meta">
                      {plan.totalWeightKg?.toFixed(0) ?? 0} kg | {plan.status}
                    </div>
                    <div className="plan-date">
                      {new Date(plan.createdAt).toLocaleDateString()}
                    </div>
                  </button>
                ))}
              </div>
            )}
            <div className="dialog-actions">
              <button onClick={() => setShowLoadDialog(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
