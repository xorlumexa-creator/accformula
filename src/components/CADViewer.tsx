import { useRef, useState, useCallback, Suspense, useEffect } from 'react';
import { Canvas, useThree, useLoader } from '@react-three/fiber';
import { OrbitControls, Grid, Center, Html, Environment } from '@react-three/drei';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';
import {
  Maximize, RotateCcw, Box, Grid3x3, Eye, Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

type ViewMode = 'solid' | 'wireframe' | 'xray';

interface CADViewerProps {
  fileUrl: string | null;
  fileType: string | null;
  loading?: boolean;
  className?: string;
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
  return (
    <mesh geometry={geometry} material={mat} castShadow receiveShadow />
  );
}

/* ─── OBJ Model ─── */
function OBJModel({ url, viewMode }: { url: string; viewMode: ViewMode }) {
  const obj = useLoader(OBJLoader, url);
  const mat = getMaterial(viewMode);

  useEffect(() => {
    obj.traverse((child: any) => {
      if (child.isMesh) {
        child.material = mat;
        child.castShadow = true;
        child.receiveShadow = true;
      }
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
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }, [gltf, viewMode, mat]);

  return <primitive object={gltf.scene} />;
}

/* ─── Material helper ─── */
function getMaterial(viewMode: ViewMode): THREE.Material {
  switch (viewMode) {
    case 'wireframe':
      return new THREE.MeshStandardMaterial({
        color: 0xe63946,
        wireframe: true,
        roughness: 0.5,
      });
    case 'xray':
      return new THREE.MeshPhysicalMaterial({
        color: 0x888888,
        transparent: true,
        opacity: 0.35,
        roughness: 0.2,
        metalness: 0.5,
        side: THREE.DoubleSide,
      });
    default:
      return new THREE.MeshStandardMaterial({
        color: 0xaaaaaa,
        roughness: 0.45,
        metalness: 0.55,
      });
  }
}

/* ─── Bounding box overlay ─── */
function BoundingBoxOverlay({ url, fileType }: { url: string; fileType: string }) {
  const { scene } = useThree();

  useEffect(() => {
    const timer = setTimeout(() => {
      const box = new THREE.Box3().setFromObject(scene);
      if (box.isEmpty()) return;
      const size = box.getSize(new THREE.Vector3());
      // We just compute it; the parent reads it from the DOM if needed
    }, 500);
    return () => clearTimeout(timer);
  }, [scene, url, fileType]);

  return null;
}

/* ─── Scene content ─── */
function SceneContent({
  fileUrl,
  fileType,
  viewMode,
  showBBox,
}: {
  fileUrl: string;
  fileType: string;
  viewMode: ViewMode;
  showBBox: boolean;
}) {
  return (
    <>
      {/* Lighting */}
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
          {(fileType === 'gltf' || fileType === 'glb') && (
            <GLTFModel url={fileUrl} viewMode={viewMode} />
          )}
        </Suspense>
      </AutoFit>

      <Grid
        infiniteGrid
        cellSize={0.5}
        sectionSize={2}
        cellColor="#1a1a2e"
        sectionColor="#2a2a3e"
        fadeDistance={30}
        position={[0, -0.01, 0]}
      />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.12}
        minDistance={1}
        maxDistance={100}
      />
    </>
  );
}

/* ─── Main component ─── */
export default function CADViewer({ fileUrl, fileType, loading, className }: CADViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('solid');
  const [showBBox, setShowBBox] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }, []);

  const viewButtons: { mode: ViewMode; icon: typeof Box; label: string }[] = [
    { mode: 'solid', icon: Box, label: 'Solid' },
    { mode: 'wireframe', icon: Grid3x3, label: 'Wire' },
    { mode: 'xray', icon: Eye, label: 'X-Ray' },
  ];

  return (
    <div
      ref={containerRef}
      className={`relative rounded-lg overflow-hidden border border-border/50 bg-[hsl(220,25%,5%)] ${className ?? ''}`}
      style={{ minHeight: 400 }}
    >
      {/* Toolbar */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5">
        {viewButtons.map(({ mode, icon: Icon, label }) => (
          <Button
            key={mode}
            size="sm"
            variant={viewMode === mode ? 'default' : 'secondary'}
            className="h-7 px-2 text-xs gap-1"
            onClick={() => setViewMode(mode)}
          >
            <Icon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{label}</span>
          </Button>
        ))}
      </div>

      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
        <Button size="sm" variant="secondary" className="h-7 w-7 p-0" onClick={toggleFullscreen} title="Fullscreen">
          <Maximize className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="h-7 w-7 p-0"
          onClick={() => {
            // Force re-render by toggling bbox (also acts as reset orientation)
            setShowBBox(b => !b);
          }}
          title="Reset orientation"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Bounding box toggle */}
      {fileUrl && (
        <div className="absolute bottom-3 left-3 z-10">
          <Button
            size="sm"
            variant={showBBox ? 'default' : 'secondary'}
            className="h-7 px-2 text-xs gap-1"
            onClick={() => setShowBBox(b => !b)}
          >
            <Box className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">BBox</span>
          </Button>
        </div>
      )}

      {/* Canvas */}
      {loading ? (
        <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Loading model…</span>
        </div>
      ) : fileUrl && fileType ? (
        <Canvas
          shadows
          camera={{ position: [4, 3, 4], fov: 45, near: 0.1, far: 1000 }}
          gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
          style={{ height: '100%', minHeight: 400 }}
        >
          <color attach="background" args={['#0a0a0a']} />
          <SceneContent fileUrl={fileUrl} fileType={fileType} viewMode={viewMode} showBBox={showBBox} />
        </Canvas>
      ) : (
        <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-3 text-muted-foreground">
          <Box className="w-12 h-12 opacity-30" />
          <p className="text-sm">Upload a 3D model to preview</p>
          <p className="text-xs opacity-50">STL · OBJ · GLTF · GLB</p>
        </div>
      )}
    </div>
  );
}
