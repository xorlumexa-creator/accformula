import { useState, useRef, useCallback, useEffect, useMemo, Suspense } from 'react';
import { Canvas, useThree, useFrame, useLoader, ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Html, Grid } from '@react-three/drei';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import ReactMarkdown from 'react-markdown';
import {
  Upload, Trash2, Eye, EyeOff, Maximize, RotateCcw, Box, Grid3x3,
  Loader2, Zap, Save, Crosshair, Star, Download,
  Link2, Scale, Shield, Wrench, AlertTriangle, Minimize2,
  ArrowDownToLine, ArrowUpFromLine, FlipVertical, Undo2,
  Plus, Minus, RotateCw,
} from 'lucide-react';

const PYTHON_API = 'https://python-1--epicure742.replit.app/analyze-part';
const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;
const PART_COLORS = ['#ff4444', '#4488ff', '#44ff88', '#ffaa00', '#aa44ff', '#ff44aa', '#ff8844', '#44ffff'];
const VIEWER_FORMATS = ['stl', 'obj', 'gltf', 'glb'];

interface PartGeometry {
  dimensions_mm: { x: number; y: number; z: number };
  volume_mm3: number;
  surface_area_mm2?: number;
  center_of_gravity: { x: number; y: number; z: number };
  is_watertight: boolean;
  vertex_count: number;
  face_count: number;
}

interface AssemblyPart {
  id: string;
  file: File;
  url: string;
  fileType: string;
  name: string;
  color: string;
  visible: boolean;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  originalRotation: [number, number, number];
  geometry?: PartGeometry;
  geometrySource: 'python' | 'estimated';
  estimatedDims?: { x: number; y: number; z: number };
}

interface AssemblyAnnotation {
  id: number;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  zone: string;
  position_hint: string;
  title: string;
  problem: string;
  solution: string;
  color: string;
}

interface AnalysisResult {
  content: string;
  annotations: AssemblyAnnotation[];
  score: number;
  metrics: {
    jointCompatibility: number;
    weightBalance: number;
    structuralRating: number;
    modificationDifficulty: string;
  };
}

type ViewMode = 'solid' | 'wireframe' | 'xray';

const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

/* ─── Python API call ─── */
async function fetchPythonGeometry(file: File): Promise<PartGeometry | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const formData = new FormData();
    formData.append('file', file);
    const resp = await fetch(PYTHON_API, { method: 'POST', body: formData, signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

/* ─── Mesh island separation ─── */
function separateMeshIslands(geometry: THREE.BufferGeometry): THREE.BufferGeometry[] {
  const pos = geometry.attributes.position;
  const index = geometry.index;
  if (!pos) return [geometry];

  const vertexCount = pos.count;
  const parent = new Int32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) parent[i] = i;

  function find(a: number): number {
    while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
    return a;
  }
  function union(a: number, b: number) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  if (index) {
    const arr = index.array;
    for (let i = 0; i < arr.length; i += 3) {
      union(arr[i], arr[i + 1]);
      union(arr[i + 1], arr[i + 2]);
    }
  } else {
    for (let i = 0; i < vertexCount; i += 3) {
      union(i, i + 1);
      union(i + 1, i + 2);
    }
  }

  const islands = new Map<number, number[]>();
  if (index) {
    const arr = index.array;
    for (let i = 0; i < arr.length; i += 3) {
      const root = find(arr[i]);
      if (!islands.has(root)) islands.set(root, []);
      islands.get(root)!.push(i / 3);
    }
  } else {
    for (let i = 0; i < vertexCount; i += 3) {
      const root = find(i);
      if (!islands.has(root)) islands.set(root, []);
      islands.get(root)!.push(i / 3);
    }
  }

  if (islands.size <= 1 || islands.size > 20) return [geometry];

  const results: THREE.BufferGeometry[] = [];
  for (const [, faceIndices] of islands) {
    const newGeo = new THREE.BufferGeometry();
    const positions: number[] = [];
    const normals: number[] = [];
    const hasNormals = !!geometry.attributes.normal;

    for (const fi of faceIndices) {
      for (let v = 0; v < 3; v++) {
        const vi = index ? index.array[fi * 3 + v] : fi * 3 + v;
        positions.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
        if (hasNormals) {
          const n = geometry.attributes.normal;
          normals.push(n.getX(vi), n.getY(vi), n.getZ(vi));
        }
      }
    }

    newGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (normals.length) newGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    else newGeo.computeVertexNormals();
    results.push(newGeo);
  }

  return results;
}

/* ─── Three.js estimated dimensions ─── */
function estimateDimensions(geometry: THREE.BufferGeometry): { x: number; y: number; z: number } {
  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox!;
  return {
    x: +(bbox.max.x - bbox.min.x).toFixed(2),
    y: +(bbox.max.y - bbox.min.y).toFixed(2),
    z: +(bbox.max.z - bbox.min.z).toFixed(2),
  };
}

/* ─── Materials ─── */
function getPartMaterial(color: string, viewMode: ViewMode, isSelected: boolean, isHovered: boolean, isIsolatedOther: boolean): THREE.Material {
  const c = new THREE.Color(color);
  const opacity = isIsolatedOther ? 0 : 1;
  switch (viewMode) {
    case 'wireframe':
      return new THREE.MeshStandardMaterial({ color: c, wireframe: true, roughness: 0.5, transparent: isIsolatedOther, opacity });
    case 'xray':
      return new THREE.MeshPhysicalMaterial({ color: c, transparent: true, opacity: isIsolatedOther ? 0 : 0.3, roughness: 0.2, metalness: 0.5, side: THREE.DoubleSide });
    default:
      return new THREE.MeshStandardMaterial({
        color: c, roughness: 0.3, metalness: 0.7,
        emissive: isSelected ? new THREE.Color('#ff0000') : isHovered ? c : new THREE.Color(0x000000),
        emissiveIntensity: isSelected ? 0.4 : isHovered ? 0.1 : 0,
        transparent: isIsolatedOther, opacity,
      });
  }
}

/* ─── Part Mesh component ─── */
function PartMesh({ geometry, color, viewMode, isSelected, isHovered, isIsolatedOther, onPointerOver, onPointerOut, onPointerDown, onClick }: {
  geometry: THREE.BufferGeometry; color: string; viewMode: ViewMode;
  isSelected: boolean; isHovered: boolean; isIsolatedOther: boolean;
  onPointerOver: () => void; onPointerOut: () => void;
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
}) {
  const mat = useMemo(() => getPartMaterial(color, viewMode, isSelected, isHovered, isIsolatedOther),
    [color, viewMode, isSelected, isHovered, isIsolatedOther]);

  return (
    <mesh geometry={geometry} material={mat} castShadow receiveShadow
      onPointerOver={(e) => { e.stopPropagation(); onPointerOver(); }}
      onPointerOut={onPointerOut}
      onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e); }}
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
    />
  );
}

