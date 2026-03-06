import { useRef, useState, useCallback, Suspense, useEffect, useMemo } from 'react';
import { Canvas, useThree, useLoader, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Center, Html, Billboard } from '@react-three/drei';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';
import {
  Maximize, RotateCcw, Box, Grid3x3, Eye, Loader2, MapPin,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

type ViewMode = 'solid' | 'wireframe' | 'xray';

export interface Annotation {
  id: number;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  zone: string;
  position_hint: string;
  title: string;
  problem: string;
  solution: string;
  color: string;
}

interface CADViewerProps {
  fileUrl: string | null;
  fileType: string | null;
  loading?: boolean;
  className?: string;
  annotations?: Annotation[];
  selectedAnnotation?: number | null;
  onSelectAnnotation?: (id: number | null) => void;
}

/* ─── Position mapping ─── */
function mapPositionHint(hint: string, bbox: THREE.Box3): THREE.Vector3 {
  const center = bbox.getCenter(new THREE.Vector3());
  const { min, max } = bbox;
  const map: Record<string, THREE.Vector3> = {
    far_end_top: new THREE.Vector3(min.x, max.y, max.z),
    far_end_bottom: new THREE.Vector3(min.x, min.y, max.z),
    middle_center: center.clone(),
    near_end_top: new THREE.Vector3(max.x, max.y, min.z),
    near_end_bottom: new THREE.Vector3(max.x, min.y, min.z),
    middle_top: new THREE.Vector3(center.x, max.y, center.z),
    middle_bottom: new THREE.Vector3(center.x, min.y, center.z),
    far_end_center: new THREE.Vector3(min.x, center.y, max.z),
    near_end_center: new THREE.Vector3(max.x, center.y, min.z),
  };
  return map[hint] || center.clone();
}

/* ─── Pulsing annotation sphere ─── */
function AnnotationPin({
  annotation,
  position,
  isSelected,
  isDimmed,
  onClick,
}: {
  annotation: Annotation;
  position: THREE.Vector3;
  isSelected: boolean;
  isDimmed: boolean;
  onClick: () => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const color = new THREE.Color(annotation.color);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const pulse = isSelected ? 1.2 + Math.sin(t * 4) * 0.3 : 1 + Math.sin(t * 2) * 0.15;
    if (meshRef.current) meshRef.current.scale.setScalar(pulse);
    if (glowRef.current) {
      glowRef.current.scale.setScalar(pulse * 2);
      (glowRef.current.material as THREE.MeshBasicMaterial).opacity = isDimmed ? 0.05 : (0.15 + Math.sin(t * 2) * 0.1);
    }
  });

  return (
    <group position={position}>
      {/* Glow sphere */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.15, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.15} />
      </mesh>
      {/* Core sphere */}
      <mesh ref={meshRef} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshBasicMaterial color={color} opacity={isDimmed ? 0.3 : 1} transparent />
      </mesh>
      {/* Label billboard */}
      <Billboard position={[0, 0.35, 0]}>
        <Html center distanceFactor={6} style={{ pointerEvents: 'auto' }}>
          <div
            onClick={(e) => { e.stopPropagation(); onClick(); }}
            className="cursor-pointer select-none whitespace-nowrap"
            style={{ opacity: isDimmed ? 0.3 : 1, transition: 'opacity 0.3s' }}
          >
            <div
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-bold border backdrop-blur-sm"
              style={{
                backgroundColor: `${annotation.color}22`,
                borderColor: `${annotation.color}66`,
                color: annotation.color,
              }}
            >
              <span>#{annotation.id}</span>
              <span className="text-[9px] font-medium opacity-80">{annotation.title}</span>
            </div>
          </div>
        </Html>
      </Billboard>
      {/* Line from pin to label */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[new Float32Array([0, 0, 0, 0, 0.25, 0]), 3]}
            count={2}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial color={annotation.color} opacity={isDimmed ? 0.2 : 0.6} transparent />
      </line>
    </group>
  );
}

