import { useState, useEffect } from 'react';
import { TruckView3D } from './components/TruckView3D';
import { TruckSelector } from './components/TruckSelector';
import { CaseCatalog } from './components/CaseCatalog';
import { MetricsPanel } from './components/MetricsPanel';
import { usePlanner } from './hooks/usePlanner';
import type { SavedPlan } from './hooks/usePlanner';
import type { Yaw } from './core/types';
import './App.css';

function App() {
  const [state, actions] = usePlanner();
  const [autoPackQuantities, setAutoPackQuantities] = useState<Record<string, number>>({});
  const [planName, setPlanName] = useState('');
  const [savedPlans, setSavedPlans] = useState<SavedPlan[]>([]);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const [showNewTruck, setShowNewTruck] = useState(false);
  const [showNewCase, setShowNewCase] = useState(false);

  const [truckForm, setTruckForm] = useState({
    truckId: '', name: '', x: 7200, y: 2400, z: 2400, emptyWeightKg: 3500,
    frontX: 1000, rearX: 5500, maxFrontKg: 4000, maxRearKg: 8000, maxLr: 10,
  });

  const [caseForm, setCaseForm] = useState({
    skuId: '', name: '', l: 800, w: 600, h: 400, weightKg: 45,
    uprightOnly: false, canBeBase: true, topContactAllowed: true,
    maxLoadAboveKg: 90, minSupportRatio: 0.75,
  });

  useEffect(() => {
    if (showLoadDialog) {
      actions.listPlans().then(setSavedPlans).catch(err => console.error('Failed to load plans:', err));
    }
  }, [showLoadDialog]);

  if (state.loading) {
    return <div className="app loading"><div className="spinner" /><p>Loading data from Supabase...</p></div>;
  }

  if (state.error) {
    return <div className="app error"><h2>Error</h2><p>{state.error}</p><p className="hint">Make sure you've run schema.sql and seed.sql in Supabase</p></div>;
  }

  const selectedInstance = state.instances.find(i => i.id === state.selectedInstanceId);
  const selectedSku = selectedInstance ? state.skus.get(selectedInstance.skuId) : null;

  return (
    <div className="app">
      <header className="app-header">
        <h1>Truck Load Planner</h1>
        <div className="header-actions">
          <button onClick={() => setLeftCollapsed(v => !v)}>{leftCollapsed ? 'Show Left' : 'Hide Left'}</button>
          <button onClick={() => setRightCollapsed(v => !v)}>{rightCollapsed ? 'Show Right' : 'Hide Right'}</button>
          <button onClick={() => setShowNewTruck(true)}>New Truck Type</button>
          <button onClick={() => setShowNewCase(true)}>New Case Type</button>
          <button onClick={() => setShowSaveDialog(true)} disabled={!state.truck || state.instances.length === 0}>Save Plan</button>
          <button onClick={() => setShowLoadDialog(true)}>Load Plan</button>
          <button onClick={() => actions.clearAll()} disabled={state.instances.length === 0}>Clear All</button>
          <button onClick={() => actions.runAutoPack(new Map(Object.entries(autoPackQuantities).map(([k, v]) => [k, Number(v)])))} disabled={!state.truck}>Auto Pack</button>
        </div>
      </header>

      <main className={`app-main ${leftCollapsed ? 'left-collapsed' : ''} ${rightCollapsed ? 'right-collapsed' : ''}`}>
        {!leftCollapsed && <aside className="sidebar left">
          <TruckSelector trucks={state.trucks} selected={state.truck} onSelect={actions.setTruck} />
          <div className="auto-pack-section">
            <h3>Auto Pack Quantities</h3>
            <div className="quantity-inputs">
              {state.cases.map(c => (
                <label key={c.skuId}><span>{c.name}</span><input type="number" min="0" value={autoPackQuantities[c.skuId] || 0} onChange={(e) => setAutoPackQuantities(prev => ({ ...prev, [c.skuId]: Number(e.target.value) }))} /></label>
              ))}
            </div>
          </div>
        </aside>}

        <section className="main-view">
          <TruckView3D truck={state.truck} instances={state.instances} selectedId={state.selectedInstanceId} onSelect={actions.selectInstance} />
          {state.validation && !state.validation.valid && (
            <div className="validation-error"><h4>Cannot Place</h4><ul>{state.validation.violations.map((v, i) => <li key={i}>{v}</li>)}</ul></div>
          )}
        </section>

        {!rightCollapsed && <aside className="sidebar right">
          <CaseCatalog
            cases={state.cases}
            onPlace={(skuId, pos, yaw) => {
              const result = actions.placeCase(skuId, pos, yaw);
              if (!result.valid) console.warn('Placement failed:', result);
            }}
          />

          <div className="placed-items">
            <h3>Placed Items (drag to swap)</h3>
            <div className="placed-list">
              {state.instances.map(inst => (
                <button
                  key={inst.id}
                  className={`placed-card ${state.selectedInstanceId === inst.id ? 'selected' : ''}`}
                  draggable
                  onDragStart={() => setDraggedId(inst.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (draggedId && draggedId !== inst.id) {
                      const res = actions.swapInstancePositions(draggedId, inst.id);
                      if (!res.valid) console.warn('Swap failed', res);
                    }
                  }}
                  onClick={() => actions.selectInstance(inst.id)}
                >
                  <span>{inst.id}</span>
                  <small>({inst.position.x}, {inst.position.y}, {inst.position.z})</small>
                </button>
              ))}
            </div>
          </div>

          <MetricsPanel metrics={state.metrics} truck={state.truck} />

          {selectedInstance && selectedSku && (
            <div className="selected-instance">
              <h4>Selected Case</h4>
              <p className="selected-name">{selectedSku.name}</p>
              <div className="selected-details">
                <span>ID: {selectedInstance.id}</span>
                <span>Weight: {selectedSku.weightKg} kg</span>
              </div>
              <div className="position-inputs compact">
                <label>X<input type="number" value={selectedInstance.position.x} onChange={(e) => actions.updateInstance(selectedInstance.id, { position: { ...selectedInstance.position, x: Number(e.target.value) } })} /></label>
                <label>Y<input type="number" value={selectedInstance.position.y} onChange={(e) => actions.updateInstance(selectedInstance.id, { position: { ...selectedInstance.position, y: Number(e.target.value) } })} /></label>
                <label>Z<input type="number" value={selectedInstance.position.z} onChange={(e) => actions.updateInstance(selectedInstance.id, { position: { ...selectedInstance.position, z: Number(e.target.value) } })} /></label>
              </div>
              <div className="yaw-buttons">
                {[0, 90, 180, 270].map((y) => (
                  <button key={y} className={selectedInstance.yaw === y ? 'selected' : ''} onClick={() => actions.updateInstance(selectedInstance.id, { yaw: y as Yaw })}>
                    {y}°
                  </button>
                ))}
              </div>
              <div className="position-inputs compact">
                <label>Tilt X<input type="number" value={selectedInstance.tilt?.x ?? 0} onChange={(e) => actions.updateInstance(selectedInstance.id, { tilt: { x: Number(e.target.value), y: selectedInstance.tilt?.y ?? 0 } })} /></label>
                <label>Tilt Y<input type="number" value={selectedInstance.tilt?.y ?? 0} onChange={(e) => actions.updateInstance(selectedInstance.id, { tilt: { x: selectedInstance.tilt?.x ?? 0, y: Number(e.target.value) } })} /></label>
              </div>
              <button onClick={() => actions.removeCase(selectedInstance.id)}>Remove</button>
            </div>
          )}
        </aside>}
      </main>

      {showNewTruck && (
        <div className="dialog-overlay" onClick={() => setShowNewTruck(false)}>
          <div className="dialog" onClick={e => e.stopPropagation()}>
            <h3>Create Truck Type</h3>
            <div className="form-grid">
              <input placeholder="Truck ID" value={truckForm.truckId} onChange={e => setTruckForm({ ...truckForm, truckId: e.target.value })} />
              <input placeholder="Name" value={truckForm.name} onChange={e => setTruckForm({ ...truckForm, name: e.target.value })} />
              <input type="number" placeholder="Length" value={truckForm.x} onChange={e => setTruckForm({ ...truckForm, x: Number(e.target.value) })} />
              <input type="number" placeholder="Width" value={truckForm.y} onChange={e => setTruckForm({ ...truckForm, y: Number(e.target.value) })} />
              <input type="number" placeholder="Height" value={truckForm.z} onChange={e => setTruckForm({ ...truckForm, z: Number(e.target.value) })} />
              <input type="number" placeholder="Empty weight" value={truckForm.emptyWeightKg} onChange={e => setTruckForm({ ...truckForm, emptyWeightKg: Number(e.target.value) })} />
            </div>
            <div className="dialog-actions">
              <button onClick={() => setShowNewTruck(false)}>Cancel</button>
              <button className="primary" onClick={async () => {
                await actions.createTruck({
                  truckId: truckForm.truckId,
                  name: truckForm.name,
                  innerDims: { x: truckForm.x, y: truckForm.y, z: truckForm.z },
                  emptyWeightKg: truckForm.emptyWeightKg,
                  axle: { frontX: truckForm.frontX, rearX: truckForm.rearX, maxFrontKg: truckForm.maxFrontKg, maxRearKg: truckForm.maxRearKg },
                  maxLeftRightPercentDiff: truckForm.maxLr,
                });
                setShowNewTruck(false);
              }}>Create</button>
            </div>
          </div>
        </div>
      )}

      {showNewCase && (
        <div className="dialog-overlay" onClick={() => setShowNewCase(false)}>
          <div className="dialog" onClick={e => e.stopPropagation()}>
            <h3>Create Case Type</h3>
            <div className="form-grid">
              <input placeholder="SKU ID" value={caseForm.skuId} onChange={e => setCaseForm({ ...caseForm, skuId: e.target.value })} />
              <input placeholder="Name" value={caseForm.name} onChange={e => setCaseForm({ ...caseForm, name: e.target.value })} />
              <input type="number" placeholder="Length" value={caseForm.l} onChange={e => setCaseForm({ ...caseForm, l: Number(e.target.value) })} />
              <input type="number" placeholder="Width" value={caseForm.w} onChange={e => setCaseForm({ ...caseForm, w: Number(e.target.value) })} />
              <input type="number" placeholder="Height" value={caseForm.h} onChange={e => setCaseForm({ ...caseForm, h: Number(e.target.value) })} />
              <input type="number" placeholder="Weight" value={caseForm.weightKg} onChange={e => setCaseForm({ ...caseForm, weightKg: Number(e.target.value) })} />
            </div>
            <div className="dialog-actions">
              <button onClick={() => setShowNewCase(false)}>Cancel</button>
              <button className="primary" onClick={async () => {
                await actions.createCase({
                  skuId: caseForm.skuId,
                  name: caseForm.name,
                  dims: { l: caseForm.l, w: caseForm.w, h: caseForm.h },
                  weightKg: caseForm.weightKg,
                  uprightOnly: caseForm.uprightOnly,
                  allowedYaw: [0, 90, 180, 270],
                  canBeBase: caseForm.canBeBase,
                  topContactAllowed: caseForm.topContactAllowed,
                  maxLoadAboveKg: caseForm.maxLoadAboveKg,
                  minSupportRatio: caseForm.minSupportRatio,
                });
                setShowNewCase(false);
              }}>Create</button>
            </div>
          </div>
        </div>
      )}

      {showSaveDialog && (
        <div className="dialog-overlay" onClick={() => setShowSaveDialog(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Save Load Plan</h3>
            <input type="text" placeholder="Plan name..." value={planName} onChange={(e) => setPlanName(e.target.value)} autoFocus />
            <div className="dialog-actions">
              <button onClick={() => setShowSaveDialog(false)}>Cancel</button>
              <button className="primary" disabled={!planName.trim() || saving} onClick={async () => {
                setSaving(true);
                try { await actions.savePlan(planName.trim()); } finally { setSaving(false); setPlanName(''); setShowSaveDialog(false); }
              }}>{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {showLoadDialog && (
        <div className="dialog-overlay" onClick={() => setShowLoadDialog(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Load Plan</h3>
            {savedPlans.length === 0 ? <p className="empty-message">No saved plans</p> : (
              <div className="plan-list">
                {savedPlans.map(plan => (
                  <button key={plan.id} className="plan-card" onClick={async () => { await actions.loadPlan(plan.id); setShowLoadDialog(false); }}>
                    <div className="plan-name">{plan.name}</div>
                    <div className="plan-meta">{plan.totalWeightKg?.toFixed(0) ?? 0} kg | {plan.status}</div>
                    <div className="plan-date">{new Date(plan.createdAt).toLocaleDateString()}</div>
                  </button>
                ))}
              </div>
            )}
            <div className="dialog-actions"><button onClick={() => setShowLoadDialog(false)}>Close</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
