import { useEffect, useMemo } from 'react';
import type { MutableRefObject } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Edges, Html } from '@react-three/drei';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { base64ToArrayBuffer } from '@/lib/assemblyApi';
import type { AssemblyPart, AssemblyResult, Hardware } from '@/lib/assemblyApi';

export interface SceneOptions {
  xray: boolean;
  xrayOpacity: number;
  explode: number; // 0..1
  showCavities: boolean;
  showComponents: boolean;
  showHardware: boolean;
  section: { enabled: boolean; axis: 'x' | 'y' | 'z'; offset: number };
  hidden: Set<string>;
  selected: string | null;
}

const PART_COLORS = ['#7aa2f7', '#9ece6a', '#e0af68', '#bb9af7', '#7dcfff', '#f7768e', '#73daca', '#ff9e64'];
const CAVITY_COLORS: Record<string, string> = { enclosed: '#c084fc', pocket: '#4ade80', channel: '#fb923c', trough: '#2dd4bf' };
const COMPONENT_COLORS = ['#facc15', '#f472b6', '#38bdf8', '#a3e635', '#fb7185', '#34d399'];

// The backend works in CAD coordinates (Z up). three.js is Y up, so everything is drawn inside one group rotated -90 deg about X:
// CAD (x, y, z) -> three (x, z, -y).
const toThree = (v: number[]) => new THREE.Vector3(v[0], v[2], -v[1]);
const dirToThree = (v: number[]) => new THREE.Vector3(v[0], v[2], -v[1]).normalize();

/** Clipping plane in three.js world space that keeps CAD coordinate <= offset along the chosen axis. */
function sectionPlane(axis: 'x' | 'y' | 'z', offset: number): THREE.Plane {
  const n = axis === 'x' ? [-1, 0, 0] : axis === 'y' ? [0, -1, 0] : [0, 0, -1];
  return new THREE.Plane(new THREE.Vector3(n[0], n[2], -n[1]), offset);
}

interface PartProps {
  part: AssemblyPart;
  color: string;
  opts: SceneOptions;
  result: AssemblyResult;
  planes: THREE.Plane[];
  distance: number;
  onSelect: (id: string) => void;
}

function PartMesh({ part, color, opts, result, planes, distance, onSelect }: PartProps) {
  const geometry = useMemo(() => {
    if (!part.stl_base64) return null;
    const g = new STLLoader().parse(base64ToArrayBuffer(part.stl_base64));
    g.computeVertexNormals();
    return g;
  }, [part.stl_base64]);
  const edges = useMemo(() => (geometry ? new THREE.EdgesGeometry(geometry, 28) : null), [geometry]);
  const matrix = useMemo(() => new THREE.Matrix4().fromArray(part.matrix).transpose(), [part.matrix]);
  // explode along the mate normal, expressed in CAD space (the parent group rotates it into three.js space)
  const offset: [number, number, number] = [
    part.explode_dir[0] * opts.explode * distance,
    part.explode_dir[1] * opts.explode * distance,
    part.explode_dir[2] * opts.explode * distance,
  ];
  const selected = opts.selected === part.id;
  const cavities = part.internal_space?.cavities ?? [];
  const placements = result.packing?.[part.id]?.packing?.placements ?? [];
  if (!geometry) return null;
  return (
    <group position={part.is_ground ? [0, 0, 0] : offset}>
      <group matrixAutoUpdate={false} matrix={matrix}>
        <mesh geometry={geometry} onClick={(e) => { e.stopPropagation(); onSelect(part.id); }}>
          {opts.xray ? (
            <meshBasicMaterial color={selected ? '#ffffff' : color} transparent opacity={selected ? Math.min(0.5, opts.xrayOpacity * 2) : opts.xrayOpacity}
              depthWrite={false} side={THREE.DoubleSide} clippingPlanes={planes} />
          ) : (
            <meshStandardMaterial color={color} metalness={0.25} roughness={0.55} emissive={selected ? '#334155' : '#000000'}
              clippingPlanes={planes} side={THREE.DoubleSide} />
          )}
        </mesh>
        {opts.xray && edges && (
          <lineSegments geometry={edges}>
            <lineBasicMaterial color={selected ? '#ffffff' : color} transparent opacity={0.85} clippingPlanes={planes} />
          </lineSegments>
        )}
        {opts.showCavities &&
          cavities.filter((c) => c.role !== 'hole' || selected).map((c) => {
            const size = c.inscribed.size;
            const centre = c.inscribed.min.map((m, i) => m + size[i] / 2);
            return (
              <mesh key={c.id} position={[centre[0], centre[1], centre[2]]}>
                <boxGeometry args={[size[0], size[1], size[2]]} />
                <meshBasicMaterial color={CAVITY_COLORS[c.kind] ?? '#c084fc'} transparent opacity={0.2} depthWrite={false} clippingPlanes={planes} />
                <Edges color={CAVITY_COLORS[c.kind] ?? '#c084fc'} />
              </mesh>
            );
          })}
        {opts.showComponents &&
          placements.map((p, i) => (
            <mesh key={`${p.name}-${p.index}-${i}`} position={[p.min[0] + p.size[0] / 2, p.min[1] + p.size[1] / 2, p.min[2] + p.size[2] / 2]}>
              <boxGeometry args={[p.size[0], p.size[1], p.size[2]]} />
              <meshStandardMaterial color={COMPONENT_COLORS[i % COMPONENT_COLORS.length]} metalness={0.1} roughness={0.5} clippingPlanes={planes} />
              <Edges color="#111827" />
              {selected && (
                <Html center distanceFactor={90} style={{ pointerEvents: 'none' }}>
                  <div className="text-[10px] px-1 rounded bg-black/70 text-white whitespace-nowrap">{p.name}{p.index > 1 ? ` #${p.index}` : ''}</div>
                </Html>
              )}
            </mesh>
          ))}
      </group>
    </group>
  );
}

