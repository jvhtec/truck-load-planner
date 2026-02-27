import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, PerspectiveCamera, Text } from '@react-three/drei';
import { Suspense, useMemo, useState, useEffect } from 'react';
import { BoxGeometry } from 'three';
import type { CaseInstance, CaseSKU, TruckType } from '../core/types';

interface TruckView3DProps {
  truck: TruckType | null;
  instances: CaseInstance[];
  skus: Map<string, CaseSKU>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function TruckView3D({ truck, instances, skus, selectedId, onSelect }: TruckView3DProps) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) {
      setError('WebGL not supported in this browser');
    }
  }, []);

  if (error) {
    return <div className="truck-view-3d error"><p>⚠️ {error}</p><p>Please use a modern browser with WebGL support</p></div>;
  }

  if (!truck) {
    return <div className="truck-view-3d empty"><p>Select a truck to begin planning</p></div>;
  }

  return (
    <div className="truck-view-3d">
      <Canvas shadows onError={() => setError('3D rendering error')}>
        <PerspectiveCamera makeDefault position={[15, 12, 15]} fov={50} />
        <OrbitControls target={[truck.innerDims.x / 2000, truck.innerDims.y / 2000, truck.innerDims.z / 2000]} enableDamping dampingFactor={0.05} />

        <ambientLight intensity={0.4} />
        <directionalLight position={[10, 20, 10]} intensity={1} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} />

        <Suspense fallback={null}>
          <Scene truck={truck} instances={instances} skus={skus} selectedId={selectedId} onSelect={onSelect} />
        </Suspense>
      </Canvas>
    </div>
  );
}

const SCALE = 0.001;

function Scene({ truck, instances, skus, selectedId, onSelect }: {
  truck: TruckType;
  instances: CaseInstance[];
  skus: Map<string, CaseSKU>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const truckDims = useMemo(() => ({ x: truck.innerDims.x * SCALE, y: truck.innerDims.y * SCALE, z: truck.innerDims.z * SCALE }), [truck]);

  const truckGeometry = useMemo(() => new BoxGeometry(truckDims.x, truckDims.z, truckDims.y), [truckDims.x, truckDims.y, truckDims.z]);

  return (
    <>
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

      <group position={[truckDims.x / 2, truckDims.z / 2, truckDims.y / 2]}>
        <lineSegments>
          <edgesGeometry args={[truckGeometry]} />
          <lineBasicMaterial color="#3b82f6" linewidth={2} />
        </lineSegments>
      </group>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[truckDims.x / 2, 0.001, truckDims.y / 2]} receiveShadow>
        <planeGeometry args={[truckDims.x, truckDims.y]} />
        <meshStandardMaterial color="#1e293b" transparent opacity={0.5} />
      </mesh>

      {instances.map((inst) => (
        <CaseMesh
          key={inst.id}
          instance={inst}
          sku={skus.get(inst.skuId)}
          scale={SCALE}
          isSelected={inst.id === selectedId}
          onClick={() => onSelect(inst.id === selectedId ? null : inst.id)}
        />
      ))}
    </>
  );
}

function CaseMesh({ instance, sku, scale, isSelected, onClick }: {
  instance: CaseInstance;
  sku?: CaseSKU;
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

  const caseGeometry = useMemo(() => new BoxGeometry(...size), [size[0], size[1], size[2]]);
  const color = isSelected ? '#22c55e' : (sku?.color ?? '#6366f1');
  const faceLabel = sku?.name ?? instance.skuId;
  const textSize = Math.max(Math.min(size[0], size[1], size[2]) * 0.12, 0.06);

  return (
    <mesh position={position} rotation={[((instance.tilt?.x ?? 0) * Math.PI) / 180, 0, ((instance.tilt?.y ?? 0) * Math.PI) / 180]} onClick={onClick} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} transparent opacity={isSelected ? 0.9 : 0.75} emissive={isSelected ? '#22c55e' : '#000000'} emissiveIntensity={isSelected ? 0.3 : 0} />

      <Text position={[0, size[1] / 2 + 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={textSize} maxWidth={size[0] * 0.9} color="#f8fafc" anchorX="center" anchorY="middle">{faceLabel}</Text>
      <Text position={[0, 0, size[2] / 2 + 0.005]} fontSize={textSize} maxWidth={size[0] * 0.9} color="#f8fafc" anchorX="center" anchorY="middle">{faceLabel}</Text>
      <Text position={[0, 0, -size[2] / 2 - 0.005]} rotation={[0, Math.PI, 0]} fontSize={textSize} maxWidth={size[0] * 0.9} color="#f8fafc" anchorX="center" anchorY="middle">{faceLabel}</Text>
      <Text position={[size[0] / 2 + 0.005, 0, 0]} rotation={[0, Math.PI / 2, 0]} fontSize={textSize} maxWidth={size[2] * 0.9} color="#f8fafc" anchorX="center" anchorY="middle">{faceLabel}</Text>
      <Text position={[-size[0] / 2 - 0.005, 0, 0]} rotation={[0, -Math.PI / 2, 0]} fontSize={textSize} maxWidth={size[2] * 0.9} color="#f8fafc" anchorX="center" anchorY="middle">{faceLabel}</Text>

      {isSelected && (
        <lineSegments>
          <edgesGeometry args={[caseGeometry]} />
          <lineBasicMaterial color="#22c55e" linewidth={2} />
        </lineSegments>
      )}
    </mesh>
  );
}
