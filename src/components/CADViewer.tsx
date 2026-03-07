import { useRef, useState, useCallback, Suspense, useEffect, useMemo } from 'react';
import { Canvas, useThree, useLoader, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Center, Html, Billboard } from '@react-three/drei';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';
import {
  Maximize, RotateCcw, Box, Grid3x3, Eye, Loader2, MapPin, Thermometer, Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';

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

export interface GeometryZone {
  id: string;
  type: 'stress_concentration' | 'thin_wall' | 'excess_material' | 'thermal_risk' | 'balance_concern';
  label: string;
  color: string;
  position: { x: number; y: number; z: number };
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  explanation: string;
  suggestion: string;
  affectedTriangles: number;
}

export interface STLData {
  filename: string;
  triangleCount: number;
  vertexCount: number;
  boundingBox: { width: number; height: number; depth: number; volume: number };
  surfaceArea: number;
  centerOfMass: { x: number; y: number; z: number };
  aspectRatio: number;
  thinSectionPercent: number;
  highDensityZones: number;
  hasHoles: boolean;
  symmetrical: boolean;
  estimatedWallThickness: number;
  geometryZones: GeometryZone[];
}

export interface HeatSensor {
  name: string;
  temperature: number;
  position: THREE.Vector3;
  mapped: boolean;
}

interface CADViewerProps {
  fileUrl: string | null;
  fileType: string | null;
  loading?: boolean;
  className?: string;
  annotations?: Annotation[];
  selectedAnnotation?: number | null;
  onSelectAnnotation?: (id: number | null) => void;
  onSTLParsed?: (data: STLData) => void;
  heatSensors?: HeatSensor[];
  heatMode?: boolean;
  heatOpacity?: number;
  geometryZones?: GeometryZone[];
  showZones?: boolean;
  selectedZone?: string | null;
  onSelectZone?: (id: string | null) => void;
}

/* ─── Zone type config ─── */
const ZONE_CONFIG: Record<GeometryZone['type'], { color: string; label: string }> = {
  stress_concentration: { color: '#ff0000', label: 'Stress Concentration' },
  thin_wall: { color: '#ff6600', label: 'Thin Wall' },
  excess_material: { color: '#4488ff', label: 'Excess Material' },
  thermal_risk: { color: '#ffaa00', label: 'Thermal Risk' },
  balance_concern: { color: '#aa44ff', label: 'Balance Concern' },
};

/* ─── Geometry Zone Detection ─── */
function detectGeometryZones(geometry: THREE.BufferGeometry, filename: string): GeometryZone[] {
  const zones: GeometryZone[] = [];
  geometry.computeBoundingBox();
  geometry.computeVertexNormals();
  const bbox = geometry.boundingBox!;
  const positions = geometry.attributes.position;
  const normals = geometry.attributes.normal;
  const vertexCount = positions.count;
  const triangleCount = geometry.index ? geometry.index.count / 3 : vertexCount / 3;

  const size = bbox.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const center = bbox.getCenter(new THREE.Vector3());
  let zoneCounter = 0;

  // Precompute per-triangle data
  const triData: { centroid: THREE.Vector3; area: number; normalAngle: number; normal: THREE.Vector3 }[] = [];
  const sampleLimit = Math.min(triangleCount, 80000);

  for (let i = 0; i < sampleLimit; i++) {
    const idx = triangleCount > sampleLimit ? Math.floor((i / sampleLimit) * triangleCount) : i;
    const i0 = geometry.index ? geometry.index.getX(idx * 3) : idx * 3;
    const i1 = geometry.index ? geometry.index.getX(idx * 3 + 1) : idx * 3 + 1;
    const i2 = geometry.index ? geometry.index.getX(idx * 3 + 2) : idx * 3 + 2;
    const a = new THREE.Vector3().fromBufferAttribute(positions, i0);
    const b = new THREE.Vector3().fromBufferAttribute(positions, i1);
    const c = new THREE.Vector3().fromBufferAttribute(positions, i2);
    const ab = new THREE.Vector3().subVectors(b, a);
    const ac = new THREE.Vector3().subVectors(c, a);
    const cross = new THREE.Vector3().crossVectors(ab, ac);
    const area = cross.length() * 0.5;
    const n = cross.normalize();
    const centroid = new THREE.Vector3().addVectors(a, b).add(c).divideScalar(3);

    // Compute normal deviation from neighbors (approximate sharpness)
    const n0 = new THREE.Vector3().fromBufferAttribute(normals, i0);
    const n1 = new THREE.Vector3().fromBufferAttribute(normals, i1);
    const n2 = new THREE.Vector3().fromBufferAttribute(normals, i2);
    const avgNormal = new THREE.Vector3().addVectors(n0, n1).add(n2).normalize();
    const normalAngle = Math.acos(Math.min(1, Math.abs(avgNormal.dot(n))));

    triData.push({ centroid, area, normalAngle, normal: n });
  }

  if (triData.length === 0) return zones;

  const avgArea = triData.reduce((s, t) => s + t.area, 0) / triData.length;

  // ─── 1. STRESS CONCENTRATION: sharp normal changes ───
  const sharpTriangles = triData.filter(t => t.normalAngle > 0.4); // ~23 degrees
  if (sharpTriangles.length > 0) {
    // Cluster sharp triangles into groups by proximity
    const clusters = clusterPoints(sharpTriangles.map(t => t.centroid), maxDim * 0.15);
    for (const cluster of clusters.slice(0, 3)) {
      zoneCounter++;
      const severity = cluster.count > sharpTriangles.length * 0.3 ? 'CRITICAL' : cluster.count > sharpTriangles.length * 0.1 ? 'HIGH' : 'MEDIUM';
      zones.push({
        id: `zone_${zoneCounter}`,
        type: 'stress_concentration',
        label: `Stress Concentration Zone ${zoneCounter}`,
        color: ZONE_CONFIG.stress_concentration.color,
        position: { x: cluster.center.x, y: cluster.center.y, z: cluster.center.z },
        severity,
        explanation: `Sharp geometry transition detected with ${cluster.count} abrupt normal changes. This area may experience high stress concentration under load, risking crack initiation.`,
        suggestion: 'Add fillet radius (≥1mm) or smooth the geometry transition to distribute stress more evenly. Consider chamfering sharp edges.',
        affectedTriangles: cluster.count,
      });
    }
  }

  // ─── 2. THIN WALL: very small triangle areas ───
  const thinThreshold = avgArea * 0.15;
  const thinTriangles = triData.filter(t => t.area < thinThreshold && t.area > 0);
  if (thinTriangles.length > triData.length * 0.05) {
    const clusters = clusterPoints(thinTriangles.map(t => t.centroid), maxDim * 0.2);
    for (const cluster of clusters.slice(0, 2)) {
      zoneCounter++;
      const pct = ((cluster.count / triData.length) * 100).toFixed(1);
      zones.push({
        id: `zone_${zoneCounter}`,
        type: 'thin_wall',
        label: `Thin Structure Zone ${zoneCounter}`,
        color: ZONE_CONFIG.thin_wall.color,
        position: { x: cluster.center.x, y: cluster.center.y, z: cluster.center.z },
        severity: parseFloat(pct) > 20 ? 'HIGH' : 'MEDIUM',
        explanation: `${pct}% of faces in this region have very small surface area, indicating potentially thin walls. Risk of structural weakness, deformation under load, and manufacturing difficulty.`,
        suggestion: 'Increase wall thickness to minimum 2.0–2.5mm. Verify with FEA simulation under expected load conditions.',
        affectedTriangles: cluster.count,
      });
    }
  }

  // ─── 3. EXCESS MATERIAL: high-density bulky regions ───
  const gridSize = maxDim / 8;
  const densityGrid: Record<string, { count: number; center: THREE.Vector3 }> = {};
  for (const t of triData) {
    const gx = Math.floor(t.centroid.x / gridSize);
    const gy = Math.floor(t.centroid.y / gridSize);
    const gz = Math.floor(t.centroid.z / gridSize);
    const key = `${gx},${gy},${gz}`;
    if (!densityGrid[key]) {
      densityGrid[key] = { count: 0, center: new THREE.Vector3(
        (gx + 0.5) * gridSize, (gy + 0.5) * gridSize, (gz + 0.5) * gridSize
      )};
    }
    densityGrid[key].count++;
  }
  const densities = Object.values(densityGrid);
  const avgDensity = densities.reduce((s, d) => s + d.count, 0) / densities.length;
  const bulkyRegions = densities.filter(d => d.count > avgDensity * 3).sort((a, b) => b.count - a.count);
  for (const region of bulkyRegions.slice(0, 2)) {
    zoneCounter++;
    zones.push({
      id: `zone_${zoneCounter}`,
      type: 'excess_material',
      label: `Material Optimization Zone ${zoneCounter}`,
      color: ZONE_CONFIG.excess_material.color,
      position: { x: region.center.x, y: region.center.y, z: region.center.z },
      severity: 'LOW',
      explanation: `High triangle density region (${region.count} triangles) suggests bulky geometry. This may indicate excess material increasing weight without structural benefit.`,
      suggestion: 'Evaluate for material removal via topology optimization. Add lightening holes or reduce wall thickness where stress permits.',
      affectedTriangles: region.count,
    });
  }

  // ─── 4. THERMAL RISK: enclosed geometry pockets ───
  // Detect regions with inward-facing normals clustered together (concavity / pockets)
  const concaveTriangles = triData.filter(t => {
    const toCenter = new THREE.Vector3().subVectors(center, t.centroid).normalize();
    return t.normal.dot(toCenter) > 0.5; // normal pointing inward
  });
  if (concaveTriangles.length > triData.length * 0.08) {
    const clusters = clusterPoints(concaveTriangles.map(t => t.centroid), maxDim * 0.2);
    for (const cluster of clusters.slice(0, 2)) {
      zoneCounter++;
      zones.push({
        id: `zone_${zoneCounter}`,
        type: 'thermal_risk',
        label: `Thermal Risk Zone ${zoneCounter}`,
        color: ZONE_CONFIG.thermal_risk.color,
        position: { x: cluster.center.x, y: cluster.center.y, z: cluster.center.z },
        severity: cluster.count > concaveTriangles.length * 0.4 ? 'HIGH' : 'MEDIUM',
        explanation: `Enclosed pocket or concave geometry detected with ${cluster.count} inward-facing surfaces. This geometry can trap heat and restrict airflow, causing thermal buildup.`,
        suggestion: 'Add ventilation channels or cooling fins. Consider redesigning enclosed pockets to improve airflow pathways.',
        affectedTriangles: cluster.count,
      });
    }
  }

  // ─── 5. BALANCE / SYMMETRY: mass distribution check ───
  const massCenter = new THREE.Vector3();
  for (const t of triData) massCenter.add(t.centroid);
  massCenter.divideScalar(triData.length);
  const offset = massCenter.clone().sub(center);
  const imbalanceRatio = offset.length() / (maxDim * 0.5);

  if (imbalanceRatio > 0.15) {
    zoneCounter++;
    const heavySide = massCenter.clone();
    zones.push({
      id: `zone_${zoneCounter}`,
      type: 'balance_concern',
      label: `Balance Concern Zone`,
      color: ZONE_CONFIG.balance_concern.color,
      position: { x: heavySide.x, y: heavySide.y, z: heavySide.z },
      severity: imbalanceRatio > 0.3 ? 'HIGH' : 'MEDIUM',
      explanation: `Mass distribution is offset by ${(imbalanceRatio * 100).toFixed(1)}% from geometric center. This imbalance may cause vibration and mechanical instability during operation.`,
      suggestion: 'Redistribute material or add counterweight. Consider symmetric design modifications to balance mass distribution.',
      affectedTriangles: 0,
    });
  }

  return zones;
}

/* ─── Simple spatial clustering ─── */
function clusterPoints(points: THREE.Vector3[], radius: number): { center: THREE.Vector3; count: number }[] {
  if (points.length === 0) return [];
  const used = new Set<number>();
  const clusters: { center: THREE.Vector3; count: number }[] = [];

  for (let i = 0; i < points.length; i++) {
    if (used.has(i)) continue;
    const cluster = [points[i]];
    used.add(i);
    for (let j = i + 1; j < points.length; j++) {
      if (used.has(j)) continue;
      if (points[i].distanceTo(points[j]) < radius) {
        cluster.push(points[j]);
        used.add(j);
      }
    }
    if (cluster.length >= 3) {
      const center = new THREE.Vector3();
      for (const p of cluster) center.add(p);
      center.divideScalar(cluster.length);
      clusters.push({ center, count: cluster.length });
    }
    if (clusters.length >= 5) break; // limit total zones
  }

  return clusters.sort((a, b) => b.count - a.count);
}

/* ─── STL geometry analysis ─── */
export function analyzeSTLGeometry(geometry: THREE.BufferGeometry, filename: string): STLData {
  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox!;
  const width = bbox.max.x - bbox.min.x;
  const height = bbox.max.y - bbox.min.y;
  const depth = bbox.max.z - bbox.min.z;
  const dims = [width, height, depth].sort((a, b) => a - b);
  const positions = geometry.attributes.position;
  const vertexCount = positions.count;
  const triangleCount = geometry.index ? geometry.index.count / 3 : vertexCount / 3;

  let surfaceArea = 0;
  let thinCount = 0;
  const thinThreshold = (dims[0] * 0.01) ** 2;
  const densityGrid: Record<string, number> = {};
  const gridSz = Math.max(width, height, depth) / 10;

  for (let i = 0; i < triangleCount; i++) {
    const i0 = geometry.index ? geometry.index.getX(i * 3) : i * 3;
    const i1 = geometry.index ? geometry.index.getX(i * 3 + 1) : i * 3 + 1;
    const i2 = geometry.index ? geometry.index.getX(i * 3 + 2) : i * 3 + 2;
    const a = new THREE.Vector3().fromBufferAttribute(positions, i0);
    const b = new THREE.Vector3().fromBufferAttribute(positions, i1);
    const c = new THREE.Vector3().fromBufferAttribute(positions, i2);
    const ab = new THREE.Vector3().subVectors(b, a);
    const ac = new THREE.Vector3().subVectors(c, a);
    const area = ab.cross(ac).length() * 0.5;
    surfaceArea += area;
    if (area < thinThreshold) thinCount++;
    const cx = Math.floor(((a.x + b.x + c.x) / 3) / gridSz);
    const cy = Math.floor(((a.y + b.y + c.y) / 3) / gridSz);
    const cz = Math.floor(((a.z + b.z + c.z) / 3) / gridSz);
    densityGrid[`${cx},${cy},${cz}`] = (densityGrid[`${cx},${cy},${cz}`] || 0) + 1;
  }

  const densVals = Object.values(densityGrid);
  const avgD = densVals.reduce((s, v) => s + v, 0) / densVals.length;
  const highDensityZones = densVals.filter(d => d > avgD * 2).length;

  const center = bbox.getCenter(new THREE.Vector3());
  let symScore = 0;
  const sampleCount = Math.min(1000, vertexCount);
  for (let i = 0; i < sampleCount; i++) {
    const idx = Math.floor((i / sampleCount) * vertexCount);
    const v = new THREE.Vector3().fromBufferAttribute(positions, idx);
    const mirrored = new THREE.Vector3(-v.x + 2 * center.x, v.y, v.z);
    let minDist = Infinity;
    for (let j = 0; j < Math.min(200, vertexCount); j++) {
      const jj = Math.floor(Math.random() * vertexCount);
      const w = new THREE.Vector3().fromBufferAttribute(positions, jj);
      minDist = Math.min(minDist, mirrored.distanceTo(w));
    }
    if (minDist < dims[0] * 0.05) symScore++;
  }

  const edgeMap: Record<string, number> = {};
  for (let i = 0; i < Math.min(triangleCount, 50000); i++) {
    const i0 = geometry.index ? geometry.index.getX(i * 3) : i * 3;
    const i1 = geometry.index ? geometry.index.getX(i * 3 + 1) : i * 3 + 1;
    const i2 = geometry.index ? geometry.index.getX(i * 3 + 2) : i * 3 + 2;
    for (const [ea, eb] of [[i0, i1], [i1, i2], [i2, i0]]) {
      const key = `${Math.min(ea, eb)}-${Math.max(ea, eb)}`;
      edgeMap[key] = (edgeMap[key] || 0) + 1;
    }
  }
  const boundaryEdges = Object.values(edgeMap).filter(c => c === 1).length;

  // Detect geometry zones
  const geometryZones = detectGeometryZones(geometry, filename);

  return {
    filename,
    triangleCount,
    vertexCount,
    boundingBox: { width, height, depth, volume: width * height * depth },
    surfaceArea,
    centerOfMass: { x: center.x, y: center.y, z: center.z },
    aspectRatio: dims[2] / Math.max(dims[0], 0.001),
    thinSectionPercent: (thinCount / Math.max(triangleCount, 1)) * 100,
    highDensityZones,
    hasHoles: boundaryEdges > 10,
    symmetrical: symScore / sampleCount > 0.6,
    estimatedWallThickness: Math.sqrt(surfaceArea / Math.max(triangleCount, 1)),
    geometryZones,
  };
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

/* ─── Zone Pin (arrow + sphere + label) ─── */
function ZonePin({ zone, isSelected, isDimmed, onClick }: {
  zone: GeometryZone; isSelected: boolean; isDimmed: boolean; onClick: () => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const arrowRef = useRef<THREE.Mesh>(null);
  const color = new THREE.Color(zone.color);
  const pos = new THREE.Vector3(zone.position.x, zone.position.y, zone.position.z);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const pulse = isSelected ? 1.3 + Math.sin(t * 4) * 0.3 : 1 + Math.sin(t * 2) * 0.12;
    if (meshRef.current) meshRef.current.scale.setScalar(pulse);
    // Arrow bob
    if (arrowRef.current) {
      arrowRef.current.position.y = 0.5 + Math.sin(t * 3) * 0.05;
    }
  });

  const severityIcon: Record<string, string> = {
    CRITICAL: '🔴', HIGH: '🟠', MEDIUM: '🟡', LOW: '⚪',
  };

  return (
    <group position={pos}>
      {/* Glow sphere */}
      <mesh>
        <sphereGeometry args={[0.2, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={isDimmed ? 0.05 : 0.12} />
      </mesh>
      {/* Core sphere */}
      <mesh ref={meshRef} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshBasicMaterial color={color} opacity={isDimmed ? 0.25 : 1} transparent />
      </mesh>
      {/* Directional arrow (cone pointing down) */}
      <mesh ref={arrowRef} position={[0, 0.5, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.06, 0.2, 8]} />
        <meshBasicMaterial color={color} opacity={isDimmed ? 0.2 : 0.9} transparent />
      </mesh>
      {/* Vertical line */}
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[new Float32Array([0, 0, 0, 0, 0.4, 0]), 3]} count={2} itemSize={3} />
        </bufferGeometry>
        <lineBasicMaterial color={zone.color} opacity={isDimmed ? 0.15 : 0.5} transparent />
      </line>
      {/* Label */}
      <Billboard position={[0, 0.75, 0]}>
        <Html center distanceFactor={6} style={{ pointerEvents: 'auto' }}>
          <div
            onClick={(e) => { e.stopPropagation(); onClick(); }}
            className="cursor-pointer select-none whitespace-nowrap"
            style={{ opacity: isDimmed ? 0.25 : 1, transition: 'opacity 0.3s' }}
          >
            <div
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-bold border backdrop-blur-sm"
              style={{
                backgroundColor: `${zone.color}22`,
                borderColor: `${zone.color}55`,
                color: zone.color,
              }}
            >
              <span>{severityIcon[zone.severity]}</span>
              <span className="text-[9px] font-medium opacity-90">{zone.label}</span>
            </div>
          </div>
        </Html>
      </Billboard>
    </group>
  );
}

/* ─── Zone Popup ─── */
function ZonePopup({ zone, onClose }: { zone: GeometryZone; onClose: () => void }) {
  const pos = new THREE.Vector3(zone.position.x, zone.position.y, zone.position.z);
  const typeLabel = ZONE_CONFIG[zone.type]?.label || zone.type;
  const severityEmoji: Record<string, string> = { CRITICAL: '🔴', HIGH: '🟠', MEDIUM: '🟡', LOW: '⚪' };

  return (
    <group position={pos}>
      <Billboard position={[0, 1.2, 0]}>
        <Html center distanceFactor={5} style={{ pointerEvents: 'auto' }}>
          <div className="w-64 rounded-lg border shadow-2xl text-xs backdrop-blur-md" style={{ backgroundColor: 'hsl(220 25% 8% / 0.95)', borderColor: `${zone.color}44` }}>
            <div className="flex items-center justify-between px-3 py-2 rounded-t-lg border-b" style={{ backgroundColor: `${zone.color}18`, borderColor: `${zone.color}33` }}>
              <span className="font-bold" style={{ color: zone.color }}>{severityEmoji[zone.severity]} {zone.severity} — {typeLabel}</span>
              <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="text-muted-foreground hover:text-foreground text-sm leading-none">✕</button>
            </div>
            <div className="px-3 py-2.5 space-y-2">
              <p className="font-bold text-foreground">{zone.label}</p>
              {zone.affectedTriangles > 0 && (
                <p className="text-[10px] text-muted-foreground">{zone.affectedTriangles} affected faces</p>
              )}
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Explanation</p>
                <p className="text-foreground/80">{zone.explanation}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Suggested Fix</p>
                <p className="text-foreground/80">{zone.suggestion}</p>
              </div>
            </div>
          </div>
        </Html>
      </Billboard>
    </group>
  );
}

/* ─── Geometry Zones Layer ─── */
function GeometryZonesLayer({ zones, selectedId, onSelect }: {
  zones: GeometryZone[]; selectedId: string | null; onSelect: (id: string | null) => void;
}) {
  return (
    <>
      {zones.map((z) => {
        const isSelected = selectedId === z.id;
        const isDimmed = selectedId !== null && !isSelected;
        return (
          <group key={z.id}>
            <ZonePin zone={z} isSelected={isSelected} isDimmed={isDimmed} onClick={() => onSelect(isSelected ? null : z.id)} />
            {isSelected && <ZonePopup zone={z} onClose={() => onSelect(null)} />}
          </group>
        );
      })}
    </>
  );
}

/* ─── Pulsing annotation sphere ─── */
function AnnotationPin({
  annotation, position, isSelected, isDimmed, onClick,
}: {
  annotation: Annotation; position: THREE.Vector3;
  isSelected: boolean; isDimmed: boolean; onClick: () => void;
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
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.15, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.15} />
      </mesh>
      <mesh ref={meshRef} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshBasicMaterial color={color} opacity={isDimmed ? 0.3 : 1} transparent />
      </mesh>
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
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[new Float32Array([0, 0, 0, 0, 0.25, 0]), 3]} count={2} itemSize={3} />
        </bufferGeometry>
        <lineBasicMaterial color={annotation.color} opacity={isDimmed ? 0.2 : 0.6} transparent />
      </line>
    </group>
  );
}

