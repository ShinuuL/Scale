import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useUserEvents } from '@/hooks/useUserEvents';
import { ProfileMenu } from '@/components/ui/ProfileMenu';
import { applyMeAdmin, type MeUser } from '@/lib/api';

const handlers = new Map<string, (payload: unknown) => void>();
vi.mock('socket.io-client', () => ({
  io: () => {
    const sock = {
      on: vi.fn((event: string, cb: (payload: unknown) => void) => {
        handlers.set(event, cb);
        return sock;
      }),
      disconnect: vi.fn(),
    };
    return sock;
  },
}));

const base: MeUser = {
  id: 'bruno',
  name: 'Bruno',
  email: 'bruno@example.test',
  createdAt: '2026-11-06T10:00:00.000Z',
  isAdmin: false,
  adminSource: null,
};

function Harness() {
  const [me, setMe] = useState<MeUser>(base);
  useUserEvents(true, { onMeAdmin: (event) => setMe((prev) => applyMeAdmin(prev, event)) });
  return <ProfileMenu name={me.name} email={me.email} isAuthenticated user={me} onUserChange={setMe} />;
}

describe('useUserEvents: me:admin', () => {
  it('papel concedido aparece no menu sem recarregar; payload inválido é ignorado', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Perfil de Bruno' }));
    expect(screen.queryByRole('menuitem', { name: 'Administração' })).not.toBeInTheDocument();

    act(() => handlers.get('me:admin')?.({ isAdmin: 'sim' }));
    expect(screen.queryByRole('menuitem', { name: 'Administração' })).not.toBeInTheDocument();

    act(() => handlers.get('me:admin')?.({ isAdmin: true, adminSource: 'db' }));
    expect(screen.getByRole('menuitem', { name: 'Administração' })).toHaveAttribute('href', '/admin');

    act(() => handlers.get('me:admin')?.({ isAdmin: false, adminSource: null }));
    expect(screen.queryByRole('menuitem', { name: 'Administração' })).not.toBeInTheDocument();
  });
});
