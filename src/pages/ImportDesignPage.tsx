import { useState, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import {
  Upload, FileText, Image, ChevronRight, Lightbulb
} from 'lucide-react';

const cadSoftware = [
  'Fusion 360', 'Blender', 'SolidWorks', 'AutoCAD', 'CATIA',
  'Siemens NX', 'Onshape', 'FreeCAD', 'SketchUp', 'Inventor', 'Rhino', 'Tinkercad',
];

const exportGuidelines: Record<string, { steps: string[]; formats: string }> = {
  'Fusion 360': {
    steps: ['Open your design in Fusion 360', 'Go to File → Export', 'Choose STEP, IGES, or JSON format', 'Enable metadata export in settings', 'Save and upload the file here'],
    formats: 'STEP, IGES, JSON',
  },
  'Blender': {
    steps: ['Select your object in the viewport', 'Go to File → Export', 'Choose glTF, FBX, or JSON format', 'Enable geometry + hierarchy data export', 'Upload the exported file'],
    formats: 'glTF, FBX, JSON',
  },
  'SolidWorks': {
    steps: ['Open your part or assembly', 'Go to File → Save As', 'Select STEP or Parasolid format', 'Include feature tree data in export options', 'Upload the file here'],
    formats: 'STEP, Parasolid',
  },
  'AutoCAD': {
    steps: ['Open your drawing file', 'Go to File → Export → Other Formats', 'Select DXF, STEP, or IGES format', 'Configure export units and precision', 'Upload the exported file'],
    formats: 'DXF, STEP, IGES',
  },
  'CATIA': {
    steps: ['Open your CATPart or CATProduct', 'Go to File → Save As', 'Choose STEP AP214 or IGES format', 'Enable geometric and PMI data export', 'Upload the file here'],
    formats: 'STEP AP214, IGES',
  },
  'Siemens NX': {
    steps: ['Open your part in NX', 'Go to File → Export', 'Select STEP, JT, or Parasolid format', 'Configure tessellation quality settings', 'Upload the exported file'],
    formats: 'STEP, JT, Parasolid',
  },
  'Onshape': {
    steps: ['Open your document', 'Right-click the Part Studio tab', 'Select Export and choose STEP or STL', 'Configure resolution settings', 'Download and upload here'],
    formats: 'STEP, STL, Parasolid',
  },
  'FreeCAD': {
    steps: ['Open your model in FreeCAD', 'Go to File → Export', 'Select STEP, IGES, or STL format', 'Review mesh quality for STL exports', 'Upload the exported file'],
    formats: 'STEP, IGES, STL',
  },
  'SketchUp': {
    steps: ['Open your project in SketchUp', 'Go to File → Export → 3D Model', 'Choose STL, DAE, or FBX format', 'Set export units appropriately', 'Upload the file here'],
    formats: 'STL, DAE, FBX',
  },
  'Inventor': {
    steps: ['Open your part or assembly', 'Go to File → Export → CAD Format', 'Select STEP or IGES format', 'Include assembly structure data', 'Upload the exported file'],
    formats: 'STEP, IGES',
  },
  'Rhino': {
    steps: ['Open your model in Rhino', 'Go to File → Export Selected', 'Choose STEP, IGES, or 3DM format', 'Set tolerance and units', 'Upload the file here'],
    formats: 'STEP, IGES, 3DM',
  },
  'Tinkercad': {
    steps: ['Open your design in Tinkercad', 'Click Export in the top-right', 'Choose STL or OBJ format', 'Download the file to your computer', 'Upload it here'],
    formats: 'STL, OBJ',
  },
};

const ACCEPTED_FILES = '.step,.stp,.iges,.igs,.stl,.json,.xml,.csv,.gltf,.glb,.fbx';
const ACCEPTED_IMAGES = 'image/png,image/jpeg,image/webp';

export default function ImportDesignPage() {
  const { toast } = useToast();
  const [software, setSoftware] = useState('');
  const [structuredData, setStructuredData] = useState('');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedImage, setUploadedImage] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);

  const guide = software ? exportGuidelines[software] : null;

  return (
    <div className="space-y-6 animate-slide-up max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center border-glow">
          <FileText className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold font-display tracking-wide">Import Design Data</h2>
          <p className="text-sm text-muted-foreground">Select your CAD software and export your design data</p>
        </div>
      </div>

      {/* Software Selection */}
      <Card className="glass-strong border-glow">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">Select CAD Software</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={software} onValueChange={setSoftware}>
            <SelectTrigger className="bg-background/50 border-border/50">
              <SelectValue placeholder="Select the software used to create your design" />
            </SelectTrigger>
            <SelectContent>
              {cadSoftware.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Dynamic Guideline Panel */}
      {guide && (
        <Card className="glass border-glow animate-slide-up">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Lightbulb className="w-4 h-4 text-primary" />
              <span className="uppercase tracking-wider text-muted-foreground">Export Guide — {software}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              {guide.steps.map((step, i) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <span className="text-foreground/80">{step}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 pt-2 text-xs text-muted-foreground">
              <ChevronRight className="w-3 h-3" />
              Supported formats: <span className="text-primary font-medium">{guide.formats}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Data Input Area */}
      <Card className="glass-strong border-glow">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">Design Data Input</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm text-muted-foreground mb-1.5 block">Structured Data</label>
            <Textarea
              value={structuredData}
              onChange={(e) => setStructuredData(e.target.value)}
              placeholder="Paste structured data, JSON, STEP metadata, or exported design parameters here..."
              className="min-h-[140px] bg-background/50 border-border/50 font-mono text-xs"
              rows={8}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-3 p-4 rounded-lg bg-background/30 border border-dashed border-border/50 cursor-pointer hover:border-primary/30 hover:bg-primary/5 transition-all group"
            >
              <input ref={fileRef} type="file" accept={ACCEPTED_FILES} className="hidden" onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setUploadedFile(f);
              }} />
              <Upload className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{uploadedFile ? uploadedFile.name : 'Upload Design File'}</p>
                <p className="text-xs text-muted-foreground">STEP, IGES, STL, JSON, XML, CSV, glTF, FBX</p>
              </div>
            </div>

            <div
              onClick={() => imageRef.current?.click()}
              className="flex items-center gap-3 p-4 rounded-lg bg-background/30 border border-dashed border-border/50 cursor-pointer hover:border-primary/30 hover:bg-primary/5 transition-all group"
            >
              <input ref={imageRef} type="file" accept={ACCEPTED_IMAGES} className="hidden" onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setUploadedImage(f);
              }} />
              <Image className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{uploadedImage ? uploadedImage.name : 'Attach Screenshot'}</p>
                <p className="text-xs text-muted-foreground">PNG, JPEG, WebP design previews</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
