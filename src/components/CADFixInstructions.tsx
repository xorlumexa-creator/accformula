import { useState } from 'react';
import { ChevronDown, ChevronUp, Wrench } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { Annotation, STLData } from '@/components/CADViewer';

interface PythonGeoData {
  dimensions_mm: { x: number; y: number; z: number };
  volume_mm3: number;
  surface_area_mm2?: number;
  center_of_gravity: { x: number; y: number; z: number };
  is_watertight: boolean;
  vertex_count: number;
  face_count: number;
}

const CAD_SOFTWARE = [
  { id: 'fusion360', name: 'Fusion 360', icon: '🔵' },
  { id: 'solidworks', name: 'SolidWorks', icon: '🔴' },
  { id: 'freecad', name: 'FreeCAD', icon: '🟢' },
  { id: 'blender', name: 'Blender', icon: '🟠' },
];

type IssueType = 'thin_wall' | 'stress_concentration' | 'non_manifold' | 'overhang' | 'hole' | 'sharp_corner' | 'generic';

function classifyIssue(title: string, problem: string): IssueType {
  const text = `${title} ${problem}`.toLowerCase();
  if (text.includes('thin') || text.includes('wall thickness')) return 'thin_wall';
  if (text.includes('stress') || text.includes('concentration') || text.includes('fillet')) return 'stress_concentration';
  if (text.includes('manifold') || text.includes('watertight') || text.includes('mesh error')) return 'non_manifold';
  if (text.includes('overhang') || text.includes('support') || text.includes('print')) return 'overhang';
  if (text.includes('hole') || text.includes('gap') || text.includes('open')) return 'hole';
  if (text.includes('sharp') || text.includes('corner') || text.includes('edge')) return 'sharp_corner';
  return 'generic';
}