/* ─── STL Part ─── */
function PartSTL({ url, color, viewMode, isSelected, isHovered, isIsolatedOther, onBoundsReady, onPointerOver, onPointerOut, onPointerDown, onClick }: {
  url: string; color: string; viewMode: ViewMode; isSelected: boolean; isHovered: boolean; isIsolatedOther: boolean;
  onBoundsReady?: (dims: { x: number; y: number; z: number }) => void;
  onPointerOver: () => void; onPointerOut: () => void;
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
}) {
  const geometry = useLoader(STLLoader, url);
  const readyRef = useRef(false);

  useEffect(() => {
    if (readyRef.current || !onBoundsReady) return;
    geometry.computeVertexNormals();
    onBoundsReady(estimateDimensions(geometry));
    readyRef.current = true;
  }, [geometry, onBoundsReady]);

  return <PartMesh geometry={geometry} color={color} viewMode={viewMode} isSelected={isSelected} isHovered={isHovered} isIsolatedOther={isIsolatedOther} onPointerOver={onPointerOver} onPointerOut={onPointerOut} onPointerDown={onPointerDown} onClick={onClick} />;
}

function PartOBJ({ url, color, viewMode, isSelected, isHovered, isIsolatedOther, onPointerOver, onPointerOut, onPointerDown, onClick }: {
  url: string; color: string; viewMode: ViewMode; isSelected: boolean; isHovered: boolean; isIsolatedOther: boolean;
  onPointerOver: () => void; onPointerOut: () => void;
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
}) {
  const obj = useLoader(OBJLoader, url);
  const mat = useMemo(() => getPartMaterial(color, viewMode, isSelected, isHovered, isIsolatedOther),
    [color, viewMode, isSelected, isHovered, isIsolatedOther]);
  useEffect(() => { obj.traverse((c: any) => { if (c.isMesh) { c.material = mat; c.castShadow = true; } }); }, [obj, mat]);
  return <primitive object={obj}
    onPointerOver={(e: any) => { e.stopPropagation(); onPointerOver(); }}
    onPointerOut={onPointerOut}
    onPointerDown={(e: any) => { e.stopPropagation(); onPointerDown(e); }}
    onClick={(e: any) => { e.stopPropagation(); onClick(e); }}
  />;
}

function PartGLTF({ url, color, viewMode, isSelected, isHovered, isIsolatedOther, onPointerOver, onPointerOut, onPointerDown, onClick }: {
  url: string; color: string; viewMode: ViewMode; isSelected: boolean; isHovered: boolean; isIsolatedOther: boolean;
  onPointerOver: () => void; onPointerOut: () => void;
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
}) {
  const gltf = useLoader(GLTFLoader, url);
  const mat = useMemo(() => getPartMaterial(color, viewMode, isSelected, isHovered, isIsolatedOther),
    [color, viewMode, isSelected, isHovered, isIsolatedOther]);
  useEffect(() => { gltf.scene.traverse((c: any) => { if (c.isMesh) { c.material = mat; } }); }, [gltf, viewMode, mat]);
  return <primitive object={gltf.scene}
    onPointerOver={(e: any) => { e.stopPropagation(); onPointerOver(); }}
    onPointerOut={onPointerOut}
    onPointerDown={(e: any) => { e.stopPropagation(); onPointerDown(e); }}
    onClick={(e: any) => { e.stopPropagation(); onClick(e); }}
  />;
}

/* ─── Annotation Spheres ─── */
function AnnotationSpheres({ annotations, parts, visible }: {
  annotations: AssemblyAnnotation[]; parts: AssemblyPart[]; visible: boolean;
}) {
  const bbox = useMemo(() => {
    if (!visible || annotations.length === 0 || parts.length === 0) return null;
    const box = new THREE.Box3();
    parts.forEach(p => {
      const dims = p.geometry?.dimensions_mm || p.estimatedDims || { x: 10, y: 10, z: 10 };
      const halfX = dims.x / 2, halfY = dims.y / 2, halfZ = dims.z / 2;
      const pos = p.position;
      box.expandByPoint(new THREE.Vector3(pos[0] - halfX, pos[1] - halfY, pos[2] - halfZ));
      box.expandByPoint(new THREE.Vector3(pos[0] + halfX, pos[1] + halfY, pos[2] + halfZ));
    });
    return box;
  }, [parts, visible, annotations.length]);

  if (!bbox) return null;

  const maxDim = Math.max(bbox.max.x - bbox.min.x, bbox.max.y - bbox.min.y, bbox.max.z - bbox.min.z);
  const sphereSize = maxDim * 0.03;
  const center = bbox.getCenter(new THREE.Vector3());

  const getPos = (hint: string): [number, number, number] => {
    switch (hint) {
      case 'far_end_top': return [bbox.min.x, bbox.max.y, bbox.max.z];
      case 'far_end_bottom': return [bbox.min.x, bbox.min.y, bbox.max.z];
      case 'middle_center': return [center.x, center.y, center.z];
      case 'near_end_top': return [bbox.max.x, bbox.max.y, bbox.min.z];
      case 'near_end_bottom': return [bbox.max.x, bbox.min.y, bbox.min.z];
      case 'middle_top': return [center.x, bbox.max.y, center.z];
      case 'middle_bottom': return [center.x, bbox.min.y, center.z];
      default: return [center.x, center.y, center.z];
    }
  };

  return (
    <>
      {annotations.map(a => {
        const pos = getPos(a.position_hint);
        return (
          <mesh key={a.id} position={pos}>
            <sphereGeometry args={[sphereSize, 16, 16]} />
            <meshStandardMaterial color={a.color} emissive={a.color} emissiveIntensity={0.5} transparent opacity={0.85} />
            <Html center distanceFactor={maxDim * 2} style={{ pointerEvents: 'none' }}>
              <div className="bg-[#111111]/90 border border-[#333] rounded px-2 py-1 text-[10px] text-white whitespace-nowrap backdrop-blur-sm">
                {a.title}
              </div>
            </Html>
          </mesh>
        );
      })}
    </>
  );
}

/* ─── Bobbing animation for unselected parts ─── */
function BobbingGroup({ children, isSelected, partId }: { children: React.ReactNode; isSelected: boolean; partId: string }) {
  const ref = useRef<THREE.Group>(null);
  const phase = useMemo(() => Math.random() * Math.PI * 2, [partId]);

  useFrame(({ clock }) => {
    if (ref.current && !isSelected) {
      ref.current.position.y = Math.sin(clock.elapsedTime * 0.8 + phase) * 0.002;
    } else if (ref.current) {
      ref.current.position.y = 0;
    }
  });

  return <group ref={ref}>{children}</group>;
}

