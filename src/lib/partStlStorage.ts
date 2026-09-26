import { supabase } from '@/integrations/supabase/client';

// Generated STL files now live in the "part-stl-files" Storage bucket instead of the
// project_parts.stl_base64 text column. A Postgres text column is a poor fit for binary
// payloads — it doesn't compress, bloats the free-tier 500MB database quota fast, and every
// read/write round-trips the full base64 string through Postgres. Storage is built for this.
//
// Path convention: "{user_id}/{part_id}.stl" — the bucket's RLS policies (see the
// add_parts_stl_storage_bucket migration) key off the first path segment matching
// auth.uid(), mirroring the same "owner can only touch their own rows" pattern the other
// tables enforce via a user_id column. The bucket is private, so reading a file back needs a
// signed URL (see getPartStlSignedUrl), not a public URL.
//
// stl_base64 is left in the schema, read-only, purely so any part saved before this change
// keeps working without a data migration — see loadStlUrlForPart below.

const BUCKET = 'part-stl-files';

function storagePathFor(userId: string, partId: string): string {
  return `${userId}/${partId}.stl`;
}

/** Decodes a base64 STL payload and uploads it, returning the storage path to save on the row. */
export async function uploadPartStl(userId: string, partId: string, base64: string): Promise<string> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const path = storagePathFor(userId, partId);
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: 'application/octet-stream',
    upsert: true, // regenerating a part's STL overwrites the previous file at the same path
  });
  if (error) throw error;
  return path;
}

/** Signed URLs are short-lived by design (the bucket is private) — get a fresh one each time
 *  a preview is opened rather than caching it long-term.
 *
 *  `downloadFilename` sets Content-Disposition on the signed URL's response so the existing
 *  `<a download>` link still forces a save-as with a sensible name for a cross-origin Storage
 *  URL (the browser only honors the `download` attribute for same-origin URLs; Storage URLs
 *  are a different origin). This header only affects direct navigation to the URL — the
 *  three.js STLLoader reads the same URL's bytes via fetch/XHR regardless, so one signed URL
 *  safely serves both the 3D preview and the download link. */
export async function getPartStlSignedUrl(
  path: string,
  opts: { expiresInSeconds?: number; downloadFilename?: string } = {}
): Promise<string> {
  const { expiresInSeconds = 3600, downloadFilename } = opts;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(
    path,
    expiresInSeconds,
    downloadFilename ? { download: downloadFilename } : undefined
  );
  if (error || !data?.signedUrl) throw error ?? new Error('Could not create a signed URL for this STL file.');
  return data.signedUrl;
}

export async function deletePartStl(path: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}
