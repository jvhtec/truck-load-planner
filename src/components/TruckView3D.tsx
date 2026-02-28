import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, PerspectiveCamera, Text } from '@react-three/drei';
import { Suspense, useMemo, useState, useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { BoxGeometry, Plane, Vector3 } from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import type { CaseInstance, CaseSKU, LoadMetrics, TruckType } from '../core/types';

export type CameraPreset = 'top' | 'side-left' | 'side-right' | 'iso';

interface TruckView3DProps {
  truck: TruckType | null;
  instances: CaseInstance[];
  skus: Map<string, CaseSKU>;
  metrics: LoadMetrics | null;
  showSpatialMetrics: boolean;
  itemNumbers: Map<string, number>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  viewLocked: boolean;
  cameraPreset: CameraPreset;
  onMoveInstance: (id: string, position: { x: number; y: number; z: number }) => boolean;
  resolveDragPosition: (id: string, position: { x: number; y: number; z: number }) => { x: number; y: number; z: number };
  onOpenItemActions: (payload: { id: string; clientX: number; clientY: number; tiltAllowed: boolean }) => void;
  lang: 'es' | 'en';
}

export function TruckView3D({
  truck,
  instances,
  skus,
  metrics,
  showSpatialMetrics,
  itemNumbers,
  selectedId,
  onSelect,
  viewLocked,
  cameraPreset,
  onMoveInstance,
  resolveDragPosition,
  onOpenItemActions,
  lang,
}: TruckView3DProps) {
  const [error, setError] = useState<string | null>(null);
  const controlsRef = useRef<any>(null);
  const t = lang === 'es'
      ? {
        webglUnsupported: 'WebGL no esta soportado en este navegador',
        webglHint: 'Usa un navegador moderno con soporte WebGL',
        noTruck: 'Selecciona un camion para comenzar',
        renderError: 'Error de renderizado 3D',
        tiltLabel: 'INCL-Y90',
        frontAxle: 'Eje Del.',
        rearAxle: 'Eje Tras.',
        balance: 'Balance',
      }
    : {
        webglUnsupported: 'WebGL not supported in this browser',
        webglHint: 'Please use a modern browser with WebGL support',
        noTruck: 'Select a truck to begin planning',
        renderError: '3D rendering error',
        tiltLabel: 'TILT-Y90',
        frontAxle: 'Front Axle',
        rearAxle: 'Rear Axle',
        balance: 'Balance',
      };

  useEffect(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) {
      setError(t.webglUnsupported);
    }
  }, [t.webglUnsupported]);

  if (error) {
    return <div className="truck-view-3d error"><p>{error}</p><p>{t.webglHint}</p></div>;
  }

  if (!truck) {
    return <div className="truck-view-3d empty"><p>{t.noTruck}</p></div>;
  }

  return (
    <div className="truck-view-3d">
      <Canvas
        shadows
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        onError={() => setError(t.renderError)}
        onPointerMissed={() => onSelect(null)}
      >
        <PerspectiveCamera makeDefault position={[15, 12, 15]} fov={50} />
        <OrbitControls
          ref={controlsRef}
          target={[truck.innerDims.x / 2000, truck.innerDims.y / 2000, truck.innerDims.z / 2000]}
          enableDamping
          dampingFactor={0.05}
          enabled={!viewLocked}
        />
        <CameraController truck={truck} preset={cameraPreset} controlsRef={controlsRef} />

        <ambientLight intensity={0.4} />
        <directionalLight position={[10, 20, 10]} intensity={1} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048} />

        <Suspense fallback={null}>
          <Scene
            truck={truck}
            instances={instances}
            skus={skus}
            metrics={metrics}
            showSpatialMetrics={showSpatialMetrics}
            itemNumbers={itemNumbers}
            selectedId={selectedId}
            onSelect={onSelect}
            viewLocked={viewLocked}
            onMoveInstance={onMoveInstance}
            resolveDragPosition={resolveDragPosition}
            onOpenItemActions={onOpenItemActions}
            tiltLabel={t.tiltLabel}
            frontAxleLabel={t.frontAxle}
            rearAxleLabel={t.rearAxle}
            balanceLabel={t.balance}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}

