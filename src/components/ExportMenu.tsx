import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EXPORT_OPTIONS, ExportFormat, base64ToBlob, exportFromScript, saveBlob } from '@/lib/exportDesign';

interface Props {
  /** File name without extension, e.g. "bracket". */
  baseName: string;
  /** Object URL of the STL already shown in the preview (instant download). */
  stlUrl?: string | null;
  /** STEP the backend returned with the result (instant download). */
  stepBase64?: string | null;
  /** The design script; lets the backend build GLB / OBJ / BREP (and STEP if not supplied). */
  script?: string | null;
}

export default function ExportMenu({ baseName, stlUrl, stepBase64, script }: Props) {
  const [busy, setBusy] = useState<ExportFormat | null>(null);

  const available = (f: ExportFormat) =>
    (f === 'stl' && !!stlUrl) || (f === 'step' && !!stepBase64) || !!script;

  const run = async (f: ExportFormat) => {
    const filename = `${baseName}.${f}`;
    try {
      setBusy(f);
      if (f === 'stl' && stlUrl) {
        const blob = await (await fetch(stlUrl)).blob();
        saveBlob(blob, filename);
      } else if (f === 'step' && stepBase64) {
        saveBlob(base64ToBlob(stepBase64, 'model/step'), filename);
      } else if (script) {
        saveBlob(await exportFromScript(script, f), filename);
      } else {
        throw new Error('Regenerate this part to enable this format.');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-primary hover:text-primary gap-1">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Download
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="text-xs">Export (millimetres)</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {EXPORT_OPTIONS.map(o => (
          <DropdownMenuItem key={o.format} disabled={!available(o.format) || busy !== null} onSelect={() => run(o.format)}>
            <div className="flex flex-col">
              <span className="text-sm">{o.label}</span>
              <span className="text-[11px] text-muted-foreground">
                {available(o.format) ? o.hint : 'Regenerate to enable'}
              </span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