/* ─── Popup card ─── */
function AnnotationPopup({
  annotation,
  position,
  onClose,
}: {
  annotation: Annotation;
  position: THREE.Vector3;
  onClose: () => void;
}) {
  const severityEmoji: Record<string, string> = {
    CRITICAL: '🔴', HIGH: '🟠', MEDIUM: '🟡', LOW: '⚪',
  };

  return (
    <group position={position}>
      <Billboard position={[0, 0.7, 0]}>
        <Html center distanceFactor={5} style={{ pointerEvents: 'auto' }}>
          <div
            className="w-56 rounded-lg border shadow-2xl text-xs backdrop-blur-md"
            style={{
              backgroundColor: 'hsl(220 25% 8% / 0.95)',
              borderColor: `${annotation.color}44`,
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-3 py-2 rounded-t-lg border-b"
              style={{
                backgroundColor: `${annotation.color}18`,
                borderColor: `${annotation.color}33`,
              }}
            >
              <span className="font-bold" style={{ color: annotation.color }}>
                {severityEmoji[annotation.severity]} {annotation.severity} — #{annotation.id}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onClose(); }}
                className="text-muted-foreground hover:text-foreground text-sm leading-none"
              >
                ✕
              </button>
            </div>
            {/* Body */}
            <div className="px-3 py-2.5 space-y-2">
              <p className="font-bold text-foreground">{annotation.title}</p>
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Problem</p>
                <p className="text-foreground/80">{annotation.problem}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Solution</p>
                <p className="text-foreground/80">{annotation.solution}</p>
              </div>
            </div>
          </div>
        </Html>
      </Billboard>
    </group>
  );
}

/* ─── Camera fly-to ─── */
function CameraController({ target, orbitRef }: { target: THREE.Vector3 | null; orbitRef: React.RefObject<any> }) {
  const { camera } = useThree();
  const animating = useRef(false);
  const startPos = useRef(new THREE.Vector3());
  const endPos = useRef(new THREE.Vector3());
  const startTarget = useRef(new THREE.Vector3());
  const endTarget = useRef(new THREE.Vector3());
  const progress = useRef(0);

  useEffect(() => {
    if (!target) return;
    startPos.current.copy(camera.position);
    const offset = new THREE.Vector3(1.5, 1, 1.5).normalize().multiplyScalar(3);
    endPos.current.copy(target).add(offset);
    if (orbitRef.current) startTarget.current.copy(orbitRef.current.target);
    endTarget.current.copy(target);
    progress.current = 0;
    animating.current = true;
  }, [target, camera, orbitRef]);

  useFrame((_, delta) => {
    if (!animating.current) return;
    progress.current = Math.min(1, progress.current + delta / 0.8);
    const t = easeInOut(progress.current);
    camera.position.lerpVectors(startPos.current, endPos.current, t);
    if (orbitRef.current) {
      orbitRef.current.target.lerpVectors(startTarget.current, endTarget.current, t);
      orbitRef.current.update();
    }
    if (progress.current >= 1) animating.current = false;
  });

  return null;
}

function easeInOut(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/* ─── Annotations layer ─── */
function AnnotationsLayer({
  annotations,
  selectedId,
  onSelect,
}: {
  annotations: Annotation[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
}) {
  const { scene } = useThree();
  const [bbox, setBbox] = useState<THREE.Box3 | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      const box = new THREE.Box3().setFromObject(scene);
      if (!box.isEmpty()) setBbox(box);
    }, 600);
    return () => clearTimeout(timer);
  }, [scene]);

  if (!bbox) return null;

  return (
    <>
      {annotations.map((a) => {
        const pos = mapPositionHint(a.position_hint, bbox);
        const isSelected = selectedId === a.id;
        const isDimmed = selectedId !== null && !isSelected;
        return (
          <group key={a.id}>
            <AnnotationPin
              annotation={a}
              position={pos}
              isSelected={isSelected}
              isDimmed={isDimmed}
              onClick={() => onSelect(isSelected ? null : a.id)}
            />
            {isSelected && (
              <AnnotationPopup annotation={a} position={pos} onClose={() => onSelect(null)} />
            )}
          </group>
        );
      })}
    </>
  );
}

/* ─── Auto-fit model ─── */
function AutoFit({ children }: { children: React.ReactNode }) {
  return <Center>{children}</Center>;
}

