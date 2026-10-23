'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Logo } from '@/components/ui/Logo';
import { Skeleton } from '@/components/ui/Skeleton';
import { ToastProvider, useToast } from '@/components/ui/Toast';
import { Icon } from '@/components/ui/Icon';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import { InviteLinkCard } from '@/components/room/InviteLinkCard';
import { ProfileMenu } from '@/components/ui/ProfileMenu';
import { api, FETCH_RETRY_MAX_ATTEMPTS } from '@/lib/api';
import type { RoomListItem } from '@/lib/validation';
import { ROOM_NAME_MIN, ROOM_NAME_MAX } from '@/lib/validation';

const STORAGE_KEY = 'scale.onboardingDone';
const RECENT_ROOMS_KEY = 'scale.recentRooms';

// ─── Focus trap helper ──────────────────────────────────────────
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

function InviteModal({
  roomId,
  inviteToken,
  onClose,
}: {
  roomId: string;
  inviteToken?: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Save previously focused element
    previousFocusRef.current = document.activeElement as HTMLElement;

    // Focus the first focusable element inside the dialog
    const timer = setTimeout(() => {
      if (dialogRef.current) {
        const first = dialogRef.current.querySelector<HTMLElement>(FOCUSABLE);
        first?.focus();
      }
    }, 50);

    return () => {
      clearTimeout(timer);
      previousFocusRef.current?.focus();
    };
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    },
    [onClose],
  );

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-forest-950/80 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-modal-title"
      onKeyDown={handleKeyDown}
    >
      <Card variant="glass" className="w-full max-w-md animate-fade-in">
        <CardContent className="space-y-4">
          <div>
            <h3 id="invite-modal-title" className="text-lg font-semibold text-white">
              Sala privada criada
            </h3>
            <p className="text-sm text-slate-400 mt-1">
              Compartilhe este link com quem você quer chamar.
            </p>
          </div>
          <InviteLinkCard
            roomId={roomId}
            inviteToken={inviteToken}
          />
          <div className="flex gap-2">
            <Button
              onClick={() => {
                addRecentRoom(roomId);
                window.location.href = inviteToken
                  ? `/room/${roomId}?token=${inviteToken}`
                  : `/room/${roomId}`;
              }}
              className="flex-1"
            >
              Entrar na sala
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Fechar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
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
      <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500/15 text-brand-300">
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

