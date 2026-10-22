import { useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, FileCode2, Sparkles, Upload } from 'lucide-react';
import { toast } from 'sonner';

// What the person picked when they tapped "Generate STL" on a micro part.
//  - 'ai':     the existing flow — Lumexa's LLM writes the build123d script and refines it (AI + FEA loop).
//  - 'script': run a build123d file the person supplies (no LLM): sandbox -> geometry checks -> FEA, once.
export type StlGenerateChoice =
  | { mode: 'ai' }
  | {
      mode: 'script';
      script: string;
      forceN: number;
      forceDir: 'x' | 'y' | 'z';
      testPlanJson?: string;
    };

const MAX_FILE_BYTES = 200_000; // matches the backend's 200 KB cap

interface Props {
  open: boolean;
  partName: string;
  onClose: () => void;
  onChoose: (choice: StlGenerateChoice) => void;
}

export default function GenerateStlDialog({ open, partName, onClose, onChoose }: Props) {
  const [view, setView] = useState<'choose' | 'script'>('choose');
  const [script, setScript] = useState('');
  const [scriptName, setScriptName] = useState('');
  const [forceN, setForceN] = useState('1000');
  const [forceDir, setForceDir] = useState<'x' | 'y' | 'z'>('z');
  const [planText, setPlanText] = useState('');
  const [planName, setPlanName] = useState('');
  const scriptInput = useRef<HTMLInputElement>(null);
  const planInput = useRef<HTMLInputElement>(null);

  const reset = () => {
    setView('choose');
    setScript('');
    setScriptName('');
    setForceN('1000');
    setForceDir('z');
    setPlanText('');
    setPlanName('');
  };

  const close = () => {
    reset();
    onClose();
  };

  const readFile = async (file: File, kind: 'script' | 'plan') => {
    if (file.size > MAX_FILE_BYTES) {
      toast.error(`That file is ${Math.round(file.size / 1024)} KB — the limit is 200 KB.`);
      return;
    }
    const text = await file.text();
    if (kind === 'script') {
      setScript(text);
      setScriptName(file.name);
    } else {
      setPlanText(text);
      setPlanName(file.name);
    }
  };

  const runScript = () => {
    if (!script.trim()) {
      toast.error('Add a build123d file (or paste the code) first.');
      return;
    }
    const n = Number(forceN);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error('Load must be a positive number of newtons.');
      return;
    }
    let planJson: string | undefined;
    if (planText.trim()) {
      try {
        JSON.parse(planText);
      } catch {
        toast.error('The test plan is not valid JSON.');
        return;
      }
      planJson = planText;
    }
    onChoose({ mode: 'script', script, forceN: n, forceDir, testPlanJson: planJson });
    reset();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto border-border/30" style={{ background: '#0d0d0d' }}>
        {view === 'choose' ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-base">Generate STL</DialogTitle>
              <DialogDescription className="text-xs">{partName}</DialogDescription>
            </DialogHeader>

            <div className="space-y-3 pt-1">
              <button
                type="button"
                onClick={() => { onChoose({ mode: 'ai' }); reset(); }}
                className="w-full text-left rounded-lg border border-primary/30 p-4 hover:border-primary/60 transition-colors"
                style={{ background: '#0a0a0a' }}
              >
                <div className="flex items-center gap-2 font-medium text-sm">
                  <Sparkles className="w-4 h-4 text-primary" /> Make Lumexa do it
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  Lumexa writes the build123d code itself, runs the FEA, and self-corrects. Takes a few minutes.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setView('script')}
                className="w-full text-left rounded-lg border border-border/30 p-4 hover:border-primary/40 transition-colors"
                style={{ background: '#0a0a0a' }}
              >
                <div className="flex items-center gap-2 font-medium text-sm">
                  <FileCode2 className="w-4 h-4 text-primary" /> Give the build123d code file
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  Upload your own script. It runs through the same sandbox and analysis once, with no AI, and you can
                  download the results if it doesn&apos;t pass.
                </p>
              </button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-base flex items-center gap-2">
                <button type="button" onClick={() => setView('choose')} aria-label="Back" className="text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="w-4 h-4" />
                </button>
                Use my build123d file
              </DialogTitle>
              <DialogDescription className="text-xs">{partName}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4 pt-1">
              <div className="space-y-2">
                <Label className="text-xs">build123d script (.py)</Label>
                <input
                  ref={scriptInput}
                  type="file"
                  accept=".py,.txt,text/x-python,text/plain"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f, 'script'); e.target.value = ''; }}
                />
                <Button type="button" variant="outline" size="sm" className="w-full text-xs h-9" onClick={() => scriptInput.current?.click()}>
                  <Upload className="w-3.5 h-3.5 mr-1.5" />
                  {scriptName ? scriptName : 'Choose file'}
                </Button>
                <Textarea
                  value={script}
                  onChange={(e) => { setScript(e.target.value); if (scriptName) setScriptName(''); }}
                  placeholder={'…or paste the code here.\nIt must assign the final solid to `result`.'}
                  className="font-mono text-xs min-h-[120px]"
                  spellCheck={false}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs" htmlFor="force-n">Load (N)</Label>
                  <Input id="force-n" inputMode="decimal" value={forceN} onChange={(e) => setForceN(e.target.value)} className="h-9 text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Direction</Label>
                  <div className="flex gap-1.5">
                    {(['x', 'y', 'z'] as const).map((d) => (
                      <Button
                        key={d}
                        type="button"
                        size="sm"
                        variant={forceDir === d ? 'default' : 'outline'}
                        className="h-9 flex-1 text-xs uppercase"
                        onClick={() => setForceDir(d)}
                      >
                        {d}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Test plan (.json) — optional</Label>
                <input
                  ref={planInput}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f, 'plan'); e.target.value = ''; }}
                />
                <Button type="button" variant="outline" size="sm" className="w-full text-xs h-9" onClick={() => planInput.current?.click()}>
                  <Upload className="w-3.5 h-3.5 mr-1.5" />
                  {planName ? planName : 'Choose test plan'}
                </Button>
                <p className="text-[11px] text-muted-foreground/70">
                  Without a plan, one simple load case is used. With a plan, static, buckling and thermal tests run as
                  real FEM on the faces it selects.
                </p>
              </div>

              <Button type="button" className="w-full" onClick={runScript}>
                Run analysis
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