/* ─── STL Model ─── */
function STLModel({ url, viewMode }: { url: string; viewMode: ViewMode }) {
  const geometry = useLoader(STLLoader, url);
  geometry.computeVertexNormals();
  const mat = getMaterial(viewMode);
  return <mesh geometry={geometry} material={mat} castShadow receiveShadow />;
}

/* ─── OBJ Model ─── */
function OBJModel({ url, viewMode }: { url: string; viewMode: ViewMode }) {
  const obj = useLoader(OBJLoader, url);
  const mat = getMaterial(viewMode);
  useEffect(() => {
    obj.traverse((child: any) => {
      if (child.isMesh) { child.material = mat; child.castShadow = true; child.receiveShadow = true; }
    });
  }, [obj, mat]);
  return <primitive object={obj} />;
}

/* ─── GLTF Model ─── */
function GLTFModel({ url, viewMode }: { url: string; viewMode: ViewMode }) {
  const gltf = useLoader(GLTFLoader, url);
  const mat = getMaterial(viewMode);
  useEffect(() => {
    gltf.scene.traverse((child: any) => {
      if (child.isMesh) {
        if (viewMode !== 'solid') child.material = mat;
        child.castShadow = true; child.receiveShadow = true;
      }
    });
  }, [gltf, viewMode, mat]);
  return <primitive object={gltf.scene} />;
}

/* ─── Material helper ─── */
function getMaterial(viewMode: ViewMode): THREE.Material {
  switch (viewMode) {
    case 'wireframe':
      return new THREE.MeshStandardMaterial({ color: 0xe63946, wireframe: true, roughness: 0.5 });
    case 'xray':
      return new THREE.MeshPhysicalMaterial({ color: 0x888888, transparent: true, opacity: 0.35, roughness: 0.2, metalness: 0.5, side: THREE.DoubleSide });
    default:
      return new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.45, metalness: 0.55 });
  }
}

/* ─── Scene content ─── */
function SceneContent({
  fileUrl, fileType, viewMode, annotations, showAnnotations, selectedId, onSelectAnnotation, flyToTarget, orbitRef,
}: {
  fileUrl: string; fileType: string; viewMode: ViewMode;
  annotations: Annotation[]; showAnnotations: boolean;
  selectedId: number | null; onSelectAnnotation: (id: number | null) => void;
  flyToTarget: THREE.Vector3 | null; orbitRef: React.RefObject<any>;
}) {
  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 8, 5]} intensity={1} castShadow />
      <directionalLight position={[-5, 3, -5]} intensity={0.4} />
      <directionalLight position={[0, -3, 5]} intensity={0.2} />

      <AutoFit>
        <Suspense
          fallback={
            <Html center>
              <div className="flex items-center gap-2 text-primary">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm font-medium">Loading model…</span>
              </div>
            </Html>
          }
        >
          {fileType === 'stl' && <STLModel url={fileUrl} viewMode={viewMode} />}
          {fileType === 'obj' && <OBJModel url={fileUrl} viewMode={viewMode} />}
          {(fileType === 'gltf' || fileType === 'glb') && <GLTFModel url={fileUrl} viewMode={viewMode} />}
        </Suspense>
      </AutoFit>

      {showAnnotations && annotations.length > 0 && (
        <AnnotationsLayer annotations={annotations} selectedId={selectedId} onSelect={onSelectAnnotation} />
      )}

      <CameraController target={flyToTarget} orbitRef={orbitRef} />

      <Grid infiniteGrid cellSize={0.5} sectionSize={2} cellColor="#1a1a2e" sectionColor="#2a2a3e" fadeDistance={30} position={[0, -0.01, 0]} />
      <OrbitControls ref={orbitRef} makeDefault enableDamping dampingFactor={0.12} minDistance={1} maxDistance={100} />
    </>
  );
}