function RoomCard({ room, onEnter }: { room: RoomListItem; onEnter: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopyLink = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${window.location.origin}/room/${room.id}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="group cursor-pointer rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 transition-colors duration-150 hover:border-white/[0.12] hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400 motion-reduce:transition-none"
      onClick={onEnter}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onEnter()}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-medium text-slate-200 truncate group-hover:text-white transition-colors">
              {room.name}
            </p>
            {room.isPersistent && (
              <Badge variant="success" className="shrink-0">Persistente</Badge>
            )}
            {!room.isPersistent && (
              <Badge variant="warning" className="shrink-0">Temporária</Badge>
            )}
          </div>
          <p className="text-xs text-slate-400">
            Até {room.maxParticipants} participantes
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleCopyLink}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/5 hover:text-brand-400"
            title="Copiar link"
            aria-label={copied ? 'Link copiado' : 'Copiar link'}
          >
            <span aria-hidden="true">
              {copied ? <Icon name="check" size={14} /> : <Icon name="link" size={14} />}
            </span>
          </button>
          <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); onEnter(); }}>
            Entrar
          </Button>
        </div>
      </div>
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
  const [joinCode, setJoinCode] = useState('');
  const [mounted, setMounted] = useState(false);

  // ─── Create room state ──────────────────────────────────────
  const [roomName, setRoomName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [isPersistent, setIsPersistent] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [creating, setCreating] = useState(false);
  // Attempt number of the retry currently in flight, or null (1 = first retry, i.e. "2/3")
  const [createRetry, setCreateRetry] = useState<number | null>(null);
  // Aviso de que criar sala exige login (qualquer sala, temp ou persistente).
  const [authWarning, setAuthWarning] = useState(false);
  const [createdInvite, setCreatedInvite] = useState<{ roomId: string; inviteToken?: string } | null>(null);

  // ─── Auth + rooms ───────────────────────────────────────────
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [account, setAccount] = useState<{ name: string; email: string } | null>(null);
  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [roomsError, setRoomsError] = useState<string | null>(null);
  // Anônimo: GET /api/rooms agora responde 401. Em vez de "não foi possível
  // carregar", mostramos o aviso para entrar e ver as salas da rede.
  const [roomsRequireAuth, setRoomsRequireAuth] = useState(false);

  // ─── Recent rooms ───────────────────────────────────────────
  const [recentRoomIds, setRecentRoomIds] = useState<string[]>([]);
  const [recentRooms, setRecentRooms] = useState<RoomListItem[]>([]);

  useEffect(() => {
    setMounted(true);
    const done = localStorage.getItem(STORAGE_KEY) === 'true';
    setOnboardingDone(done);
    setRecentRoomIds(getRecentRooms());

    // Auth ANTES da listagem: GET /api/rooms agora exige login (401 sem
    // sessão), então só buscamos as salas quando há sessão válida. Anônimo vê o
    // aviso com link para /login em vez do erro genérico.
    let cancelled = false;

    const load = async () => {
      let authed = false;
      try {
        const me = await api.getMe();
        if (!cancelled) setAccount({ name: me.user.name, email: me.user.email });
        authed = true;
      } catch {
        authed = false;
      }
      if (cancelled) return;
      setIsAuthenticated(authed);
      setAuthChecked(true);

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
  }, []);

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
      window.location.href = `/room/${result.room.id}`;
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
    window.location.href = `/room/${joinCode.trim()}`;
  };

  const handleEnterRoom = (roomId: string) => {
    addRecentRoom(roomId);
    window.location.href = `/room/${roomId}`;
  };

  const handleShowGuide = () => setShowWizard(true);
  const handleWizardComplete = () => { setShowWizard(false); setOnboardingDone(true); };
  const handleWizardSkip = () => { setShowWizard(false); setOnboardingDone(true); };

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse-soft text-brand-400 text-lg">
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

  const visibleRooms = isAuthenticated
    ? rooms.filter((r) => r.isPersistent)
    : rooms;

  const authNotice = (text: string) => (
    <div
      className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 animate-fade-in"
      role="alert"
    >
      <p className="text-xs text-amber-300">{text}</p>
      <Link
        href="/login"
        className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brand-400 transition-colors hover:text-brand-300"
      >
        Entrar <Icon name="arrowRight" size={12} />
      </Link>
    </div>
  );

  const optionClass =
    'flex cursor-pointer select-none items-start gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 transition-colors hover:border-white/[0.16] has-[:checked]:border-brand-500/40 has-[:checked]:bg-brand-500/[0.06]';

  return (
    <main id="main-content" className="min-h-screen">
      {/* ── Header ───────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-white/5 bg-forest-950/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4">
          <Link href="/" className="group flex items-center gap-2">
            <Logo variant="mark" size={28} />
            <span className="text-base font-bold tracking-tight text-white transition-colors group-hover:text-brand-300">
              Scale
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/tutorial" className="btn-ghost !px-3 !py-2" aria-label="Como usar">
              <Icon name="book" /> <span className="hidden sm:inline">Como usar</span>
            </Link>
            {authChecked && (
              <ProfileMenu
                name={account?.name ?? 'Convidado'}
                email={account?.email}
                isAuthenticated={isAuthenticated}
              />
            )}
          </div>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-brand-600/10 via-transparent to-transparent" />
        <div className="relative mx-auto max-w-5xl px-4 pb-8 pt-10 sm:pt-14">
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Chamadas privadas <span className="text-brand-400">P2P</span>
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-400 sm:text-base">
            Voz e tela compartilhada para 2 a 8 pessoas, conectadas direto entre si.
          </p>
        </div>
      </section>

      <div className="mx-auto grid max-w-5xl gap-5 px-4 pb-12 lg:grid-cols-2 lg:items-start">
        {/* ── Coluna principal: criar sala ───────────────────── */}
        <section
          aria-labelledby="create-title"
          className="animate-slide-up rounded-2xl border border-white/10 bg-forest-900 shadow-lg shadow-black/20"
        >
          <div className="flex items-start gap-3 border-b border-white/[0.08] px-5 py-4 sm:px-6">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-brand-500/15 text-brand-300"
            >
              <Icon name="phone" size={20} />
            </span>
            <div>
              <h2 id="create-title" className="text-base font-semibold text-white">
                Nova sala
              </h2>
              <p className="text-sm text-slate-400">Crie um canal e mande o link para quem vai participar.</p>
            </div>
          </div>

          <div className="space-y-4 px-5 py-5 sm:px-6">
            <Input
              label="Nome da sala"
              placeholder="Ex: Reunião de equipe"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              onBlur={() => setNameTouched(true)}
              maxLength={ROOM_NAME_MAX}
              required
              error={nameTouched && nameError ? nameError : undefined}
              aria-label="Nome da sala"
            />

            <div className="grid gap-2 sm:grid-cols-2">
              <label className={optionClass}>
                <input
                  type="checkbox"
                  checked={isPersistent}
                  onChange={(e) => handleTogglePersistent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-white/10 bg-white/5 accent-brand-500 focus:ring-brand-500"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-200">Sala persistente</span>
                  <span className="block text-xs text-slate-400">Continua ativa até ser encerrada pelo dono.</span>
                </span>
              </label>

              <label className={optionClass}>
                <input
                  type="checkbox"
                  checked={isPrivate}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-white/10 bg-white/5 accent-brand-500 focus:ring-brand-500"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-200">Sala privada</span>
                  <span className="block text-xs text-slate-400">Só entra quem tem o link de convite.</span>
                </span>
              </label>
            </div>

            {authWarning && !isAuthenticated && authNotice('Faça login para criar uma sala')}

            {createRetry !== null && (
              <p
                className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-300"
                role="status"
              >
                Tentando novamente ({createRetry + 1}/{FETCH_RETRY_MAX_ATTEMPTS})...
              </p>
            )}

            <Button onClick={handleCreateRoom} disabled={creating} className="w-full py-3 text-base">
              {creating ? 'Criando...' : 'Criar sala'}
            </Button>
          </div>

          <div className="border-t border-white/[0.08] px-5 py-4 sm:px-6">
            <p className="mb-2 text-sm font-medium text-slate-200">Já tem um código?</p>
            <div className="flex gap-2">
              <Input
                placeholder="Cole o código da sala"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleJoinRoom()}
                aria-label="Código da sala"
              />
              <Button variant="secondary" onClick={handleJoinRoom} disabled={!joinCode.trim()}>
                Entrar
              </Button>
            </div>
          </div>
        </section>

        {/* ── Coluna lateral: salas e ajuda ──────────────────── */}
        <div className="space-y-5">
          <section
            aria-labelledby="rooms-title"
            className="animate-slide-up rounded-2xl border border-white/10 bg-forest-900/70"
          >
            <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-5 py-4">
              <h2 id="rooms-title" className="text-sm font-semibold text-white">
                Salas na rede
              </h2>
              {!roomsLoading && !roomsRequireAuth && (
                <span className="rounded-full border border-white/10 px-2 py-0.5 text-xs tabular-nums text-slate-300">
                  {visibleRooms.length} sala{visibleRooms.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            <div className="space-y-2 p-4">
              {roomsLoading && (
                <div className="space-y-4 p-1">
                  <SkeletonCard />
                  <SkeletonCard />
                </div>
              )}

              {!roomsLoading && roomsRequireAuth && authNotice('Faça login para ver as salas da rede')}

              {!roomsLoading && !roomsRequireAuth && roomsError && (
                <p className="py-4 text-center text-xs text-slate-400">{roomsError}</p>
              )}

              {!roomsLoading && !roomsRequireAuth && !roomsError && visibleRooms.length === 0 && (
                <EmptyRooms onCreate={handleCreateRoom} />
              )}

              {!roomsLoading && !roomsError && visibleRooms.length > 0 && (
                <ul className="space-y-2">
                  {visibleRooms.map((room) => (
                    <li key={room.id}>
                      <RoomCard room={room} onEnter={() => handleEnterRoom(room.id)} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {!roomsLoading && recentRooms.length > 0 && (
            <section
              aria-labelledby="recent-title"
              className="animate-slide-up rounded-2xl border border-white/10 bg-forest-900/70"
            >
              <div className="border-b border-white/[0.08] px-5 py-4">
                <h2 id="recent-title" className="text-sm font-semibold text-white">
                  Salas recentes
                </h2>
              </div>
              <ul className="space-y-2 p-4">
                {recentRooms.map((room) => (
                  <li key={room.id}>
                    <RoomCard room={room} onEnter={() => handleEnterRoom(room.id)} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-label="Ajuda" className="rounded-2xl border border-white/10 bg-forest-900/70 p-2">
            <Link
              href="/tutorial"
              className="group flex min-h-[56px] items-center justify-between gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-white/[0.05]"
            >
              <span className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white/[0.05] text-slate-300"
                >
                  <Icon name="book" size={18} />
                </span>
                <span>
                  <span className="block text-sm font-medium text-slate-200 group-hover:text-white">Como usar o Scale</span>
                  <span className="block text-xs text-slate-400">Guia passo a passo, da conta até a chamada</span>
                </span>
              </span>
              <span className="text-slate-400 transition-colors group-hover:text-brand-400">
                <Icon name="arrowRight" />
              </span>
            </Link>
            <button
              type="button"
              onClick={handleShowGuide}
              className="group flex min-h-[56px] w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-white/[0.05]"
            >
              <span className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white/[0.05] text-slate-300"
                >
                  <Icon name="lightbulb" size={18} />
                </span>
                <span>
                  <span className="block text-sm font-medium text-slate-200 group-hover:text-white">
                    {onboardingDone ? 'Rever guia de uso' : 'Abrir guia de uso'}
                  </span>
                  <span className="block text-xs text-slate-400">Configuração inicial em poucos passos</span>
                </span>
              </span>
              <span className="text-slate-400 transition-colors group-hover:text-brand-400">
                <Icon name="arrowRight" />
              </span>
            </button>
          </section>
        </div>
      </div>

      {/* ── Invite modal ─────────────────────────────────────── */}
      {createdInvite && (
        <InviteModal
          roomId={createdInvite.roomId}
          inviteToken={createdInvite.inviteToken}
          onClose={() => setCreatedInvite(null)}
        />
      )}
    </main>
  );
}
