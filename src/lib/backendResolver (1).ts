// Finds the CAD / FEA backend's address and survives it changing. No imports on purpose, so it can be unit-tested
// without Supabase or the browser (see backendResolver.test.ts). The app uses the wired-up instance in backendUrl.ts.
//
// The backend runs on a tablet behind a Cloudflare quick tunnel, so its address changes every time the tunnel
// restarts. start_all.sh / tunnel.sh publish the current address to Supabase; this reads it back.
// A fixed VITE_BACKEND_URL still works as the fallback (Render, a VPS, localhost, or Supabase unreachable).

export interface ResolverDeps {
  /** Returns the address the backend last registered, or null when there is none / it can't be read. Must not throw. */
  readRegistry: () => Promise<string | null>;
  /** Build-time fallback, normally import.meta.env.VITE_BACKEND_URL. */
  envUrl?: string;
  fetchFn?: (input: string, init?: RequestInit) => Promise<Response>;
  now?: () => number;
  /** How long a resolved address is trusted before the registry is read again. */
  freshMs?: number;
  /** After a failure, the registry is re-read at most this often, so a dead backend isn't hammered. */
  minRetryMs?: number;
}

/** Cloudflare answers 530 when a quick tunnel no longer exists, i.e. the address is stale. The request never reached the backend. */
const TUNNEL_GONE = 530;

/** Accepts http(s)://host[:port][/prefix] and strips trailing slashes; anything else (spaces, query, other schemes) is null. */
export function cleanBackendUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s?#]+$/i.test(s) ? s : null;
}

const isAbort = (e: unknown) => typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'AbortError';

export function createBackendResolver(deps: ResolverDeps) {
  const now = deps.now ?? (() => Date.now());
  const doFetch = deps.fetchFn ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const freshMs = deps.freshMs ?? 60_000;
  const minRetryMs = deps.minRetryMs ?? 5_000;
  const envUrl = cleanBackendUrl(deps.envUrl);

  let cache: { url: string; at: number } | null = null;
  let inflight: Promise<string> | null = null;
  let lastForced = -Infinity;

  /** The backend's current address: the registered one, else the last good one, else VITE_BACKEND_URL. */
  function getBackendUrl(opts: { force?: boolean } = {}): Promise<string> {
    if (!opts.force && cache && now() - cache.at < freshMs) return Promise.resolve(cache.url);
    if (inflight) return inflight;
    inflight = (async () => {
      const registered = cleanBackendUrl(await deps.readRegistry());
      const url = registered ?? cache?.url ?? envUrl;
      if (!url) {
        throw new Error('The backend address is not set. Start the backend (start_all.sh) so it can register itself, or set VITE_BACKEND_URL.');
      }
      cache = { url, at: now() };
      return url;
    })().finally(() => { inflight = null; });
    return inflight;
  }

  /**
   * fetch() against the backend. If the request fails to connect (or gets Cloudflare's 530) it looks the address up again and,
   * when the tunnel has moved, retries once on the new address. Aborts and ordinary HTTP errors are never retried.
   */
  async function backendFetch(path: string, init?: RequestInit): Promise<Response> {
    const base = await getBackendUrl();
    let first: Response | undefined;
    let failure: unknown;
    try {
      first = await doFetch(`${base}${path}`, init);
      if (first.status !== TUNNEL_GONE) return first;
    } catch (e) {
      if (isAbort(e)) throw e;
      failure = e;
    }
    const giveUp = (): Response => { if (first) return first; throw failure; };

    if (now() - lastForced < minRetryMs) return giveUp();
    lastForced = now();
    let fresh = base;
    try { fresh = await getBackendUrl({ force: true }); } catch { /* keep the old address */ }
    if (fresh === base) return giveUp();
    return doFetch(`${fresh}${path}`, init);
  }

  function reset() { cache = null; inflight = null; lastForced = -Infinity; }

  return { getBackendUrl, backendFetch, reset };
}