/* ─── Popup card ─── */
function AnnotationPopup({ annotation, position, onClose }: { annotation: Annotation; position: THREE.Vector3; onClose: () => void; }) {
  const severityEmoji: Record<string, string> = { CRITICAL: '🔴', HIGH: '🟠', MEDIUM: '🟡', LOW: '⚪' };
  return (
    <group position={position}>
      <Billboard position={[0, 0.7, 0]}>
        <Html center distanceFactor={5} style={{ pointerEvents: 'auto' }}>
          <div className="w-56 rounded-lg border shadow-2xl text-xs backdrop-blur-md" style={{ backgroundColor: 'hsl(220 25% 8% / 0.95)', borderColor: `${annotation.color}44` }}>
            <div className="flex items-center justify-between px-3 py-2 rounded-t-lg border-b" style={{ backgroundColor: `${annotation.color}18`, borderColor: `${annotation.color}33` }}>
              <span className="font-bold" style={{ color: annotation.color }}>{severityEmoji[annotation.severity]} {annotation.severity} — #{annotation.id}</span>
              <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="text-muted-foreground hover:text-foreground text-sm leading-none">✕</button>
            </div>
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

/* ─── Auto-fit on load ─── */
function AutoFitCamera({ orbitRef }: { orbitRef: React.RefObject<any> }) {
  const { scene, camera } = useThree();
  const fitted = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (fitted.current) return;
      const box = new THREE.Box3().setFromObject(scene);
      if (box.isEmpty()) return;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const dist = maxDim * 2.5;
      camera.position.set(center.x + dist * 0.6, center.y + dist * 0.4, center.z + dist * 0.6);
      camera.lookAt(center);
      if (orbitRef.current) {
        orbitRef.current.target.copy(center);
        orbitRef.current.update();
      }
      fitted.current = true;
    }, 500);
    return () => clearTimeout(timer);
  }, [scene, camera, orbitRef]);

  return null;
}

