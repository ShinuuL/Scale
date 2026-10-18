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
    <div className="text-center py-8 space-y-4">
      <div className="text-5xl"><Icon name="mic" size={48} /></div>
      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-300">Nenhuma sala ativa</p>
        <p className="text-xs text-slate-400 max-w-xs mx-auto">
          Crie uma sala para começar uma videochamada P2P privada com até 8 participantes.
        </p>
      </div>
      <Button size="sm" onClick={onCreate}>
        Criar Sala
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
      className="glass-subtle p-4 rounded-xl transition-all duration-200 hover:bg-white/[0.06] hover:border-white/[0.12] cursor-pointer group"
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
              <Badge variant="warning" className="shrink-0">Temp</Badge>
            )}
          </div>
          <p className="text-xs text-slate-400">
            {room.maxParticipants} participantes max
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleCopyLink}
            className="text-xs text-slate-400 hover:text-brand-400 transition-colors px-2 py-1 rounded-lg hover:bg-white/5"
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
        await api.getMe();
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

  return (
    <main id="main-content" className="min-h-screen">
      {/* ── Header ───────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-white/5 bg-forest-950/80 backdrop-blur-xl">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            <Logo variant="mark" size={28} />
            <span className="text-base font-bold tracking-tight text-white group-hover:text-brand-300 transition-colors">
              Scale
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/tutorial">
              <Button variant="ghost" size="sm">
                <Icon name="book" /> Como usar
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-brand-600/10 via-transparent to-transparent pointer-events-none" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-brand-600/5 blur-[120px] rounded-full pointer-events-none" />

        <div className="relative max-w-2xl mx-auto px-4 pt-16 pb-10 text-center space-y-5">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
            <span className="bg-gradient-to-r from-white via-white to-slate-400 bg-clip-text text-transparent">
              Chamadas privadas
            </span>
            <br />
            <span className="bg-gradient-to-r from-brand-400 to-brand-600 bg-clip-text text-transparent">
              P2P
            </span>
          </h1>

          <p className="text-slate-400 text-base max-w-md mx-auto leading-relaxed">
            Videochamadas criptografadas de ponta a ponta para 2-8 participantes,
            sem servidores intermediários.
          </p>
        </div>
      </section>

      {/* ── Create / Join ────────────────────────────────────── */}
      <section className="max-w-md mx-auto px-4 pb-8 space-y-6">
        <Card variant="glass" className="animate-slide-up">
          <CardContent className="space-y-4">
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

            <div className="space-y-3">
              <label className="flex items-start gap-3 cursor-pointer select-none group">
                <input
                  type="checkbox"
                  checked={isPersistent}
                  onChange={(e) => handleTogglePersistent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-white/10 bg-white/5 accent-brand-500 focus:ring-brand-500"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-200 group-hover:text-white transition-colors">
                    Sala persistente
                  </span>
                  <span className="block text-xs text-slate-400">
                    Continua ativa até ser encerrada pelo dono.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-3 cursor-pointer select-none group">
                <input
                  type="checkbox"
                  checked={isPrivate}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-white/10 bg-white/5 accent-brand-500 focus:ring-brand-500"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-200 group-hover:text-white transition-colors">
                    Sala privada
                  </span>
                  <span className="block text-xs text-slate-400">
                    Só entra quem tem o link de convite.
                  </span>
                </span>
              </label>

              {authWarning && !isAuthenticated && (
                <div
                  className="flex items-center justify-between gap-3 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 animate-fade-in"
                  role="alert"
                >
                  <p className="text-xs text-amber-300">Faça login para criar uma sala</p>
                  <Link
                    href="/login"
                    className="inline-flex items-center gap-1 text-xs font-medium text-brand-400 hover:text-brand-300 transition-colors shrink-0"
                  >
                    Entrar <Icon name="arrowRight" size={12} />
                  </Link>
                </div>
              )}

              {createRetry !== null && (
                <p
                  className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3"
                  role="status"
                >
                  Tentando novamente ({createRetry + 1}/{FETCH_RETRY_MAX_ATTEMPTS})...
                </p>
              )}
            </div>

            <Button onClick={handleCreateRoom} disabled={creating} className="w-full text-base py-3">
              {creating ? 'Criando...' : 'Criar Sala'}
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/10" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="px-3 bg-slate-900 text-slate-400">ou</span>
              </div>
            </div>

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
          </CardContent>
        </Card>
      </section>

      {/* ── Salas na rede ────────────────────────────────────── */}
      <section className="max-w-md mx-auto px-4 pb-6">
        <Card variant="subtle" className="animate-slide-up">
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-200">
                Salas na rede
              </h2>
              <span className="text-xs text-slate-400">
                {roomsLoading ? '' : `${visibleRooms.length} sala${visibleRooms.length !== 1 ? 's' : ''}`}
              </span>
            </div>

            {roomsLoading && (
              <div className="space-y-2">
                <SkeletonCard />
                <SkeletonCard />
              </div>
            )}

            {!roomsLoading && roomsRequireAuth && (
              <div
                className="flex items-center justify-between gap-3 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 animate-fade-in"
                role="alert"
              >
                <p className="text-xs text-amber-300">Faça login para ver as salas da rede</p>
                <Link
                  href="/login"
                  className="inline-flex items-center gap-1 text-xs font-medium text-brand-400 hover:text-brand-300 transition-colors shrink-0"
                >
                  Entrar <Icon name="arrowRight" size={12} />
                </Link>
              </div>
            )}

            {!roomsLoading && !roomsRequireAuth && roomsError && (
              <p className="text-xs text-slate-400 py-4 text-center">{roomsError}</p>
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
          </CardContent>
        </Card>
      </section>

      {/* ── Salas recentes ───────────────────────────────────── */}
      {!roomsLoading && recentRooms.length > 0 && (
        <section className="max-w-md mx-auto px-4 pb-6">
          <Card variant="subtle" className="animate-slide-up">
            <CardContent className="space-y-3">
              <h2 className="text-sm font-semibold text-slate-200">
                Salas recentes
              </h2>
              <ul className="space-y-2">
                {recentRooms.map((room) => (
                  <li key={room.id}>
                    <RoomCard room={room} onEnter={() => handleEnterRoom(room.id)} />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      )}

      {/* ── Quick links ──────────────────────────────────────── */}
      <section className="max-w-md mx-auto px-4 pb-12 space-y-3">
        <Link href="/tutorial" className="block">
          <div className="glass-subtle p-4 rounded-xl flex items-center justify-between group transition-all duration-200 hover:bg-white/[0.06] hover:border-white/[0.12]">
            <div className="flex items-center gap-3">
              <span className="text-xl"><Icon name="book" size={20} /></span>
              <div>
                <p className="text-sm font-medium text-slate-200 group-hover:text-white transition-colors">
                  Como usar o Scale
                </p>
                <p className="text-xs text-slate-400">
                  Guia passo a passo, da conta até a chamada
                </p>
              </div>
            </div>
            <span className="text-slate-400 group-hover:text-brand-400 transition-colors">
              <Icon name="arrowRight" />
            </span>
          </div>
        </Link>

        {!onboardingDone && (
          <Card variant="subtle" className="animate-slide-up">
            <CardContent className="py-2">
              <Button variant="secondary" onClick={handleShowGuide} className="w-full">
                Abrir guia de uso
              </Button>
            </CardContent>
          </Card>
        )}

        {onboardingDone && (
          <div className="text-center">
            <Button variant="ghost" size="sm" onClick={handleShowGuide}>
              <Icon name="book" /> Rever guia de uso
            </Button>
          </div>
        )}
      </section>

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