/* ─── Auto fit camera ─── */
function AutoFit({ orbitRef }: { orbitRef: React.RefObject<any> }) {
  const { scene, camera } = useThree();
  const fitted = useRef(false);
  useEffect(() => {
    const t = setTimeout(() => {
      if (fitted.current) return;
      const box = new THREE.Box3().setFromObject(scene);
      if (box.isEmpty()) return;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const dist = Math.max(size.x, size.y, size.z) * 2.5;
      camera.position.set(center.x + dist * 0.6, center.y + dist * 0.4, center.z + dist * 0.6);
      if (orbitRef.current) { orbitRef.current.target.copy(center); orbitRef.current.update(); }
      fitted.current = true;
    }, 500);
    return () => clearTimeout(t);
  }, [scene, camera, orbitRef]);
  return null;
}

/* ─── Spin/Tilt Controls (Html overlay on selected part) ─── */
function SpinTiltOverlay({ part, spinActive, tiltActive, onSpinDown, onSpinUp, onTiltDown, onTiltUp }: {
  part: AssemblyPart;
  spinActive: boolean; tiltActive: boolean;
  onSpinDown: () => void; onSpinUp: () => void;
  onTiltDown: () => void; onTiltUp: () => void;
}) {
  const dims = part.geometry?.dimensions_mm || part.estimatedDims || { x: 10, y: 10, z: 10 };
  const offset = Math.max(dims.x, dims.y, dims.z) * 0.6;

  return (
    <group position={part.position}>
      {/* Floating label above */}
      <Html center position={[0, offset * 0.8, 0]} style={{ pointerEvents: 'none' }}>
        <div className="bg-[#111]/90 border border-primary/40 rounded-md px-3 py-1 backdrop-blur-sm whitespace-nowrap">
          <span className="text-[11px] font-bold text-primary">{part.name}</span>
        </div>
      </Html>

      {/* Spin/Tilt buttons below */}
      <Html center position={[0, -offset * 0.5, 0]}>
        <div className="flex gap-2 select-none" style={{ touchAction: 'none' }}>
          <button
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); onSpinDown(); }}
            onPointerUp={onSpinUp}
            onPointerLeave={onSpinUp}
            onPointerCancel={onSpinUp}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all select-none cursor-pointer ${
              spinActive
                ? 'bg-red-600 text-white shadow-lg shadow-red-500/30 scale-105'
                : 'bg-[#1a1a1a] border border-[#333] text-white/80 hover:border-red-500/50 hover:bg-[#222]'
            }`}
          >
            <RotateCw className="w-3.5 h-3.5" />
            Spin
          </button>
          <button
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); onTiltDown(); }}
            onPointerUp={onTiltUp}
            onPointerLeave={onTiltUp}
            onPointerCancel={onTiltUp}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all select-none cursor-pointer ${
              tiltActive
                ? 'bg-red-600 text-white shadow-lg shadow-red-500/30 scale-105'
                : 'bg-[#1a1a1a] border border-[#333] text-white/80 hover:border-red-500/50 hover:bg-[#222]'
            }`}
          >
            <RotateCw className="w-3.5 h-3.5 rotate-90" />
            Tilt
          </button>
        </div>
      </Html>
    </group>
  );
}

/* ─── Continuous rotation driver ─── */
function RotationDriver({ spinActive, tiltActive, selectedId, onRotate }: {
  spinActive: boolean; tiltActive: boolean; selectedId: string | null;
  onRotate: (id: string, axisDeltas: [number, number, number]) => void;
}) {
  useFrame((_, delta) => {
    if (!selectedId) return;
    const speed = 90; // degrees per second
    let dx = 0, dy = 0;
    if (spinActive) dy = speed * delta;
    if (tiltActive) dx = speed * delta;
    if (dx !== 0 || dy !== 0) {
      onRotate(selectedId, [dx, dy, 0]);
    }
  });
  return null;
}

/* ─── Part Group (draggable) ─── */
function PartGroup({ part, viewMode, selectedId, isolatedId, hoveredId, onHover, onUnhover, onPointerDown, onClick }: {
  part: AssemblyPart; viewMode: ViewMode; selectedId: string | null; isolatedId: string | null;
  hoveredId: string | null;
  onHover: (id: string) => void; onUnhover: () => void;
  onPointerDown: (id: string, e: ThreeEvent<PointerEvent>) => void;
  onClick: (id: string, e: ThreeEvent<MouseEvent>) => void;
}) {
  const isSelected = selectedId === part.id;
  const isHovered = hoveredId === part.id;
  const isIsolatedOther = isolatedId !== null && isolatedId !== part.id;

  if (!part.visible || isIsolatedOther) return null;

  const interactionProps = {
    onPointerOver: () => onHover(part.id),
    onPointerOut: onUnhover,
    onPointerDown: (e: ThreeEvent<PointerEvent>) => onPointerDown(part.id, e),
    onClick: (e: ThreeEvent<MouseEvent>) => onClick(part.id, e),
  };

  return (
    <group
      position={part.position}
      rotation={[part.rotation[0] * Math.PI / 180, part.rotation[1] * Math.PI / 180, part.rotation[2] * Math.PI / 180]}
      scale={part.scale}
    >
      <BobbingGroup isSelected={isSelected} partId={part.id}>
        <Suspense fallback={<Html center><Loader2 className="w-4 h-4 animate-spin text-red-500" /></Html>}>
          {part.fileType === 'stl' && <PartSTL url={part.url} color={part.color} viewMode={viewMode} isSelected={isSelected} isHovered={isHovered} isIsolatedOther={false} {...interactionProps} />}
          {part.fileType === 'obj' && <PartOBJ url={part.url} color={part.color} viewMode={viewMode} isSelected={isSelected} isHovered={isHovered} isIsolatedOther={false} {...interactionProps} />}
          {(part.fileType === 'gltf' || part.fileType === 'glb') && <PartGLTF url={part.url} color={part.color} viewMode={viewMode} isSelected={isSelected} isHovered={isHovered} isIsolatedOther={false} {...interactionProps} />}
        </Suspense>
      </BobbingGroup>
    </group>
  );
}

