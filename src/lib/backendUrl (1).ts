// The app's single door to the CAD / FEA backend. Use backendFetch('/path', init) instead of fetch(`${VITE_BACKEND_URL}/path`).
// See backendResolver.ts for how the address is found and refreshed.
import { supabase } from '@/integrations/supabase/client';
import { createBackendResolver } from '@/lib/backendResolver';

async function readRegistry(): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('lumexa_get_backend');
    return error ? null : (data as string | null);
  } catch {
    return null;
  }
}

const backend = createBackendResolver({
  readRegistry,
  envUrl: import.meta.env.VITE_BACKEND_URL as string | undefined,
});

/** Resolves to the backend's address, or rejects with a readable message when none is configured. */
export const getBackendUrl = backend.getBackendUrl;
/** fetch() against the backend; follows the tunnel if it moved. */
export const backendFetch = backend.backendFetch;
/** Forget the cached address (e.g. after sign-out). */
export const resetBackendUrl = backend.reset;