/* ─── Annotations layer ─── */
function AnnotationsLayer({ annotations, selectedId, onSelect }: { annotations: Annotation[]; selectedId: number | null; onSelect: (id: number | null) => void; }) {
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
            <AnnotationPin annotation={a} position={pos} isSelected={isSelected} isDimmed={isDimmed} onClick={() => onSelect(isSelected ? null : a.id)} />
            {isSelected && <AnnotationPopup annotation={a} position={pos} onClose={() => onSelect(null)} />}
          </group>
        );
      })}
    </>
  );
}

/* ─── Heat Sensor Pin ─── */
function HeatSensorPin({ sensor }: { sensor: HeatSensor }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const color = getHeatColor(sensor.temperature);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const pulse = sensor.temperature > 120 ? 1 + Math.sin(clock.getElapsedTime() * 4) * 0.3 : 1;
    meshRef.current.scale.setScalar(pulse);
  });

  return (
    <group position={sensor.position}>
      <mesh ref={meshRef}>
        <sphereGeometry args={[0.06, 16, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <Billboard position={[0, 0.25, 0]}>
        <Html center distanceFactor={6} style={{ pointerEvents: 'none' }}>
          <div className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-background/80 border border-border/50 whitespace-nowrap" style={{ color }}>
            {sensor.name}: {sensor.temperature.toFixed(1)}°C
          </div>
        </Html>
      </Billboard>
    </group>
  );
}

/* ─── Heat color helper ─── */
function getHeatColor(temp: number): string {
  if (temp >= 120) return '#ff0000';
  if (temp >= 90) return '#ff6600';
  if (temp >= 60) return '#ffff00';
  if (temp >= 30) return '#00ff00';
  return '#0000ff';
}

/* ─── Heat color overlay material ─── */
function HeatOverlayModel({ url, sensors, opacity }: { url: string; sensors: HeatSensor[]; opacity: number }) {
  const geometry = useLoader(STLLoader, url);
  const meshRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    if (!geometry || sensors.length === 0) return;
    geometry.computeBoundingBox();
    const positions = geometry.attributes.position;
    const colors = new Float32Array(positions.count * 3);

    for (let i = 0; i < positions.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(positions, i);
      let totalWeight = 0;
      let weightedTemp = 0;
      for (const sensor of sensors) {
        const dist = v.distanceTo(sensor.position);
        const w = 1 / Math.max(dist * dist, 0.001);
        totalWeight += w;
        weightedTemp += sensor.temperature * w;
      }
      const temp = totalWeight > 0 ? weightedTemp / totalWeight : 20;
      const c = new THREE.Color(getHeatColor(temp));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }, [geometry, sensors]);

  if (sensors.length === 0) return null;

  return (
    <mesh ref={meshRef} geometry={geometry}>
      <meshBasicMaterial vertexColors transparent opacity={opacity} side={THREE.DoubleSide} />
    </mesh>
  );
}

