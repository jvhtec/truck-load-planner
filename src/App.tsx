import { useState } from 'react';
import { TruckView3D } from './components/TruckView3D';
import { TruckSelector } from './components/TruckSelector';
import { CaseCatalog } from './components/CaseCatalog';
import { MetricsPanel } from './components/MetricsPanel';
import { usePlanner } from './hooks/usePlanner';
import './App.css';

function App() {
  const [state, actions] = usePlanner();
  const [autoPackQuantities, setAutoPackQuantities] = useState<Record<string, number>>({});

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

  return (
    <div className="app">
      <header className="app-header">
        <h1>🚛 Truck Load Planner</h1>
        <div className="header-actions">
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
              {state.cases.slice(0, 5).map(c => (
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
              <h4>⚠️ Cannot Place</h4>
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
          
          {state.selectedInstanceId && (
            <div className="selected-instance">
              <h4>Selected Case</h4>
              <p>ID: {state.selectedInstanceId}</p>
              <button onClick={() => actions.removeCase(state.selectedInstanceId!)}>
                Remove
              </button>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

export default App;
