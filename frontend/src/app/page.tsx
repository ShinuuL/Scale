'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Skeleton } from '@/components/ui/Skeleton';
import { ToastProvider, useToast } from '@/components/ui/Toast';
import { TailscaleWizard } from '@/components/onboarding/TailscaleWizard';
import { InviteLinkCard } from '@/components/room/InviteLinkCard';
import { api, FETCH_RETRY_MAX_ATTEMPTS } from '@/lib/api';
import { buildTailscaleHttpsUrl } from '@/lib/tailscale';
import type { RoomListItem, TailscaleStatus } from '@/lib/validation';

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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in"
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
      <div className="text-5xl">🎙️</div>
      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-300">Nenhuma sala ativa</p>
        <p className="text-xs text-slate-500 max-w-xs mx-auto">
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
          <p className="text-xs text-slate-500">
            {room.maxParticipants} participantes max
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleCopyLink}
            className="text-xs text-slate-500 hover:text-brand-400 transition-colors px-2 py-1 rounded-lg hover:bg-white/5"
            title="Copiar link"
          >
            {copied ? '✓' : '🔗'}
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
  const [isPersistent, setIsPersistent] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [creating, setCreating] = useState(false);
  // Attempt number of the retry currently in flight, or null (1 = first retry, i.e. "2/3")
  const [createRetry, setCreateRetry] = useState<number | null>(null);
  const [persistentWarning, setPersistentWarning] = useState(false);
  const [createdInvite, setCreatedInvite] = useState<{ roomId: string; inviteToken?: string } | null>(null);

  // ─── Auth + rooms ───────────────────────────────────────────
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [rooms, setRooms] = useState<RoomListItem[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [roomsError, setRoomsError] = useState<string | null>(null);

  // ─── Recent rooms ───────────────────────────────────────────
  const [recentRoomIds, setRecentRoomIds] = useState<string[]>([]);
  const [recentRooms, setRecentRooms] = useState<RoomListItem[]>([]);

  // ─── Tailscale status ───────────────────────────────────────
  const [tailscaleStatus, setTailscaleStatus] = useState<TailscaleStatus | null>(null);

  useEffect(() => {
    setMounted(true);
    const done = localStorage.getItem(STORAGE_KEY) === 'true';
    setOnboardingDone(done);
    setRecentRoomIds(getRecentRooms());

    // Auth
    api
      .getMe()
      .then(() => setIsAuthenticated(true))
      .catch(() => setIsAuthenticated(false))
      .finally(() => setAuthChecked(true));

    // Active rooms
    setRoomsLoading(true);
    api
      .listRooms()
      .then(({ rooms: list }) => {
        setRooms(list);

        // Resolve recent rooms from full list
        const recentIds = getRecentRooms();
        if (recentIds.length > 0) {
          const matched = recentIds
            .map((id) => list.find((r) => r.id === id))
            .filter((r): r is RoomListItem => !!r);
          setRecentRooms(matched);
        }
      })
      .catch(() => setRoomsError('Não foi possível carregar as salas'))
      .finally(() => setRoomsLoading(false));

    // Tailscale status (non-blocking)
    api
      .getTailscaleStatus()
      .then(setTailscaleStatus)
      .catch(() => {});
  }, []);

  const handleTogglePersistent = (checked: boolean) => {
    setIsPersistent(checked);
    setPersistentWarning(checked && !isAuthenticated);
  };

  const handleCreateRoom = async () => {
    if (isPersistent && !isAuthenticated) {
      setPersistentWarning(true);
      return;
    }
    setCreating(true);
    setCreateRetry(null);
    try {
      const result = await api.createRoom(
        {
          name: `Sala ${Math.random().toString(36).slice(2, 6)}`,
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
        <div className="animate-pulse-soft text-brand-400 text-lg">Scale 🐉</div>
      </div>
    );
  }

  if (showWizard) {
    return <TailscaleWizard onComplete={handleWizardComplete} onSkip={handleWizardSkip} />;
  }

  const visibleRooms = isAuthenticated
    ? rooms.filter((r) => r.isPersistent)
    : rooms;

  const tsConnected = !!tailscaleStatus?.tailscaleIp;

  // Banner de contexto inseguro: HTTP na rede Tailscale bloqueia micro/tela.
  // Só aparece quando há Tailscale IP detectado (acesso via rede mesh).
  const isInsecureContext = typeof window !== 'undefined' && !window.isSecureContext;
  const insecureHttpsUrl = buildTailscaleHttpsUrl('/');
  const showInsecureBanner = isInsecureContext && tsConnected;

  return (
    <main id="main-content" className="min-h-screen">
      {/* ── Header ───────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-white/5 bg-slate-950/80 backdrop-blur-xl">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            <span className="text-xl">🐉</span>
            <span className="text-base font-bold tracking-tight text-white group-hover:text-brand-300 transition-colors">
              Scale
            </span>
          </Link>
          <div className="flex items-center gap-3">
            {/* Tailscale status badge */}
            {tailscaleStatus && (
              <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ${
                tsConnected
                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-300 border-amber-500/20'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${tsConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                {tsConnected ? tailscaleStatus.tailscaleIp : 'Tailscale?'}
              </div>
            )}
            <Link href="/tutorial">
              <Button variant="ghost" size="sm">
                📖 Compartilhar
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* ── Insecure context banner ──────────────────────────── */}
      {showInsecureBanner && (
        <div className="max-w-3xl mx-auto px-4 pt-4">
          <Banner
            variant="warning"
            icon="🔒"
            title="Conexão não segura — microfone/tela bloqueados"
            description="Você está acessando via HTTP na rede Tailscale. Use HTTPS para que os navegadores liberem microfone e compartilhamento de tela nas chamadas."
            action={
              insecureHttpsUrl ? (
                <a
                  className="btn-primary text-xs px-3 py-1.5 rounded-lg"
                  href={insecureHttpsUrl}
                  aria-label={`Abrir Scale via HTTPS (${insecureHttpsUrl})`}
                >
                  Abrir via HTTPS
                </a>
              ) : (
                <Link
                  href="/tutorial"
                  className="btn-ghost text-xs px-3 py-1.5 rounded-lg"
                  aria-label="Ver instruções de configuração HTTPS no guia"
                >
                  Ver guia HTTPS
                </Link>
              )
            }
          />
        </div>
      )}

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-brand-600/10 via-transparent to-transparent pointer-events-none" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-brand-600/5 blur-[120px] rounded-full pointer-events-none" />

        <div className="relative max-w-2xl mx-auto px-4 pt-16 pb-10 text-center space-y-5">
          <div className="inline-flex items-center gap-2 bg-brand-500/10 text-brand-300 text-xs font-medium px-3 py-1.5 rounded-full border border-brand-500/20">
            <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
            P2P via Tailscale — Sem exposição pública
          </div>

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
                  <span className="block text-xs text-slate-500">
                    Continua ativa até ser encerrada pelo dono (exige login).
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
                  <span className="block text-xs text-slate-500">
                    Só entra quem tem o link de convite.
                  </span>
                </span>
              </label>

              {persistentWarning && !isAuthenticated && (
                <div
                  className="flex items-center justify-between gap-3 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 animate-fade-in"
                  role="alert"
                >
                  <p className="text-xs text-amber-300">Faça login para salas persistentes</p>
                  <Link href="/login" className="text-xs font-medium text-brand-400 hover:text-brand-300 transition-colors shrink-0">
                    Entrar →
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
                <span className="px-3 bg-slate-900 text-slate-500">ou</span>
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
              <span className="text-xs text-slate-500">
                {roomsLoading ? '' : `${visibleRooms.length} sala${visibleRooms.length !== 1 ? 's' : ''}`}
              </span>
            </div>

            {roomsLoading && (
              <div className="space-y-2">
                <SkeletonCard />
                <SkeletonCard />
              </div>
            )}

            {!roomsLoading && roomsError && (
              <p className="text-xs text-slate-500 py-4 text-center">{roomsError}</p>
            )}

            {!roomsLoading && !roomsError && visibleRooms.length === 0 && (
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
              <span className="text-xl">📖</span>
              <div>
                <p className="text-sm font-medium text-slate-200 group-hover:text-white transition-colors">
                  Como compartilhar na rede
                </p>
                <p className="text-xs text-slate-500">
                  Guia Tailscale passo a passo
                </p>
              </div>
            </div>
            <span className="text-slate-500 group-hover:text-brand-400 transition-colors">→</span>
          </div>
        </Link>

        {!onboardingDone && (
          <Card variant="subtle" className="animate-slide-up">
            <CardContent className="py-2">
              <Button variant="secondary" onClick={handleShowGuide} className="w-full">
                Abrir Wizard de configuração
              </Button>
            </CardContent>
          </Card>
        )}

        {onboardingDone && (
          <div className="text-center">
            <Button variant="ghost" size="sm" onClick={handleShowGuide}>
              📖 Rever guia de configuração
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