/* ─── Assembly Scene ─── */
function AssemblyScene({ parts, viewMode, selectedId, isolatedId, hoveredId, orbitRef,
  spinActive, tiltActive,
  annotations, showAnnotations,
  onSelect, onHover, onUnhover, onPartMove, onPartRotate, onDeselect,
  onSpinDown, onSpinUp, onTiltDown, onTiltUp }: {
  parts: AssemblyPart[]; viewMode: ViewMode; selectedId: string | null; isolatedId: string | null;
  hoveredId: string | null; orbitRef: React.RefObject<any>;
  spinActive: boolean; tiltActive: boolean;
  annotations: AssemblyAnnotation[]; showAnnotations: boolean;
  onSelect: (id: string) => void; onHover: (id: string) => void; onUnhover: () => void;
  onPartMove: (id: string, pos: [number, number, number]) => void;
  onPartRotate: (id: string, deltas: [number, number, number]) => void;
  onDeselect: () => void;
  onSpinDown: () => void; onSpinUp: () => void;
  onTiltDown: () => void; onTiltUp: () => void;
}) {
  const draggingRef = useRef<string | null>(null);
  const dragOffsetRef = useRef(new THREE.Vector3());
  const floorPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const hasDraggedRef = useRef(false);

  const handlePartPointerDown = useCallback((id: string, e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    draggingRef.current = id;
    hasDraggedRef.current = false;
    // Calculate offset so part doesn't jump to cursor
    const part = parts.find(p => p.id === id);
    if (part) {
      const hitPoint = new THREE.Vector3();
      e.ray.intersectPlane(floorPlane, hitPoint);
      dragOffsetRef.current.set(part.position[0] - hitPoint.x, 0, part.position[2] - hitPoint.z);
    }
    if (orbitRef.current) orbitRef.current.enabled = false;
    // @ts-ignore
    e.target?.setPointerCapture?.(e.pointerId);
  }, [parts, floorPlane, orbitRef]);

  const handlePartClick = useCallback((id: string, e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (!hasDraggedRef.current) {
      onSelect(id);
    }
  }, [onSelect]);

  const handleScenePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!draggingRef.current) return;
    hasDraggedRef.current = true;
    const hitPoint = new THREE.Vector3();
    e.ray.intersectPlane(floorPlane, hitPoint);
    if (hitPoint) {
      const part = parts.find(p => p.id === draggingRef.current);
      if (part) {
        onPartMove(draggingRef.current, [
          hitPoint.x + dragOffsetRef.current.x,
          part.position[1],
          hitPoint.z + dragOffsetRef.current.z,
        ]);
      }
    }
  }, [floorPlane, parts, onPartMove]);

  const handleScenePointerUp = useCallback(() => {
    if (draggingRef.current) {
      draggingRef.current = null;
      if (orbitRef.current) orbitRef.current.enabled = true;
    }
  }, [orbitRef]);

  const selectedPartData = parts.find(p => p.id === selectedId);

  return (
    <>
      <ambientLight intensity={0.35} />
      <directionalLight position={[5, 8, 3]} intensity={1.3} castShadow color="#ffffff" />
      <directionalLight position={[-6, 4, -2]} intensity={0.5} color="#f0f0ff" />
      <pointLight position={[0, -3, 0]} intensity={0.15} color="#ff2200" />

      {/* Invisible drag surface + deselect plane */}
      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}
        onPointerMove={handleScenePointerMove}
        onPointerUp={handleScenePointerUp}
        onClick={(e) => { if (!hasDraggedRef.current) { e.stopPropagation(); onDeselect(); } }}
      >
        <planeGeometry args={[10000, 10000]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      {parts.filter(p => p.visible).map(part => (
        <PartGroup key={part.id} part={part} viewMode={viewMode} selectedId={selectedId}
          isolatedId={isolatedId} hoveredId={hoveredId}
          onHover={onHover} onUnhover={onUnhover}
          onPointerDown={handlePartPointerDown}
          onClick={handlePartClick}
        />
      ))}

      {/* Spin/Tilt overlay on selected part */}
      {selectedPartData && (
        <SpinTiltOverlay part={selectedPartData}
          spinActive={spinActive} tiltActive={tiltActive}
          onSpinDown={onSpinDown} onSpinUp={onSpinUp}
          onTiltDown={onTiltDown} onTiltUp={onTiltUp}
        />
      )}

      {/* Continuous rotation driver */}
      <RotationDriver spinActive={spinActive} tiltActive={tiltActive}
        selectedId={selectedId} onRotate={onPartRotate} />

      <AnnotationSpheres annotations={annotations} parts={parts} visible={showAnnotations} />

      <Grid infiniteGrid cellSize={0.5} sectionSize={2} cellColor="#1a0000" sectionColor="#330000" fadeDistance={50} position={[0, -0.01, 0]} />
      <OrbitControls ref={orbitRef} makeDefault enableDamping dampingFactor={0.05} minDistance={0.001} maxDistance={10000} zoomSpeed={3} rotateSpeed={0.8} panSpeed={1.5} />
      <AutoFit orbitRef={orbitRef} />
    </>
  );
}

/* ─── Loading Messages ─── */
const LOADING_MSGS = [
  'Connecting to geometry engine...',
  'Extracting real dimensions...',
  'Calculating joint compatibility...',
  'Analyzing stress zones...',
  'Computing screw specifications...',
  'Generating engineering report...',
  'Finalizing assessment...',
];

const COMMUNITY_PARTS = [
  { name: 'M8 Hex Bolt', rating: 4.5, downloads: 1240 },
  { name: 'Bearing Housing', rating: 4.8, downloads: 890 },
  { name: 'Motor Mount Bracket', rating: 4.2, downloads: 2100 },
  { name: 'Servo Horn 25T', rating: 4.6, downloads: 560 },
  { name: 'Carbon Rod End', rating: 4.3, downloads: 1780 },
  { name: 'Quadcopter Arm 250mm', rating: 4.7, downloads: 930 },
];

