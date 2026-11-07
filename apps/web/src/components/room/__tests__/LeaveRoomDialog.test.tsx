import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LeaveRoomDialog } from '../LeaveRoomDialog';

describe('confirmação de saída da chamada', () => {
  it('apenas confirma a saída após a ação explícita e permite cancelar com Escape', () => {
    const leave = vi.fn();
    const cancel = vi.fn();
    render(<LeaveRoomDialog onCancel={cancel} onLeave={leave} />);
    const dialog = screen.getByRole('dialog', { name: 'Sair da sala?' });
    expect(leave).not.toHaveBeenCalled();
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(cancel).toHaveBeenCalledOnce();
    expect(leave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Sair da sala' }));
    expect(leave).toHaveBeenCalledOnce();
  });

  it('devolve o foco ao controle que abriu a confirmação', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const { unmount } = render(<LeaveRoomDialog onCancel={() => {}} onLeave={() => {}} />);
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