/* ─── STL Model with parse callback ─── */
function STLModel({ url, viewMode, onParsed, filename }: { url: string; viewMode: ViewMode; onParsed?: (data: STLData) => void; filename?: string }) {
  const geometry = useLoader(STLLoader, url);
  const parsedRef = useRef(false);

  useEffect(() => {
    if (parsedRef.current || !onParsed) return;
    geometry.computeVertexNormals();
    const data = analyzeSTLGeometry(geometry, filename || 'model.stl');
    onParsed(data);
    parsedRef.current = true;
  }, [geometry, onParsed, filename]);

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
      return new THREE.MeshStandardMaterial({ color: 0xb0b0b0, roughness: 0.35, metalness: 0.65, envMapIntensity: 1.0 });
  }
}

/* ─── Control hints ─── */
function ControlHints() {
  const [visible, setVisible] = useState(true);
  useEffect(() => { const t = setTimeout(() => setVisible(false), 3000); return () => clearTimeout(t); }, []);
  if (!visible) return null;
  return (
    <Html center>
      <div className="bg-background/80 backdrop-blur-md text-foreground/70 text-[11px] px-4 py-2 rounded-lg border border-border/30 whitespace-nowrap animate-fade-in">
        Drag to rotate · Scroll to zoom · Right click to pan
      </div>
    </Html>
  );
}

