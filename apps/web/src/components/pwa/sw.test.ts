// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type FetchEvent = { request: Request; respondWith: (response: Promise<Response>) => void };

function worker() {
  const listeners = new Map<string, (event: FetchEvent) => void>();
  const stored = new Map<string, Response>();
  const put = vi.fn(async (request: Request | string, response: Response) => {
    stored.set(typeof request === 'string' ? request : request.url, response);
  });
  const cache = { put, match: async () => undefined, keys: async () => [], delete: vi.fn() };
  const fetchMock = vi.fn(async () => new Response('asset', { headers: { 'content-type': 'application/javascript' } }));
  runInNewContext(readFileSync(new URL('../../../public/sw.js', import.meta.url), 'utf8'), {
    self: { location: { origin: 'https://scale.test' }, addEventListener: (name: string, handler: (event: FetchEvent) => void) => listeners.set(name, handler) },
    caches: { open: async () => cache, match: async () => new Response('offline') },
    fetch: fetchMock, Request, Response, URL,
  });
  return {
    fetchMock, put, stored,
    request(path: string, options: RequestInit = {}, navigation = false) {
      let response: Promise<Response> | undefined;
      const request = new Request(`https://scale.test${path}`, options);
      if (navigation) Object.defineProperty(request, 'mode', { value: 'navigate' });
      listeners.get('fetch')?.({ request, respondWith: (value) => { response = value; } });
      return response;
    },
  };
}

describe('public-only service worker', () => {
  it.each(['/api/rooms', '/api/files/a', '/api/auth/me', '/socket.io/?transport=polling', '/sw.js', '/room?id=ticket', '/_next/static/a-12345678.js?ticket=secret'])('bypasses sensitive and unversioned requests: %s', (path) => {
    const sw = worker();
    expect(sw.request(path)).toBeUndefined();
    expect(sw.fetchMock).not.toHaveBeenCalled();
    expect(sw.put).not.toHaveBeenCalled();
  });
  it.each(['/api/files/a', '/api/auth/me', '/socket.io/', '/sw.js'])('bypasses sensitive navigations: %s', (path) => {
    const sw = worker();
    expect(sw.request(path, {}, true)).toBeUndefined();
    expect(sw.fetchMock).not.toHaveBeenCalled();
  });
  it('uses only the generic offline document on failed page navigation and never caches HTML', async () => {
    const sw = worker();
    sw.fetchMock.mockRejectedValue(new Error('offline'));
    const response = await sw.request('/room?id=private', {}, true);
    expect(await response?.text()).toBe('offline');
    expect(sw.put).not.toHaveBeenCalled();
  });
  it.each(['authorization', 'x-room-ticket'])('bypasses requests carrying %s', (header) => {
    const sw = worker();
    expect(sw.request('/_next/static/app-12345678.js', { headers: { [header]: 'secret' } })).toBeUndefined();
    expect(sw.put).not.toHaveBeenCalled();
  });
  it('fetches hash assets without cookies and stores only their public response', async () => {
    const sw = worker();
    await sw.request('/_next/static/app-12345678.js');
    expect(sw.fetchMock.mock.calls.length).toBe(1);
    const request = (sw.fetchMock.mock.calls as unknown as [Request][])[0][0];
    expect(request.credentials).toBe('omit');
    expect(sw.put).toHaveBeenCalledTimes(1);
  });
  it('recognizes Next CSS named only by its content hash', async () => {
    const sw = worker();
    sw.fetchMock.mockResolvedValue(new Response('css', { headers: { 'content-type': 'text/css' } }));
    await sw.request('/_next/static/css/0123456789abcdef.css');
    expect(sw.put).toHaveBeenCalledTimes(1);
  });
  it.each(['private', 'no-store'])('does not store %s even at a hashed public URL', async (cacheControl) => {
    const sw = worker();
    sw.fetchMock.mockResolvedValue(new Response('secret', { headers: { 'content-type': 'application/javascript', 'cache-control': cacheControl } }));
    await sw.request('/_next/static/app-12345678.js');
    expect(sw.put).not.toHaveBeenCalled();
  });
  it('does not store HTML disguised as an asset', async () => {
    const sw = worker();
    sw.fetchMock.mockResolvedValue(new Response('login', { headers: { 'content-type': 'text/html' } }));
    await sw.request('/_next/static/app-12345678.js');
    expect(sw.put).not.toHaveBeenCalled();
  });
  it('never forces updates into an existing call', () => {
    const source = readFileSync(new URL('../../../public/sw.js', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\.skipWaiting\s*\(/);
    expect(source).not.toMatch(/\.claim\s*\(/);
  });
});