function Bolt({ hw, opts, planes }: { hw: Hardware; opts: SceneOptions; planes: THREE.Plane[] }) {
  const axis = useMemo(() => dirToThree(hw.axis), [hw.axis]);
  const quat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis), [axis]);
  const origin = useMemo(() => toThree(hw.origin), [hw.origin]);
  const pulled = origin.clone().addScaledVector(axis, -opts.explode * (hw.length_mm + 10));
  const along = (p: number[]) => toThree(p).sub(origin).dot(axis);
  const mat = <meshStandardMaterial color="#9ca3af" metalness={0.8} roughness={0.35} clippingPlanes={planes} />;
  return (
    <group position={pulled} quaternion={quat}>
      <mesh position={[0, hw.length_mm / 2, 0]}>
        <cylinderGeometry args={[hw.shank_d / 2, hw.shank_d / 2, hw.length_mm, 24]} />
        {mat}
      </mesh>
      <mesh position={[0, -hw.head_h / 2, 0]}>
        <cylinderGeometry args={[hw.head_d / 2, hw.head_d / 2, hw.head_h, 24]} />
        {mat}
      </mesh>
      {hw.nut && (
        <mesh position={[0, along(hw.nut.origin) + hw.nut.h / 2, 0]}>
          <cylinderGeometry args={[hw.nut.af / Math.sqrt(3), hw.nut.af / Math.sqrt(3), hw.nut.h, 6]} />
          <meshStandardMaterial color="#6b7280" metalness={0.8} roughness={0.4} clippingPlanes={planes} />
        </mesh>
      )}
    </group>
  );
}

export type CaptureView = 'iso' | 'top' | 'side' | 'front';
export type CaptureFn = (views: CaptureView[]) => { view: CaptureView; image: string }[];

/** Hands the page a function that renders the current scene from fixed camera angles and returns JPEG data URLs (for the vision check). */
function Capturer({ captureRef, centre, size }: { captureRef: MutableRefObject<CaptureFn | null>; centre: THREE.Vector3; size: number }) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    captureRef.current = (views) => {
      const cam = camera as THREE.PerspectiveCamera;
      const saved = { pos: cam.position.clone(), quat: cam.quaternion.clone(), aspect: cam.aspect };
      const savedSize = gl.getSize(new THREE.Vector2());
      const savedRatio = gl.getPixelRatio();
      const out: { view: CaptureView; image: string }[] = [];
      const W = 960, H = 640;
      gl.setPixelRatio(1);
      gl.setSize(W, H, false);
      cam.aspect = W / H;
      const d = size * 2.1;
      const at: Record<CaptureView, THREE.Vector3> = {
        iso: new THREE.Vector3(centre.x + size * 1.3, centre.y + size * 1.1, centre.z + size * 1.6),
        top: new THREE.Vector3(centre.x, centre.y + d, centre.z + 0.001),
        side: new THREE.Vector3(centre.x + d, centre.y, centre.z),
        front: new THREE.Vector3(centre.x, centre.y, centre.z + d),
      };
      try {
        for (const v of views) {
          cam.position.copy(at[v]);
          cam.lookAt(centre);
          cam.updateProjectionMatrix();
          cam.updateMatrixWorld();
          gl.render(scene, cam);                       // toDataURL straight after render, so no preserveDrawingBuffer is needed
          out.push({ view: v, image: gl.domElement.toDataURL('image/jpeg', 0.85) });
        }
      } finally {
        cam.position.copy(saved.pos);
        cam.quaternion.copy(saved.quat);
        cam.aspect = saved.aspect;
        cam.updateProjectionMatrix();
        gl.setPixelRatio(savedRatio);
        gl.setSize(savedSize.x, savedSize.y, false);
        gl.render(scene, cam);
      }
      return out;
    };
    return () => { captureRef.current = null; };
  }, [captureRef, gl, scene, camera, centre, size]);
  return null;
}