/* ─── Scene content ─── */
function SceneContent({
  fileUrl, fileType, viewMode, annotations, showAnnotations, selectedId, onSelectAnnotation,
  flyToTarget, orbitRef, onSTLParsed, filename, heatSensors, heatMode, heatOpacity,
  geometryZones, showZones, selectedZoneId, onSelectZone,
}: {
  fileUrl: string; fileType: string; viewMode: ViewMode;
  annotations: Annotation[]; showAnnotations: boolean;
  selectedId: number | null; onSelectAnnotation: (id: number | null) => void;
  flyToTarget: THREE.Vector3 | null; orbitRef: React.RefObject<any>;
  onSTLParsed?: (data: STLData) => void; filename?: string;
  heatSensors?: HeatSensor[]; heatMode?: boolean; heatOpacity?: number;
  geometryZones?: GeometryZone[]; showZones?: boolean;
  selectedZoneId?: string | null; onSelectZone?: (id: string | null) => void;
}) {
  return (
    <>
      <ambientLight intensity={0.3} />
      <directionalLight position={[5, 8, 3]} intensity={1.2} castShadow color="#ffffff" />
      <directionalLight position={[-6, 4, -2]} intensity={0.5} color="#f0f0ff" />
      <directionalLight position={[0, 2, -8]} intensity={0.3} color="#8888ff" />
      <directionalLight position={[0, -3, 0]} intensity={0.15} color="#ffffff" />

      <Center>
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
          {fileType === 'stl' && <STLModel url={fileUrl} viewMode={viewMode} onParsed={onSTLParsed} filename={filename} />}
          {fileType === 'obj' && <OBJModel url={fileUrl} viewMode={viewMode} />}
          {(fileType === 'gltf' || fileType === 'glb') && <GLTFModel url={fileUrl} viewMode={viewMode} />}

          {heatMode && fileType === 'stl' && heatSensors && heatSensors.length > 0 && (
            <HeatOverlayModel url={fileUrl} sensors={heatSensors} opacity={heatOpacity ?? 0.8} />
          )}
        </Suspense>
      </Center>

      {heatMode && heatSensors?.map((s, i) => s.mapped && <HeatSensorPin key={i} sensor={s} />)}

      {showAnnotations && annotations.length > 0 && (
        <AnnotationsLayer annotations={annotations} selectedId={selectedId} onSelect={onSelectAnnotation} />
      )}

      {showZones && geometryZones && geometryZones.length > 0 && (
        <GeometryZonesLayer zones={geometryZones} selectedId={selectedZoneId ?? null} onSelect={onSelectZone ?? (() => {})} />
      )}

      <CameraController target={flyToTarget} orbitRef={orbitRef} />
      <AutoFitCamera orbitRef={orbitRef} />
      <ControlHints />

      <Grid infiniteGrid cellSize={0.5} sectionSize={2} cellColor="#1a1a2e" sectionColor="#2a2a3e" fadeDistance={50} position={[0, -0.01, 0]} />
      <OrbitControls
        ref={orbitRef}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={0.001}
        maxDistance={10000}
        zoomSpeed={3}
        rotateSpeed={0.8}
        enablePan
        panSpeed={1.5}
      />
    </>
  );
}

