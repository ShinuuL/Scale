import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const TITLE = 'Nova versão disponível';

async function load(version: string) {
  vi.stubEnv('NEXT_PUBLIC_BUILD_ID', 'build-a');
  vi.resetModules();
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version }) });
  vi.stubGlobal('fetch', fetchMock);
  const reload = vi.fn();
  vi.stubGlobal('location', { ...window.location, reload });
  const mod = await import('./UpdatePrompt');
  render(<mod.UpdatePrompt />);
  return { fetchMock, reload, mod };
}

function setCall(active: boolean) {
  act(() => { window.dispatchEvent(new CustomEvent('scale:call-state', { detail: { active } })); });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.scaleCallActive;
});

describe('UpdatePrompt', () => {
  it('mesma versão: não mostra nada', async () => {
    const { fetchMock } = await load('build-a');
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledWith('/version.json', expect.objectContaining({ cache: 'no-store' }));
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it('versão nova: pede para recarregar a página', async () => {
    const { reload } = await load('build-b');
    expect(await screen.findByText(TITLE)).toBeTruthy();
    expect(screen.getByText('Recarregue a página para atualizar.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Recarregar' }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it('em chamada: recarrega só quando a chamada termina', async () => {
    const { reload } = await load('build-b');
    await screen.findByText(TITLE);
    setCall(true);
    expect(screen.getByText(/Recarregar agora encerra a chamada/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Recarregar ao sair da chamada' }));
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(reload).not.toHaveBeenCalled();
    setCall(false);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('chamada já ativa antes de montar é detectada', async () => {
    document.documentElement.dataset.scaleCallActive = 'true';
    await load('build-b');
    await screen.findByText(TITLE);
    expect(screen.getByRole('button', { name: 'Recarregar ao sair da chamada' })).toBeTruthy();
  });

  it('"Depois" adia o aviso, que volta após o intervalo', async () => {
    const { mod } = await load('build-b');
    await screen.findByText(TITLE);
    fireEvent.click(screen.getByRole('button', { name: 'Depois' }));
    expect(screen.queryByText(TITLE)).toBeNull();
    const later = Date.now() + mod.SNOOZE_MS + 1;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(await screen.findByText(TITLE)).toBeTruthy();
  });

  it('reconhece erro de chunk de deploy novo', async () => {
    const { mod } = await load('build-a');
    expect(mod.isChunkError(Object.assign(new Error('Loading chunk 12 failed.'), { name: 'ChunkLoadError' }))).toBe(true);
    expect(mod.isChunkError(new TypeError('Failed to fetch dynamically imported module: /x.js'))).toBe(true);
    expect(mod.isChunkError(new Error('boom'))).toBe(false);
  });
});
