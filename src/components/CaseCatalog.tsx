import { useEffect, useState } from 'react';
import type { CaseSKU, Yaw } from '../core/types';

interface CaseCatalogProps {
  cases: CaseSKU[];
  onPlace: (skuId: string, position: { x: number; y: number; z: number }, yaw: Yaw) => void;
  onUpdateCase: (skuId: string, updates: Partial<CaseSKU>) => Promise<void>;
}

export function CaseCatalog({ cases, onPlace, onUpdateCase }: CaseCatalogProps) {
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0, z: 0 });
  const [yaw, setYaw] = useState<Yaw>(0);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('#6366f1');
  const [savingEdit, setSavingEdit] = useState(false);

  const selectedCase = cases.find(c => c.skuId === selectedSku);

  useEffect(() => {
    if (!selectedCase) return;
    setEditName(selectedCase.name);
    setEditColor(selectedCase.color ?? '#6366f1');
  }, [selectedCase?.skuId]);

  const handlePlace = () => {
    if (!selectedSku) return;
    onPlace(selectedSku, position, yaw);
    setPosition({ x: 0, y: 0, z: 0 });
  };

  return (
    <div className="case-catalog">
      <h3>Cases</h3>

      <div className="case-list">
        {cases.length === 0 ? <p className="empty-message">No cases loaded</p> : (
          cases.map((c) => (
            <button key={c.skuId} className={`case-card ${selectedSku === c.skuId ? 'selected' : ''}`} onClick={() => setSelectedSku(c.skuId)}>
              <div className="case-header-row">
                <div className="case-color-dot" style={{ backgroundColor: c.color ?? '#6366f1' }} />
                <div className="case-name">{c.name}</div>
              </div>
              <div className="case-info">{c.dims.l}×{c.dims.w}×{c.dims.h} mm | {c.weightKg} kg</div>
              <div className="case-tags">
                {!c.canBeBase && <span className="tag no-stack">No Stack</span>}
                {c.uprightOnly && <span className="tag upright">Upright</span>}
              </div>
            </button>
          ))
        )}
      </div>

      {selectedCase && (
        <>
          <div className="placement-controls">
            <h4>Place {selectedCase.name}</h4>

            <div className="position-inputs">
              <label>X (front-rear)<input type="number" value={position.x} onChange={(e) => setPosition({ ...position, x: Number(e.target.value) })} step={100} min={0} /></label>
              <label>Y (left-right)<input type="number" value={position.y} onChange={(e) => setPosition({ ...position, y: Number(e.target.value) })} step={100} min={0} /></label>
              <label>Z (height)<input type="number" value={position.z} onChange={(e) => setPosition({ ...position, z: Number(e.target.value) })} step={100} min={0} /></label>
            </div>

            <div className="yaw-selector">
              <label>Rotation</label>
              <div className="yaw-buttons">
                {[0, 90, 180, 270].map((y) => (
                  <button key={y} className={yaw === y ? 'selected' : ''} onClick={() => setYaw(y as Yaw)} disabled={!selectedCase.allowedYaw.includes(y as Yaw)}>{y}°</button>
                ))}
              </div>
            </div>

            <button className="place-button" onClick={handlePlace}>Place Case</button>
          </div>

          <div className="placement-controls">
            <h4>Edit Case Type</h4>
            <div className="position-inputs compact">
              <label>Name<input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} /></label>
              <label>Color<input type="color" value={editColor} onChange={(e) => setEditColor(e.target.value)} /></label>
            </div>
            <button
              className="place-button"
              disabled={savingEdit}
              onClick={async () => {
                setSavingEdit(true);
                try {
                  await onUpdateCase(selectedCase.skuId, { name: editName, color: editColor });
                } finally {
                  setSavingEdit(false);
                }
              }}
            >
              {savingEdit ? 'Saving...' : 'Save Case Properties'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