/* ─── Heat Legend ─── */
function HeatLegend() {
  const items = [
    { color: '#ff0000', label: '120°C+', status: 'CRITICAL' },
    { color: '#ff6600', label: '90-120°C', status: 'DANGER' },
    { color: '#ffff00', label: '60-90°C', status: 'WARNING' },
    { color: '#00ff00', label: '30-60°C', status: 'NORMAL' },
    { color: '#0000ff', label: '<30°C', status: 'SAFE' },
    { color: '#666666', label: 'No data', status: '' },
  ];
  return (
    <div className="absolute bottom-3 right-3 z-10 bg-background/90 backdrop-blur-md border border-border/50 rounded-lg p-2.5 space-y-1">
      {items.map(({ color, label, status }) => (
        <div key={label} className="flex items-center gap-2 text-[10px]">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
          <span className="text-foreground/70">{label}</span>
          {status && <span className="text-foreground/40 text-[9px]">{status}</span>}
        </div>
      ))}
    </div>
  );
}

/* ─── Zone Legend ─── */
function ZoneLegend() {
  const items = Object.entries(ZONE_CONFIG).map(([, cfg]) => cfg);
  return (
    <div className="absolute bottom-3 right-3 z-10 bg-background/90 backdrop-blur-md border border-border/50 rounded-lg p-2.5 space-y-1">
      <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Zone Types</p>
      {items.map(({ color, label }) => (
        <div key={label} className="flex items-center gap-2 text-[10px]">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-foreground/70">{label}</span>
        </div>
      ))}
    </div>
  );
}

