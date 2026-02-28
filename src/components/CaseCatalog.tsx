import { useEffect, useState } from 'react';
import type { CaseSKU, Yaw } from '../core/types';

interface CaseCatalogProps {
  cases: CaseSKU[];
  onPlace: (skuId: string, position: { x: number; y: number; z: number }, yaw: Yaw) => void;
  onUpdateCase: (skuId: string, updates: Partial<CaseSKU>) => Promise<void>;
  onDeleteCase: (skuId: string) => Promise<void>;
  lang: 'es' | 'en';
}

export function CaseCatalog({ cases, onPlace, onUpdateCase, onDeleteCase, lang }: CaseCatalogProps) {
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [yaw, setYaw] = useState<Yaw>(0);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('#6366f1');
  const [editDims, setEditDims] = useState({ l: 0, w: 0, h: 0 });
  const [editWeightKg, setEditWeightKg] = useState(0);
  const [editAllowedYaw, setEditAllowedYaw] = useState<Record<Yaw, boolean>>({ 0: true, 90: true, 180: true, 270: true });
  const [editUprightOnly, setEditUprightOnly] = useState(false);
  const [editCanBeBase, setEditCanBeBase] = useState(true);
  const [editTopContactAllowed, setEditTopContactAllowed] = useState(true);
  const [editTiltAllowed, setEditTiltAllowed] = useState(false);
  const [editMaxLoadAboveKg, setEditMaxLoadAboveKg] = useState(0);
  const [editMinSupportRatio, setEditMinSupportRatio] = useState(0.75);
  const [editStackClass, setEditStackClass] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const t = lang === 'es'
    ? {
        title: 'Cajas',
        empty: 'No hay cajas cargadas',
        noStack: 'No Apilar',
        upright: 'Vertical',
        tilt: 'Inclinacion Y',
        add: 'Agregar',
        stagedHint: 'Los nuevos items se colocan fuera del camion para evitar colisiones.',
        initialRotation: 'Rotacion Inicial',
        addStaging: 'Agregar a Zona Externa',
        editToggleOpen: 'Editar tipo de caja',
        editToggleClose: 'Ocultar editor de caja',
        editTitle: 'Editar Tipo de Caja',
        name: 'Nombre',
        color: 'Color',
        weight: 'Peso (kg)',
        stackClass: 'Clase de Apilado',
        maxLoad: 'Carga Maxima Encima (kg)',
        minSupport: 'Soporte Minimo (ratio)',
        allowedYaw: 'Yaw Permitido',
        uprightOnly: 'Solo Vertical',
        stackable: 'Apilable (Base Permitida)',
        topContact: 'Contacto Superior Permitido',
        tiltAllowed: 'Inclinacion Permitida (Y 90°)',
        save: 'Guardar Propiedades',
        saving: 'Guardando...',
        delete: 'Eliminar Tipo de Caja',
        deleting: 'Eliminando...',
        confirmDelete: 'Eliminar este tipo de caja del catalogo?',
        yawRequired: 'Debe permitir al menos un yaw.',
        saveError: 'No se pudieron guardar las propiedades',
      }
    : {
        title: 'Cases',
        empty: 'No cases loaded',
        noStack: 'No Stack',
        upright: 'Upright',
        tilt: 'Tilt Y',
        add: 'Add',
        stagedHint: 'New items are staged outside the truck to avoid collisions.',
        initialRotation: 'Initial Rotation',
        addStaging: 'Add To Staging',
        editToggleOpen: 'Edit case type',
        editToggleClose: 'Hide case editor',
        editTitle: 'Edit Case Type',
        name: 'Name',
        color: 'Color',
        weight: 'Weight (kg)',
        stackClass: 'Stack Class',
        maxLoad: 'Max Load Above (kg)',
        minSupport: 'Min Support Ratio',
        allowedYaw: 'Allowed Yaw',
        uprightOnly: 'Upright Only',
        stackable: 'Stackable (Can Be Base)',
        topContact: 'Top Contact Allowed',
        tiltAllowed: 'Tilt Allowed (Y 90°)',
        save: 'Save Case Properties',
        saving: 'Saving...',
        delete: 'Delete Case Type',
        deleting: 'Deleting...',
        confirmDelete: 'Delete this case type from catalog?',
        yawRequired: 'At least one allowed yaw is required.',
        saveError: 'Failed to save case properties',
      };

  const selectedCase = cases.find(c => c.skuId === selectedSku);

  useEffect(() => {
    if (!selectedCase) return;
    setEditName(selectedCase.name);
    setEditColor(selectedCase.color ?? '#6366f1');
    setEditDims(selectedCase.dims);
    setEditWeightKg(selectedCase.weightKg);
    setEditAllowedYaw({
      0: selectedCase.allowedYaw.includes(0),
      90: selectedCase.allowedYaw.includes(90),
      180: selectedCase.allowedYaw.includes(180),
      270: selectedCase.allowedYaw.includes(270),
    });
    setEditUprightOnly(selectedCase.uprightOnly);
    setEditCanBeBase(selectedCase.canBeBase);
    setEditTopContactAllowed(selectedCase.topContactAllowed);
    setEditTiltAllowed(Boolean(selectedCase.tiltAllowed));
    setEditMaxLoadAboveKg(selectedCase.maxLoadAboveKg);
    setEditMinSupportRatio(selectedCase.minSupportRatio);
    setEditStackClass(selectedCase.stackClass ?? '');
  }, [selectedCase?.skuId]);

  const handlePlace = () => {
    if (!selectedSku) return;
    onPlace(selectedSku, { x: 0, y: 0, z: 0 }, yaw);
  };

  return (
    <div className="case-catalog">
      <h3>{t.title}</h3>

      <div className="case-list">
        {cases.length === 0 ? <p className="empty-message">{t.empty}</p> : (
          cases.map((c) => (
            <button key={c.skuId} className={`case-card ${selectedSku === c.skuId ? 'selected' : ''}`} onClick={() => setSelectedSku(c.skuId)}>
              <div className="case-header-row">
                <div className="case-color-dot" style={{ backgroundColor: c.color ?? '#6366f1' }} />
                <div className="case-name">{c.name}</div>
              </div>
              <div className="case-info">{c.dims.l}×{c.dims.w}×{c.dims.h} mm | {c.weightKg} kg</div>
              <div className="case-tags">
                {!c.canBeBase && <span className="tag no-stack">{t.noStack}</span>}
                {c.uprightOnly && <span className="tag upright">{t.upright}</span>}
                {c.tiltAllowed && <span className="tag upright">{t.tilt}</span>}
              </div>
            </button>
          ))
        )}
      </div>

      {selectedCase && (
        <>
          <div className="placement-controls">
            <h4>{t.add} {selectedCase.name}</h4>
            <p className="empty-message">{t.stagedHint}</p>

            <div className="yaw-selector">
              <label>{t.initialRotation}</label>
              <div className="yaw-buttons">
                {[0, 90, 180, 270].map((y) => (
                  <button key={y} className={yaw === y ? 'selected' : ''} onClick={() => setYaw(y as Yaw)} disabled={!selectedCase.allowedYaw.includes(y as Yaw)}>{y}°</button>
                ))}
              </div>
            </div>

            <button className="place-button" onClick={handlePlace}>{t.addStaging}</button>
          </div>

          <div className="placement-controls">
            <button className="place-button" onClick={() => setEditOpen(v => !v)}>
              {editOpen ? t.editToggleClose : t.editToggleOpen}
            </button>
            {editOpen && (
              <>
                <h4>{t.editTitle}</h4>
                <div className="position-inputs compact">
                  <label>{t.name}<input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} /></label>
                  <label>{t.color}<input type="color" value={editColor} onChange={(e) => setEditColor(e.target.value)} /></label>
                </div>
                <div className="position-inputs">
                  <label>L (mm)<input type="number" value={editDims.l} onChange={(e) => setEditDims(prev => ({ ...prev, l: Number(e.target.value) }))} /></label>
                  <label>W (mm)<input type="number" value={editDims.w} onChange={(e) => setEditDims(prev => ({ ...prev, w: Number(e.target.value) }))} /></label>
                  <label>H (mm)<input type="number" value={editDims.h} onChange={(e) => setEditDims(prev => ({ ...prev, h: Number(e.target.value) }))} /></label>
                </div>
                <div className="position-inputs compact">
                  <label>{t.weight}<input type="number" step="0.1" value={editWeightKg} onChange={(e) => setEditWeightKg(Number(e.target.value))} /></label>
                  <label>{t.stackClass}<input type="text" value={editStackClass} onChange={(e) => setEditStackClass(e.target.value)} /></label>
                </div>
                <div className="position-inputs compact">
                  <label>{t.maxLoad}<input type="number" step="0.1" value={editMaxLoadAboveKg} onChange={(e) => setEditMaxLoadAboveKg(Number(e.target.value))} /></label>
                  <label>{t.minSupport}<input type="number" min="0" max="1" step="0.01" value={editMinSupportRatio} onChange={(e) => setEditMinSupportRatio(Number(e.target.value))} /></label>
                </div>
                <div className="yaw-selector">
                  <label>{t.allowedYaw}</label>
                  <div className="yaw-buttons">
                    {[0, 90, 180, 270].map((y) => (
                      <button
                        key={y}
                        className={editAllowedYaw[y as Yaw] ? 'selected' : ''}
                        onClick={() => setEditAllowedYaw(prev => ({ ...prev, [y]: !prev[y as Yaw] }))}
                      >
                        {y}°
                      </button>
                    ))}
                  </div>
                </div>
                <div className="position-inputs compact">
                  <label className="toggle-input">
                    <input type="checkbox" checked={editUprightOnly} onChange={(e) => setEditUprightOnly(e.target.checked)} />
                    <span>{t.uprightOnly}</span>
                  </label>
                  <label className="toggle-input">
                    <input type="checkbox" checked={editCanBeBase} onChange={(e) => setEditCanBeBase(e.target.checked)} />
                    <span>{t.stackable}</span>
                  </label>
                  <label className="toggle-input">
                    <input type="checkbox" checked={editTopContactAllowed} onChange={(e) => setEditTopContactAllowed(e.target.checked)} />
                    <span>{t.topContact}</span>
                  </label>
                  <label className="toggle-input">
                    <input
                      type="checkbox"
                      checked={editTiltAllowed}
                      disabled={editUprightOnly}
                      onChange={(e) => setEditTiltAllowed(e.target.checked)}
                    />
                    <span>{t.tiltAllowed}</span>
                  </label>
                </div>
                <button
                  className="place-button"
                  disabled={savingEdit}
                  onClick={async () => {
                    setSavingEdit(true);
                    setEditError(null);
                    try {
                      const nextAllowedYaw = ([0, 90, 180, 270] as Yaw[]).filter(y => editAllowedYaw[y]);
                      if (nextAllowedYaw.length === 0) {
                        throw new Error(t.yawRequired);
                      }
                      await onUpdateCase(selectedCase.skuId, {
                        name: editName,
                        color: editColor,
                        dims: editDims,
                        weightKg: editWeightKg,
                        allowedYaw: nextAllowedYaw,
                        uprightOnly: editUprightOnly,
                        canBeBase: editCanBeBase,
                        topContactAllowed: editTopContactAllowed,
                        tiltAllowed: editUprightOnly ? false : editTiltAllowed,
                        maxLoadAboveKg: editMaxLoadAboveKg,
                        minSupportRatio: editMinSupportRatio,
                        stackClass: editStackClass || undefined,
                      });
                    } catch (err: any) {
                      setEditError(err?.message ?? t.saveError);
                    } finally {
                      setSavingEdit(false);
                    }
                  }}
                >
                  {savingEdit ? t.saving : t.save}
                </button>
                <button
                  className="danger-button"
                  disabled={savingEdit}
                  onClick={async () => {
                    if (!window.confirm(t.confirmDelete)) return;
                    setSavingEdit(true);
                    setEditError(null);
                    try {
                      await onDeleteCase(selectedCase.skuId);
                      setSelectedSku(null);
                      setEditOpen(false);
                    } catch (err: any) {
                      setEditError(err?.message ?? t.saveError);
                    } finally {
                      setSavingEdit(false);
                    }
                  }}
                >
                  {savingEdit ? t.deleting : t.delete}
                </button>
                {editError && <p className="error-message">{editError}</p>}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
