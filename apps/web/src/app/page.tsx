'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/Card';
import { AppModal } from '@/components/ui/AppModal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Logo } from '@/components/ui/Logo';
import { Skeleton } from '@/components/ui/Skeleton';
import { ToastProvider, useToast } from '@/components/ui/Toast';
import { Icon } from '@/components/ui/Icon';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import { InviteLinkCard } from '@/components/room/InviteLinkCard';
import { DeleteRoomDialog } from '@/components/room/DeleteRoomDialog';
import { RoomCard } from '@/components/room/RoomCard';
import { takeFlash } from '@/lib/flash';
import { ProfileMenu } from '@/components/ui/ProfileMenu';
import { api, FETCH_RETRY_MAX_ATTEMPTS, type MeUser } from '@/lib/api';
import type { RoomListItem } from '@/lib/validation';
import { ROOM_NAME_MIN, ROOM_NAME_MAX } from '@/lib/validation';
import { AppShell } from '@/components/layout/AppShell';
import { roomPath } from '@/lib/roomLink';

const STORAGE_KEY = 'scale.onboardingDone';
const RECENT_ROOMS_KEY = 'scale.recentRooms';

/** Sala privada criada: link de convite (AppModal/react-aria cuida de foco e Esc). */
function InviteModal({
  roomId,
  inviteToken,
  onClose,
}: {
  roomId: string;
  inviteToken?: string;
  onClose: () => void;
}) {
  return (
    <AppModal title="Sala privada criada" onClose={onClose} describedBy="invite-modal-desc">
      <div className="space-y-4">
        <p id="invite-modal-desc" className="-mt-3 text-sm text-ink-secondary">
          Compartilhe este link com quem você quer chamar.
        </p>
        <InviteLinkCard roomId={roomId} inviteToken={inviteToken} />
        <div className="flex gap-2">
          <Button
            autoFocus
            onClick={() => {
              addRecentRoom(roomId);
              window.location.href = roomPath(roomId, inviteToken);
            }}
            className="flex-1"
          >
            Entrar na sala
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>
    </AppModal>
  );
}

function getRecentRooms(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_ROOMS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function addRecentRoom(roomId: string) {
  const rooms = getRecentRooms().filter((id) => id !== roomId);
  rooms.unshift(roomId);
  localStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(rooms.slice(0, 10)));
}

function removeRecentRoom(roomId: string) {
  try {
    const rooms = getRecentRooms().filter((id) => id !== roomId);
    localStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(rooms));
  } catch {
    // Storage indisponível: some só da tela nesta sessão.
  }
}

function SkeletonCard() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-4 w-1/3 !rounded-lg" />
      <Skeleton className="h-3 w-2/3 !rounded-lg" />
      <Skeleton className="h-8 w-16 !rounded-lg" />
    </div>
  );
}

function EmptyRooms({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-white/10 px-6 py-8 text-center">
      <span
        aria-hidden="true"
        className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500/15 text-brand-300"
      >
        <Icon name="speaker" size={20} />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium text-slate-200">Nenhuma sala persistente ainda</p>
        <p className="mx-auto max-w-xs text-xs leading-relaxed text-slate-400">
          Salas persistentes ficam listadas aqui para você e sua equipe voltarem quando quiserem.
        </p>
      </div>
      <Button size="sm" variant="secondary" onClick={onCreate}>
        Criar sala
      </Button>
    </div>
  );
}

export default function HomePage() {
  return (
    <ToastProvider>
      <HomePageInner />
    </ToastProvider>
  );
}

