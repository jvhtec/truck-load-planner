import { useEffect, useState } from 'react';
import type { TruckType } from '../core/types';
import { useHaptics } from '../hooks/useHaptics';

interface TruckSelectorProps {
  trucks: TruckType[];
  selected: TruckType | null;
  onSelect: (truck: TruckType) => void;
  onUpdateTruck: (truckId: string, updates: {
    name: string;
    innerDims: { x: number; y: number; z: number };
    emptyWeightKg: number;
    axle: { frontX: number; rearX: number; maxFrontKg: number; maxRearKg: number };
    maxLeftRightPercentDiff: number;
  }) => Promise<void>;
  onDeleteTruck: (truckId: string) => Promise<void>;
  onNewTruck?: () => void;
  lang: 'es' | 'en';
}

export function TruckSelector({ trucks, selected, onSelect, onUpdateTruck, onDeleteTruck, onNewTruck, lang }: TruckSelectorProps) {
  const { trigger: haptic } = useHaptics();
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    x: 0,
    y: 0,
    z: 0,
    emptyWeightKg: 0,
    frontX: 0,
    rearX: 0,
    maxFrontKg: 0,
    maxRearKg: 0,
    maxLr: 10,
  });

  const t = lang === 'es'
    ? {
        title: 'Seleccionar Camion',
        empty: 'No hay camiones cargados',
        newTruck: 'Nuevo Tipo de Camion',
        payload: 'Carga maxima',
        editToggleOpen: 'Editar camion seleccionado',
        editToggleClose: 'Ocultar editor de camion',
        editTitle: 'Editar Camion',
        name: 'Nombre',
        x: 'Largo X (mm)',
        y: 'Ancho Y (mm)',
        z: 'Alto Z (mm)',
        emptyWeight: 'Peso Vacio (kg)',
        frontX: 'Eje Delantero X (mm)',
        rearX: 'Eje Trasero X (mm)',
        maxFront: 'Max Eje Delantero (kg)',
        maxRear: 'Max Eje Trasero (kg)',
        maxLr: 'Max Desbalance I/D (%)',
        save: 'Guardar Camion',
        saving: 'Guardando...',
        delete: 'Eliminar Camion',
        deleting: 'Eliminando...',
        confirmDelete: 'Eliminar este tipo de camion del catalogo?',
      }
    : {
        title: 'Select Truck',
        empty: 'No trucks loaded',
        newTruck: 'New Truck Type',
        payload: 'Max payload',
        editToggleOpen: 'Edit selected truck',
        editToggleClose: 'Hide truck editor',
        editTitle: 'Edit Truck',
        name: 'Name',
        x: 'Length X (mm)',
        y: 'Width Y (mm)',
        z: 'Height Z (mm)',
        emptyWeight: 'Empty Weight (kg)',
        frontX: 'Front Axle X (mm)',
        rearX: 'Rear Axle X (mm)',
        maxFront: 'Max Front Axle (kg)',
        maxRear: 'Max Rear Axle (kg)',
        maxLr: 'Max L/R Imbalance (%)',
        save: 'Save Truck',
        saving: 'Saving...',
        delete: 'Delete Truck',
        deleting: 'Deleting...',
        confirmDelete: 'Delete this truck type from catalog?',
      };

  useEffect(() => {
    if (!selected) return;
    setForm({
      name: selected.name,
      x: selected.innerDims.x,
      y: selected.innerDims.y,
      z: selected.innerDims.z,
      emptyWeightKg: selected.emptyWeightKg,
      frontX: selected.axle.frontX,
      rearX: selected.axle.rearX,
      maxFrontKg: selected.axle.maxFrontKg,
      maxRearKg: selected.axle.maxRearKg,
      maxLr: selected.balance.maxLeftRightPercentDiff,
    });
    setError(null);
  }, [selected?.truckId]);

  return (
    <div className="truck-selector">
      <h3>{t.title}</h3>
      {onNewTruck && (
        <button className="place-button" style={{ marginBottom: '0.75rem' }} onClick={() => { haptic('nudge'); onNewTruck!(); }}>
          + {t.newTruck}
        </button>
      )}
      <div className="truck-list">
        {trucks.length === 0 ? (
          <p className="empty-message">{t.empty}</p>
        ) : (
          trucks.map((truck) => (
            <button
              key={truck.truckId}
              className={`truck-card ${selected?.truckId === truck.truckId ? 'selected' : ''}`}
              onClick={() => { haptic('nudge'); onSelect(truck); }}
            >
              <div className="truck-name">{truck.name}</div>
              <div className="truck-dims">
                {truck.innerDims.x} mm × {truck.innerDims.y} mm × {truck.innerDims.z} mm
              </div>
              <div className="truck-capacity">
                {t.payload}: {(truck.axle.maxFrontKg + truck.axle.maxRearKg).toLocaleString()} kg
              </div>
            </button>
          ))
        )}
      </div>
      {selected && (
        <div className="placement-controls">
          <button className="place-button" onClick={() => { haptic('nudge'); setEditOpen(v => !v); }}>
            {editOpen ? t.editToggleClose : t.editToggleOpen}
          </button>
          {editOpen && (
            <>
              <h4>{t.editTitle}</h4>
              <div className="position-inputs compact">
                <label>{t.name}<input type="text" value={form.name} onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))} /></label>
                <label>{t.emptyWeight}<input type="number" value={form.emptyWeightKg} onChange={(e) => setForm(prev => ({ ...prev, emptyWeightKg: Number(e.target.value) }))} /></label>
              </div>
              <div className="position-inputs compact">
                <label>{t.x}<input type="number" value={form.x} onChange={(e) => setForm(prev => ({ ...prev, x: Number(e.target.value) }))} /></label>
                <label>{t.y}<input type="number" value={form.y} onChange={(e) => setForm(prev => ({ ...prev, y: Number(e.target.value) }))} /></label>
              </div>
              <div className="position-inputs compact">
                <label>{t.z}<input type="number" value={form.z} onChange={(e) => setForm(prev => ({ ...prev, z: Number(e.target.value) }))} /></label>
                <label>{t.maxLr}<input type="number" step="0.1" value={form.maxLr} onChange={(e) => setForm(prev => ({ ...prev, maxLr: Number(e.target.value) }))} /></label>
              </div>
              <div className="position-inputs compact">
                <label>{t.frontX}<input type="number" value={form.frontX} onChange={(e) => setForm(prev => ({ ...prev, frontX: Number(e.target.value) }))} /></label>
                <label>{t.rearX}<input type="number" value={form.rearX} onChange={(e) => setForm(prev => ({ ...prev, rearX: Number(e.target.value) }))} /></label>
              </div>
              <div className="position-inputs compact">
                <label>{t.maxFront}<input type="number" value={form.maxFrontKg} onChange={(e) => setForm(prev => ({ ...prev, maxFrontKg: Number(e.target.value) }))} /></label>
                <label>{t.maxRear}<input type="number" value={form.maxRearKg} onChange={(e) => setForm(prev => ({ ...prev, maxRearKg: Number(e.target.value) }))} /></label>
              </div>
              <button
                className="place-button"
                disabled={saving}
                onClick={async () => {
                  haptic('nudge');
                  setSaving(true);
                  setError(null);
                  try {
                    await onUpdateTruck(selected.truckId, {
                      name: form.name,
                      innerDims: { x: form.x, y: form.y, z: form.z },
                      emptyWeightKg: form.emptyWeightKg,
                      axle: { frontX: form.frontX, rearX: form.rearX, maxFrontKg: form.maxFrontKg, maxRearKg: form.maxRearKg },
                      maxLeftRightPercentDiff: form.maxLr,
                    });
                    haptic('success');
                  } catch (err: any) {
                    haptic('error');
                    setError(err?.message ?? 'Failed to update truck');
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving ? t.saving : t.save}
              </button>
              <button
                className="danger-button"
                disabled={saving}
                onClick={async () => {
                  haptic('nudge');
                  if (!window.confirm(t.confirmDelete)) return;
                  setSaving(true);
                  setError(null);
                  try {
                    await onDeleteTruck(selected.truckId);
                    haptic('success');
                    setEditOpen(false);
                  } catch (err: any) {
                    haptic('error');
                    setError(err?.message ?? 'Failed to delete truck');
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving ? t.deleting : t.delete}
              </button>
              {error && <p className="error-message">{error}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
