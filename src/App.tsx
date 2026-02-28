import { useState, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { TruckView3D } from './components/TruckView3D';
import type { CameraPreset } from './components/TruckView3D';
import { TruckSelector } from './components/TruckSelector';
import { CaseCatalog } from './components/CaseCatalog';
import { MetricsPanel } from './components/MetricsPanel';
import { usePlanner } from './hooks/usePlanner';
import type { SavedPlan } from './hooks/usePlanner';
import type { CaseInstance, Yaw } from './core/types';
import './App.css';
import { buildStackClass, formatCaseCsv, parseCaseCsv, sanitizeSkuId } from './lib/caseCsv';

const ORDER_BUCKET_MM = 100;

function centerX(inst: CaseInstance): number {
  return (inst.aabb.min.x + inst.aabb.max.x) / 2;
}

function centerY(inst: CaseInstance): number {
  return (inst.aabb.min.y + inst.aabb.max.y) / 2;
}

function bucket(value: number): number {
  return Math.round(value / ORDER_BUCKET_MM);
}

function buildItemNumberMap(instances: CaseInstance[]): Map<string, number> {
  const sorted = [...instances].sort((a, b) => {
    const ay = bucket(centerY(a));
    const by = bucket(centerY(b));
    if (ay !== by) return ay - by; // left -> right

    const ax = bucket(centerX(a));
    const bx = bucket(centerX(b));
    if (ax !== bx) return ax - bx; // front -> back

    const az = bucket(a.aabb.min.z);
    const bz = bucket(b.aabb.min.z);
    if (az !== bz) return az - bz; // bottom -> top

    const dy = centerY(a) - centerY(b);
    if (dy !== 0) return dy;
    const dx = centerX(a) - centerX(b);
    if (dx !== 0) return dx;
    const dz = a.aabb.min.z - b.aabb.min.z;
    if (dz !== 0) return dz;
    return a.id.localeCompare(b.id);
  });

  const map = new Map<string, number>();
  sorted.forEach((inst, idx) => map.set(inst.id, idx + 1));
  return map;
}

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
  const [touchDropId, setTouchDropId] = useState<string | null>(null);
  const [viewLocked, setViewLocked] = useState(false);
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('iso');
  const [itemActionsMenu, setItemActionsMenu] = useState<{ id: string; x: number; y: number; tiltAllowed: boolean } | null>(null);
  const [selectedStagedIds, setSelectedStagedIds] = useState<string[]>([]);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [printing, setPrinting] = useState(false);
  const [lang, setLang] = useState<'es' | 'en'>('es');
  const [showMetricsOverlay, setShowMetricsOverlay] = useState(true);
  const [showSpatialMetrics, setShowSpatialMetrics] = useState(false);
  const [mobileTab, setMobileTab] = useState<'view' | 'trucks' | 'cases'>('trucks');
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const caseImportInputRef = useRef<HTMLInputElement | null>(null);

  const [showNewTruck, setShowNewTruck] = useState(false);
  const [showNewCase, setShowNewCase] = useState(false);

  const [truckForm, setTruckForm] = useState({
    truckId: '', name: '', x: 7200, y: 2400, z: 2400, emptyWeightKg: 3500,
    frontX: 1000, rearX: 5500, maxFrontKg: 4000, maxRearKg: 8000, maxLr: 10,
  });

  const [caseForm, setCaseForm] = useState({
    skuId: '', name: '', l: 800, w: 600, h: 400, weightKg: 45,
    uprightOnly: false, canBeBase: true, topContactAllowed: true,
    maxLoadAboveKg: 90, minSupportRatio: 0.75, color: '#6366f1', tiltAllowed: false,
  });

  const t = lang === 'es'
    ? {
        loading: 'Cargando datos desde Supabase...',
        error: 'Error',
        errorHint: 'Asegurate de ejecutar schema.sql y seed.sql en Supabase',
        appTitle: 'Planificador de Carga de Camiones',
        showLeft: 'Mostrar Izquierda',
        hideLeft: 'Ocultar Izquierda',
        showRight: 'Mostrar Derecha',
        hideRight: 'Ocultar Derecha',
        newTruckType: 'Nuevo Tipo de Camion',
        newCaseType: 'Nuevo Tipo de Caja',
        savePlan: 'Guardar Plan',
        preparingPdf: 'Preparando PDF...',
        printPdf: 'Imprimir / PDF',
        printItemList: 'Imprimir Lista',
        lightMode: 'Modo Claro',
        darkMode: 'Modo Oscuro',
        loadPlan: 'Cargar Plan',
        clearAll: 'Limpiar Todo',
        autoPack: 'Auto Carga',
        autoPackQty: 'Cantidades Auto Carga',
        exportCasesCsv: 'Exportar Casos (CSV)',
        importCasesCsv: 'Importar Casos (CSV/XLSX*)',
        importCasesHelp: '* XLSX no disponible en este entorno; exporta como CSV para importar.',
        lockView: 'Bloquear Vista',
        unlockView: 'Desbloquear Vista',
        top: 'Superior',
        sideLeft: 'Lado Izquierdo',
        sideRight: 'Lado Derecho',
        iso: 'Iso',
        viewHint: 'Clic derecho en una caja para acciones.',
        showMetricsOverlay: 'Mostrar Panel Metricas',
        hideMetricsOverlay: 'Ocultar Panel Metricas',
        showSpatialMetrics: 'Mostrar Guias 3D',
        hideSpatialMetrics: 'Ocultar Guias 3D',
        rotate90: 'Rotar 90°',
        toggleTiltY90: 'Alternar Inclinacion Y 90°',
        cannotPlace: 'No se puede colocar',
        stagedItems: 'Items en Zona Externa (fuera del camion)',
        autoplaceSelected: 'Auto ubicar seleccionados',
        staged: 'en zona externa',
        placedItems: 'Items Colocados (arrastrar para intercambiar)',
        dropTarget: 'Objetivo de suelta',
        dragToSwap: 'Arrastrar / tocar para intercambiar',
        selectedCase: 'Caja Seleccionada',
        loadOrder: 'Orden de Carga',
        id: 'ID',
        weightKg: 'Peso',
        noTilt: 'Sin Inclinacion',
        tiltY90: 'Inclinacion Y 90°',
        remove: 'Eliminar',
        createTruckType: 'Crear Tipo de Camion',
        truckHelp: 'Dimensiones segun coordenadas del camion: X = largo (frente a fondo), Y = ancho (izquierda a derecha), Z = alto (suelo a techo).',
        truckId: 'ID Camion',
        name: 'Nombre',
        lengthX: 'Largo X (mm)',
        widthY: 'Ancho Y (mm)',
        heightZ: 'Alto Z (mm)',
        emptyWeight: 'Peso Vacio (kg)',
        cancel: 'Cancelar',
        create: 'Crear',
        createCaseType: 'Crear Tipo de Caja',
        caseHelp: 'Dimensiones de la caja por ejes del camion despues de rotar: L = X (frente a fondo), W = Y (izquierda a derecha), H = Z (arriba).',
        skuId: 'ID SKU',
        lengthL: 'Largo L (mm)',
        widthW: 'Ancho W (mm)',
        heightH: 'Alto H (mm)',
        caseWeightKg: 'Peso (kg)',
        stackable: 'Apilable (Puede ser base)',
        tiltAllowed: 'Inclinacion Permitida (Y 90°)',
        color: 'Color',
        saveLoadPlan: 'Guardar Plan de Carga',
        planNamePlaceholder: 'Nombre del plan...',
        saving: 'Guardando...',
        save: 'Guardar',
        loadPlanTitle: 'Cargar Plan',
        noSavedPlans: 'No hay planes guardados',
        close: 'Cerrar',
        reportTitle: 'Planificador de Carga - Reporte',
        reportTruck: 'Camion',
        reportPrinted: 'Impreso',
        reportItems: 'Items',
        reportTopView: 'Vista Superior',
        reportSideLeft: 'Vista Lado Izquierdo',
        reportSideRight: 'Vista Lado Derecho',
        reportIso: 'Vista Isometrica',
        reportCaptureUnavailable: 'Captura no disponible',
        itemListTitle: 'Planificador de Carga - Lista de Carga',
        listOrder: 'Orden',
        listSku: 'SKU',
        listName: 'Nombre',
        listDims: 'Dimensiones',
        listWeight: 'Peso',
        listPosition: 'Posicion',
        listPlacement: 'Ubicacion',
        rowLabel: 'Fila',
        placementFloor: 'en suelo',
        placementOnTop: 'encima de item',
        placementManual: 'segun coordenadas',
        mobileTabView: 'Vista 3D',
        mobileTabTrucks: 'Camiones',
        mobileTabCases: 'Cajas',
        mobileMenuTitle: 'Acciones',
      }
    : {
        loading: 'Loading data from Supabase...',
        error: 'Error',
        errorHint: 'Make sure you have run schema.sql and seed.sql in Supabase',
        appTitle: 'Truck Load Planner',
        showLeft: 'Show Left',
        hideLeft: 'Hide Left',
        showRight: 'Show Right',
        hideRight: 'Hide Right',
        newTruckType: 'New Truck Type',
        newCaseType: 'New Case Type',
        savePlan: 'Save Plan',
        preparingPdf: 'Preparing PDF...',
        printPdf: 'Print / PDF',
        printItemList: 'Print Item List',
        lightMode: 'Light Mode',
        darkMode: 'Dark Mode',
        loadPlan: 'Load Plan',
        clearAll: 'Clear All',
        autoPack: 'Auto Pack',
        autoPackQty: 'Auto Pack Quantities',
        exportCasesCsv: 'Export Cases (CSV)',
        importCasesCsv: 'Import Cases (CSV/XLSX*)',
        importCasesHelp: '* XLSX is not available in this environment; export as CSV to import.',
        lockView: 'Lock View',
        unlockView: 'Unlock View',
        top: 'Top',
        sideLeft: 'Side Left',
        sideRight: 'Side Right',
        iso: 'Iso',
        viewHint: 'Right-click a case for actions.',
        showMetricsOverlay: 'Show Metrics Panel',
        hideMetricsOverlay: 'Hide Metrics Panel',
        showSpatialMetrics: 'Show 3D Guides',
        hideSpatialMetrics: 'Hide 3D Guides',
        rotate90: 'Rotate 90°',
        toggleTiltY90: 'Toggle Tilt Y 90°',
        cannotPlace: 'Cannot Place',
        stagedItems: 'Staged Items (outside truck)',
        autoplaceSelected: 'Autoplace Selected',
        staged: 'staged',
        placedItems: 'Placed Items (drag to swap)',
        dropTarget: 'Drop target',
        dragToSwap: 'Drag / touch to swap',
        selectedCase: 'Selected Case',
        loadOrder: 'Load Order',
        id: 'ID',
        weightKg: 'Weight',
        noTilt: 'No Tilt',
        tiltY90: 'Tilt Y 90°',
        remove: 'Remove',
        createTruckType: 'Create Truck Type',
        truckHelp: 'Dimensions use truck coordinates: X = length (front to rear), Y = width (left to right), Z = height (floor to roof).',
        truckId: 'Truck ID',
        name: 'Name',
        lengthX: 'Length X (mm)',
        widthY: 'Width Y (mm)',
        heightZ: 'Height Z (mm)',
        emptyWeight: 'Empty Weight (kg)',
        cancel: 'Cancel',
        create: 'Create',
        createCaseType: 'Create Case Type',
        caseHelp: 'Case dimensions map to truck axes after rotation: L = X (front to rear), W = Y (left to right), H = Z (up).',
        skuId: 'SKU ID',
        lengthL: 'Length L (mm)',
        widthW: 'Width W (mm)',
        heightH: 'Height H (mm)',
        caseWeightKg: 'Weight (kg)',
        stackable: 'Stackable (Can Be Base)',
        tiltAllowed: 'Tilt Allowed (Y 90°)',
        color: 'Color',
        saveLoadPlan: 'Save Load Plan',
        planNamePlaceholder: 'Plan name...',
        saving: 'Saving...',
        save: 'Save',
        loadPlanTitle: 'Load Plan',
        noSavedPlans: 'No saved plans',
        close: 'Close',
        reportTitle: 'Truck Load Planner - Load Report',
        reportTruck: 'Truck',
        reportPrinted: 'Printed',
        reportItems: 'Items',
        reportTopView: 'Top View',
        reportSideLeft: 'Side Left View',
        reportSideRight: 'Side Right View',
        reportIso: 'Isometric View',
        reportCaptureUnavailable: 'Capture unavailable',
        itemListTitle: 'Truck Load Planner - Ordered Item List',
        listOrder: 'Order',
        listSku: 'SKU',
        listName: 'Name',
        listDims: 'Dimensions',
        listWeight: 'Weight',
        listPosition: 'Position',
        listPlacement: 'Placement',
        rowLabel: 'Row',
        placementFloor: 'on floor',
        placementOnTop: 'on top of item',
        placementManual: 'by coordinates',
        mobileTabView: '3D View',
        mobileTabTrucks: 'Trucks',
        mobileTabCases: 'Cases',
        mobileMenuTitle: 'Actions',
      };

  useEffect(() => {
    if (showLoadDialog) {
      actions.listPlans().then(setSavedPlans).catch(err => console.error('Failed to load plans:', err));
    }
  }, [showLoadDialog]);

  useEffect(() => {
    const staged = new Set(state.instances.filter(i => i.staged).map(i => i.id));
    setSelectedStagedIds(prev => prev.filter(id => staged.has(id)));
  }, [state.instances]);

  // Auto-switch mobile tab when truck selection changes
  useEffect(() => {
    if (state.truck) {
      setMobileTab('view');
    }
  }, [state.truck?.truckId]);

  if (state.loading) {
    return <div className="app loading"><div className="spinner" /><p>{t.loading}</p></div>;
  }

  if (state.error) {
    return <div className="app error"><h2>{t.error}</h2><p>{state.error}</p><p className="hint">{t.errorHint}</p></div>;
  }

  const selectedInstance = state.instances.find(i => i.id === state.selectedInstanceId);
  const selectedSku = selectedInstance ? state.skus.get(selectedInstance.skuId) : null;
  const stagedInstances = state.instances.filter(i => i.staged);
  const placedInstances = state.instances.filter(i => !i.staged);
  const hasStagedItems = stagedInstances.length > 0;
  const hasAutoLoadQuantities = state.cases.some((c) => Number(autoPackQuantities[c.skuId] ?? 0) > 0);
  const itemNumbers = buildItemNumberMap(placedInstances);

  const resolveManualDropPosition = (instanceId: string, requested: { x: number; y: number; z: number }) => {
    if (!state.truck) return requested;
    const moving = state.instances.find(i => i.id === instanceId);
    if (!moving) return requested;

    const movingSku = state.skus.get(moving.skuId);
    const minSupport = movingSku?.minSupportRatio ?? 0.75;
    const dx = moving.aabb.max.x - moving.aabb.min.x;
    const dy = moving.aabb.max.y - moving.aabb.min.y;
    const dz = moving.aabb.max.z - moving.aabb.min.z;
    const footprint = Math.max(1, dx * dy);

    const x = Math.max(0, Math.min(Math.round(requested.x), state.truck.innerDims.x - dx));
    const y = Math.max(0, Math.min(Math.round(requested.y), state.truck.innerDims.y - dy));

    const overlapWithCandidate = (other: typeof moving) => {
      const ox = Math.max(0, Math.min(x + dx, other.aabb.max.x) - Math.max(x, other.aabb.min.x));
      const oy = Math.max(0, Math.min(y + dy, other.aabb.max.y) - Math.max(y, other.aabb.min.y));
      return ox * oy;
    };

    const supportCandidates = state.instances
      .filter(i => i.id !== instanceId && !i.staged)
      .map(i => ({ inst: i, sku: state.skus.get(i.skuId), overlap: overlapWithCandidate(i) }))
      .filter(v => v.overlap > 0 && v.sku?.canBeBase && v.sku?.topContactAllowed);

    const topLevels = Array.from(new Set(supportCandidates.map(v => v.inst.aabb.max.z))).sort((a, b) => b - a);

    let z = 0;
    for (const top of topLevels) {
      if (top + dz > state.truck.innerDims.z) continue;
      const supportArea = supportCandidates
        .filter(v => v.inst.aabb.max.z === top)
        .reduce((sum, v) => sum + v.overlap, 0);
      if (supportArea / footprint >= minSupport) {
        z = top;
        break;
      }
    }

    return { x, y, z };
  };

  const waitForRender = async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 120));
  };

  const openPrintWindow = (html: string) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    const triggerPrint = () => {
      printWindow.print();
    };
    const images = Array.from(printWindow.document.images);
    if (images.length === 0) {
      setTimeout(triggerPrint, 150);
    } else {
      let pending = images.length;
      const done = () => {
        pending -= 1;
        if (pending <= 0) setTimeout(triggerPrint, 120);
      };
      images.forEach((img) => {
        if (img.complete) {
          done();
        } else {
          img.onload = done;
          img.onerror = done;
        }
      });
    }
  };

  const printOrderedItemList = async () => {
    if (!state.truck || placedInstances.length === 0 || printing) return;
    setPrinting(true);
    try {
      const sorted = [...placedInstances].sort((a, b) => (itemNumbers.get(a.id) ?? 9999) - (itemNumbers.get(b.id) ?? 9999));
      const rowAnchors: number[] = [];
      const findRow = (y: number) => {
        const tolerance = 80;
        for (let i = 0; i < rowAnchors.length; i += 1) {
          if (Math.abs(rowAnchors[i] - y) <= tolerance) return i + 1;
        }
        rowAnchors.push(y);
        return rowAnchors.length;
      };

      const overlapAreaXY = (a: typeof sorted[number], b: typeof sorted[number]) => {
        const ox = Math.max(0, Math.min(a.aabb.max.x, b.aabb.max.x) - Math.max(a.aabb.min.x, b.aabb.min.x));
        const oy = Math.max(0, Math.min(a.aabb.max.y, b.aabb.max.y) - Math.max(a.aabb.min.y, b.aabb.min.y));
        return ox * oy;
      };

      const rows = sorted.map((inst) => {
        const sku = state.skus.get(inst.skuId);
        const row = findRow(inst.position.y);
        const num = itemNumbers.get(inst.id) ?? 0;
        const zBottom = inst.aabb.min.z;
        let placement = `${t.rowLabel} ${row}: ${t.placementManual}`;
        if (zBottom === 0) {
          placement = `${t.rowLabel} ${row}: ${t.placementFloor}`;
        } else {
          let bestSupport: { num: number; area: number } | null = null;
          for (const other of sorted) {
            if (other.id === inst.id) continue;
            if (Math.abs(other.aabb.max.z - zBottom) > 5) continue;
            const area = overlapAreaXY(inst, other);
            if (area <= 0) continue;
            const supportNum = itemNumbers.get(other.id) ?? 0;
            if (!bestSupport || area > bestSupport.area) {
              bestSupport = { num: supportNum, area };
            }
          }
          if (bestSupport) {
            placement = `${t.rowLabel} ${row}: ${t.placementOnTop} #${bestSupport.num}`;
          }
        }

        return `<tr>
          <td>${num}</td>
          <td>${inst.skuId}</td>
          <td>${sku?.name ?? inst.skuId}</td>
          <td>${sku ? `${sku.dims.l}x${sku.dims.w}x${sku.dims.h} mm` : '-'}</td>
          <td>${sku ? `${sku.weightKg} kg` : '-'}</td>
          <td>(${inst.position.x}, ${inst.position.y}, ${inst.position.z})</td>
          <td>${placement}</td>
        </tr>`;
      }).join('');

      const html = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${t.itemListTitle}</title>
    <style>
      body { font-family: Segoe UI, Arial, sans-serif; margin: 20px; color: #111827; }
      h1 { margin: 0 0 4px; font-size: 20px; }
      .meta { margin-bottom: 16px; color: #374151; font-size: 12px; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
      th, td { border: 1px solid #d1d5db; padding: 6px; text-align: left; vertical-align: top; }
      th { background: #f3f4f6; }
      @media print { body { margin: 12mm; } }
    </style>
  </head>
  <body>
    <h1>${t.itemListTitle}</h1>
    <div class="meta">
      ${t.reportTruck}: ${state.truck.name} (${state.truck.truckId}) | ${t.reportPrinted}: ${new Date().toLocaleString(lang === 'es' ? 'es-ES' : 'en-US')} | ${t.reportItems}: ${placedInstances.length}
    </div>
    <table>
      <thead>
        <tr>
          <th>${t.listOrder}</th>
          <th>${t.listSku}</th>
          <th>${t.listName}</th>
          <th>${t.listDims}</th>
          <th>${t.listWeight}</th>
          <th>${t.listPosition}</th>
          <th>${t.listPlacement}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </body>
</html>`;

      openPrintWindow(html);
    } finally {
      setPrinting(false);
    }
  };

  const printReportPdf = async () => {
    if (!state.truck || placedInstances.length === 0 || printing) return;
    setPrinting(true);
    const previous = cameraPreset;

    try {
      const capture = async (preset: CameraPreset) => {
        flushSync(() => setCameraPreset(preset));
        for (let attempt = 0; attempt < 5; attempt += 1) {
          await waitForRender();
          const canvas = document.querySelector('.truck-view-3d canvas') as HTMLCanvasElement | null;
          if (!canvas) continue;
          const dataUrl = canvas.toDataURL('image/png');
          if (dataUrl && dataUrl !== 'data:,' && dataUrl.length > 1000) {
            return dataUrl;
          }
        }
        return '';
      };

      const views: Array<{ label: string; key: CameraPreset }> = [
        { label: t.reportTopView, key: 'top' },
        { label: t.reportSideLeft, key: 'side-left' },
        { label: t.reportSideRight, key: 'side-right' },
        { label: t.reportIso, key: 'iso' },
      ];
      const shots: Array<{ label: string; dataUrl: string }> = [];
      for (const view of views) {
        shots.push({ label: view.label, dataUrl: await capture(view.key) });
      }

      const itemRows = [...placedInstances]
        .sort((a, b) => (itemNumbers.get(a.id) ?? 9999) - (itemNumbers.get(b.id) ?? 9999))
        .map((inst) => {
          const num = itemNumbers.get(inst.id) ?? 0;
          return `<tr><td>${num}</td><td>${inst.skuId}</td><td>${inst.position.x}</td><td>${inst.position.y}</td><td>${inst.position.z}</td></tr>`;
        })
        .join('');

      const html = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${t.reportTitle}</title>
    <style>
      body { font-family: Segoe UI, Arial, sans-serif; margin: 20px; color: #111827; }
      h1 { margin: 0 0 4px; font-size: 20px; }
      .meta { margin-bottom: 16px; color: #374151; font-size: 12px; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .card { border: 1px solid #d1d5db; border-radius: 6px; padding: 8px; break-inside: avoid; }
      .card h3 { margin: 0 0 8px; font-size: 13px; }
      .card img { width: 100%; height: auto; border: 1px solid #e5e7eb; border-radius: 4px; }
      table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 12px; }
      th, td { border: 1px solid #d1d5db; padding: 6px; text-align: left; }
      th { background: #f3f4f6; }
      @media print { body { margin: 12mm; } }
    </style>
  </head>
  <body>
    <h1>${t.reportTitle}</h1>
    <div class="meta">
      ${t.reportTruck}: ${state.truck.name} (${state.truck.truckId}) | ${t.reportPrinted}: ${new Date().toLocaleString(lang === 'es' ? 'es-ES' : 'en-US')} | ${t.reportItems}: ${placedInstances.length}
    </div>
    <div class="grid">
      ${shots.map((s) => `<div class="card"><h3>${s.label}</h3>${s.dataUrl ? `<img src="${s.dataUrl}" />` : `<div style="height:260px;display:flex;align-items:center;justify-content:center;border:1px solid #e5e7eb;border-radius:4px;color:#6b7280;">${t.reportCaptureUnavailable}</div>`}</div>`).join('')}
    </div>
    <table>
      <thead><tr><th>#</th><th>SKU</th><th>X</th><th>Y</th><th>Z</th></tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
  </body>
</html>`;

      openPrintWindow(html);
    } finally {
      setCameraPreset(previous);
      setPrinting(false);
    }
  };


  const downloadTextFile = (filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleExportCases = () => {
    const csv = formatCaseCsv(state.cases, autoPackQuantities);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    downloadTextFile(`cases-${stamp}.csv`, csv, 'text/csv;charset=utf-8');
  };

  const handleImportCases = async (file: File) => {
    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith('.xlsx')) {
      alert(t.importCasesHelp);
      return;
    }
    const csvText = await file.text();
    const rows = parseCaseCsv(csvText);
    const existing = new Set(state.cases.map((c) => c.skuId));

    for (const row of rows) {
      const hasValidDims = Number.isFinite(row.length) && Number.isFinite(row.width) && Number.isFinite(row.height) && Number.isFinite(row.weight)
        && row.length > 0 && row.width > 0 && row.height > 0 && row.weight > 0;
      if (!row.boxName || !hasValidDims) continue;
      const skuId = sanitizeSkuId(row.boxName, existing);
      const noRotate = row.noRotate;
      const allowedYaw: Yaw[] = noRotate ? [0] : [0, 90, 180, 270];
      const canBeBase = !row.noStack;
      const stackClass = buildStackClass(undefined, row.onFloor);
      await actions.createCase({
        skuId,
        name: row.boxName,
        dims: { l: row.length, w: row.width, h: row.height },
        weightKg: row.weight,
        uprightOnly: row.noTilt,
        tiltAllowed: !row.noTilt,
        allowedYaw,
        canBeBase,
        topContactAllowed: canBeBase,
        maxLoadAboveKg: canBeBase ? Math.max(row.weight * 2, row.weight) : 0,
        minSupportRatio: 0.75,
        color: row.colorHex || '#6366f1',
        stackClass,
      });

      if (row.count > 0) {
        setAutoPackQuantities((prev) => ({ ...prev, [skuId]: row.count }));
      }
    }
  };

  return (
    <div className={`app theme-${theme}`}>
      <header className="app-header">
        <h1>{t.appTitle}</h1>
        <div className="header-actions">
          <button onClick={() => setLeftCollapsed(v => !v)}>{leftCollapsed ? t.showLeft : t.hideLeft}</button>
          <button onClick={() => setRightCollapsed(v => !v)}>{rightCollapsed ? t.showRight : t.hideRight}</button>
          <button onClick={() => setShowNewTruck(true)}>{t.newTruckType}</button>
          <button onClick={() => setShowNewCase(true)}>{t.newCaseType}</button>
          <button onClick={() => setShowSaveDialog(true)} disabled={!state.truck || placedInstances.length === 0}>{t.savePlan}</button>
          <button onClick={printReportPdf} disabled={!state.truck || placedInstances.length === 0 || printing}>{printing ? t.preparingPdf : t.printPdf}</button>
          <button onClick={printOrderedItemList} disabled={!state.truck || placedInstances.length === 0 || printing}>{printing ? t.preparingPdf : t.printItemList}</button>
          <button onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? t.lightMode : t.darkMode}</button>
          <button onClick={() => setLang((prev) => (prev === 'es' ? 'en' : 'es'))}>{lang === 'es' ? 'EN' : 'ES'}</button>
          <button onClick={() => setShowLoadDialog(true)}>{t.loadPlan}</button>
          <button onClick={handleExportCases} disabled={state.cases.length === 0}>{t.exportCasesCsv}</button>
          <button onClick={() => caseImportInputRef.current?.click()}>{t.importCasesCsv}</button>
          <input
            ref={caseImportInputRef}
            type="file"
            accept=".csv,.xlsx"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                await handleImportCases(file);
              } catch (err) {
                console.error('Import failed', err);
              } finally {
                e.currentTarget.value = '';
              }
            }}
          />
          <button onClick={() => actions.clearAll()} disabled={state.instances.length === 0}>{t.clearAll}</button>
          <button
            onClick={() => {
              const stagedIds = state.instances.filter(i => i.staged).map(i => i.id);
              if (stagedIds.length > 0) {
                const res = actions.autoPlaceInstances(stagedIds);
                if (!res.valid) console.warn('Autoplace all staged failed', res);
                setSelectedStagedIds([]);
                return;
              }
              if (!hasAutoLoadQuantities) return;
              actions.runAutoPack(new Map(Object.entries(autoPackQuantities).map(([k, v]) => [k, Number(v)])));
            }}
            disabled={!state.truck || (!hasStagedItems && !hasAutoLoadQuantities)}
          >
            {t.autoPack}
          </button>
        </div>
        <button className="mobile-menu-btn" onClick={() => setShowMobileMenu(true)} aria-label={t.mobileMenuTitle}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect y="3" width="20" height="2" rx="1" fill="currentColor"/><rect y="9" width="20" height="2" rx="1" fill="currentColor"/><rect y="15" width="20" height="2" rx="1" fill="currentColor"/></svg>
        </button>
      </header>

      {showMobileMenu && (
        <div className="mobile-menu-overlay" onClick={() => setShowMobileMenu(false)}>
          <div className="mobile-menu-sheet" onClick={e => e.stopPropagation()}>
            <div className="mobile-menu-header">
              <span>{t.mobileMenuTitle}</span>
              <button onClick={() => setShowMobileMenu(false)} aria-label={t.close}>&times;</button>
            </div>
            <div className="mobile-menu-items">
              <button onClick={() => { setShowNewTruck(true); setShowMobileMenu(false); }}>{t.newTruckType}</button>
              <button onClick={() => { setShowNewCase(true); setShowMobileMenu(false); }}>{t.newCaseType}</button>
              <button onClick={() => { setShowSaveDialog(true); setShowMobileMenu(false); }} disabled={!state.truck || placedInstances.length === 0}>{t.savePlan}</button>
              <button onClick={() => { setShowLoadDialog(true); setShowMobileMenu(false); }}>{t.loadPlan}</button>
              <button onClick={() => { printReportPdf(); setShowMobileMenu(false); }} disabled={!state.truck || placedInstances.length === 0 || printing}>{printing ? t.preparingPdf : t.printPdf}</button>
              <button onClick={() => { printOrderedItemList(); setShowMobileMenu(false); }} disabled={!state.truck || placedInstances.length === 0 || printing}>{printing ? t.preparingPdf : t.printItemList}</button>
              <button onClick={() => { setTheme(v => v === 'dark' ? 'light' : 'dark'); setShowMobileMenu(false); }}>{theme === 'dark' ? t.lightMode : t.darkMode}</button>
              <button onClick={() => { setLang(prev => prev === 'es' ? 'en' : 'es'); setShowMobileMenu(false); }}>{lang === 'es' ? 'EN' : 'ES'}</button>
              <button onClick={() => { actions.clearAll(); setShowMobileMenu(false); }} disabled={state.instances.length === 0}>{t.clearAll}</button>
              <button
                onClick={() => {
                  const stagedIds = state.instances.filter(i => i.staged).map(i => i.id);
                  if (stagedIds.length > 0) {
                    const res = actions.autoPlaceInstances(stagedIds);
                    if (!res.valid) console.warn('Autoplace all staged failed', res);
                    setSelectedStagedIds([]);
                  } else if (hasAutoLoadQuantities) {
                    actions.runAutoPack(new Map(Object.entries(autoPackQuantities).map(([k, v]) => [k, Number(v)])));
                  }
                  setShowMobileMenu(false);
                }}
                disabled={!state.truck || (!hasStagedItems && !hasAutoLoadQuantities)}
              >
                {t.autoPack}
              </button>
            </div>
          </div>
        </div>
      )}

      <main className={`app-main ${leftCollapsed ? 'left-collapsed' : ''} ${rightCollapsed ? 'right-collapsed' : ''}`} data-mobile-tab={mobileTab}>
        <aside className={`sidebar left ${leftCollapsed ? 'desktop-hidden' : ''}`}>
          <TruckSelector
            trucks={state.trucks}
            selected={state.truck}
            onSelect={actions.setTruck}
            onUpdateTruck={actions.updateTruck}
            onDeleteTruck={actions.deleteTruck}
            onNewTruck={() => setShowNewTruck(true)}
            lang={lang}
          />
          <div className="auto-pack-section">
            <h3>{t.autoPackQty}</h3>
            <div className="quantity-inputs">
              {state.cases.map(c => (
                <label key={c.skuId}><span>{c.name}</span><input type="number" min="0" value={autoPackQuantities[c.skuId] || 0} onChange={(e) => setAutoPackQuantities(prev => ({ ...prev, [c.skuId]: Number(e.target.value) }))} /></label>
              ))}
            </div>
          </div>
        </aside>

        <section className="main-view" onMouseDown={() => setItemActionsMenu(null)}>
          <div className="view-controls">
            <button onClick={() => setViewLocked(v => !v)} disabled={!state.truck}>
              {viewLocked ? t.unlockView : t.lockView}
            </button>
            <button
              className={cameraPreset === 'top' ? 'selected' : ''}
              onClick={() => setCameraPreset('top')}
              disabled={!state.truck}
            >
              {t.top}
            </button>
            <button
              className={cameraPreset === 'side-left' ? 'selected' : ''}
              onClick={() => setCameraPreset('side-left')}
              disabled={!state.truck}
            >
              {t.sideLeft}
            </button>
            <button
              className={cameraPreset === 'side-right' ? 'selected' : ''}
              onClick={() => setCameraPreset('side-right')}
              disabled={!state.truck}
            >
              {t.sideRight}
            </button>
            <button
              className={cameraPreset === 'iso' ? 'selected' : ''}
              onClick={() => setCameraPreset('iso')}
              disabled={!state.truck}
            >
              {t.iso}
            </button>
            <button onClick={() => setShowMetricsOverlay(v => !v)} disabled={!state.truck}>
              {showMetricsOverlay ? t.hideMetricsOverlay : t.showMetricsOverlay}
            </button>
            <button onClick={() => setShowSpatialMetrics(v => !v)} disabled={!state.truck}>
              {showSpatialMetrics ? t.hideSpatialMetrics : t.showSpatialMetrics}
            </button>
            {viewLocked && <span className="view-hint">{t.viewHint}</span>}
          </div>
          {itemActionsMenu && (
            <div className="item-actions-menu" style={{ left: itemActionsMenu.x, top: itemActionsMenu.y }} onMouseDown={(e) => e.stopPropagation()}>
              <button onClick={() => {
                const instance = state.instances.find(i => i.id === itemActionsMenu.id);
                if (!instance) return;
                const nextYaw = (((instance.yaw + 90) % 360) as Yaw);
                const result = actions.updateInstance(itemActionsMenu.id, { yaw: nextYaw });
                if (!result.valid) console.warn('Rotate failed:', result);
                setItemActionsMenu(null);
              }}>
                {t.rotate90}
              </button>
              {itemActionsMenu.tiltAllowed && (
                <button onClick={() => {
                  const instance = state.instances.find(i => i.id === itemActionsMenu.id);
                  if (!instance) return;
                  const current = instance.tilt ?? { y: 0 };
                  const nextTilt = current.y === 90 ? { y: 0 } : { y: 90 };
                  const result = actions.updateInstance(itemActionsMenu.id, { tilt: nextTilt });
                  if (!result.valid) console.warn('Tilt failed:', result);
                  setItemActionsMenu(null);
                }}>
                  {t.toggleTiltY90}
                </button>
              )}
            </div>
          )}
          <TruckView3D
            truck={state.truck}
            instances={state.instances}
            skus={state.skus}
            metrics={state.metrics}
            showSpatialMetrics={showSpatialMetrics}
            itemNumbers={itemNumbers}
            selectedId={state.selectedInstanceId}
            onSelect={actions.selectInstance}
            viewLocked={viewLocked}
            cameraPreset={cameraPreset}
            resolveDragPosition={resolveManualDropPosition}
            lang={lang}
            onMoveInstance={(instanceId, position) => {
              const instance = state.instances.find(i => i.id === instanceId);
              if (!instance) return false;
              let result = actions.updateInstance(instanceId, { position });
              if (!result.valid && position.z > 0) {
                result = actions.updateInstance(instanceId, { position: { ...position, z: 0 } });
              }
              if (!result.valid) console.warn('Move failed:', result);
              return result.valid;
            }}
            onOpenItemActions={({ id, clientX, clientY, tiltAllowed }) => {
              actions.selectInstance(id);
              setItemActionsMenu({
                id,
                x: Math.max(8, Math.min(clientX, window.innerWidth - 170)),
                y: Math.max(8, Math.min(clientY, window.innerHeight - 100)),
                tiltAllowed,
              });
            }}
          />
          {showMetricsOverlay && (
            <div className="metrics-overlay">
              <MetricsPanel metrics={state.metrics} truck={state.truck} lang={lang} />
            </div>
          )}
          {state.validation && !state.validation.valid && (
            <div className="validation-error"><h4>{t.cannotPlace}</h4><ul>{state.validation.violations.map((v, i) => <li key={i}>{v}</li>)}</ul></div>
          )}
        </section>

        <aside className={`sidebar right ${rightCollapsed ? 'desktop-hidden' : ''}`} data-panel="cases">
          <CaseCatalog
            cases={state.cases}
            lang={lang}
            onPlace={(skuId, pos, yaw) => {
              const result = actions.placeCase(skuId, pos, yaw);
              if (!result.valid) console.warn('Placement failed:', result);
            }}
            onUpdateCase={async (skuId, updates) => {
              await actions.updateCase(skuId, {
                name: updates.name,
                color: updates.color,
                dims: updates.dims,
                weightKg: updates.weightKg,
                allowedYaw: updates.allowedYaw,
                uprightOnly: updates.uprightOnly,
                canBeBase: updates.canBeBase,
                topContactAllowed: updates.topContactAllowed,
                tiltAllowed: updates.tiltAllowed,
                maxLoadAboveKg: updates.maxLoadAboveKg,
                minSupportRatio: updates.minSupportRatio,
                stackClass: updates.stackClass,
              });
            }}
            onDeleteCase={actions.deleteCase}
            onNewCase={() => setShowNewCase(true)}
          />

          <div className="placed-items">
            <h3>{t.stagedItems}</h3>
            <div className="staged-actions">
              <button
                disabled={selectedStagedIds.length === 0}
                onClick={() => {
                  const res = actions.autoPlaceInstances(selectedStagedIds);
                  if (!res.valid) console.warn('Autoplace failed', res);
                  setSelectedStagedIds([]);
                }}
              >
                {t.autoplaceSelected}
              </button>
            </div>
            <div className="placed-list">
              {stagedInstances.map(inst => (
                <label key={inst.id} className={`placed-card ${state.selectedInstanceId === inst.id ? 'selected' : ''}`}>
                  <input
                    type="checkbox"
                    checked={selectedStagedIds.includes(inst.id)}
                    onChange={(e) => {
                      setSelectedStagedIds(prev => e.target.checked ? [...prev, inst.id] : prev.filter(id => id !== inst.id));
                    }}
                  />
                  <span onClick={() => actions.selectInstance(inst.id)}>{inst.id}</span>
                  <small>{t.staged}</small>
                </label>
              ))}
            </div>
          </div>

          <div className="placed-items">
            <h3>{t.placedItems}</h3>
            <div className="placed-list">
              {placedInstances.map(inst => (
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
                    setDraggedId(null);
                  }}
                  onTouchStart={() => setDraggedId(inst.id)}
                  onTouchEnd={(e) => {
                    const touch = e.changedTouches[0];
                    if (!touch) return;
                    const target = document.elementFromPoint(touch.clientX, touch.clientY);
                    const dropId = target?.closest('[data-inst-id]')?.getAttribute('data-inst-id');
                    setTouchDropId(dropId ?? null);
                    if (draggedId && dropId && draggedId !== dropId) {
                      const res = actions.swapInstancePositions(draggedId, dropId);
                      if (!res.valid) console.warn('Swap failed', res);
                    }
                    setDraggedId(null);
                  }}
                  onClick={() => actions.selectInstance(inst.id)}
                  data-inst-id={inst.id}
                >
                  <span>#{itemNumbers.get(inst.id) ?? '-'} {inst.id}</span>
                  <small>({inst.position.x}, {inst.position.y}, {inst.position.z})</small>
                  <span className="mobile-drop-hint">{touchDropId === inst.id ? t.dropTarget : t.dragToSwap}</span>
                </button>
              ))}
            </div>
          </div>
          {selectedInstance && selectedSku && (
            <div className="selected-instance">
              <h4>{t.selectedCase}</h4>
              <p className="selected-name">{selectedSku.name}</p>
              <div className="selected-details">
                <span>{t.loadOrder}: #{itemNumbers.get(selectedInstance.id) ?? '-'}</span>
                <span>{t.id}: {selectedInstance.id}</span>
                <span>{t.weightKg}: {selectedSku.weightKg} kg</span>
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
              <div className="yaw-buttons">
                <button
                  className={(selectedInstance.tilt?.y ?? 0) === 0 ? 'selected' : ''}
                  onClick={() => actions.updateInstance(selectedInstance.id, { tilt: { y: 0 } })}
                >
                  {t.noTilt}
                </button>
                <button
                  className={(selectedInstance.tilt?.y ?? 0) === 90 ? 'selected' : ''}
                  onClick={() => actions.updateInstance(selectedInstance.id, { tilt: { y: 90 } })}
                  disabled={!selectedSku?.tiltAllowed}
                >
                  {t.tiltY90}
                </button>
              </div>
              <button onClick={() => actions.removeCase(selectedInstance.id)}>{t.remove}</button>
            </div>
          )}
        </aside>
      </main>

      <nav className="mobile-tab-bar">
        <button className={mobileTab === 'trucks' ? 'active' : ''} onClick={() => setMobileTab('trucks')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
          <span>{t.mobileTabTrucks}</span>
        </button>
        <button className={mobileTab === 'view' ? 'active' : ''} onClick={() => setMobileTab('view')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
          <span>{t.mobileTabView}</span>
        </button>
        <button className={mobileTab === 'cases' ? 'active' : ''} onClick={() => setMobileTab('cases')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
          <span>{t.mobileTabCases}</span>
        </button>
      </nav>

      {showNewTruck && (
        <div className="dialog-overlay" onClick={() => setShowNewTruck(false)}>
          <div className="dialog" onClick={e => e.stopPropagation()}>
            <h3>{t.createTruckType}</h3>
            <p className="dialog-help">{t.truckHelp}</p>
            <div className="form-grid">
              <label className="form-field">
                <span>{t.truckId}</span>
                <input placeholder="TRUCK_01" value={truckForm.truckId} onChange={e => setTruckForm({ ...truckForm, truckId: e.target.value })} />
              </label>
              <label className="form-field">
                <span>{t.name}</span>
                <input placeholder="e.g. 53ft Dry Van" value={truckForm.name} onChange={e => setTruckForm({ ...truckForm, name: e.target.value })} />
              </label>
              <label className="form-field">
                <span>{t.lengthX}</span>
                <input type="number" placeholder="front to rear" value={truckForm.x} onChange={e => setTruckForm({ ...truckForm, x: Number(e.target.value) })} />
              </label>
              <label className="form-field">
                <span>{t.widthY}</span>
                <input type="number" placeholder="left to right" value={truckForm.y} onChange={e => setTruckForm({ ...truckForm, y: Number(e.target.value) })} />
              </label>
              <label className="form-field">
                <span>{t.heightZ}</span>
                <input type="number" placeholder="floor to roof" value={truckForm.z} onChange={e => setTruckForm({ ...truckForm, z: Number(e.target.value) })} />
              </label>
              <label className="form-field">
                <span>{t.emptyWeight}</span>
                <input type="number" placeholder="truck tare weight" value={truckForm.emptyWeightKg} onChange={e => setTruckForm({ ...truckForm, emptyWeightKg: Number(e.target.value) })} />
              </label>
            </div>
            <div className="dialog-actions">
              <button onClick={() => setShowNewTruck(false)}>{t.cancel}</button>
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
              }}>{t.create}</button>
            </div>
          </div>
        </div>
      )}

      {showNewCase && (
        <div className="dialog-overlay" onClick={() => setShowNewCase(false)}>
          <div className="dialog" onClick={e => e.stopPropagation()}>
            <h3>{t.createCaseType}</h3>
            <p className="dialog-help">{t.caseHelp}</p>
            <div className="form-grid">
              <label className="form-field">
                <span>{t.skuId}</span>
                <input placeholder="CASE_01" value={caseForm.skuId} onChange={e => setCaseForm({ ...caseForm, skuId: e.target.value })} />
              </label>
              <label className="form-field">
                <span>{t.name}</span>
                <input placeholder="e.g. Case B1" value={caseForm.name} onChange={e => setCaseForm({ ...caseForm, name: e.target.value })} />
              </label>
              <label className="form-field">
                <span>{t.lengthL}</span>
                <input type="number" placeholder="X axis" value={caseForm.l} onChange={e => setCaseForm({ ...caseForm, l: Number(e.target.value) })} />
              </label>
              <label className="form-field">
                <span>{t.widthW}</span>
                <input type="number" placeholder="Y axis" value={caseForm.w} onChange={e => setCaseForm({ ...caseForm, w: Number(e.target.value) })} />
              </label>
              <label className="form-field">
                <span>{t.heightH}</span>
                <input type="number" placeholder="Z axis" value={caseForm.h} onChange={e => setCaseForm({ ...caseForm, h: Number(e.target.value) })} />
              </label>
              <label className="form-field">
                <span>{t.caseWeightKg}</span>
                <input type="number" placeholder="case weight" value={caseForm.weightKg} onChange={e => setCaseForm({ ...caseForm, weightKg: Number(e.target.value) })} />
              </label>
              <label className="toggle-input">
                <input type="checkbox" checked={caseForm.canBeBase} onChange={e => setCaseForm({ ...caseForm, canBeBase: e.target.checked })} />
                <span>{t.stackable}</span>
              </label>
              <label className="toggle-input">
                <input type="checkbox" checked={caseForm.tiltAllowed} onChange={e => setCaseForm({ ...caseForm, tiltAllowed: e.target.checked })} />
                <span>{t.tiltAllowed}</span>
              </label>
              <label className="color-input">{t.color} <input type="color" value={caseForm.color} onChange={e => setCaseForm({ ...caseForm, color: e.target.value })} /></label>
            </div>
            <div className="dialog-actions">
              <button onClick={() => setShowNewCase(false)}>{t.cancel}</button>
              <button className="primary" onClick={async () => {
                await actions.createCase({
                  skuId: caseForm.skuId,
                  name: caseForm.name,
                  dims: { l: caseForm.l, w: caseForm.w, h: caseForm.h },
                  weightKg: caseForm.weightKg,
                  uprightOnly: caseForm.uprightOnly,
                  allowedYaw: [0, 90, 180, 270],
                  canBeBase: caseForm.canBeBase,
                  tiltAllowed: caseForm.tiltAllowed,
                  topContactAllowed: caseForm.topContactAllowed,
                  maxLoadAboveKg: caseForm.maxLoadAboveKg,
                  minSupportRatio: caseForm.minSupportRatio,
                  color: caseForm.color,
                });
                setShowNewCase(false);
              }}>{t.create}</button>
            </div>
          </div>
        </div>
      )}

      {showSaveDialog && (
        <div className="dialog-overlay" onClick={() => setShowSaveDialog(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>{t.saveLoadPlan}</h3>
            <input type="text" placeholder={t.planNamePlaceholder} value={planName} onChange={(e) => setPlanName(e.target.value)} autoFocus />
            <div className="dialog-actions">
              <button onClick={() => setShowSaveDialog(false)}>{t.cancel}</button>
              <button className="primary" disabled={!planName.trim() || saving} onClick={async () => {
                setSaving(true);
                try { await actions.savePlan(planName.trim()); } finally { setSaving(false); setPlanName(''); setShowSaveDialog(false); }
              }}>{saving ? t.saving : t.save}</button>
            </div>
          </div>
        </div>
      )}

      {showLoadDialog && (
        <div className="dialog-overlay" onClick={() => setShowLoadDialog(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>{t.loadPlanTitle}</h3>
            {savedPlans.length === 0 ? <p className="empty-message">{t.noSavedPlans}</p> : (
              <div className="plan-list">
                {savedPlans.map(plan => (
                  <button key={plan.id} className="plan-card" onClick={async () => { await actions.loadPlan(plan.id); setShowLoadDialog(false); }}>
                    <div className="plan-name">{plan.name}</div>
                    <div className="plan-meta">{plan.totalWeightKg?.toFixed(0) ?? 0} kg | {plan.status}</div>
                    <div className="plan-date">{new Date(plan.createdAt).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US')}</div>
                  </button>
                ))}
              </div>
            )}
            <div className="dialog-actions"><button onClick={() => setShowLoadDialog(false)}>{t.close}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
