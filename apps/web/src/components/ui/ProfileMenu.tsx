'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Button as AriaButton,
  Dialog,
  Heading,
  Modal,
  ModalOverlay,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  Separator,
  type Key,
} from 'react-aria-components';
import { clsx } from 'clsx';
import { Icon } from '@/components/ui/Icon';
import { SettingsDialog } from '@/components/ui/SettingsDialog';
import { hasLinkResult } from '@/components/ui/LinkedAccounts';
import { Button } from '@/components/ui/Button';
import { api, avatarUrl, type MeUser } from '@/lib/api';

interface ProfileMenuProps {
  /** Nome exibido (conta ou convidado). */
  name: string;
  /** E-mail da conta; ausente = convidado. */
  email?: string | null;
  /** true quando há sessão válida. */
  isAuthenticated: boolean;
  /** Conta completa (foto e edição do perfil nas Configurações). */
  user?: MeUser | null;
  /** Perfil alterado nas Configurações. */
  onUserChange?: (user: MeUser) => void;
  className?: string;
}

function initialOf(name: string): string {
  return (name.trim().charAt(0) || '?').toUpperCase();
}

/** Foto de perfil ou, sem ela, a inicial do nome. Sempre decorativa aqui. */
function Avatar({ name, photo, size }: { name: string; photo: string | null; size: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'h-8 w-8 text-xs' : 'h-10 w-10 text-sm';
  if (photo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- export estatico, sem otimizador de imagem
      <img
        src={photo}
        alt=""
        aria-hidden="true"
        className={clsx(box, 'flex-shrink-0 rounded-full object-cover')}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={clsx(
        box,
        'flex flex-shrink-0 items-center justify-center rounded-full bg-brand-600/30 font-semibold text-brand-200',
      )}
    >
      {initialOf(name)}
    </span>
  );
}

/**
 * Menu de perfil (react-aria `Menu`): avatar + nome no gatilho; no painel,
 * identidade, Configurações e ações de conta. Setas, Home, End e busca por
 * letra percorrem os itens; Esc, clique fora ou escolher fecha e devolve o
 * foco ao gatilho. Links navegam pelo roteador do Next (`AriaRouter`), então
 * a chamada em andamento não cai.
 */
export function ProfileMenu({
  name,
  email,
  isAuthenticated,
  user,
  onUserChange,
  className,
}: ProfileMenuProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Volta do vinculo GitHub/Google (/?vinculo=...): reabre as Configuracoes
  // para mostrar o resultado na secao "Contas vinculadas".
  useEffect(() => {
    if (isAuthenticated && hasLinkResult()) setSettingsOpen(true);
  }, [isAuthenticated]);
  const photo = avatarUrl(user?.avatarUpdatedAt);

  // Logoff: 'confirm' quando há chamada ativa (ela será encerrada), 'error'
  // quando o servidor não respondeu (o cookie continua e a sessão também).
  const [logoutState, setLogoutState] = useState<'idle' | 'confirm' | 'busy' | 'error'>('idle');

  const logout = async () => {
    setLogoutState('busy');
    try {
      await api.logout();
    } catch {
      setLogoutState('error');
      return;
    }
    // Encerra a chamada (se houver) sem o aviso do navegador e recarrega:
    // socket, chamada e estado da conta recomeçam como visitante.
    window.dispatchEvent(new Event('scale:end-call'));
    window.location.assign('/');
  };

  const onAction = (key: Key) => {
    if (key === 'settings') setSettingsOpen(true);
    if (key === 'logout') {
      const inCall = document.documentElement.dataset.scaleCallActive === 'true';
      if (inCall) setLogoutState('confirm');
      else void logout();
    }
  };

  const itemClass =
    'flex min-h-[44px] w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 text-left text-sm text-ink-primary outline-none transition-colors hover:bg-white/[0.06] focus:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-brand-400/60';
  const separatorClass = 'my-1 border-t border-white/[0.08]';

  return (
    <div className={clsx('relative', className)}>
      <MenuTrigger>
        <AriaButton
          ref={triggerRef}
          data-profile-trigger
          aria-label={`Perfil de ${name}`}
          className={({ isPressed, isFocusVisible }) =>
            clsx(
              'flex min-h-[44px] items-center gap-2 rounded-lg border border-transparent bg-transparent py-1 pl-1 pr-1 sm:pr-3',
              'text-sm text-ink-primary outline-none transition-colors hover:border-white/20 hover:bg-white/[0.06]',
              'aria-expanded:border-white/20 aria-expanded:bg-white/[0.06]',
              isFocusVisible && 'outline outline-2 outline-offset-2 outline-brand-400',
              isPressed && 'scale-[0.98]',
            )
          }
        >
          <Avatar name={name} photo={photo} size="sm" />
          <span className="hidden max-w-[10rem] truncate font-medium sm:inline">{name}</span>
        </AriaButton>
        <Popover
          placement="bottom end"
          offset={8}
          className={clsx(
            'z-50 w-72 max-w-[calc(100vw-2rem)] origin-top-right',
            'rounded-xl border border-white/10 bg-forest-900 p-1.5 shadow-[0_12px_40px_rgb(0_0_0/0.3)]',
            'data-[entering]:animate-menu-in motion-reduce:data-[entering]:animate-fade-in-fast',
          )}
        >
          <div className="flex items-center gap-3 px-2.5 py-2.5">
            <Avatar name={name} photo={photo} size="md" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink-primary">{name}</p>
              <p className="truncate text-xs text-ink-muted">
                {isAuthenticated
                  ? email || 'Conta conectada'
                  : name === 'Convidado'
                    ? 'Sem conta conectada'
                    : 'Convidado'}
              </p>
            </div>
          </div>
          <div className={separatorClass} role="separator" />
          <Menu aria-label="Menu do perfil" onAction={onAction} className="py-1 outline-none">
            {isAuthenticated && (
              <MenuItem id="friends" href="/friends" textValue="Amigos" className={itemClass}>
                <Icon name="users" size={16} className="text-ink-muted" />
                Amigos
              </MenuItem>
            )}
            <MenuItem id="settings" textValue="Configurações" className={itemClass}>
              <Icon name="settings" size={16} className="text-ink-muted" />
              Configurações
            </MenuItem>
            {isAuthenticated && user?.isAdmin === true && (
              <MenuItem id="admin" href="/admin" textValue="Administração" className={itemClass}>
                <Icon name="shield" size={16} className="text-ink-muted" />
                Administração
              </MenuItem>
            )}
            {isAuthenticated && <Separator className={separatorClass} />}
            {isAuthenticated && (
              <MenuItem
                id="logout"
                textValue="Sair da conta"
                className={clsx(itemClass, 'text-red-300 hover:bg-red-500/10 focus:bg-red-500/10')}
              >
                <Icon name="logOut" size={16} />
                Sair da conta
              </MenuItem>
            )}
            {!isAuthenticated && <Separator className={separatorClass} />}
            {!isAuthenticated && (
              <MenuItem id="login" href="/login" textValue="Entrar" className={itemClass}>
                <Icon name="key" size={16} className="text-ink-muted" />
                Entrar
              </MenuItem>
            )}
            {!isAuthenticated && (
              <MenuItem
                id="register"
                href="/register"
                textValue="Criar conta"
                className={itemClass}
              >
                <Icon name="users" size={16} className="text-ink-muted" />
                Criar conta
              </MenuItem>
            )}
          </Menu>
        </Popover>
      </MenuTrigger>

      {logoutState !== 'idle' && (
        <ModalOverlay
          isOpen
          isDismissable={logoutState !== 'busy'}
          onOpenChange={(open) => {
            if (!open) setLogoutState('idle');
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 data-[entering]:animate-fade-in"
        >
          <Modal className="w-full max-w-md rounded-2xl border border-line bg-surface-secondary p-6 text-ink-primary shadow-2xl shadow-black/40 data-[entering]:animate-menu-in">
            <Dialog className="outline-none" aria-describedby="logout-desc">
              <Heading slot="title" className="text-xl font-semibold">
                {logoutState === 'error' ? 'Não foi possível sair' : 'Sair da conta?'}
              </Heading>
              <p id="logout-desc" className="mt-3 text-sm leading-6 text-ink-secondary">
                {logoutState === 'error'
                  ? 'O servidor não respondeu. Sua sessão continua ativa; tente de novo.'
                  : 'Você está numa chamada. Ao sair da conta, a chamada é encerrada.'}
              </p>
              <div className="mt-6 flex flex-wrap justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setLogoutState('idle')}
                  autoFocus
                  disabled={logoutState === 'busy'}
                >
                  {logoutState === 'error' ? 'Fechar' : 'Continuar na chamada'}
                </Button>
                <Button
                  variant="danger"
                  onClick={() => void logout()}
                  disabled={logoutState === 'busy'}
                  aria-busy={logoutState === 'busy'}
                >
                  {logoutState === 'busy'
                    ? 'Saindo...'
                    : logoutState === 'error'
                      ? 'Tentar de novo'
                      : 'Sair da conta'}
                </Button>
              </div>
            </Dialog>
          </Modal>
        </ModalOverlay>
      )}

      {settingsOpen && (
        <SettingsDialog
          user={isAuthenticated ? (user ?? null) : null}
          onUserChange={onUserChange}
          onClose={() => {
            setSettingsOpen(false);
            triggerRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}
