import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminModerationState } from '@scale/shared';
import AdminModerationPage from '../page';
import { api, type MeUser } from '@/lib/api';
import { takeFlash } from '@/lib/flash';
import { ADMIN_ONLY_FLASH } from '@/components/admin/moderationLabels';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));
vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children, accountSlot }: { children: ReactNode; accountSlot?: ReactNode }) => (
    <main>
      <div>{accountSlot}</div>
      <div>{children}</div>
    </main>
  ),
}));
vi.mock('@/components/ui/ProfileMenu', () => ({
  ProfileMenu: () => <button type="button">Minha conta</button>,
}));

const admin: MeUser = {
  id: 'ana',
  name: 'Ana',
  email: 'ana@example.test',
  createdAt: '2026-11-06T10:00:00.000Z',
  isAdmin: true,
};

function makeState(partial: Partial<AdminModerationState> = {}): AdminModerationState {
  return {
    effective: {
      provider: 'heuristic',
      screen: false,
      minAge: 18,
      consentVersion: '2026-11',
      frameIntervalSec: 20,
      privacyContactEmail: null,
      model: 'claude-opus-5-5',
      retentionDays: 90,
      hasApiKey: false,
      apiKeySource: 'none',
    },
    overrides: {
      provider: null,
      model: null,
      screenEnabled: null,
      frameIntervalSec: null,
      retentionDays: null,
      minAge: null,
      privacyContactEmail: null,
    },
    envDefaults: {
      provider: 'heuristic',
      model: 'claude-opus-5-5',
      screenEnabled: false,
      frameIntervalSec: 20,
      retentionDays: 90,
      minAge: 18,
      privacyContactEmail: null,
      hasApiKey: false,
    },
    updatedAt: null,
    updatedBy: null,
    ...partial,
  };
}

describe('/admin/moderation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    replace.mockReset();
    window.sessionStorage.clear();
    vi.spyOn(api, 'getAdminModerationAudit').mockResolvedValue({ entries: [] });
  });

  it('redireciona quem não é admin para a home com aviso', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValue({ user: { ...admin, isAdmin: false } });
    const getState = vi.spyOn(api, 'getAdminModeration');
    render(<AdminModerationPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(takeFlash()).toEqual({ message: ADMIN_ONLY_FLASH, variant: 'error' });
    expect(getState).not.toHaveBeenCalled();
    expect(screen.queryByText('Salvar')).toBeNull();
  });

  it('sem sessão vai para o login', async () => {
    vi.spyOn(api, 'getMe').mockRejectedValue({ status: 401 });
    render(<AdminModerationPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  });

  it('mostra "Usando .env" e salva só o campo alterado', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValue({ user: admin });
    vi.spyOn(api, 'getAdminModeration').mockResolvedValue(makeState());
    const update = vi.spyOn(api, 'updateAdminModeration').mockResolvedValue(
      makeState({ overrides: { ...makeState().overrides, retentionDays: 30 } }),
    );
    render(<AdminModerationPage />);

    expect(await screen.findByText('Usando .env: 90 dias')).toBeTruthy();
    expect(screen.getByText('Usando .env: Heurística local')).toBeTruthy();
    expect(screen.getByText(/Tudo o que é configurado aqui é exibido aos usuários/)).toBeTruthy();
    // A chave nunca volta do servidor: campo de senha vazio e status textual.
    const keyInput = screen.getByLabelText('Chave de API') as HTMLInputElement;
    expect(keyInput.type).toBe('password');
    expect(keyInput.value).toBe('');
    expect(screen.getByText(/^Sem chave\./)).toBeTruthy();

    const save = screen.getByRole('button', { name: 'Salvar' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Retenção dos eventos/), { target: { value: '30' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith({ retentionDays: 30 });
    expect(await screen.findByText(/Valor do painel \(sobrepõe o \.env: 90 dias\)/)).toBeTruthy();
  });

  it('"Voltar ao .env" envia null e o erro 400 cai no campo', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValue({ user: admin });
    vi.spyOn(api, 'getAdminModeration').mockResolvedValue(
      makeState({ overrides: { ...makeState().overrides, minAge: 16 } }),
    );
    const update = vi
      .spyOn(api, 'updateAdminModeration')
      .mockRejectedValue({ status: 400, error: 'screen_requires_claude', field: 'screenEnabled' });
    render(<AdminModerationPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Voltar ao .env (Idade mínima)' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Análise de tela ligada' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(update).toHaveBeenCalledWith({ minAge: null, screenEnabled: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A análise de tela exige o provedor Claude API.');
  });

  it('remover a chave pede confirmação antes de chamar o servidor', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValue({ user: admin });
    const withKey = makeState();
    withKey.effective = { ...withKey.effective, hasApiKey: true, apiKeySource: 'db' };
    vi.spyOn(api, 'getAdminModeration').mockResolvedValue(withKey);
    const del = vi.spyOn(api, 'deleteAdminModerationApiKey').mockResolvedValue(makeState());
    render(<AdminModerationPage />);

    expect(await screen.findByText(/Chave configurada \(banco\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remover chave' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Remover a chave de API?' });
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remover chave' }));
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/^Sem chave\./)).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('testa um texto e mostra o veredito ou o erro do provedor', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValue({ user: admin });
    vi.spyOn(api, 'getAdminModeration').mockResolvedValue(makeState());
    const test = vi
      .spyOn(api, 'testAdminModeration')
      .mockResolvedValueOnce({ flagged: true, category: 'hate', severity: 'high', reason: 'ataque a grupo' })
      .mockRejectedValueOnce({ status: 502, error: 'provider_error', detail: 'HTTP 401' });
    render(<AdminModerationPage />);

    const textarea = await screen.findByLabelText('Texto de teste');
    fireEvent.change(textarea, { target: { value: 'texto ruim' } });
    fireEvent.click(screen.getByRole('button', { name: 'Classificar' }));
    const result = await screen.findByRole('status', { name: 'Veredito' });
    expect(test).toHaveBeenCalledWith('texto ruim');
    expect(result).toHaveTextContent('Sinalizado');
    expect(result).toHaveTextContent('Ódio');
    expect(result).toHaveTextContent('Alta');
    expect(result).toHaveTextContent('ataque a grupo');

    fireEvent.click(screen.getByRole('button', { name: 'Classificar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Erro do provedor: HTTP 401.');
  });

  it('auditoria legível: apiKey como "definida", valores com rótulo', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValue({ user: admin });
    vi.spyOn(api, 'getAdminModeration').mockResolvedValue(makeState());
    vi.spyOn(api, 'getAdminModerationAudit').mockResolvedValue({
      entries: [
        {
          id: 'a1',
          admin: { id: 'ana', name: 'Ana' },
          createdAt: '2026-11-11T12:00:00.000Z',
          changes: { apiKey: { from: null, to: 'set' }, provider: { from: null, to: 'claude' } },
        },
      ],
    });
    render(<AdminModerationPage />);
    const table = await screen.findByRole('table');
    expect(table).toHaveTextContent('Ana');
    expect(table).toHaveTextContent('Chave de API: definida');
    expect(table).toHaveTextContent('Provedor: .env para Claude API');
  });
});