/* ─── Main component ─── */
export default function CADViewer({ fileUrl, fileType, loading, className, annotations = [], selectedAnnotation, onSelectAnnotation }: CADViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('solid');
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [internalSelected, setInternalSelected] = useState<number | null>(null);
  const [flyToTarget, setFlyToTarget] = useState<THREE.Vector3 | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const orbitRef = useRef<any>(null);

  const selected = selectedAnnotation !== undefined ? selectedAnnotation : internalSelected;
  const setSelected = onSelectAnnotation || setInternalSelected;

  // When selectedAnnotation changes from parent (list click), trigger fly-to
  useEffect(() => {
    if (selectedAnnotation != null && annotations.length > 0) {
      // We compute a dummy target; the actual fly-to uses the scene bbox inside
      // For now just set a marker to trigger re-render
      setFlyToTarget(new THREE.Vector3(selectedAnnotation * 0.001, 0, 0)); // unique value to trigger effect
    }
  }, [selectedAnnotation, annotations]);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) containerRef.current.requestFullscreen();
    else document.exitFullscreen();
  }, []);

  const viewButtons: { mode: ViewMode; icon: typeof Box; label: string }[] = [
    { mode: 'solid', icon: Box, label: 'Solid' },
    { mode: 'wireframe', icon: Grid3x3, label: 'Wire' },
    { mode: 'xray', icon: Eye, label: 'X-Ray' },
  ];

  return (
    <div ref={containerRef} className={`relative rounded-lg overflow-hidden border border-border/50 bg-[hsl(220,25%,5%)] ${className ?? ''}`} style={{ minHeight: 400 }}>
      {/* Top-left toolbar */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5">
        {viewButtons.map(({ mode, icon: Icon, label }) => (
          <Button key={mode} size="sm" variant={viewMode === mode ? 'default' : 'secondary'} className="h-7 px-2 text-xs gap-1" onClick={() => setViewMode(mode)}>
            <Icon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{label}</span>
          </Button>
        ))}
      </div>

      {/* Top-right toolbar */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
        {annotations.length > 0 && (
          <div className="flex items-center gap-1.5 bg-secondary/80 backdrop-blur-sm rounded-md px-2 h-7">
            <MapPin className="w-3 h-3 text-primary" />
            <span className="text-[10px] text-muted-foreground hidden sm:inline">Pins</span>
            <Switch checked={showAnnotations} onCheckedChange={setShowAnnotations} className="scale-75" />
          </div>
        )}
        <Button size="sm" variant="secondary" className="h-7 w-7 p-0" onClick={toggleFullscreen} title="Fullscreen">
          <Maximize className="w-3.5 h-3.5" />
        </Button>
        <Button size="sm" variant="secondary" className="h-7 w-7 p-0" onClick={() => {}} title="Reset orientation">
          <RotateCcw className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Canvas */}
      {loading ? (
        <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Loading model…</span>
        </div>
      ) : fileUrl && fileType ? (
        <Canvas shadows camera={{ position: [4, 3, 4], fov: 45, near: 0.1, far: 1000 }} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }} style={{ height: '100%', minHeight: 400 }}>
          <color attach="background" args={['#0a0a0a']} />
          <SceneContent
            fileUrl={fileUrl} fileType={fileType} viewMode={viewMode}
            annotations={annotations} showAnnotations={showAnnotations}
            selectedId={selected} onSelectAnnotation={setSelected}
            flyToTarget={flyToTarget} orbitRef={orbitRef}
          />
        </Canvas>
      ) : (
        <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-3 text-muted-foreground">
          <Box className="w-12 h-12 opacity-30" />
          <p className="text-sm">Upload a 3D model to preview</p>
          <p className="text-xs opacity-50">STL · OBJ · GLTF · GLB</p>
        </div>
      )}

      {/* Annotation list panel */}
      {annotations.length > 0 && showAnnotations && (
        <div className="absolute bottom-3 left-3 right-3 z-10">
          <div className="bg-background/90 backdrop-blur-md border border-border/50 rounded-lg p-2 flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
            {annotations.map((a) => {
              const isActive = selected === a.id;
              return (
                <button
                  key={a.id}
                  onClick={() => setSelected(isActive ? null : a.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all ${
                    isActive ? 'ring-1 ring-primary scale-105' : 'hover:bg-accent/50'
                  }`}
                  style={{
                    borderColor: `${a.color}44`,
                    backgroundColor: isActive ? `${a.color}22` : 'transparent',
                  }}
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: a.color }} />
                  <span className="text-foreground/90">#{a.id} {a.title}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