export interface BalanceMarkers {
  show: boolean;
  /** centre of gravity, assembly mm */
  cog?: number[] | null;
  /** planned lift motors (assembly mm) and the prop diameter drawn around each */
  motors?: { x: number; y: number; spin: number }[];
  propDiameter?: number;
}

/** Centre of gravity (magenta ball with cross hairs) and the planned lift motors (prop discs, one colour per spin direction).
 *  Drawn inside the CAD-oriented group, so coordinates are assembly mm. */
function Markers({ m, size }: { m: BalanceMarkers; size: number }) {
  if (!m.show) return null;
  const r = Math.max(size * 0.016, 2);
  const cog = m.cog && m.cog.length === 3 ? m.cog : null;
  const arm = size * 0.25;
  return (
    <group>
      {cog && (
        <group position={[cog[0], cog[1], cog[2]]} renderOrder={999}>
          <mesh><sphereGeometry args={[r, 20, 14]} /><meshBasicMaterial color="#e11d8f" depthTest={false} transparent opacity={0.95} /></mesh>
          {[[arm, r / 4, r / 4], [r / 4, arm, r / 4], [r / 4, r / 4, arm]].map((a, i) => (
            <mesh key={i}><boxGeometry args={a as [number, number, number]} /><meshBasicMaterial color="#e11d8f" depthTest={false} transparent opacity={0.7} /></mesh>
          ))}
        </group>
      )}
      {(m.motors ?? []).map((mo, i) => (
        <group key={i} position={[mo.x, mo.y, cog ? cog[2] : 0]} renderOrder={998}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[(m.propDiameter ?? 250) / 2, (m.propDiameter ?? 250) / 2, 1.5, 40]} />
            <meshBasicMaterial color={mo.spin > 0 ? '#22d3ee' : '#f59e0b'} transparent opacity={0.22} depthTest={false} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[r * 0.8, r * 0.8, 6, 16]} /><meshBasicMaterial color={mo.spin > 0 ? '#22d3ee' : '#f59e0b'} depthTest={false} /></mesh>
        </group>
      ))}
    </group>
  );
}

interface SceneProps {
  result: AssemblyResult;
  markers?: BalanceMarkers;
  opts: SceneOptions;
  onSelect: (id: string | null) => void;
  captureRef?: MutableRefObject<CaptureFn | null>;
}

export default function AssemblyScene({ result, opts, onSelect, captureRef, markers }: SceneProps) {
  const bb = result.assembly_bbox;
  const centre = useMemo(() => toThree(bb.min.map((m, i) => (m + bb.max[i]) / 2)), [bb]);
  const size = Math.max(...bb.max.map((m, i) => m - bb.min[i]), 10);
  const planes = useMemo(() => (opts.section.enabled ? [sectionPlane(opts.section.axis, opts.section.offset)] : []), [opts.section]);
  const colorOf = (id: string) => PART_COLORS[result.parts.findIndex((p) => p.id === id) % PART_COLORS.length];
  return (
    <Canvas
      camera={{ position: [centre.x + size * 1.3, centre.y + size * 1.1, centre.z + size * 1.6], fov: 40, near: 0.1, far: size * 40 }}
      onCreated={({ gl }) => { gl.localClippingEnabled = true; }}
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={['#0b1020']} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[size, size * 2, size]} intensity={1.1} />
      <directionalLight position={[-size, size, -size]} intensity={0.4} />
      <gridHelper args={[size * 3, 30, '#334155', '#1e293b']} position={[centre.x, toThree(bb.min).y - 0.05, centre.z]} />
      <group rotation={[-Math.PI / 2, 0, 0]}>
        {result.parts.filter((p) => !opts.hidden.has(p.id)).map((p) => (
          <PartMesh key={p.id} part={p} color={colorOf(p.id)} opts={opts} result={result} planes={planes}
            distance={size * 0.9} onSelect={(id) => onSelect(id)} />
        ))}
        {markers && <Markers m={markers} size={size} />}
      </group>
      {opts.showHardware && (
        <group>
          {result.hardware.map((h) => <Bolt key={h.id} hw={h} opts={{ ...opts, explode: opts.explode * 1.0 }} planes={planes} />)}
        </group>
      )}
      <OrbitControls target={[centre.x, centre.y, centre.z]} makeDefault />
      {captureRef && <Capturer captureRef={captureRef} centre={centre} size={size} />}
    </Canvas>
  );
}