function getFixSteps(issueType: IssueType, softwareId: string, dims?: { x: number; y: number; z: number } | null): string[] {
  const minDim = dims ? Math.min(dims.x, dims.y, dims.z).toFixed(1) : '?';
  
  const steps: Record<string, Record<string, string[]>> = {
    thin_wall: {
      fusion360: [
        'Select the thin wall face in the model',
        'Go to Modify → Press Pull or use keyboard shortcut Q',
        `Set the offset distance to increase wall to minimum 1.5mm (current ~${minDim}mm)`,
        'If the wall is from a Shell operation, go to Modify → Shell and increase thickness to 2.0mm',
        'Add internal ribs: Sketch → Line on the inner face, then Extrude → Join, rib width 1.5mm, spacing every 8mm',
        'Validate with Inspect → Section Analysis to confirm minimum wall across the part',
      ],
      solidworks: [
        'Select the thin wall face in Feature Manager',
        'Right-click → Edit Feature if it was created by Shell',
        `Increase shell thickness to minimum 1.5mm (current ~${minDim}mm)`,
        'For manual thickening: Insert → Boss/Base → Extrude, select inner face, offset 0.5mm outward',
        'Add reinforcing ribs: Insert → Features → Rib, set thickness 1.5mm, draft angle 1°',
        'Use Evaluate → Mass Properties to verify structural impact',
      ],
      freecad: [
        'Select the thin wall face in the Model tree',
        'Use Part Design → Pad to extrude additional material',
        `Set pad distance to bring wall to minimum 1.5mm (current ~${minDim}mm)`,
        'For Shell parts: edit Shell feature, increase Thickness parameter to 2.0mm',
        'Add ribs: create sketch on inner face → Part Design → Pad, width 1.5mm',
        'Use Part → Check Geometry to validate the result',
      ],
      blender: [
        'Select the thin faces in Edit Mode (Face Select)',
        'Press E to Extrude Faces, move along normal',
        `Extrude by at least 0.5mm to bring total wall to 1.5mm minimum`,
        'Alternative: use Solidify Modifier, set Thickness to 1.5mm, apply',
        'For uniform walls: Mesh → Clean Up → Merge by Distance (0.001mm) first',
        'Check wall thickness with 3D Print Toolbox addon → Thickness',
      ],
    },
    stress_concentration: {
      fusion360: [
        'Select the sharp internal edge causing stress concentration',
        'Go to Modify → Fillet',
        'Set fillet radius to 2.0mm minimum (1/3 of wall thickness recommended)',
        'For multiple edges: hold Ctrl to multi-select edges, apply fillet uniformly',
        'If fillet fails: try chamfer first at 1mm × 1mm, then fillet the chamfer edge',
        'Run Simulation → Static Stress to verify stress reduction',
      ],
      solidworks: [
        'Select the sharp edge causing the stress concentration',
        'Go to Insert → Features → Fillet/Round',
        'Set radius to minimum 2.0mm (rule: R ≥ wall_thickness / 3)',
        'Enable "Tangent Propagation" for smooth transitions',
        'For tight areas: try Variable Size Fillet with 1.5mm minimum',
        'Verify with SimulationXpress → Run Analysis',
      ],
      freecad: [
        'Select the sharp edge in 3D view',
        'Go to Part Design → Fillet',
        'Set radius to 2.0mm minimum',
        'If Fillet fails: try Part Design → Chamfer at 1.5mm first',
        'For multiple edges: hold Ctrl and select all target edges',
        'Use FEM Workbench to verify stress improvement',
      ],
      blender: [
        'Select the sharp edge in Edit Mode (Edge Select)',
        'Press Ctrl+B to Bevel, scroll mouse wheel for segments (3 minimum)',
        'Set bevel width to 2.0mm equivalent',
        'For corners: select vertices, Ctrl+Shift+B for vertex bevel',
        'Smooth the result: Right-click → Shade Smooth, add Edge Split modifier',
        'Export as STL and re-import to verify geometry is clean',
      ],
    },
    non_manifold: {
      fusion360: [
        'Go to Inspect → Component Color Cycling Toggle to spot problematic areas',
        'Select the non-manifold edge or vertex',
        'Try Modify → Stitch to close small gaps (tolerance 0.01mm)',
        'If gap persists: Sketch → Project the edge, create Patch → Extrude to fill',
        'Use Repair → Heal to automatically fix minor mesh issues',
        'Final check: Inspect → Interference to verify no self-intersections',
      ],
      solidworks: [
        'Go to Evaluate → Check Entity to identify non-manifold geometry',
        'Select Import Diagnostics if this was an imported file',
        'Click "Heal All" to attempt automatic repair',
        'For remaining issues: use Knit Surface, check "Try to form solid"',
        'Fill gaps with Insert → Surface → Fill Surface',
        'Re-run Evaluate → Check Entity to confirm manifold status',
      ],
      freecad: [
        'Use Part → Check Geometry to identify non-manifold areas',
        'Select the problematic faces in Edit Mode',
        'Try Mesh Design → Analyze → Check and Repair Mesh',
        'For open edges: Mesh → Fill Hole, select the boundary edges',
        'Validate with Part → Check Geometry → Run BOP Check',
        'Export and re-import to verify the mesh is solid',
      ],
      blender: [
        'Enter Edit Mode → Select → All by Trait → Non Manifold',
        'This highlights all problem edges/vertices',
        'For open edges: select boundary, press F to fill face',
        'For duplicate vertices: Mesh → Clean Up → Merge by Distance (0.001mm)',
        'For interior faces: select and delete (X → Faces)',
        'Final check: 3D Print Toolbox → Check All → Non Manifold should show 0',
      ],
    },
    overhang: {
      fusion360: [
        'Identify overhanging surfaces (>45° from build plate)',
        'Add chamfers to reduce angle: Modify → Chamfer, distance 2mm at 45°',
        'For flat overhangs: redesign as self-supporting arch or add fillets',
        'Consider splitting the part: Modify → Split Body at the overhang',
        'Add support ribs underneath: Sketch on XZ plane, Extrude triangular support',
        'Use Additive → 3D Print settings to preview support material needed',
      ],
      solidworks: [
        'Use DFMXpress to identify overhang areas automatically',
        'Select the overhanging face, add Draft: Insert → Features → Draft',
        'Set draft angle to bring surface within 45° of vertical',
        'For bridges: redesign with Insert → Features → Rib underneath',
        'Consider orienting the part: reposition for minimum overhang',
        'Verify with SOLIDWORKS Plastics or 3D print preview',
      ],
      freecad: [
        'Identify overhanging faces visually (>45° from Z-axis)',
        'Add Part Design → Chamfer to reduce overhang angle',
        'For flat overhangs: add support geometry with Part Design → Pad',
        'Consider splitting: Part → Slice to split at overhang line',
        'Re-orient the part in slicer for optimal print direction',
        'Use Mesh Workbench → Analyze → Overhang check',
      ],
      blender: [
        'Use 3D Print Toolbox → Overhang to highlight problem areas',
        'Select overhanging faces, use Mesh → Transform → Rotate to adjust',
        'Add support structures: model triangular braces manually',
        'For chamfering: select bottom edge of overhang, Ctrl+B bevel at 45°',
        'Consider Boolean difference to hollow and add internal lattice',
        'Export and preview in slicer to verify support reduction',
      ],
    },
    sharp_corner: {
      fusion360: [
        'Select the sharp corner edge',
        'Go to Modify → Fillet, set radius 1.5mm minimum',
        'For outer corners: Modify → Chamfer, 1mm × 1mm',
        'Multi-select similar corners with Ctrl+click for uniform fillets',
        'Check for cascading geometry failures after filleting',
        'Inspect → Curvature Analysis to verify smooth transitions',
      ],
      solidworks: [
        'Select the sharp corner edge in the graphics area',
        'Insert → Features → Fillet/Round, radius 1.5mm',
        'Enable "Keep features" to prevent cascading failures',
        'For external corners: try Chamfer at 1mm × 45°',
        'Use "Face Fillet" if edge fillet fails on complex geometry',
        'Verify with Evaluate → Curvature Display',
      ],
      freecad: [
        'Select the sharp edge in the 3D viewport',
        'Apply Part Design → Fillet, radius 1.5mm',
        'If it fails: try smaller radius first (0.5mm), then increase',
        'Alternative: Part Design → Chamfer, size 1mm',
        'For compound curves: use Part Workbench → Fillet with more segments',
        'Check Geometry to verify no new issues created',
      ],
      blender: [
        'Select the sharp edge in Edit Mode',
        'Ctrl+B to Bevel, set width to 1.5mm, segments 3',
        'For corners: select vertex, Ctrl+Shift+B for vertex bevel',
        'Apply Subdivision Surface modifier for smoother result',
        'Set crease (Shift+E) on non-filleted edges to preserve shape',
        'Check mesh quality with Mesh → Clean Up → Degenerate Dissolve',
      ],
    },
    hole: {
      fusion360: [
        'Identify the hole or gap in the mesh surface',
        'Use Mesh → Repair to auto-fill small holes',
        'For larger holes: Patch → Create patch surface across opening',
        'Stitch the patch: Modify → Stitch, tolerance 0.01mm',
        'Convert back to solid: Mesh → BRep if needed',
        'Inspect → Check for "watertight" status confirmation',
      ],
      solidworks: [
        'Run Import Diagnostics to detect surface gaps',
        'Click "Attempt to Heal All" for automatic repair',
        'For remaining gaps: Insert → Surface → Knit Surface',
        'Fill large holes: Insert → Surface → Fill Surface',
        'Delete unwanted holes: select face → Delete Face → Fill',
        'Verify solid body in Feature Manager Design Tree',
      ],
      freecad: [
        'Use Part → Check Geometry to find open edges',
        'In Mesh workbench: Mesh → Fill Hole, select boundary',
        'For surface model: Part → Shape Builder → Fill gaps',
        'Validate: Part → Check Geometry → should show "valid"',
        'If still open: export as STL, use Mesh → Evaluate & Repair',
        'Re-import repaired mesh and verify watertight status',
      ],
      blender: [
        'Enter Edit Mode → Select → All by Trait → Non Manifold',
        'Boundary edges will be highlighted around holes',
        'Select the hole boundary edges, press F to create face',
        'For complex holes: use Grid Fill (Ctrl+F → Grid Fill)',
        'Smooth new faces: select, Right-click → Smooth Faces',
        '3D Print Toolbox → Check All to confirm no remaining holes',
      ],
    },
    generic: {
      fusion360: [
        'Select the affected region in the model',
        'Use Inspect → Section Analysis to understand the geometry',
        'Apply appropriate fix: Modify → Press Pull, Fillet, or Shell',
        'Reference the specific dimensions from the analysis report',
        'Validate changes with Inspect → Interference check',
        'Re-export and re-analyze in Dynaxor to confirm improvement',
      ],
      solidworks: [
        'Locate the flagged region in the Feature Manager tree',
        'Edit the relevant feature or add a new one to address the issue',
        'Use appropriate tools: Boss/Base, Cut, Fillet, Shell, or Draft',
        'Apply exact dimensions from the analysis report',
        'Run Evaluate → Check Entity to validate geometry',
        'Re-export and re-analyze in Dynaxor to verify the fix',
      ],
      freecad: [
        'Find the affected area in the Model tree',
        'Use Part Design tools: Pad, Pocket, Fillet, or Chamfer',
        'Apply dimensions from the Dynaxor analysis report',
        'Check Geometry after each modification',
        'Use Undo (Ctrl+Z) if geometry becomes invalid',
        'Re-export and re-analyze to confirm improvement',
      ],
      blender: [
        'Select the affected mesh region in Edit Mode',
        'Apply appropriate fix using Extrude, Bevel, or Loop Cut',
        'Reference exact dimensions from the analysis report',
        'Use Mesh → Clean Up tools after modifications',
        'Check with 3D Print Toolbox for remaining issues',
        'Re-export and re-analyze in Dynaxor to verify the fix',
      ],
    },
  };

  return steps[issueType]?.[softwareId] || steps.generic[softwareId] || [];
}

