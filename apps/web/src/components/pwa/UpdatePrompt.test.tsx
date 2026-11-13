import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

async function load(version: string) {
  vi.stubEnv('NEXT_PUBLIC_BUILD_ID', 'build-a');
  vi.resetModules();
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version }) });
  vi.stubGlobal('fetch', fetchMock);
  const { UpdatePrompt } = await import('./UpdatePrompt');
  render(<UpdatePrompt />);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('UpdatePrompt', () => {
  it('mesma versão: não mostra nada', async () => {
    const fetchMock = await load('build-a');
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledWith('/version.json', expect.objectContaining({ cache: 'no-store' }));
    expect(screen.queryByText('Nova versão do Scale disponível.')).toBeNull();
  });

  it('versão nova: pede reload e avisa se há chamada', async () => {
    await load('build-b');
    expect(await screen.findByText('Nova versão do Scale disponível.')).toBeTruthy();
    act(() => { window.dispatchEvent(new CustomEvent('scale:call-state', { detail: { active: true } })); });
    expect(screen.getByText('Recarregar agora encerra a chamada atual.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Recarregar' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Depois' }));
    expect(screen.queryByText('Nova versão do Scale disponível.')).toBeNull();
  });
});
