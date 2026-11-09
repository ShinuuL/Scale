import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { DeleteRoomDialog } from '@/components/room/DeleteRoomDialog';
import { RoomCard } from '@/components/room/RoomCard';
import { api } from '@/lib/api';
import type { RoomListItem } from '@/lib/validation';

const ROOM_ID = '11111111-1111-4111-8111-111111111111';

function Harness({ onDeleted = () => {} }: { onDeleted?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Abrir
      </button>
      {open && (
        <DeleteRoomDialog
          roomId={ROOM_ID}
          roomName="Reuniao"
          onCancel={() => setOpen(false)}
          onDeleted={() => {
            setOpen(false);
            onDeleted();
          }}
        />
      )}
    </>
  );
}

function openDialog(): HTMLElement {
  const trigger = screen.getByRole('button', { name: 'Abrir' });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
}

describe('DeleteRoomDialog', () => {
  it('abre como alertdialog com o texto de confirmacao e foco no Cancelar', () => {
    render(<Harness />);
    openDialog();
    const dialog = screen.getByRole('alertdialog', { name: 'Apagar a sala Reuniao?' });
    expect(dialog).toHaveTextContent(
      'Todos saem da chamada e as mensagens e arquivos são apagados para sempre.',
    );
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();
  });

  it('Cancelar fecha sem chamar a API e devolve o foco ao gatilho', async () => {
    const spy = vi.spyOn(api, 'deleteRoom');
    render(<Harness />);
    const trigger = openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('Esc cancela', () => {
    render(<Harness />);
    openDialog();
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('Tab fica preso dentro do dialogo', () => {
    render(<Harness />);
    openDialog();
    screen.getByRole('button', { name: 'Apagar sala' }).focus();
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();
  });

  it('confirmar chama a API, mostra carregando e conclui', async () => {
    let resolve: () => void = () => {};
    const spy = vi.spyOn(api, 'deleteRoom').mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    const onDeleted = vi.fn();
    render(<Harness onDeleted={onDeleted} />);
    openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Apagar sala' }));
    expect(spy).toHaveBeenCalledWith(ROOM_ID);
    expect(await screen.findByRole('button', { name: 'Apagando...' })).toBeDisabled();
    resolve();
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  });

  it('erro da API aparece no dialogo e permite tentar de novo', async () => {
    vi.spyOn(api, 'deleteRoom').mockRejectedValue({ error: 'Forbidden', status: 403 });
    render(<Harness />);
    openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Apagar sala' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Você não tem permissão para apagar esta sala.',
    );
    expect(screen.getByRole('button', { name: 'Apagar sala' })).not.toBeDisabled();
  });
});

describe('RoomCard: botao de apagar so com canDelete', () => {
  const base: RoomListItem = {
    id: ROOM_ID,
    name: 'Reuniao',
    participantCount: 0,
    isPersistent: true,
    hasPassword: false,
    canDelete: false,
  };

  it('sem canDelete nao mostra o botao', () => {
    render(<RoomCard room={base} onEnter={() => {}} onDelete={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Apagar sala Reuniao' })).toBeNull();
  });

  it('com canDelete mostra o botao com nome acessivel e nao entra na sala', () => {
    const onEnter = vi.fn();
    const onDelete = vi.fn();
    render(<RoomCard room={{ ...base, canDelete: true }} onEnter={onEnter} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: 'Apagar sala Reuniao' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onEnter).not.toHaveBeenCalled();
  });
});