const SCALE = 0.001;

function Scene({ truck, instances, skus, metrics, showSpatialMetrics, itemNumbers, selectedId, onSelect, viewLocked, onMoveInstance, resolveDragPosition, onOpenItemActions, tiltLabel, frontAxleLabel, rearAxleLabel, balanceLabel }: {
  truck: TruckType;
  instances: CaseInstance[];
  skus: Map<string, CaseSKU>;
  metrics: LoadMetrics | null;
  showSpatialMetrics: boolean;
  itemNumbers: Map<string, number>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  viewLocked: boolean;
  onMoveInstance: (id: string, position: { x: number; y: number; z: number }) => boolean;
  resolveDragPosition: (id: string, position: { x: number; y: number; z: number }) => { x: number; y: number; z: number };
  onOpenItemActions: (payload: { id: string; clientX: number; clientY: number; tiltAllowed: boolean }) => void;
  tiltLabel: string;
  frontAxleLabel: string;
  rearAxleLabel: string;
  balanceLabel: string;
}) {
  const truckDims = useMemo(() => ({ x: truck.innerDims.x * SCALE, y: truck.innerDims.y * SCALE, z: truck.innerDims.z * SCALE }), [truck]);

  const truckGeometry = useMemo(() => new BoxGeometry(truckDims.x, truckDims.z, truckDims.y), [truckDims.x, truckDims.y, truckDims.z]);
  const loadColor = (pct: number) => {
    if (pct > 100) return '#ef4444';
    if (pct > 80) return '#f59e0b';
    return '#22c55e';
  };
  const balanceColor = (imbalancePct: number) => {
    const limit = Math.max(1, truck.balance.maxLeftRightPercentDiff);
    if (imbalancePct > limit) return '#ef4444';
    if (imbalancePct > limit * 0.8) return '#f59e0b';
    return '#22c55e';
  };

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

      <MeterGuides truck={truck} truckDims={truckDims} />

      {metrics && showSpatialMetrics && (
        <>
          {(() => {
            const axleBarLen = Math.max(1.2, truckDims.y * 0.56);
            const axleBarHeight = 0.028;
            const axleBarDepth = 0.02;
            const floorY = axleBarHeight / 2 + 0.004;

            const frontPct = truck.axle.maxFrontKg > 0 ? (metrics.frontAxleKg / truck.axle.maxFrontKg) * 100 : 0;
            const rearPct = truck.axle.maxRearKg > 0 ? (metrics.rearAxleKg / truck.axle.maxRearKg) * 100 : 0;
            const frontFill = Math.max(0, Math.min(1, frontPct / 100));
            const rearFill = Math.max(0, Math.min(1, rearPct / 100));
            const frontFillLen = axleBarLen * frontFill;
            const rearFillLen = axleBarLen * rearFill;

            return (
              <>
                <group position={[truck.axle.frontX * SCALE, floorY, truckDims.y / 2]}>
                  <mesh>
                    <boxGeometry args={[axleBarDepth, axleBarHeight, axleBarLen]} />
                    <meshStandardMaterial color="#334155" />
                  </mesh>
                  {frontFillLen > 0 && (
                    <mesh position={[0, 0.001, -axleBarLen / 2 + frontFillLen / 2]}>
                      <boxGeometry args={[axleBarDepth * 1.05, axleBarHeight * 0.82, frontFillLen]} />
                      <meshStandardMaterial color={loadColor(frontPct)} />
                    </mesh>
                  )}
                  <Text
                    position={[0, 0.055, 0]}
                    fontSize={0.085}
                    maxWidth={2.1}
                    color="#f8fafc"
                    outlineWidth={0.003}
                    outlineColor="#0f172a"
                    anchorX="center"
                    anchorY="middle"
                    textAlign="center"
                  >
                    {`${frontAxleLabel}: ${metrics.frontAxleKg.toFixed(0)} kg (${frontPct.toFixed(0)}%)`}
                  </Text>
                </group>

                <group position={[truck.axle.rearX * SCALE, floorY, truckDims.y / 2]}>
                  <mesh>
                    <boxGeometry args={[axleBarDepth, axleBarHeight, axleBarLen]} />
                    <meshStandardMaterial color="#334155" />
                  </mesh>
                  {rearFillLen > 0 && (
                    <mesh position={[0, 0.001, -axleBarLen / 2 + rearFillLen / 2]}>
                      <boxGeometry args={[axleBarDepth * 1.05, axleBarHeight * 0.82, rearFillLen]} />
                      <meshStandardMaterial color={loadColor(rearPct)} />
                    </mesh>
                  )}
                  <Text
                    position={[0, 0.055, 0]}
                    fontSize={0.085}
                    maxWidth={2.1}
                    color="#f8fafc"
                    outlineWidth={0.003}
                    outlineColor="#0f172a"
                    anchorX="center"
                    anchorY="middle"
                    textAlign="center"
                  >
                    {`${rearAxleLabel}: ${metrics.rearAxleKg.toFixed(0)} kg (${rearPct.toFixed(0)}%)`}
                  </Text>
                </group>
              </>
            );
          })()}

          {(() => {
            const total = Math.max(1, metrics.leftWeightKg + metrics.rightWeightKg);
            const leftShare = metrics.leftWeightKg / total;
            const rightShare = metrics.rightWeightKg / total;
            const balColor = balanceColor(metrics.lrImbalancePercent);

            const balanceLen = Math.max(1.8, truckDims.y * 0.9);
            const balanceHeight = 0.04;
            const balanceDepth = 0.022;
            const halfLen = balanceLen / 2;
            const leftLen = Math.max(0, Math.min(halfLen, halfLen * leftShare * 2));
            const rightLen = Math.max(0, Math.min(halfLen, halfLen * rightShare * 2));

            return (
              <group position={[Math.max(0.12, truckDims.x * 0.08), truckDims.z + 0.21, truckDims.y / 2]}>
                <mesh>
                  <boxGeometry args={[balanceDepth, balanceHeight, balanceLen]} />
                  <meshStandardMaterial color="#334155" />
                </mesh>
                <mesh>
                  <boxGeometry args={[balanceDepth * 1.06, balanceHeight * 1.05, 0.012]} />
                  <meshStandardMaterial color="#f8fafc" />
                </mesh>
                {leftLen > 0 && (
                  <mesh position={[0, 0.001, -leftLen / 2]}>
                    <boxGeometry args={[balanceDepth * 1.08, balanceHeight * 0.82, leftLen]} />
                    <meshStandardMaterial color={balColor} />
                  </mesh>
                )}
                {rightLen > 0 && (
                  <mesh position={[0, 0.001, rightLen / 2]}>
                    <boxGeometry args={[balanceDepth * 1.08, balanceHeight * 0.82, rightLen]} />
                    <meshStandardMaterial color={balColor} />
                  </mesh>
                )}
                <Text
                  position={[0, 0.08, 0]}
                  fontSize={0.09}
                  maxWidth={3.6}
                  color="#fde047"
                  outlineWidth={0.003}
                  outlineColor="#0f172a"
                  anchorX="center"
                  anchorY="middle"
                  textAlign="center"
                >
                  {`${balanceLabel}: L ${metrics.leftWeightKg.toFixed(0)} / R ${metrics.rightWeightKg.toFixed(0)} kg (${metrics.lrImbalancePercent.toFixed(1)}%)`}
                </Text>
              </group>
            );
          })()}
        </>
      )}

      {instances.map((inst) => (
        <CaseMesh
          key={inst.id}
          instance={inst}
          sku={skus.get(inst.skuId)}
          itemNumber={itemNumbers.get(inst.id)}
          truck={truck}
          scale={SCALE}
          isSelected={inst.id === selectedId}
          viewLocked={viewLocked}
          onSelect={() => onSelect(inst.id)}
          onToggleSelect={() => onSelect(inst.id === selectedId ? null : inst.id)}
          onDrop={(position) => onMoveInstance(inst.id, position)}
          onPreviewPosition={(position) => resolveDragPosition(inst.id, position)}
          tiltLabel={tiltLabel}
          onOpenActions={(clientX, clientY) => onOpenItemActions({
            id: inst.id,
            clientX,
            clientY,
            tiltAllowed: Boolean(skus.get(inst.skuId)?.tiltAllowed),
          })}
        />
      ))}
    </>
  );
}