interface CADFixInstructionsProps {
  annotation: Annotation;
  pythonGeo?: PythonGeoData | null;
  stlData?: STLData | null;
}

export default function CADFixInstructions({ annotation, pythonGeo, stlData }: CADFixInstructionsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedSoftware, setSelectedSoftware] = useState<string | null>(null);

  const issueType = classifyIssue(annotation.title, annotation.problem);
  const dims = pythonGeo?.dimensions_mm || (stlData ? { x: stlData.boundingBox.width, y: stlData.boundingBox.height, z: stlData.boundingBox.depth } : null);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center justify-between rounded-lg border border-border/30 bg-secondary/30 px-3 py-2 hover:bg-secondary/50 transition-colors">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Wrench className="w-3 h-3 text-primary" /> How to Fix in CAD
          </span>
          {isOpen ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 space-y-2">
          {/* Software selector */}
          <div className="flex gap-1.5">
            {CAD_SOFTWARE.map(sw => (
              <button
                key={sw.id}
                onClick={() => setSelectedSoftware(sw.id)}
                className={`flex-1 text-center rounded-lg py-2 px-1 text-[10px] font-medium transition-all border ${
                  selectedSoftware === sw.id
                    ? 'bg-primary/15 border-primary/40 text-primary'
                    : 'border-border/30 text-muted-foreground hover:border-border/50 hover:text-foreground'
                }`}
              >
                <span className="block text-lg mb-0.5">{sw.icon}</span>
                {sw.name}
              </button>
            ))}
          </div>

          {/* Steps */}
          {selectedSoftware && (
            <div className="rounded-lg border border-border/30 bg-card p-3 space-y-2 animate-slide-up">
              <p className="text-[10px] font-bold text-primary uppercase tracking-wider">
                {CAD_SOFTWARE.find(s => s.id === selectedSoftware)?.name} — Step by Step
              </p>
              {getFixSteps(issueType, selectedSoftware, dims).map((step, i) => (
                <div key={i} className="flex items-start gap-2 text-[11px]">
                  <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <span className="text-foreground/80 leading-relaxed">{step}</span>
                </div>
              ))}
            </div>
          )}

          {!selectedSoftware && (
            <p className="text-[10px] text-muted-foreground text-center py-2">Select your CAD software above to see fix instructions</p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
