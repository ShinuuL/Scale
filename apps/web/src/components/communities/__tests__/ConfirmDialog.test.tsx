import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../ConfirmDialog';

describe('ConfirmDialog', () => {
  it('exige o nome e mostra erro da sessão sem fechar', async () => {
    const close = vi.fn();
    const confirm = vi.fn().mockRejectedValue({ status: 401 });
    render(
      <ConfirmDialog
        title="Apagar?"
        description="Ação definitiva"
        confirmLabel="Apagar"
        requiredName="Equipe"
        onConfirm={confirm}
        onClose={close}
      />,
    );
    expect(screen.getByRole('alertdialog')).toHaveAccessibleDescription('Ação definitiva');
    const button = screen.getByRole('button', { name: 'Apagar' });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Digite Equipe para confirmar'), {
      target: { value: 'Equipe' },
    });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('sessão expirou'));
    expect(close).not.toHaveBeenCalled();
  });
  it('não fecha enquanto a ação está em andamento', async () => {
    let resolve!: () => void;
    const close = vi.fn();
    const pending = new Promise<void>((done) => {
      resolve = done;
    });
    render(
      <ConfirmDialog
        title="Sair?"
        description="Você sairá"
        confirmLabel="Sair"
        onConfirm={() => pending}
        onClose={close}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }));
    expect(screen.getByRole('button', { name: 'Aguarde...' })).toBeDisabled();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(close).not.toHaveBeenCalled();
    resolve();
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
  });
  it('informa limite de tentativas', async () => {
    render(
      <ConfirmDialog
        title="Sair?"
        description="Você sairá"
        confirmLabel="Sair"
        onConfirm={vi.fn().mockRejectedValue({ status: 429 })}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Muitas tentativas');
  });
});
