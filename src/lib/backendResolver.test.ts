import { describe, it, expect } from 'vitest';
import { cleanBackendUrl, createBackendResolver } from './backendResolver';

const ok = (body = '{}', status = 200) => new Response(body, { status });

function make(opts: { registry: (string | null)[]; env?: string; fetchImpl: (url: string) => Promise<Response> | Response }) {
  const calls: string[] = [];
  let reads = 0;
  let clock = 0;
  const r = createBackendResolver({
    readRegistry: async () => opts.registry[Math.min(reads++, opts.registry.length - 1)],
    envUrl: opts.env,
    fetchFn: async (url) => { calls.push(url); return opts.fetchImpl(url); },
    now: () => clock,
    freshMs: 60_000,
    minRetryMs: 5_000,
  });
  return { r, calls, reads: () => reads, tick: (ms: number) => { clock += ms; } };
}

describe('cleanBackendUrl', () => {
  it('keeps a clean origin and strips trailing slashes', () => {
    expect(cleanBackendUrl(' https://a-b.trycloudflare.com/ ')).toBe('https://a-b.trycloudflare.com');
  });
  it('rejects junk', () => {
    expect(cleanBackendUrl('javascript:alert(1)')).toBe(null);
    expect(cleanBackendUrl('https://x.com/?a=1')).toBe(null);
    expect(cleanBackendUrl('')).toBe(null);
    expect(cleanBackendUrl(null)).toBe(null);
  });
});

describe('getBackendUrl', () => {
  it('prefers the registered address over the build-time one', async () => {
    const { r } = make({ registry: ['https://new.trycloudflare.com'], env: 'https://old.example.com', fetchImpl: () => ok() });
    expect(await r.getBackendUrl()).toBe('https://new.trycloudflare.com');
  });
  it('falls back to VITE_BACKEND_URL when nothing is registered', async () => {
    const { r } = make({ registry: [null], env: 'https://fixed.example.com/', fetchImpl: () => ok() });
    expect(await r.getBackendUrl()).toBe('https://fixed.example.com');
  });
  it('rejects with a readable message when nothing is configured', async () => {
    const { r } = make({ registry: [null], fetchImpl: () => ok() });
    await expect(r.getBackendUrl()).rejects.toThrow('backend address is not set');
  });
  it('caches within the fresh window and re-reads after it', async () => {
    const { r, reads, tick } = make({ registry: ['https://a.trycloudflare.com', 'https://b.trycloudflare.com'], fetchImpl: () => ok() });
    expect(await r.getBackendUrl()).toBe('https://a.trycloudflare.com');
    expect(await r.getBackendUrl()).toBe('https://a.trycloudflare.com');
    expect(reads()).toBe(1);
    tick(61_000);
    expect(await r.getBackendUrl()).toBe('https://b.trycloudflare.com');
  });
  it('keeps the last good address if the registry later cannot be read', async () => {
    const { r, tick } = make({ registry: ['https://a.trycloudflare.com', null], env: 'https://stale.example.com', fetchImpl: () => ok() });
    await r.getBackendUrl();
    tick(61_000);
    expect(await r.getBackendUrl()).toBe('https://a.trycloudflare.com');
  });
});

describe('backendFetch', () => {
  it('calls the resolved address with the path', async () => {
    const { r, calls } = make({ registry: ['https://a.trycloudflare.com'], fetchImpl: () => ok() });
    await r.backendFetch('/capacity');
    expect(calls[0]).toBe('https://a.trycloudflare.com/capacity');
  });
  it('follows the tunnel to its new address after a network failure', async () => {
    const { r, calls } = make({
      registry: ['https://dead.trycloudflare.com', 'https://live.trycloudflare.com'],
      fetchImpl: (url) => { if (url.startsWith('https://dead')) throw new TypeError('Failed to fetch'); return ok('{"fine":true}'); },
    });
    const res = await r.backendFetch('/job/1');
    expect(await res.text()).toBe('{"fine":true}');
    expect(calls[1]).toBe('https://live.trycloudflare.com/job/1');
  });
  it('follows the tunnel after Cloudflare answers 530', async () => {
    const { r, calls } = make({
      registry: ['https://dead.trycloudflare.com', 'https://live.trycloudflare.com'],
      fetchImpl: (url) => (url.startsWith('https://dead') ? ok('gone', 530) : ok('{}')),
    });
    const res = await r.backendFetch('/capacity');
    expect(res.status).toBe(200);
    expect(calls.length).toBe(2);
  });
  it('does not retry a normal HTTP error', async () => {
    const { r, calls } = make({ registry: ['https://a.trycloudflare.com'], fetchImpl: () => ok('boom', 500) });
    const res = await r.backendFetch('/x');
    expect(res.status).toBe(500);
    expect(calls.length).toBe(1);
  });
  it('does not retry an abort', async () => {
    const { r, calls } = make({
      registry: ['https://a.trycloudflare.com', 'https://b.trycloudflare.com'],
      fetchImpl: () => { throw new DOMException('aborted', 'AbortError'); },
    });
    await expect(r.backendFetch('/x')).rejects.toThrow('aborted');
    expect(calls.length).toBe(1);
  });
  it('rethrows the original error when the address has not moved', async () => {
    const { r, calls } = make({
      registry: ['https://a.trycloudflare.com'],
      fetchImpl: () => { throw new TypeError('Failed to fetch'); },
    });
    await expect(r.backendFetch('/x')).rejects.toThrow('Failed to fetch');
    expect(calls.length).toBe(1);
  });
});