/* ─── Main Page ─── */
export default function AssemblyBuilderPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [parts, setParts] = useState<AssemblyPart[]>([]);
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  const [hoveredPart, setHoveredPart] = useState<string | null>(null);
  const [isolatedPart, setIsolatedPart] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('solid');
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [backendOffline, setBackendOffline] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showFineControl, setShowFineControl] = useState(false);
  const [spinActive, setSpinActive] = useState(false);
  const [tiltActive, setTiltActive] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const orbitRef = useRef<any>(null);
  const lastClickRef = useRef<{ id: string; time: number } | null>(null);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Escape') { setSelectedPart(null); setIsolatedPart(null); setShowFineControl(false); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Loading messages cycle
  useEffect(() => {
    if (!analyzing) return;
    let i = 0;
    setLoadingMsg(LOADING_MSGS[0]);
    setLoadingProgress(0);
    const interval = setInterval(() => {
      i = (i + 1) % LOADING_MSGS.length;
      setLoadingMsg(LOADING_MSGS[i]);
      setLoadingProgress(prev => Math.min(95, prev + 12));
    }, 2000);
    return () => clearInterval(interval);
  }, [analyzing]);

  const getFileExt = (name: string) => name.split('.').pop()?.toLowerCase() || '';

  const handleUpload = useCallback(async (file: File) => {
    const ext = getFileExt(file.name);
    if (!VIEWER_FORMATS.includes(ext)) {
      toast({ title: 'Please upload STL, OBJ, GLTF or GLB file', variant: 'destructive' });
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      toast({ title: 'File too large — maximum 50MB', variant: 'destructive' });
      return;
    }

    const id = crypto.randomUUID();
    const url = URL.createObjectURL(file);
    const colorIdx = parts.length;

    const newPart: AssemblyPart = {
      id, file, url, fileType: ext, name: file.name,
      color: PART_COLORS[colorIdx % PART_COLORS.length],
      visible: true,
      position: [parts.length * 3, 0, 0],
      rotation: [0, 0, 0],
      originalRotation: [0, 0, 0],
      scale: [1, 1, 1],
      geometrySource: 'estimated',
    };
    setParts(prev => [...prev, newPart]);
    setSelectedPart(id);

    const geo = await fetchPythonGeometry(file);
    if (geo) {
      setParts(prev => prev.map(p => p.id === id ? { ...p, geometry: geo, geometrySource: 'python' as const } : p));
    } else {
      setBackendOffline(true);
    }
  }, [parts.length, toast]);

  const handleSelect = useCallback((id: string) => {
    const now = Date.now();
    if (lastClickRef.current && lastClickRef.current.id === id && now - lastClickRef.current.time < 400) {
      // Double click → show fine control
      setShowFineControl(prev => !prev);
      lastClickRef.current = null;
      return;
    }
    lastClickRef.current = { id, time: now };
    setSelectedPart(id);
    setShowFineControl(false);
  }, []);

  const handleDeselect = useCallback(() => {
    setSelectedPart(null);
    setShowFineControl(false);
    setSpinActive(false);
    setTiltActive(false);
  }, []);

  const handlePartMove = useCallback((id: string, pos: [number, number, number]) => {
    setParts(prev => prev.map(p => p.id === id ? { ...p, position: pos } : p));
  }, []);

  const handlePartRotate = useCallback((id: string, deltas: [number, number, number]) => {
    setParts(prev => prev.map(p => {
      if (p.id !== id) return p;
      return {
        ...p,
        rotation: [p.rotation[0] + deltas[0], p.rotation[1] + deltas[1], p.rotation[2] + deltas[2]] as [number, number, number],
      };
    }));
  }, []);

  const removePart = (id: string) => {
    setParts(prev => {
      const part = prev.find(p => p.id === id);
      if (part) URL.revokeObjectURL(part.url);
      return prev.filter(p => p.id !== id);
    });
    if (selectedPart === id) { setSelectedPart(null); setShowFineControl(false); }
    if (isolatedPart === id) setIsolatedPart(null);
  };

  const toggleVisibility = (id: string) => {
    setParts(prev => prev.map(p => p.id === id ? { ...p, visible: !p.visible } : p));
  };

  // Fine control: move 1mm
  const fineMove = (axis: 0 | 1 | 2, delta: number) => {
    if (!selectedPart) return;
    setParts(prev => prev.map(p => {
      if (p.id !== selectedPart) return p;
      const pos = [...p.position] as [number, number, number];
      pos[axis] += delta;
      return { ...p, position: pos };
    }));
  };

  // Fine control: rotate 15°
  const fineRotate = (axis: 0 | 1 | 2, delta: number) => {
    if (!selectedPart) return;
    setParts(prev => prev.map(p => {
      if (p.id !== selectedPart) return p;
      const rot = [...p.rotation] as [number, number, number];
      rot[axis] += delta;
      return { ...p, rotation: rot };
    }));
  };

  // Smooth animated rotation over 400ms
  const animRotRef = useRef<number | null>(null);
  const animateRotationTo = useCallback((targetRot: [number, number, number]) => {
    if (!selectedPart) return;
    if (animRotRef.current) cancelAnimationFrame(animRotRef.current);
    const part = parts.find(p => p.id === selectedPart);
    if (!part) return;
    const startRot = [...part.rotation] as [number, number, number];
    const startTime = performance.now();
    const duration = 400;
    const animate = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration);
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const current: [number, number, number] = [
        startRot[0] + (targetRot[0] - startRot[0]) * ease,
        startRot[1] + (targetRot[1] - startRot[1]) * ease,
        startRot[2] + (targetRot[2] - startRot[2]) * ease,
      ];
      setParts(prev => prev.map(p => p.id === selectedPart ? { ...p, rotation: current } : p));
      if (t < 1) animRotRef.current = requestAnimationFrame(animate);
      else animRotRef.current = null;
    };
    animRotRef.current = requestAnimationFrame(animate);
  }, [selectedPart, parts]);

  const layFlat = () => {
    if (!selectedPart) return;
    const part = parts.find(p => p.id === selectedPart);
    if (!part) return;
    animateRotationTo([90, part.rotation[1], part.rotation[2]]);
  };
  const standUpright = () => {
    if (!selectedPart) return;
    const part = parts.find(p => p.id === selectedPart);
    if (!part) return;
    animateRotationTo([0, part.rotation[1], 0]);
  };
  const flip180 = () => {
    if (!selectedPart) return;
    const part = parts.find(p => p.id === selectedPart);
    if (!part) return;
    animateRotationTo([part.rotation[0] + 180, part.rotation[1], part.rotation[2]]);
  };
  const resetRotation = () => {
    if (!selectedPart) return;
    const part = parts.find(p => p.id === selectedPart);
    if (!part) return;
    animateRotationTo([...part.originalRotation]);
  };

  const getDims = (p: AssemblyPart) => p.geometry?.dimensions_mm || p.estimatedDims || { x: 0, y: 0, z: 0 };

  const clearScene = () => {
    parts.forEach(p => URL.revokeObjectURL(p.url));
    setParts([]);
    setSelectedPart(null);
    setIsolatedPart(null);
    setResult(null);
    setShowFineControl(false);
  };

  /* ─── Run Analysis ─── */
  const handleAnalyze = async () => {
    if (parts.length === 0) {
      toast({ title: 'Upload parts first', variant: 'destructive' });
      return;
    }
    setAnalyzing(true);
    setResult(null);

    try {
      const { data: projects } = await supabase
        .from('projects').select('*').eq('user_id', user!.id)
        .order('created_at', { ascending: false }).limit(1);
      const project = projects?.[0];

      const partDataStr = parts.map(p => {
        const dims = getDims(p);
        const geo = p.geometry;
        return `Part: ${p.name}
Real Dimensions: ${dims.x.toFixed(1)}mm x ${dims.y.toFixed(1)}mm x ${dims.z.toFixed(1)}mm
${geo ? `Real Volume: ${geo.volume_mm3.toFixed(1)}mm3
Real CoG: X:${geo.center_of_gravity.x.toFixed(2)} Y:${geo.center_of_gravity.y.toFixed(2)} Z:${geo.center_of_gravity.z.toFixed(2)}mm
Watertight: ${geo.is_watertight}
Vertices: ${geo.vertex_count} Faces: ${geo.face_count}` : `Estimated Volume: ${(dims.x * dims.y * dims.z).toFixed(1)}mm3`}
Scene Position: X:${p.position[0].toFixed(1)} Y:${p.position[1].toFixed(1)} Z:${p.position[2].toFixed(1)}
Scene Rotation: X:${p.rotation[0].toFixed(1)} Y:${p.rotation[1].toFixed(1)} Z:${p.rotation[2].toFixed(1)} degrees`;
      }).join('\n\n');

      const distances: string[] = [];
      for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) {
          const a = parts[i].position, b = parts[j].position;
          const dist = Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
          distances.push(`Distance ${parts[i].name} ↔ ${parts[j].name}: ${dist.toFixed(1)}mm`);
        }
      }

      const totalVolume = parts.reduce((sum, p) => {
        const v = p.geometry?.volume_mm3 || (() => { const d = getDims(p); return d.x * d.y * d.z; })();
        return sum + v;
      }, 0);

      const prompt = `You are Lumexa Engineering AI. User is building: ${project?.purpose || project?.project_name || 'engineering project'}. Budget: ${project?.budget_range || 'Not specified'}.

REAL GEOMETRIC DATA FROM PYTHON TRIMESH BACKEND:

${partDataStr}

ASSEMBLY CALCULATIONS:
Total parts: ${parts.length}
${distances.join('\n')}
Combined mass aluminum: ${(totalVolume * 0.0027).toFixed(1)}g

Provide complete assembly engineering analysis:

1. Overview — identify assembly type and overall assessment
2. Joint Analysis — analyze each connection using real dimensions
3. Screw Specifications — exact table with Joint Location, Bolt Size, Length mm, Thread Pitch, Torque Nm, Quantity based on real geometry
4. Modifications Required — specific changes with exact measurements in mm
5. Optimization Recommendations — engineering improvements
6. Next Steps — actionable items

Output JSON annotations array:
\`\`\`annotations-json
{
  "annotations": [
    {"id": 1, "severity": "CRITICAL", "zone": "zone_name", "position_hint": "far_end_top", "title": "Issue Title", "problem": "Detailed problem with real measurements from Python data", "solution": "Specific solution with exact mm values", "color": "#ff0000"}
  ]
}
\`\`\`

Reference actual part names and real dimensions throughout. Give specific measurements not generic advice.`;

      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          projectContext: project ? { name: project.project_name, category: project.category, purpose: project.purpose, budget: project.budget_range, complexity: project.complexity, description: project.description } : null,
          telemetryStats: null,
        }),
      });

      if (!resp.ok) {
        if (resp.status === 429) throw new Error('Rate limit exceeded. Please try again shortly.');
        if (resp.status === 402) throw new Error('AI credits exhausted.');
        throw new Error('Analysis failed.');
      }

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let fullText = '', textBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });
        let ni: number;
        while ((ni = textBuffer.indexOf('\n')) !== -1) {
          let line = textBuffer.slice(0, ni);
          textBuffer = textBuffer.slice(ni + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (!line.startsWith('data: ')) continue;
          const js = line.slice(6).trim();
          if (js === '[DONE]') break;
          try {
            const p = JSON.parse(js);
            const c = p.choices?.[0]?.delta?.content;
            if (c) fullText += c;
          } catch { textBuffer = line + '\n' + textBuffer; break; }
        }
      }

      let annotations: AssemblyAnnotation[] = [];
      try {
        const match = fullText.match(/```annotations-json\s*([\s\S]*?)```/);
        if (match) {
          const parsed = JSON.parse(match[1]);
          if (parsed.annotations) annotations = parsed.annotations;
        }
      } catch {}

      let score = 100;
      annotations.forEach(a => {
        if (a.severity === 'CRITICAL') score -= 25;
        else if (a.severity === 'HIGH') score -= 15;
        else if (a.severity === 'MEDIUM') score -= 8;
        else score -= 3;
      });
      score = Math.max(0, score);

      const cleanContent = fullText.replace(/```annotations-json[\s\S]*?```/g, '').trim();

      setResult({
        content: cleanContent,
        annotations: annotations.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)),
        score,
        metrics: {
          jointCompatibility: Math.min(100, score + 10),
          weightBalance: Math.min(100, score + 5),
          structuralRating: score,
          modificationDifficulty: score >= 80 ? 'Easy' : score >= 60 ? 'Medium' : 'Hard',
        },
      });
    } catch (err: any) {
      toast({ title: err.message || 'Analysis failed — please try again', variant: 'destructive' });
    } finally {
      setAnalyzing(false);
      setLoadingProgress(100);
    }
  };

  const selectedPartData = parts.find(p => p.id === selectedPart);

  const getScoreStyle = (s: number) => {
    if (s >= 90) return { bg: 'bg-[#001a00]', badge: 'GOOD', badgeColor: 'bg-green-600' };
    if (s >= 80) return { bg: 'bg-[#1a1400]', badge: 'MEDIUM', badgeColor: 'bg-yellow-600' };
    if (s >= 60) return { bg: 'bg-[#1a0800]', badge: 'HIGH', badgeColor: 'bg-orange-600' };
    return { bg: 'bg-[#1a0000]', badge: 'CRITICAL', badgeColor: 'bg-destructive' };
  };

  const viewButtons: { mode: ViewMode; icon: typeof Box; label: string }[] = [
    { mode: 'solid', icon: Box, label: 'Solid' },
    { mode: 'wireframe', icon: Grid3x3, label: 'Wire' },
    { mode: 'xray', icon: Eye, label: 'X-Ray' },
  ];

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col">
      {/* Top Bar */}
      <div className="h-12 border-b border-[#222] bg-[#111111] flex items-center px-4 gap-3 shrink-0">
        <div className="flex items-center gap-2">
          <Box className="w-4 h-4 text-primary" />
          <span className="text-sm font-bold text-foreground">Assembly Builder</span>
          {result && (
            <span className={`ml-2 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-foreground ${getScoreStyle(result.score).badgeColor}`}>
              {result.score}
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" className="gap-1.5 h-8" onClick={handleAnalyze} disabled={analyzing || parts.length === 0}>
            <Zap className="w-3.5 h-3.5" /> Analyze Assembly
          </Button>
          <Button size="sm" variant="secondary" className="gap-1.5 h-8 hover:text-destructive" onClick={clearScene}>
            <Trash2 className="w-3.5 h-3.5" /> Clear Scene
          </Button>
          <Button size="sm" variant="secondary" className="gap-1.5 h-8">
            <Save className="w-3.5 h-3.5" /> Save
          </Button>
        </div>
      </div>

      {/* Three Panel Layout */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* LEFT SIDEBAR — Parts Library */}
        {!isFullscreen && (
          <div className="w-full lg:w-[22%] border-r border-[#222] bg-[#111111] border-t-2 border-t-primary overflow-y-auto shrink-0 lg:max-h-full max-h-[180px]">
            <div className="p-3 space-y-3">
              <div className="flex items-center gap-2">
                <Box className="w-4 h-4 text-primary" />
                <span className="text-sm font-bold text-foreground">Parts Library</span>
              </div>

              <input ref={fileRef} type="file" accept=".stl,.obj,.gltf,.glb" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ''; }} />
              <Button className="w-full gap-2" onClick={() => fileRef.current?.click()}>
                <Upload className="w-4 h-4" /> Upload Part STL
              </Button>

              {/* Uploaded parts */}
              <div className="space-y-2">
                {parts.map(part => {
                  const dims = getDims(part);
                  const isActive = selectedPart === part.id;
                  const mass = part.geometry ? (part.geometry.volume_mm3 * 0.0027).toFixed(1) : null;
                  return (
                    <div key={part.id}
                      onClick={() => handleSelect(part.id)}
                      className={`bg-[#0a0a0a] rounded-lg p-2.5 border-l-4 cursor-pointer transition-all ${isActive ? 'ring-1 ring-primary' : 'hover:bg-[#151515]'}`}
                      style={{ borderLeftColor: part.color }}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: part.color }} />
                        <span className="text-xs font-medium text-foreground truncate flex-1">{part.name}</span>
                        <button onClick={e => { e.stopPropagation(); toggleVisibility(part.id); }} className="text-muted-foreground hover:text-foreground">
                          {part.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                        </button>
                        <button onClick={e => { e.stopPropagation(); removePart(part.id); }} className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                      <p className="text-[10px] text-primary font-mono">
                        {dims.x.toFixed(1)} × {dims.y.toFixed(1)} × {dims.z.toFixed(1)} mm
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" className={`text-[8px] h-4 px-1 ${part.geometrySource === 'python' ? 'border-green-600/40 text-green-400' : 'border-muted-foreground/30 text-muted-foreground'}`}>
                          {part.geometrySource === 'python' ? '✓ Verified' : part.geometry === undefined ? '⏳ Extracting...' : '⚠ Estimated'}
                        </Badge>
                        {mass && <span className="text-[9px] text-muted-foreground">{mass}g (Al)</span>}
                      </div>
                      <div className="flex gap-1 mt-1.5">
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            setSelectedPart(part.id);
                            if (orbitRef.current) {
                              orbitRef.current.target.set(...part.position);
                              orbitRef.current.update();
                            }
                          }}
                          className="text-[9px] text-muted-foreground hover:text-primary flex items-center gap-0.5"
                        >
                          <Crosshair className="w-2.5 h-2.5" /> Focus
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Community Parts */}
              <div className="border-t border-[#222] pt-2">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Community Parts</span>
              </div>
              <div className="space-y-1.5">
                {COMMUNITY_PARTS.map((cp, i) => (
                  <div key={i} className="bg-[#0a0a0a] rounded p-2 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-foreground truncate">{cp.name}</p>
                      <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
                        <span className="flex items-center gap-0.5"><Star className="w-2.5 h-2.5 text-yellow-500" />{cp.rating}</span>
                        <span className="flex items-center gap-0.5"><Download className="w-2.5 h-2.5" />{cp.downloads}</span>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 border-primary/30 text-primary hover:bg-primary/10"
                      onClick={() => toast({ title: 'Community library coming soon' })}>
                      Add
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* CENTER — 3D Viewport */}
        <div className={`relative bg-[#0a0a0a] min-h-[50vh] lg:min-h-0 ${isFullscreen ? 'flex-1' : 'flex-1 lg:w-[50%]'}`}>
          {backendOffline && (
            <div className="absolute top-12 left-1/2 -translate-x-1/2 z-20 text-[11px] text-muted-foreground bg-[#111]/80 backdrop-blur-sm rounded px-3 py-1 border border-[#222]">
              Geometry API offline — using estimates
            </div>
          )}

          {/* View mode buttons top-left */}
          <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5">
            {viewButtons.map(({ mode, icon: Icon, label }) => (
              <Button key={mode} size="sm" variant={viewMode === mode ? 'default' : 'secondary'} className="h-7 px-2 text-xs gap-1" onClick={() => setViewMode(mode)}>
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{label}</span>
              </Button>
            ))}
          </div>

          {/* Top-right controls */}
          <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
            {result && result.annotations.length > 0 && (
              <Button size="sm" variant={showAnnotations ? 'default' : 'secondary'} className="h-7 px-2 text-xs gap-1" onClick={() => setShowAnnotations(!showAnnotations)}>
                <AlertTriangle className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Issues</span>
              </Button>
            )}
            <Button size="sm" variant="secondary" className="h-7 w-7 p-0" onClick={() => setIsFullscreen(!isFullscreen)} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
              {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
            </Button>
            <Button size="sm" variant="secondary" className="h-7 w-7 p-0" onClick={() => {
              if (orbitRef.current) { orbitRef.current.reset(); }
            }} title="Reset camera">
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>

          {/* Parts counter bottom-left */}
          <div className="absolute bottom-3 left-3 z-10 text-[11px] text-muted-foreground">
            Parts in scene: {parts.filter(p => p.visible).length}
          </div>

          {/* Fine Control Popup — shown on double-tap */}
          {showFineControl && selectedPartData && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 bg-[#111]/95 backdrop-blur-md border border-[#333] rounded-xl p-3 space-y-3 min-w-[260px]">
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-primary font-bold truncate">{selectedPartData.name}</p>
                <button onClick={() => setShowFineControl(false)} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
              </div>

              {/* Position fine control */}
              <div className="space-y-1.5">
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Position (±1mm)</p>
                <div className="grid grid-cols-3 gap-1">
                  {(['X', 'Y', 'Z'] as const).map((axis, i) => (
                    <div key={axis} className="flex items-center gap-0.5">
                      <span className="text-[9px] text-muted-foreground w-3">{axis}</span>
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => fineMove(i as 0|1|2, -1)}>
                        <Minus className="w-3 h-3" />
                      </Button>
                      <span className="text-[9px] text-foreground font-mono w-8 text-center">{selectedPartData.position[i].toFixed(0)}</span>
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => fineMove(i as 0|1|2, 1)}>
                        <Plus className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Rotation fine control */}
              <div className="space-y-1.5">
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Rotation (±15°)</p>
                <div className="grid grid-cols-3 gap-1">
                  {(['X', 'Y', 'Z'] as const).map((axis, i) => (
                    <div key={axis} className="flex items-center gap-0.5">
                      <span className="text-[9px] text-muted-foreground w-3">{axis}</span>
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => fineRotate(i as 0|1|2, -15)}>
                        <Minus className="w-3 h-3" />
                      </Button>
                      <span className="text-[9px] text-foreground font-mono w-8 text-center">{selectedPartData.rotation[i].toFixed(0)}°</span>
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => fineRotate(i as 0|1|2, 15)}>
                        <Plus className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Quick Orientation */}
              <div className="border-t border-[#333] pt-2">
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1.5">Quick Orientation</p>
                <div className="grid grid-cols-4 gap-1">
                  <Button size="sm" variant="secondary" className="h-7 text-[8px] px-1 gap-0.5 flex-col leading-none py-0.5" onClick={layFlat}>
                    <ArrowDownToLine className="w-3 h-3 text-primary" />
                    Lay Flat
                  </Button>
                  <Button size="sm" variant="secondary" className="h-7 text-[8px] px-1 gap-0.5 flex-col leading-none py-0.5" onClick={standUpright}>
                    <ArrowUpFromLine className="w-3 h-3 text-primary" />
                    Upright
                  </Button>
                  <Button size="sm" variant="secondary" className="h-7 text-[8px] px-1 gap-0.5 flex-col leading-none py-0.5" onClick={flip180}>
                    <FlipVertical className="w-3 h-3 text-primary" />
                    Flip 180
                  </Button>
                  <Button size="sm" variant="secondary" className="h-7 text-[8px] px-1 gap-0.5 flex-col leading-none py-0.5" onClick={resetRotation}>
                    <Undo2 className="w-3 h-3 text-primary" />
                    Reset
                  </Button>
                </div>
              </div>

              <p className="text-[8px] text-muted-foreground/50 text-center">Double-tap part to toggle this panel</p>
            </div>
          )}

          {/* Canvas */}
          {parts.length > 0 ? (
            <Canvas shadows camera={{ position: [4, 3, 4], fov: 45, near: 0.001, far: 20000 }}
              gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, alpha: true }} className="!h-full"
              style={{ touchAction: 'none' }}
            >
              <color attach="background" args={['#0a0a0a']} />
              <AssemblyScene
                parts={parts} viewMode={viewMode} selectedId={selectedPart}
                isolatedId={isolatedPart} hoveredId={hoveredPart}
                orbitRef={orbitRef}
                spinActive={spinActive} tiltActive={tiltActive}
                annotations={result?.annotations || []} showAnnotations={showAnnotations}
                onSelect={handleSelect}
                onHover={setHoveredPart}
                onUnhover={() => setHoveredPart(null)}
                onPartMove={handlePartMove}
                onPartRotate={handlePartRotate}
                onDeselect={handleDeselect}
                onSpinDown={() => setSpinActive(true)}
                onSpinUp={() => setSpinActive(false)}
                onTiltDown={() => setTiltActive(true)}
                onTiltUp={() => setTiltActive(false)}
              />
            </Canvas>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
              <Box className="w-12 h-12 opacity-30 text-primary" />
              <p className="text-sm text-foreground">Upload parts to begin assembly</p>
              <p className="text-xs opacity-50">Supports STL, OBJ, GLTF, GLB</p>
            </div>
          )}
        </div>

        {/* RIGHT PANEL — Analysis Results */}
        {!isFullscreen && (
          <div className="w-full lg:w-[28%] border-l border-[#222] bg-[#111111] border-t-2 border-t-primary overflow-y-auto shrink-0">
            <div className="p-3 space-y-3">
              {analyzing ? (
                <div className="flex flex-col items-center justify-center py-16 gap-4">
                  <div className="relative w-16 h-16">
                    <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
                    <div className="absolute inset-0 rounded-full border-2 border-t-primary animate-spin" />
                    <div className="absolute inset-2 rounded-full border-2 border-primary/10" />
                    <div className="absolute inset-2 rounded-full border-2 border-t-primary/60 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
                  </div>
                  <p className="text-sm text-foreground animate-pulse">{loadingMsg}</p>
                  <div className="w-full bg-[#222] rounded-full h-1.5">
                    <div className="bg-primary h-1.5 rounded-full transition-all duration-500" style={{ width: `${loadingProgress}%` }} />
                  </div>
                </div>
              ) : result ? (
                <>
                  {/* Score */}
                  <div className={`rounded-lg p-4 ${getScoreStyle(result.score).bg} border border-[#222]`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-3xl font-bold text-primary font-display">{result.score}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Assembly Score</p>
                      </div>
                      <Badge className={`${getScoreStyle(result.score).badgeColor} text-foreground`}>
                        {getScoreStyle(result.score).badge}
                      </Badge>
                    </div>
                  </div>

                  {/* Metrics Grid */}
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { icon: Link2, value: `${result.metrics.jointCompatibility}%`, label: 'Joint Compat.' },
                      { icon: Scale, value: `${result.metrics.weightBalance}`, label: 'Weight Balance' },
                      { icon: Shield, value: `${result.metrics.structuralRating}`, label: 'Structural' },
                      { icon: Wrench, value: result.metrics.modificationDifficulty, label: 'Mod. Difficulty' },
                    ].map(({ icon: Icon, value, label }, i) => (
                      <div key={i} className="bg-[#0a0a0a] rounded-lg p-2.5 border border-primary/20">
                        <Icon className="w-3.5 h-3.5 text-primary mb-1" />
                        <p className="text-xs font-bold text-foreground">{value}</p>
                        <p className="text-[9px] text-muted-foreground">{label}</p>
                      </div>
                    ))}
                  </div>

                  {/* AI Report */}
                  <Card className="bg-[#0a0a0a] border-[#222]">
                    <CardContent className="pt-4 prose prose-sm prose-invert max-w-none text-xs
                      prose-headings:text-primary prose-headings:font-bold prose-headings:text-sm
                      prose-strong:text-foreground prose-table:text-[11px]
                      prose-th:bg-primary/20 prose-th:text-primary prose-th:p-2 prose-th:text-left
                      prose-td:p-2 prose-td:border-t prose-td:border-[#222]">
                      <ReactMarkdown>{result.content}</ReactMarkdown>
                    </CardContent>
                  </Card>

                  {/* Annotation Cards */}
                  {result.annotations.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" /> Critical Issues Found
                      </h4>
                      {result.annotations.map(a => {
                        const severityBg = a.severity === 'CRITICAL' ? 'bg-destructive/20' : a.severity === 'HIGH' ? 'bg-orange-500/20' : a.severity === 'MEDIUM' ? 'bg-yellow-500/20' : 'bg-muted/20';
                        return (
                          <div key={a.id} className="bg-[#0a0a0a] rounded-lg p-3 border-l-4" style={{ borderLeftColor: a.color }}>
                            <div className="flex items-center gap-2 mb-2">
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded text-foreground ${severityBg}`}>
                                {a.severity}
                              </span>
                              <span className="text-xs font-bold text-foreground">{a.title}</span>
                            </div>
                            <div className="space-y-1.5">
                              <div>
                                <span className="text-[9px] text-muted-foreground uppercase">Problem:</span>
                                <p className="text-[11px] text-foreground/80">{a.problem}</p>
                              </div>
                              <div>
                                <span className="text-[9px] text-primary uppercase">Solution:</span>
                                <p className="text-[11px] text-foreground">{a.solution}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                  <Box className="w-10 h-10 text-primary opacity-40" />
                  <p className="text-sm text-foreground">Run Analysis to get engineering report</p>
                  <p className="text-xs text-muted-foreground">Upload your parts, position them, then click Analyze Assembly</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
