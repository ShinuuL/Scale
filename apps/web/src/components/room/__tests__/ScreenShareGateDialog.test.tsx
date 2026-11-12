import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SCREEN_SHARE_CONSENT_VERSION, type ModerationConfig, type ScreenShareGate } from '@scale/shared';
import { ScreenShareGateDialog, birthDateInputSchema } from '@/components/room/ScreenShareGateDialog';
import { api } from '@/lib/api';

const CONFIG: ModerationConfig = {
  provider: 'claude',
  screen: true,
  minAge: 18,
  consentVersion: SCREEN_SHARE_CONSENT_VERSION,
  frameIntervalSec: 20,
  privacyContactEmail: null,
};

const GUEST: ScreenShareGate = { ageVerified: false, isAdult: false, consentVersion: null, allowed: false, reason: 'guest' };
const NO_AGE: ScreenShareGate = { ...GUEST, reason: 'age' };
const NO_CONSENT: ScreenShareGate = { ageVerified: true, isAdult: true, consentVersion: null, allowed: false, reason: 'consent' };
const ALLOWED: ScreenShareGate = { ...NO_CONSENT, consentVersion: SCREEN_SHARE_CONSENT_VERSION, allowed: true, reason: 'ok' };

function renderGate(gate: ScreenShareGate, extra: Partial<React.ComponentProps<typeof ScreenShareGateDialog>> = {}) {
  const onGateChange = vi.fn();
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  render(
    <ScreenShareGateDialog gate={gate} config={CONFIG} onClose={onClose} onGateChange={onGateChange} onConfirm={onConfirm} {...extra} />,
  );
  return { onGateChange, onConfirm, onClose };
}

describe('ScreenShareGateDialog', () => {
  it('convidado: pede login e não chama toggleScreenShare', () => {
    const { onConfirm } = renderGate(GUEST);
    expect(screen.getByRole('dialog', { name: 'Compartilhar tela' })).toHaveTextContent(
      'Entre com uma conta para compartilhar a tela',
    );
    expect(screen.getByRole('link', { name: /Entrar/ })).toHaveAttribute('href', '/login');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('sem idade: valida a data, salva e avança para o termo; menor de idade vê o aviso', async () => {
    const setBirthDate = vi.spyOn(api, 'setBirthDate').mockResolvedValue({ ageVerified: true, isAdult: true });
    const { onGateChange } = renderGate(NO_AGE);
    screen.getByRole('dialog', { name: 'Verificar idade' });
    const input = screen.getByLabelText('Data de nascimento');
    fireEvent.change(input, { target: { value: '2999-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A data não pode ser no futuro.');
    expect(setBirthDate).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '1990-05-20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    await waitFor(() => expect(setBirthDate).toHaveBeenCalledWith('1990-05-20'));
    await waitFor(() =>
      expect(onGateChange).toHaveBeenCalledWith(
        expect.objectContaining({ ageVerified: true, isAdult: true, allowed: false, reason: 'consent' }),
      ),
    );

    // Menor de idade: o servidor responde isAdult=false e o dialogo bloqueia.
    render(
      <ScreenShareGateDialog gate={{ ...NO_AGE, ageVerified: true, isAdult: false, reason: 'age' }} config={CONFIG} onClose={() => {}} onGateChange={() => {}} onConfirm={() => {}} />,
    );
    expect(screen.getByRole('dialog', { name: 'Partilha de tela indisponível' })).toHaveTextContent(
      'Partilha de tela disponível a partir de 18 anos',
    );
  });

  it('sem consentimento: exige "Li e concordo", registra e muda para a confirmação; confirmar chama onConfirm', async () => {
    const consent = vi.spyOn(api, 'giveScreenShareConsent').mockResolvedValue(undefined);
    const { onGateChange, onConfirm } = renderGate(NO_CONSENT);
    const dialog = screen.getByRole('dialog', { name: 'Termo de partilha de tela' });
    expect(dialog).toHaveTextContent('amostras pequenas da sua tela também podem ser analisadas');
    expect(screen.getByRole('link', { name: 'política de privacidade' })).toHaveAttribute('href', '/privacy');
    const agree = screen.getByRole('button', { name: 'Concordar e continuar' });
    expect(agree).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Li e concordo' }));
    expect(agree).not.toBeDisabled();
    fireEvent.click(agree);
    await waitFor(() => expect(consent).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(onGateChange).toHaveBeenCalledWith(
        expect.objectContaining({ consentVersion: SCREEN_SHARE_CONSENT_VERSION, allowed: true, reason: 'ok' }),
      ),
    );
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('já liberado: confirmação curta com o lembrete da análise e onConfirm no clique', () => {
    const { onConfirm } = renderGate(ALLOWED);
    const dialog = screen.getByRole('dialog', { name: 'Confirmar partilha de tela' });
    expect(dialog).toHaveTextContent('analisadas pelo assistente de moderação');
    fireEvent.click(screen.getByRole('button', { name: /Compartilhar/ }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('já liberado sem análise de tela: não menciona o assistente', () => {
    renderGate(ALLOWED, { config: { ...CONFIG, screen: false } });
    expect(screen.getByRole('dialog')).not.toHaveTextContent('assistente');
  });
});

describe('birthDateInputSchema', () => {
  it('aceita AAAA-MM-DD real no passado e recusa formato, data impossível e futuro', () => {
    expect(birthDateInputSchema.safeParse('2000-02-29').success).toBe(true);
    expect(birthDateInputSchema.safeParse('20/05/1990').success).toBe(false);
    expect(birthDateInputSchema.safeParse('2001-02-30').success).toBe(false);
    expect(birthDateInputSchema.safeParse('2999-01-01').success).toBe(false);
    expect(birthDateInputSchema.safeParse('1800-01-01').success).toBe(false);
  });
});
