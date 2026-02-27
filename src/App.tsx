import { useState } from 'react'
import './App.css'

function App() {
  return (
    <div className="app">
      <header>
        <h1>Truck Load Planner</h1>
      </header>
      
      <main>
        <aside className="sidebar">
          <h2>Trucks</h2>
          <p className="placeholder">Truck selector coming soon...</p>
          
          <h2>Cases</h2>
          <p className="placeholder">Case inventory coming soon...</p>
        </aside>
        
        <section className="canvas">
          <div className="truck-view">
            <p className="placeholder">3D truck view coming soon...</p>
          </div>
          
          <div className="metrics-panel">
            <h3>Metrics</h3>
            <div className="metric">
              <span>Total Weight:</span>
              <span>0 kg</span>
            </div>
            <div className="metric">
              <span>Front Axle:</span>
              <span>0 kg</span>
            </div>
            <div className="metric">
              <span>Rear Axle:</span>
              <span>0 kg</span>
            </div>
            <div className="metric">
              <span>L/R Balance:</span>
              <span>0%</span>
            </div>
          </div>
        </section>
        
        <aside className="panel">
          <h2>Validation</h2>
          <p className="placeholder">No violations</p>
          
          <h2>Actions</h2>
          <button disabled>Auto-Pack</button>
          <button disabled>Clear</button>
          <button disabled>Export</button>
        </aside>
      </main>
    </div>
  )
}

export default App
