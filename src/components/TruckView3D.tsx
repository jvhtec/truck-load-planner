import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, PerspectiveCamera } from '@react-three/drei';
import { Suspense, useMemo, useState, useEffect } from 'react';
import type { CaseInstance, TruckType } from '../core/types';

interface TruckView3DProps {
  truck: TruckType | null;
  instances: CaseInstance[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function TruckView3D({ truck, instances, selectedId, onSelect }: TruckView3DProps) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check WebGL support
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) {
      setError('WebGL not supported in this browser');
    }
  }, []);

  if (error) {
    return (
      <div className="truck-view-3d error">
        <p>⚠️ {error}</p>
        <p>Please use a modern browser with WebGL support</p>
      </div>
    );
  }

  if (!truck) {
    return (
      <div className="truck-view-3d empty">
        <p>Select a truck to begin planning</p>
      </div>
    );
  }

  return (
    <div className="truck-view-3d">
      <Canvas shadows onError={(e) => setError(`3D Error: ${e.message}`)}>
        <PerspectiveCamera makeDefault position={[15, 12, 15]} fov={50} />
        <OrbitControls 
          target={[truck.innerDims.x / 2000, truck.innerDims.y / 2000, truck.innerDims.z / 2000]}
          enableDamping
          dampingFactor={0.05}
        />
        
        <ambientLight intensity={0.4} />
        <directionalLight
          position={[10, 20, 10]}
          intensity={1}
          castShadow
          shadow-mapSize={[2048, 2048]}
        />
        
        <Suspense fallback={<div style={{color: 'white', padding: '2rem'}}>Loading 3D...</div>}>
          <Scene truck={truck} instances={instances} selectedId={selectedId} onSelect={onSelect} />
        </Suspense>
      </Canvas>
    </div>
  );
}

// Scale factor: mm to meters
const SCALE = 0.001;

function Scene({ truck, instances, selectedId, onSelect }: {
  truck: TruckType;
  instances: CaseInstance[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const truckDims = useMemo(() => ({
    x: truck.innerDims.x * SCALE,
    y: truck.innerDims.y * SCALE,
    z: truck.innerDims.z * SCALE,
  }), [truck]);

  const axleFront = truck.axle.frontX * SCALE;
  const axleRear = truck.axle.rearX * SCALE;

  return (
    <>
      {/* Floor grid */}
      <Grid
        args={[20, 20]}
        position={[truckDims.x / 2, 0, truckDims.y / 2]}
        cellSize={0.5}
        cellThickness={0.5}
        cellColor="#444"
        sectionSize={2}
        sectionThickness={1}
        sectionColor="#666"
        fadeDistance={50}
        fadeStrength={1}
        followCamera={false}
      />

      {/* Truck box (wireframe) */}
      <group position={[truckDims.x / 2, truckDims.z / 2, truckDims.y / 2]}>
        <lineSegments>
          <edgesGeometry args={[new BoxGeometry(truckDims.x, truckDims.z, truckDims.y)]} />
          <lineBasicMaterial color="#3b82f6" linewidth={2} />
        </lineSegments>
      </group>

      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[truckDims.x / 2, 0.001, truckDims.y / 2]} receiveShadow>
        <planeGeometry args={[truckDims.x, truckDims.y]} />
        <meshStandardMaterial color="#1e293b" transparent opacity={0.5} />
      </mesh>

      {/* Axle markers */}
      <AxleMarker x={axleFront} z={truckDims.y / 2} label="Front" maxKg={truck.axle.maxFrontKg} />
      <AxleMarker x={axleRear} z={truckDims.y / 2} label="Rear" maxKg={truck.axle.maxRearKg} />

      {/* Cases */}
      {instances.map((inst) => (
        <CaseMesh
          key={inst.id}
          instance={inst}
          scale={SCALE}
          isSelected={inst.id === selectedId}
          onClick={() => onSelect(inst.id === selectedId ? null : inst.id)}
        />
      ))}
    </>
  );
}

function AxleMarker({ x, z }: { x: number; z: number; label: string; maxKg: number }) {
  return (
    <group position={[x, 0.02, z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.1, 32]} />
        <meshBasicMaterial color="#f59e0b" />
      </mesh>
    </group>
  );
}

function CaseMesh({ 
  instance, 
  scale, 
  isSelected, 
  onClick 
}: { 
  instance: CaseInstance; 
  scale: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  const position: [number, number, number] = [
    (instance.position.x + (instance.aabb.max.x - instance.aabb.min.x) / 2) * scale,
    (instance.position.z + (instance.aabb.max.z - instance.aabb.min.z) / 2) * scale,
    (instance.position.y + (instance.aabb.max.y - instance.aabb.min.y) / 2) * scale,
  ];

  const size: [number, number, number] = [
    (instance.aabb.max.x - instance.aabb.min.x) * scale,
    (instance.aabb.max.z - instance.aabb.min.z) * scale,
    (instance.aabb.max.y - instance.aabb.min.y) * scale,
  ];

  const color = isSelected ? '#22c55e' : '#6366f1';

  return (
    <mesh position={position} onClick={onClick} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial 
        color={color} 
        transparent 
        opacity={isSelected ? 0.9 : 0.7}
        emissive={isSelected ? '#22c55e' : '#000000'}
        emissiveIntensity={isSelected ? 0.3 : 0}
      />
      {isSelected && (
        <lineSegments>
          <edgesGeometry args={[new BoxGeometry(...size)]} />
          <lineBasicMaterial color="#22c55e" linewidth={2} />
        </lineSegments>
      )}
    </mesh>
  );
}

import { BoxGeometry } from 'three';
