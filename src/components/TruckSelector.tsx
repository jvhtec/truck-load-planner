import type { TruckType } from '../core/types';

interface TruckSelectorProps {
  trucks: TruckType[];
  selected: TruckType | null;
  onSelect: (truck: TruckType) => void;
}

export function TruckSelector({ trucks, selected, onSelect }: TruckSelectorProps) {
  return (
    <div className="truck-selector">
      <h3>Select Truck</h3>
      <div className="truck-list">
        {trucks.length === 0 ? (
          <p className="empty-message">No trucks loaded</p>
        ) : (
          trucks.map((truck) => (
            <button
              key={truck.truckId}
              className={`truck-card ${selected?.truckId === truck.truckId ? 'selected' : ''}`}
              onClick={() => onSelect(truck)}
            >
              <div className="truck-name">{truck.name}</div>
              <div className="truck-dims">
                {truck.innerDims.x / 1000}m × {truck.innerDims.y / 1000}m × {truck.innerDims.z / 1000}m
              </div>
              <div className="truck-capacity">
                Max payload: {(truck.axle.maxFrontKg + truck.axle.maxRearKg).toLocaleString()} kg
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
