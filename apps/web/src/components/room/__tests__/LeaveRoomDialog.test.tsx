import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LeaveRoomDialog } from '../LeaveRoomDialog';

describe('confirmação de saída da chamada', () => {
  it('apenas confirma a saída após a ação explícita e permite cancelar com Escape', () => {
    const leave = vi.fn();
    const cancel = vi.fn();
    render(<LeaveRoomDialog onCancel={cancel} onLeave={leave} />);
    const dialog = screen.getByRole('dialog', { name: 'Sair da sala?' });
    expect(leave).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(leave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Sair da sala' }));
    expect(leave).toHaveBeenCalledOnce();
  });

  it('devolve o foco ao controle que abriu a confirmação', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const { unmount } = render(<LeaveRoomDialog onCancel={() => {}} onLeave={() => {}} />);
    unmount();
    // react-aria devolve o foco no frame seguinte ao fechamento.
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    trigger.remove();
  });
});
