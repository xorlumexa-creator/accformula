// Download helpers for the CAD formats the backend can produce (see backend GET /export-formats).
// STEP / BREP are exact B-rep (open in FreeCAD, Fusion, SolidWorks...). STL / GLB / OBJ are meshes. All in mm.

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string | undefined;

export type ExportFormat = 'step' | 'stl' | 'glb' | 'obj' | 'brep';

export const EXPORT_OPTIONS: { format: ExportFormat; label: string; hint: string }[] = [
  { format: 'step', label: 'STEP (.step)', hint: 'Exact CAD solid, editable in any CAD tool' },
  { format: 'stl', label: 'STL (.stl)', hint: '3D printing' },
  { format: 'glb', label: 'GLB (.glb)', hint: 'Web, AR, Blender' },
  { format: 'obj', label: 'OBJ (.obj)', hint: 'Blender and most 3D tools' },
  { format: 'brep', label: 'BREP (.brep)', hint: 'OpenCascade native' },
];

export function base64ToBlob(b64: string, mime = 'application/octet-stream'): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Asks the backend to build `format` from the design script. Returns the file as a Blob. */
export async function exportFromScript(script: string, format: ExportFormat): Promise<Blob> {
  if (!BACKEND_URL) throw new Error('VITE_BACKEND_URL is not configured.');
  const form = new FormData();
  form.append('script', script);
  form.append('format', format);
  const res = await fetch(`${BACKEND_URL}/export`, { method: 'POST', body: form });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { const j = JSON.parse(text); msg = j.detail ?? j.error ?? text; } catch { /* raw text */ }
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  const data = JSON.parse(text);
  return base64ToBlob(data.base64, data.mime);
}