/* ─── Main component ─── */
export default function CADViewer({
  fileUrl, fileType, loading, className, annotations = [], selectedAnnotation, onSelectAnnotation,
  onSTLParsed, heatSensors, heatMode, heatOpacity,
  geometryZones = [], showZones = false, selectedZone, onSelectZone,
}: CADViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('solid');
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [internalSelected, setInternalSelected] = useState<number | null>(null);
  const [flyToTarget, setFlyToTarget] = useState<THREE.Vector3 | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const orbitRef = useRef<any>(null);

  const selected = selectedAnnotation !== undefined ? selectedAnnotation : internalSelected;
  const setSelected = onSelectAnnotation || setInternalSelected;

  // Fly to annotation
  useEffect(() => {
    if (selectedAnnotation != null && annotations.length > 0) {
      setFlyToTarget(new THREE.Vector3(selectedAnnotation * 0.001, 0, 0));
    }
  }, [selectedAnnotation, annotations]);

  // Fly to zone
  useEffect(() => {
    if (selectedZone && geometryZones.length > 0) {
      const zone = geometryZones.find(z => z.id === selectedZone);
      if (zone) {
        setFlyToTarget(new THREE.Vector3(zone.position.x, zone.position.y, zone.position.z));
      }
    }
  }, [selectedZone, geometryZones]);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) containerRef.current.requestFullscreen();
    else document.exitFullscreen();
  }, []);

  const resetCamera = useCallback(() => {
    if (orbitRef.current) orbitRef.current.reset();
  }, []);

  const viewButtons: { mode: ViewMode; icon: typeof Box; label: string }[] = [
    { mode: 'solid', icon: Box, label: 'Solid' },
    { mode: 'wireframe', icon: Grid3x3, label: 'Wire' },
    { mode: 'xray', icon: Eye, label: 'X-Ray' },
  ];

  const hasZones = geometryZones.length > 0 && showZones;
  const hasAnnotations = annotations.length > 0;

  return (
    <div ref={containerRef} className={`relative rounded-lg overflow-hidden border border-border/50 bg-[hsl(220,25%,5%)] ${className ?? ''}`} style={{ minHeight: 400 }}>
      {/* Top-left toolbar */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 flex-wrap">
        {viewButtons.map(({ mode, icon: Icon, label }) => (
          <Button key={mode} size="sm" variant={viewMode === mode ? 'default' : 'secondary'} className="h-7 px-2 text-xs gap-1" onClick={() => setViewMode(mode)}>
            <Icon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{label}</span>
          </Button>
        ))}
      </div>

      {/* Top-right toolbar */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
        {hasZones && (
          <div className="flex items-center gap-1.5 bg-secondary/80 backdrop-blur-sm rounded-md px-2 h-7">
            <Search className="w-3 h-3 text-primary" />
            <span className="text-[10px] text-muted-foreground hidden sm:inline">Zones</span>
            <span className="text-[10px] font-bold text-primary">{geometryZones.length}</span>
          </div>
        )}
        {hasAnnotations && (
          <div className="flex items-center gap-1.5 bg-secondary/80 backdrop-blur-sm rounded-md px-2 h-7">
            <MapPin className="w-3 h-3 text-primary" />
            <span className="text-[10px] text-muted-foreground hidden sm:inline">Pins</span>
            <Switch checked={showAnnotations} onCheckedChange={setShowAnnotations} className="scale-75" />
          </div>
        )}
        <Button size="sm" variant="secondary" className="h-7 w-7 p-0" onClick={toggleFullscreen} title="Fullscreen">
          <Maximize className="w-3.5 h-3.5" />
        </Button>
        <Button size="sm" variant="secondary" className="h-7 w-7 p-0" onClick={resetCamera} title="Reset orientation">
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
        <Canvas shadows camera={{ position: [4, 3, 4], fov: 45, near: 0.001, far: 20000 }} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }} style={{ height: '100%', minHeight: 400 }}>
          <color attach="background" args={['#0a0a0a']} />
          <SceneContent
            fileUrl={fileUrl} fileType={fileType} viewMode={viewMode}
            annotations={annotations} showAnnotations={showAnnotations}
            selectedId={selected} onSelectAnnotation={setSelected}
            flyToTarget={flyToTarget} orbitRef={orbitRef}
            onSTLParsed={onSTLParsed} filename={fileUrl}
            heatSensors={heatSensors} heatMode={heatMode} heatOpacity={heatOpacity}
            geometryZones={geometryZones} showZones={showZones}
            selectedZoneId={selectedZone} onSelectZone={onSelectZone}
          />
        </Canvas>
      ) : (
        <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-3 text-muted-foreground">
          <Box className="w-12 h-12 opacity-30" />
          <p className="text-sm">Upload a 3D model to preview</p>
          <p className="text-xs opacity-50">STL · OBJ · GLTF · GLB</p>
        </div>
      )}

      {/* Legends */}
      {heatMode && <HeatLegend />}
      {hasZones && !heatMode && <ZoneLegend />}

      {/* Annotation list panel */}
      {hasAnnotations && showAnnotations && !heatMode && !hasZones && (
        <div className="absolute bottom-3 left-3 right-16 z-10">
          <div className="bg-background/90 backdrop-blur-md border border-border/50 rounded-lg p-2 flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
            {annotations.map((a) => {
              const isActive = selected === a.id;
              return (
                <button
                  key={a.id}
                  onClick={() => setSelected(isActive ? null : a.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all ${isActive ? 'ring-1 ring-primary scale-105' : 'hover:bg-accent/50'}`}
                  style={{ borderColor: `${a.color}44`, backgroundColor: isActive ? `${a.color}22` : 'transparent' }}
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: a.color }} />
                  <span className="text-foreground/90">#{a.id} {a.title}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Geometry zones list panel */}
      {hasZones && !heatMode && (
        <div className="absolute bottom-3 left-3 right-32 z-10">
          <div className="bg-background/90 backdrop-blur-md border border-border/50 rounded-lg p-2 flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
            {geometryZones.map((z) => {
              const isActive = selectedZone === z.id;
              return (
                <button
                  key={z.id}
                  onClick={() => onSelectZone?.(isActive ? null : z.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all ${isActive ? 'ring-1 ring-primary scale-105' : 'hover:bg-accent/50'}`}
                  style={{ borderColor: `${z.color}44`, backgroundColor: isActive ? `${z.color}22` : 'transparent' }}
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: z.color }} />
                  <span className="text-foreground/90">{z.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export { ZONE_CONFIG };