function CaseMesh({ instance, sku, itemNumber, truck, scale, isSelected, viewLocked, onSelect, onToggleSelect, onDrop, onPreviewPosition, onOpenActions, tiltLabel }: {
  instance: CaseInstance;
  sku?: CaseSKU;
  itemNumber?: number;
  truck: TruckType;
  scale: number;
  isSelected: boolean;
  viewLocked: boolean;
  onSelect: () => void;
  onToggleSelect: () => void;
  onDrop: (position: { x: number; y: number; z: number }) => boolean;
  onPreviewPosition: (position: { x: number; y: number; z: number }) => { x: number; y: number; z: number };
  onOpenActions: (clientX: number, clientY: number) => void;
  tiltLabel: string;
}) {
  const [draftPosition, setDraftPosition] = useState<{ x: number; y: number; z: number } | null>(null);
  const draftPositionRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const isDragging = useRef(false);
  const dragOffset = useRef(new Vector3());
  const dragPlane = useRef(new Plane());
  const moved = useRef(false);
  const pointerId = useRef<number | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sizeMm = useMemo(
    () => ({
      x: instance.aabb.max.x - instance.aabb.min.x,
      y: instance.aabb.max.y - instance.aabb.min.y,
      z: instance.aabb.max.z - instance.aabb.min.z,
    }),
    [instance.aabb.max.x, instance.aabb.max.y, instance.aabb.max.z, instance.aabb.min.x, instance.aabb.min.y, instance.aabb.min.z],
  );

  const currentPosition = draftPosition ?? instance.position;

  const position: [number, number, number] = [
    (currentPosition.x + sizeMm.x / 2) * scale,
    (currentPosition.z + sizeMm.z / 2) * scale,
    (currentPosition.y + sizeMm.y / 2) * scale,
  ];

  const size: [number, number, number] = [
    sizeMm.x * scale,
    sizeMm.z * scale,
    sizeMm.y * scale,
  ];

  const caseGeometry = useMemo(() => new BoxGeometry(...size), [size[0], size[1], size[2]]);
  const color = isSelected ? '#22c55e' : (sku?.color ?? '#6366f1');
  const isTilted = (instance.tilt?.y ?? 0) === 90;
  const faceLabel = `#${itemNumber ?? '?'} ${sku?.name ?? instance.skuId}`;
  const numberLabel = `#${itemNumber ?? '?'}`;
  const textSize = Math.max(Math.min(size[0], size[1], size[2]) * 0.11, 0.055);
  const tiltTextSize = Math.max(textSize * 0.74, 0.045);
  const numberTextSize = Math.max(textSize * 1.05, 0.06);
  const sideTiltOffsetY = -Math.max(size[1] * 0.36, textSize * 2.4);
  const topTiltOffsetZ = -Math.max(size[2] * 0.36, textSize * 2.4);
  const numberTopOffsetZ = Math.max(size[2] * 0.34, textSize * 1.8);
  const numberSideOffsetY = Math.max(size[1] * 0.32, textSize * 1.8);

  const cancelLongPress = () => {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const clearDrag = () => {
    isDragging.current = false;
    moved.current = false;
    pointerId.current = null;
    draftPositionRef.current = null;
    cancelLongPress();
  };

  const toClampedPosition = (worldPoint: Vector3) => {
    const x = Math.max(0, Math.min(worldPoint.x / scale - sizeMm.x / 2, truck.innerDims.x - sizeMm.x));
    const y = Math.max(0, Math.min(worldPoint.z / scale - sizeMm.y / 2, truck.innerDims.y - sizeMm.y));
    return { x: Math.round(x), y: Math.round(y), z: instance.position.z };
  };

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!viewLocked) return;
    e.stopPropagation();
    if (e.button === 2) {
      onSelect();
      return;
    }
    onSelect();
    // Start long-press timer — fires onOpenActions after 500 ms if the pointer doesn't move.
    // This gives touch devices the same context-menu access as right-click on desktop.
    const lpX = e.nativeEvent.clientX;
    const lpY = e.nativeEvent.clientY;
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      isDragging.current = false; // prevent drag completion after long-press
      onOpenActions(lpX, lpY);
    }, 500);
    pointerId.current = e.pointerId;
    const pointerTarget = e.target as Element & { setPointerCapture: (id: number) => void };
    pointerTarget.setPointerCapture(e.pointerId);
    dragPlane.current.set(new Vector3(0, 1, 0), -position[1]);
    const hit = e.ray.intersectPlane(dragPlane.current, new Vector3());
    if (hit) {
      dragOffset.current.copy(new Vector3(position[0], position[1], position[2])).sub(hit);
    }
    isDragging.current = true;
    moved.current = false;
    draftPositionRef.current = null;
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    cancelLongPress(); // any movement cancels the long-press
    if (!viewLocked || !isDragging.current) return;
    e.stopPropagation();
    const hit = e.ray.intersectPlane(dragPlane.current, new Vector3());
    if (!hit) return;
    const center = hit.add(dragOffset.current);
    const raw = toClampedPosition(center);
    const snapped = onPreviewPosition(raw);
    moved.current = true;
    draftPositionRef.current = snapped;
    setDraftPosition(snapped);
  };

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    cancelLongPress();
    if (!viewLocked || !isDragging.current) return;
    e.stopPropagation();
    if (pointerId.current !== null) {
      const pointerTarget = e.target as Element & { releasePointerCapture: (id: number) => void };
      pointerTarget.releasePointerCapture(pointerId.current);
    }
    const latestDraft = draftPositionRef.current ?? draftPosition;
    if (moved.current && latestDraft) {
      const applied = onDrop(latestDraft);
      if (!applied) {
        draftPositionRef.current = null;
        setDraftPosition(null);
      }
    } else {
      onToggleSelect();
    }
    draftPositionRef.current = null;
    setDraftPosition(null);
    clearDrag();
  };

  useEffect(() => {
    if (!viewLocked) {
      setDraftPosition(null);
      clearDrag();
    }
  }, [viewLocked]);

  useEffect(() => {
    return () => {
      if (longPressTimer.current !== null) clearTimeout(longPressTimer.current);
    };
  }, []);

  return (
    <mesh
      position={position}
      rotation={[0, 0, 0]}
      onClick={(e) => {
        e.stopPropagation();
        if (!moved.current) onToggleSelect();
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onContextMenu={(e) => {
        if (!viewLocked) return;
        e.stopPropagation();
        e.nativeEvent.preventDefault();
        onOpenActions(e.nativeEvent.clientX, e.nativeEvent.clientY);
      }}
      castShadow
      receiveShadow
    >
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} transparent={false} opacity={1} emissive={isSelected ? '#22c55e' : '#000000'} emissiveIntensity={isSelected ? 0.25 : 0} />
      <lineSegments>
        <edgesGeometry args={[caseGeometry]} />
        <lineBasicMaterial color="#020617" linewidth={2} />
      </lineSegments>

      <Text position={[0, size[1] / 2 + 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={textSize} maxWidth={size[0] * 0.9} color="#f8fafc" anchorX="center" anchorY="middle" textAlign="center">{faceLabel}</Text>
      <Text position={[0, size[1] / 2 + 0.005, numberTopOffsetZ]} rotation={[-Math.PI / 2, 0, 0]} fontSize={numberTextSize} maxWidth={size[0] * 0.5} color="#fde047" anchorX="center" anchorY="middle" textAlign="center">{numberLabel}</Text>
      {isTilted && <Text position={[0, size[1] / 2 + 0.005, topTiltOffsetZ]} rotation={[-Math.PI / 2, 0, 0]} fontSize={tiltTextSize} maxWidth={size[0] * 0.8} color="#fbbf24" anchorX="center" anchorY="middle" textAlign="center">{tiltLabel}</Text>}

      <Text position={[0, 0, size[2] / 2 + 0.005]} fontSize={textSize} maxWidth={size[0] * 0.9} color="#f8fafc" anchorX="center" anchorY="middle" textAlign="center">{faceLabel}</Text>
      <Text position={[0, numberSideOffsetY, size[2] / 2 + 0.005]} fontSize={numberTextSize} maxWidth={size[0] * 0.5} color="#fde047" anchorX="center" anchorY="middle" textAlign="center">{numberLabel}</Text>
      {isTilted && <Text position={[0, sideTiltOffsetY, size[2] / 2 + 0.005]} fontSize={tiltTextSize} maxWidth={size[0] * 0.8} color="#fbbf24" anchorX="center" anchorY="middle" textAlign="center">{tiltLabel}</Text>}

      <Text position={[0, 0, -size[2] / 2 - 0.005]} rotation={[0, Math.PI, 0]} fontSize={textSize} maxWidth={size[0] * 0.9} color="#f8fafc" anchorX="center" anchorY="middle" textAlign="center">{faceLabel}</Text>
      <Text position={[0, numberSideOffsetY, -size[2] / 2 - 0.005]} rotation={[0, Math.PI, 0]} fontSize={numberTextSize} maxWidth={size[0] * 0.5} color="#fde047" anchorX="center" anchorY="middle" textAlign="center">{numberLabel}</Text>
      {isTilted && <Text position={[0, sideTiltOffsetY, -size[2] / 2 - 0.005]} rotation={[0, Math.PI, 0]} fontSize={tiltTextSize} maxWidth={size[0] * 0.8} color="#fbbf24" anchorX="center" anchorY="middle" textAlign="center">{tiltLabel}</Text>}

      <Text position={[size[0] / 2 + 0.005, 0, 0]} rotation={[0, Math.PI / 2, 0]} fontSize={textSize} maxWidth={size[2] * 0.9} color="#f8fafc" anchorX="center" anchorY="middle" textAlign="center">{faceLabel}</Text>
      {isTilted && <Text position={[size[0] / 2 + 0.005, sideTiltOffsetY, 0]} rotation={[0, Math.PI / 2, 0]} fontSize={tiltTextSize} maxWidth={size[2] * 0.8} color="#fbbf24" anchorX="center" anchorY="middle" textAlign="center">{tiltLabel}</Text>}

      <Text position={[-size[0] / 2 - 0.005, 0, 0]} rotation={[0, -Math.PI / 2, 0]} fontSize={textSize} maxWidth={size[2] * 0.9} color="#f8fafc" anchorX="center" anchorY="middle" textAlign="center">{faceLabel}</Text>
      {isTilted && <Text position={[-size[0] / 2 - 0.005, sideTiltOffsetY, 0]} rotation={[0, -Math.PI / 2, 0]} fontSize={tiltTextSize} maxWidth={size[2] * 0.8} color="#fbbf24" anchorX="center" anchorY="middle" textAlign="center">{tiltLabel}</Text>}

      {isSelected && (
        <lineSegments>
          <edgesGeometry args={[caseGeometry]} />
          <lineBasicMaterial color="#22c55e" linewidth={2} />
        </lineSegments>
      )}
    </mesh>
  );
}


function MeterGuides({ truck, truckDims }: { truck: TruckType; truckDims: { x: number; y: number; z: number } }) {
  const meterStepMm = 1000;
  const xMeters = Math.floor(truck.innerDims.x / meterStepMm);
  const yMeters = Math.floor(truck.innerDims.y / meterStepMm);

  return (
    <>
      {Array.from({ length: xMeters + 1 }, (_, i) => {
        const x = i * meterStepMm * SCALE;
        return (
          <group key={`mx-${i}`} position={[x, 0.015, -0.09]}>
            <mesh>
              <boxGeometry args={[0.014, 0.05, 0.09]} />
              <meshStandardMaterial color="#e2e8f0" emissive="#e2e8f0" emissiveIntensity={0.3} />
            </mesh>
            <Text
              position={[0, 0.075, 0]}
              fontSize={0.11}
              color="#f8fafc"
              outlineWidth={0.007}
              outlineColor="#0f172a"
              anchorX="center"
              anchorY="middle"
            >
              {String(i)}
            </Text>
          </group>
        );
      })}
      {Array.from({ length: yMeters + 1 }, (_, i) => {
        const z = i * meterStepMm * SCALE;
        return (
          <group key={`my-${i}`} position={[-0.09, 0.015, z]}>
            <mesh>
              <boxGeometry args={[0.09, 0.05, 0.014]} />
              <meshStandardMaterial color="#e2e8f0" emissive="#e2e8f0" emissiveIntensity={0.3} />
            </mesh>
            <Text
              position={[0, 0.075, 0]}
              rotation={[0, Math.PI / 2, 0]}
              fontSize={0.11}
              color="#f8fafc"
              outlineWidth={0.007}
              outlineColor="#0f172a"
              anchorX="center"
              anchorY="middle"
            >
              {String(i)}
            </Text>
          </group>
        );
      })}

      <Text position={[truckDims.x / 2, 0.1, -0.16]} fontSize={0.1} color="#f8fafc" outlineWidth={0.006} outlineColor="#0f172a" anchorX="center" anchorY="middle">
        m
      </Text>
      <Text position={[-0.16, 0.1, truckDims.y / 2]} rotation={[0, Math.PI / 2, 0]} fontSize={0.1} color="#f8fafc" outlineWidth={0.006} outlineColor="#0f172a" anchorX="center" anchorY="middle">
        m
      </Text>
    </>
  );
}

function CameraController({ truck, preset, controlsRef }: {
  truck: TruckType;
  preset: CameraPreset;
  controlsRef: MutableRefObject<any>;
}) {
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    const center = new Vector3(truck.innerDims.x * SCALE / 2, truck.innerDims.z * SCALE / 2, truck.innerDims.y * SCALE / 2);
    const span = Math.max(truck.innerDims.x, truck.innerDims.y, truck.innerDims.z) * SCALE;
    const nearHeight = Math.max(truck.innerDims.z * SCALE * 0.7, 2);
    const far = span * 1.4;

    let cameraPos: Vector3;
    if (preset === 'top') {
      cameraPos = new Vector3(center.x, center.y + span * 1.7, center.z);
    } else if (preset === 'side-left') {
      cameraPos = new Vector3(center.x, center.y + nearHeight, center.z + far);
    } else if (preset === 'side-right') {
      cameraPos = new Vector3(center.x, center.y + nearHeight, center.z - far);
    } else {
      cameraPos = new Vector3(center.x + far, center.y + span, center.z + far);
    }

    controls.object.position.copy(cameraPos);
    controls.target.copy(center);
    controls.update();
  }, [truck, preset, controlsRef]);

  return null;
}
