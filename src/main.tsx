import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { HapticsProvider } from './hooks/useHaptics.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <HapticsProvider>
        <App />
      </HapticsProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