function HomePageInner() {
  const { toast } = useToast();
  const [onboardingDone, setOnboardingDone] = useState(true);
  const [showWizard, setShowWizard] = useState(false);
  const [roomSearch, setRoomSearch] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [mounted, setMounted] = useState(false);

  // ─── Create room state ──────────────────────────────────────
  const [roomName, setRoomName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [isPersistent, setIsPersistent] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [showRoomOptions, setShowRoomOptions] = useState(false);
  const [creating, setCreating] = useState(false);
  // Attempt number of the retry currently in flight, or null (1 = first retry, i.e. "2/3")
  const [createRetry, setCreateRetry] = useState<number | null>(null);
  // Aviso de que criar sala exige login (qualquer sala, temp ou persistente).
  const [authWarning, setAuthWarning] = useState(false);
  const [createdInvite, setCreatedInvite] = useState<{
    roomId: string;
    inviteToken?: string;
  } | null>(null);

  // ─── Auth + rooms ───────────────────────────────────────────
  const [authState, setAuthState] = useState<'loading' | 'guest' | 'ready' | 'error'>('loading');
  const [authAttempt, setAuthAttempt] = useState(0);
  const isAuthenticated = authState === 'ready';
  const authChecked = authState === 'ready' || authState === 'guest';
  const [account, setAccount] = useState<MeUser | null>(null);
  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [roomsError, setRoomsError] = useState<string | null>(null);
  // Anônimo: GET /api/rooms agora responde 401. Em vez de "não foi possível
  // carregar", mostramos o aviso para entrar e ver as salas da rede.
  const [roomsRequireAuth, setRoomsRequireAuth] = useState(false);

  // ─── Recent rooms ───────────────────────────────────────────
  const [recentRooms, setRecentRooms] = useState<RoomListItem[]>([]);
  const [roomToDelete, setRoomToDelete] = useState<RoomListItem | null>(null);

  // Aviso deixado pela pagina da sala (ex.: "Sala apagada").
  useEffect(() => {
    const flash = takeFlash();
    if (flash) toast(flash.message, flash.variant);
  }, [toast]);

  const handleRoomDeleted = (id: string) => {
    setRooms((prev) => prev.filter((r) => r.id !== id));
    setRecentRooms((prev) => prev.filter((r) => r.id !== id));
    setRoomToDelete(null);
    toast('Sala apagada', 'success');
  };

  useEffect(() => {
    setMounted(true);
    const done = localStorage.getItem(STORAGE_KEY) === 'true';
    setOnboardingDone(done);

    // Auth ANTES da listagem: GET /api/rooms agora exige login (401 sem
    // sessão), então só buscamos as salas quando há sessão válida. Anônimo vê o
    // aviso com link para /login em vez do erro genérico.
    let cancelled = false;

    const load = async () => {
      setAuthState('loading');
      setRoomsLoading(true);
      setRoomsError(null);
      setRoomsRequireAuth(false);
      setAuthWarning(false);
      let authed = false;
      try {
        const me = await api.getMe();
        if (!cancelled) setAccount(me.user);
        authed = true;
      } catch (error: unknown) {
        if (cancelled) return;
        const status = (error as { status?: number } | null)?.status;
        if (status !== 401 && status !== 403) {
          setAccount(null);
          setAuthState('error');
          setRoomsLoading(false);
          return;
        }
        setAccount(null);
      }
      if (cancelled) return;
      setAuthState(authed ? 'ready' : 'guest');

      if (!authed) {
        setRoomsRequireAuth(true);
        setRoomsLoading(false);
        return;
      }

      try {
        const { rooms: list } = await api.listRooms();
        if (cancelled) return;
        setRooms(list);

        // Resolve recent rooms from full list
        const recentIds = getRecentRooms();
        if (recentIds.length > 0) {
          const matched = recentIds
            .map((id) => list.find((r) => r.id === id))
            .filter((r): r is RoomListItem => !!r);
          setRecentRooms(matched);
        }
      } catch {
        if (!cancelled) setRoomsError('Não foi possível carregar as salas');
      } finally {
        if (!cancelled) setRoomsLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [authAttempt]);

  const handleTogglePersistent = (checked: boolean) => {
    setIsPersistent(checked);
  };

  const trimmedName = roomName.trim();
  const nameError =
    trimmedName.length === 0
      ? 'Informe um nome para a sala'
      : trimmedName.length < ROOM_NAME_MIN
        ? `O nome precisa de pelo menos ${ROOM_NAME_MIN} caracteres`
        : null;

  const handleCreateRoom = async () => {
    if (!authChecked) return;
    setNameTouched(true);
    // Criar sala (temporária OU persistente) exige login: sem sessão, não chama
    // a API (que responderia 401) e mostra o aviso com link para entrar.
    if (!isAuthenticated) {
      setAuthWarning(true);
      return;
    }
    if (nameError) return;

    setAuthWarning(false);
    setCreating(true);
    setCreateRetry(null);
    try {
      const result = await api.createRoom(
        {
          name: trimmedName,
          isPersistent,
          isPrivate,
          maxParticipants: 8,
        },
        {
          // Network failures / 5xx are retried automatically (500ms, 1s, 2s).
          // Show progress so users don't think the button hung.
          onRetry: (failedAttempt, maxAttempts) => {
            console.debug(`[createRoom] retrying ${failedAttempt + 1}/${maxAttempts}`);
            setCreateRetry(failedAttempt);
          },
        },
      );
      localStorage.setItem(STORAGE_KEY, 'true');
      addRecentRoom(result.room.id);

      if (result.room.isPrivate) {
        setCreatedInvite({ roomId: result.room.id, inviteToken: result.room.inviteToken });
        return;
      }
      window.location.href = roomPath(result.room.id);
    } catch {
      toast('Falha ao criar sala. Tente novamente.', 'error');
    } finally {
      setCreating(false);
      setCreateRetry(null);
    }
  };

  const handleJoinRoom = () => {
    if (!joinCode.trim()) return;
    localStorage.setItem(STORAGE_KEY, 'true');
    addRecentRoom(joinCode.trim());
    window.location.href = roomPath(joinCode.trim());
  };

  const handleEnterRoom = (roomId: string) => {
    addRecentRoom(roomId);
    window.location.href = roomPath(roomId);
  };

  const handleShowGuide = () => setShowWizard(true);
  const handleWizardComplete = () => {
    setShowWizard(false);
    setOnboardingDone(true);
  };
  const handleWizardSkip = () => {
    setShowWizard(false);
    setOnboardingDone(true);
  };

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-brand-400 text-lg">
          <Logo variant="full" />
        </div>
      </div>
    );
  }

  if (showWizard) {
    return (
      <OnboardingWizard
        onComplete={handleWizardComplete}
        onSkip={handleWizardSkip}
        isAuthenticated={isAuthenticated}
      />
    );
  }

  const visibleRooms = isAuthenticated ? rooms.filter((r) => r.isPersistent) : rooms;

  const listedRooms = visibleRooms.filter((room) =>
    room.name.toLocaleLowerCase('pt-BR').includes(roomSearch.trim().toLocaleLowerCase('pt-BR')),
  );
  const openCreate = () => document.getElementById('room-name')?.focus();
  const authNotice = (text: string) => (
    <div className="rounded-lg border border-line bg-surface-secondary p-4" role="status">
      <p className="text-sm leading-6 text-ink-secondary">{text}</p>
      <Link
        href="/login"
        className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-accent"
      >
        Entrar na conta <Icon name="arrowRight" />
      </Link>
    </div>
  );
  return (
    <AppShell
      activeSection="rooms"
      title="Salas"
      accountSlot={
        authChecked ? (
          <ProfileMenu
            name={account?.name ?? 'Convidado'}
            email={account?.email}
            isAuthenticated={isAuthenticated}
            user={account}
            onUserChange={setAccount}
          />
        ) : authState === 'error' ? (
          <span className="text-xs text-ink-muted">Conta indisponível</span>
        ) : (
          <Skeleton className="h-10 w-10" />
        )
      }
      actions={
        <Button size="sm" onClick={openCreate}>
          <Icon name="phone" />
          <span className="hidden sm:inline">Nova sala</span>
          <span className="sr-only sm:hidden">Nova sala</span>
        </Button>
      }
      contextSidebar={
        <>
          <h2 className="context-title">Seu espaço</h2>
          <nav aria-label="Salas e atalhos" className="space-y-1">
            <a href="#rooms-list" className="context-link" data-active="true">
              <Icon name="speaker" />
              Salas disponíveis
            </a>
            <button
              type="button"
              onClick={openCreate}
              data-context-focus-target="room-name"
              className="context-link w-full"
            >
              <Icon name="phone" />
              Criar uma sala
            </button>
            <a href="#join-room" className="context-link">
              <Icon name="link" />
              Entrar por código
            </a>
          </nav>
          <div className="mt-8 border-t border-line pt-6">
            <h3 className="mb-3 text-xs font-semibold text-ink-muted">Para começar</h3>
            <p className="text-sm leading-6 text-ink-secondary">
              Chame os amigos ou reúna a equipe. Uma sala, voz e tela compartilhada.
            </p>
            <button
              type="button"
              onClick={handleShowGuide}
              className="context-link mt-3 w-full !px-0"
            >
              <Icon name="lightbulb" />
              {onboardingDone ? 'Rever guia de uso' : 'Abrir guia de uso'}
            </button>
            <Link href="/tutorial" className="context-link !px-0">
              <Icon name="book" />
              Como usar o Scale
            </Link>
          </div>
        </>
      }
    >
      <div className="rooms-content">
        <div className="rooms-layout">
          <section id="rooms-list" className="rooms-list" aria-labelledby="rooms-title">
            <div className="mb-6">
              <h2
                id="rooms-title"
                className="text-[28px] font-semibold leading-9 tracking-tight text-ink-primary"
              >
                Uma sala para se encontrar.
              </h2>
              <p className="mt-2 text-sm leading-6 text-ink-secondary">
                Entre na conversa ou comece uma nova com até 8 pessoas.
              </p>
            </div>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-ink-primary">Salas persistentes</h3>
              <div className="w-full sm:w-56">
                <Input
                  aria-label="Buscar salas"
                  placeholder="Buscar sala pelo nome"
                  value={roomSearch}
                  onChange={(event) => setRoomSearch(event.target.value)}
                />
              </div>
            </div>
            {roomsLoading ? (
              <div aria-label="Carregando salas" role="status" className="space-y-4">
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </div>
            ) : authState === 'error' ? (
              <div className="rounded-lg border border-red-400/30 p-5" role="alert">
                <p className="text-sm text-red-300">
                  Não foi possível verificar sua conta. Tente novamente para carregar suas salas.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  onClick={() => setAuthAttempt((attempt) => attempt + 1)}
                >
                  Tentar novamente
                </Button>
              </div>
            ) : roomsRequireAuth ? (
              authNotice(
                'Entre na sua conta para ver as salas disponíveis. Você também pode usar um convite sem criar uma conta.',
              )
            ) : roomsError ? (
              <div className="rounded-lg border border-red-400/30 p-5" role="alert">
                <p className="text-sm text-red-300">{roomsError}.</p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  onClick={() => setAuthAttempt((attempt) => attempt + 1)}
                >
                  Tentar novamente
                </Button>
              </div>
            ) : visibleRooms.length === 0 ? (
              <EmptyRooms onCreate={openCreate} />
            ) : listedRooms.length === 0 ? (
              <div className="border-y border-line py-10 text-center">
                <p className="text-sm text-ink-secondary">Nenhuma sala com esse nome.</p>
                <Button variant="ghost" onClick={() => setRoomSearch('')}>
                  Limpar busca
                </Button>
              </div>
            ) : (
              <ul>
                {listedRooms.map((room) => (
                  <li key={room.id}>
                    <RoomCard
                      room={room}
                      onEnter={() => handleEnterRoom(room.id)}
                      onDelete={() => setRoomToDelete(room)}
                    />
                  </li>
                ))}
              </ul>
            )}
            {recentRooms.length > 0 && (
              <section aria-labelledby="recent-title" className="mt-10">
                <h3 id="recent-title" className="mb-2 text-sm font-semibold text-ink-secondary">
                  Acessadas recentemente
                </h3>
                <ul>
                  {recentRooms.map((room) => (
                    <li key={room.id}>
                      <RoomCard
                        room={room}
                        onEnter={() => handleEnterRoom(room.id)}
                        onDelete={() => setRoomToDelete(room)}
                        onRemoveRecent={() => {
                          removeRecentRoom(room.id);
                          setRecentRooms((prev) => prev.filter((r) => r.id !== room.id));
                        }}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section
              id="join-room"
              className="mt-10 border-t border-line pt-6"
              aria-labelledby="join-title"
            >
              <h3 id="join-title" className="text-base font-semibold text-ink-primary">
                Recebeu um código?
              </h3>
              <p className="mt-1 mb-4 text-sm text-ink-secondary">
                Cole o código da sala para entrar. Um link de convite abre a sala diretamente.
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  handleJoinRoom();
                }}
                className="flex items-end gap-2"
              >
                <div className="min-w-0 flex-1">
                  <Input
                    label="Código da sala"
                    placeholder="Cole o código aqui"
                    value={joinCode}
                    onChange={(event) => setJoinCode(event.target.value)}
                  />
                </div>
                <Button type="submit" variant="secondary" disabled={!joinCode.trim()}>
                  Entrar <Icon name="arrowRight" />
                </Button>
              </form>
            </section>
          </section>
          <section className="room-form" aria-labelledby="create-title">
            <div className="mb-6 flex items-start gap-3">
              <span className="room-row-icon">
                <Icon name="phone" size={21} />
              </span>
              <div>
                <h2 id="create-title" className="text-xl font-semibold leading-7">
                  Nova sala
                </h2>
                <p className="mt-1 text-sm leading-5 text-ink-secondary">
                  Dê um nome e mande o convite.
                </p>
              </div>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                // Sem sessão o primeiro clique já mostra o aviso de login.
                if (!showRoomOptions && isAuthenticated) {
                  setNameTouched(true);
                  if (!nameError) setShowRoomOptions(true);
                  return;
                }
                void handleCreateRoom();
              }}
              className="space-y-5"
            >
              <Input
                id="room-name"
                label="Nome da sala"
                placeholder="Ex.: Partida de hoje ou Equipe"
                value={roomName}
                onChange={(event) => setRoomName(event.target.value)}
                onBlur={() => setNameTouched(true)}
                maxLength={ROOM_NAME_MAX}
                required
                error={nameTouched && nameError ? nameError : undefined}
              />
              {showRoomOptions && (
                <fieldset className="space-y-3">
                  <legend className="mb-2 text-sm font-medium text-ink-secondary">
                    Preferências da sala
                  </legend>
                  <CheckOption
                    checked={isPersistent}
                    onChange={handleTogglePersistent}
                    label="Sala persistente"
                    hint="Fica disponível até você encerrar."
                  />
                  <CheckOption
                    checked={isPrivate}
                    onChange={setIsPrivate}
                    label="Sala privada"
                    hint="Acesso somente pelo link de convite."
                  />
                </fieldset>
              )}
              {authWarning && (
                <div role="alert" className="text-sm text-amber-200">
                  Entre na sua conta para criar uma sala.{' '}
                  <Link href="/login" className="underline underline-offset-4">
                    Entrar
                  </Link>
                </div>
              )}
              <Button type="submit" className="w-full" disabled={creating || !authChecked}>
                {creating
                  ? createRetry !== null
                    ? `Tentando novamente (${createRetry + 1}/${FETCH_RETRY_MAX_ATTEMPTS})...`
                    : 'Criando sala...'
                  : showRoomOptions
                    ? 'Confirmar e criar sala'
                    : 'Criar sala'}
                <Icon name="arrowRight" />
              </Button>
              {!isAuthenticated && authChecked && (
                <p className="text-xs leading-5 text-ink-muted">
                  Para criar uma sala,{' '}
                  <Link href="/login" className="text-accent underline underline-offset-4">
                    entre na sua conta
                  </Link>{' '}
                  ou{' '}
                  <Link href="/register" className="text-accent underline underline-offset-4">
                    cadastre-se
                  </Link>
                  .
                </p>
              )}
            </form>
            <div className="mt-7 flex items-start gap-2 border-t border-line pt-5 text-xs leading-5 text-ink-muted">
              <Icon name="lock" size={16} className="mt-0.5 shrink-0" />
              <p>Voz e tela conectadas entre os participantes. Sem gravação de chamadas.</p>
            </div>
          </section>
        </div>
      </div>
      {roomToDelete && (
        <DeleteRoomDialog
          roomId={roomToDelete.id}
          roomName={roomToDelete.name}
          onCancel={() => setRoomToDelete(null)}
          onDeleted={() => handleRoomDeleted(roomToDelete.id)}
        />
      )}
      {createdInvite && (
        <InviteModal
          roomId={createdInvite.roomId}
          inviteToken={createdInvite.inviteToken}
          onClose={() => setCreatedInvite(null)}
        />
      )}
    </AppShell>
  );
}

function CheckOption({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="group flex min-h-11 cursor-pointer items-start gap-3 rounded-md py-2">
      <span className="relative mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="peer h-5 w-5 cursor-pointer appearance-none rounded-[6px] border border-line-strong bg-surface-tertiary transition-colors duration-150 group-hover:border-accent checked:border-accent-solid checked:bg-accent-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base"
        />
        <Icon
          name="check"
          size={14}
          className="pointer-events-none absolute scale-50 text-white opacity-0 transition-[opacity,transform] duration-150 peer-checked:scale-100 peer-checked:opacity-100"
        />
      </span>
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {checked && <span className="mt-1 block text-xs leading-5 text-ink-secondary">{hint}</span>}
      </span>
    </label>
  );
}
