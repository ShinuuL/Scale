'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { callEndedSchema, callInviteSchema, type CallEndReason, type CallInvite } from '@scale/shared';
import { api } from '@/lib/api';
import { roomPath } from '@/lib/roomLink';
import { getWsUrl } from '@/hooks/useSocket';
import { Icon } from '@/components/ui/Icon';
import { UserAvatar } from '@/components/friends/UserAvatar';

/** Paginas sem sessao: nem tenta conectar. */
const SKIP_PATHS = ['/login', '/register'];

/** Aviso que fica na tela depois que a chamada feita termina. */
const NOTICE_MS = 4000;

const OUTGOING_END_TEXT: Record<CallEndReason, string> = {
  accepted: 'atendeu',
  declined: 'recusou a chamada',
  cancelled: 'chamada cancelada',
  missed: 'não atendeu',
};

/**
 * Toque sintetizado (Web Audio): dois bipes a cada 2 s, sem arquivo de som.
 * O navegador pode bloquear o audio ate o primeiro clique na pagina; nesse
 * caso a tela aparece em silencio, e isso e aceitavel.
 */
function startRingtone(): () => void {
  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioContext();
  } catch {
    return () => {};
  }
  const audio = ctx;
  const beep = (at: number) => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, at);
    osc.frequency.setValueAtTime(660, at + 0.18);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.18, at + 0.03);
    gain.gain.setValueAtTime(0.18, at + 0.32);
    gain.gain.linearRampToValueAtTime(0, at + 0.38);
    osc.connect(gain).connect(audio.destination);
    osc.start(at);
    osc.stop(at + 0.4);
  };
  const ring = () => {
    const t = audio.currentTime + 0.05;
    beep(t);
    beep(t + 0.5);
  };
  void audio.resume().catch(() => {});
  ring();
  const timer = setInterval(ring, 2000);
  if ('vibrate' in navigator) navigator.vibrate?.([400, 200, 400]);
  return () => {
    clearInterval(timer);
    if ('vibrate' in navigator) navigator.vibrate?.(0);
    void audio.close().catch(() => {});
  };
}

/** Ondas saindo do avatar (tela de chamada). */
function RingingAvatar({ invite }: { invite: CallInvite }) {
  return (
    <div className="relative flex h-28 w-28 items-center justify-center">
      {[0, 0.8, 1.6].map((delay) => (
        <span
          key={delay}
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-brand-400/40 motion-safe:animate-call-ripple"
          style={{ animationDelay: `${delay}s` }}
        />
      ))}
      <UserAvatar
        userId={invite.peer.id}
        name={invite.peer.name}
        avatarUpdatedAt={invite.peer.avatarUpdatedAt}
        size="xl"
        className="relative ring-4 ring-brand-400/60"
      />
    </div>
  );
}

function IncomingCallScreen({
  invite,
  busy,
  error,
  onAccept,
  onDecline,
}: {
  invite: CallInvite;
  busy: boolean;
  error: string | null;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const acceptRef = useRef<HTMLButtonElement>(null);
  useEffect(() => acceptRef.current?.focus(), []);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="incoming-call-title"
      aria-describedby="incoming-call-desc"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-forest-950/85 p-4 backdrop-blur-md animate-fade-in"
    >
      <div className="glass flex w-full max-w-sm flex-col items-center gap-6 rounded-3xl px-8 py-10 text-center animate-slide-up">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-brand-300">Chamada recebida</p>
        <RingingAvatar invite={invite} />
        <div className="min-w-0">
          <h2 id="incoming-call-title" className="truncate text-2xl font-semibold text-white">
            {invite.peer.name}
          </h2>
          <p id="incoming-call-desc" className="mt-1 truncate text-sm text-slate-300">
            {invite.peer.username ? `@${invite.peer.username}` : 'Amigo'} está te ligando…
          </p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
        <div className="flex items-center gap-10">
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={onDecline}
              disabled={busy}
              aria-label={`Recusar chamada de ${invite.peer.name}`}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-white shadow-lg shadow-red-600/30 transition hover:bg-red-500 active:scale-95 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-red-400"
            >
              <Icon name="phone" size={26} className="rotate-[135deg]" />
            </button>
            <span className="text-xs text-slate-300">Recusar</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <button
              ref={acceptRef}
              type="button"
              onClick={onAccept}
              disabled={busy}
              aria-label={`Atender chamada de ${invite.peer.name}`}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-400 active:scale-95 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-300"
            >
              <Icon name="phone" size={26} className="motion-safe:animate-call-shake" />
            </button>
            <span className="text-xs text-slate-300">Atender</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function OutgoingCallCard({ invite, onCancel }: { invite: CallInvite; onCancel: () => void }) {
  return (
    <div
      role="status"
      className="glass fixed bottom-4 right-4 z-[90] flex items-center gap-3 rounded-2xl px-4 py-3 shadow-xl animate-slide-up"
    >
      <div className="relative">
        <span aria-hidden="true" className="absolute inset-0 rounded-full bg-brand-400/40 motion-safe:animate-call-ripple" />
        <UserAvatar
          userId={invite.peer.id}
          name={invite.peer.name}
          avatarUpdatedAt={invite.peer.avatarUpdatedAt}
          className="relative"
        />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-white">Chamando {invite.peer.name}…</p>
        <p className="truncate text-xs text-slate-400">Aguardando atender</p>
      </div>
      <button
        type="button"
        onClick={onCancel}
        aria-label={`Cancelar chamada para ${invite.peer.name}`}
        className="ml-2 flex h-9 w-9 items-center justify-center rounded-full bg-red-600 text-white transition hover:bg-red-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400"
      >
        <Icon name="phone" size={16} className="rotate-[135deg]" />
      </button>
    </div>
  );
}

/**
 * Central de chamadas, montada no layout: em qualquer pagina, a conta logada
 * ve a tela de chamada recebida (com toque) e o cartao "Chamando…" das
 * chamadas que fez. Sem sessao nao conecta.
 */
export function CallCenter() {
  const [enabled, setEnabled] = useState(false);
  const [incoming, setIncoming] = useState<CallInvite[]>([]);
  const [outgoing, setOutgoing] = useState<CallInvite[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const outgoingRef = useRef(outgoing);
  outgoingRef.current = outgoing;

  useEffect(() => {
    if (SKIP_PATHS.some((p) => window.location.pathname.startsWith(p))) return;
    api
      .getMe()
      .then(() => setEnabled(true))
      .catch(() => {});
  }, []);

  const reload = useCallback(() => {
    api
      .getActiveCalls()
      .then((r) => {
        setIncoming(r.incoming);
        setOutgoing(r.outgoing);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const sock = io(getWsUrl(), {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnection: true,
      timeout: 20000,
    });
    // (Re)conexao pode ter perdido eventos: busca o que esta tocando agora.
    sock.on('connect', reload);
    sock.on('call:incoming', (raw: unknown) => {
      const p = callInviteSchema.safeParse(raw);
      if (p.success) setIncoming((prev) => [...prev.filter((c) => c.callId !== p.data.callId), p.data]);
    });
    sock.on('call:outgoing', (raw: unknown) => {
      const p = callInviteSchema.safeParse(raw);
      if (p.success) setOutgoing((prev) => [...prev.filter((c) => c.callId !== p.data.callId), p.data]);
    });
    sock.on('call:ended', (raw: unknown) => {
      const p = callEndedSchema.safeParse(raw);
      if (!p.success) return;
      const mine = outgoingRef.current.find((c) => c.callId === p.data.callId);
      if (mine && p.data.reason !== 'cancelled') setNotice(`${mine.peer.name} ${OUTGOING_END_TEXT[p.data.reason]}`);
      setIncoming((prev) => prev.filter((c) => c.callId !== p.data.callId));
      setOutgoing((prev) => prev.filter((c) => c.callId !== p.data.callId));
    });
    return () => {
      sock.disconnect();
    };
  }, [enabled, reload]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  const current = incoming[0] ?? null;
  const ringingId = current?.callId ?? null;

  // Toca enquanto houver chamada recebida na tela.
  useEffect(() => {
    if (!ringingId) return;
    setError(null);
    return startRingtone();
  }, [ringingId]);

  const accept = async () => {
    if (!current) return;
    setBusy(true);
    try {
      const { roomId, inviteToken } = await api.acceptCall(current.callId);
      window.location.href = roomPath(roomId, inviteToken);
    } catch {
      setError('A chamada já terminou.');
      setIncoming((prev) => prev.filter((c) => c.callId !== current.callId));
      setBusy(false);
    }
  };

  const decline = async () => {
    if (!current) return;
    setBusy(true);
    setIncoming((prev) => prev.filter((c) => c.callId !== current.callId));
    await api.declineCall(current.callId).catch(() => {});
    setBusy(false);
  };

  const cancel = (invite: CallInvite) => {
    setOutgoing((prev) => prev.filter((c) => c.callId !== invite.callId));
    void api.cancelCall(invite.callId).catch(() => {});
  };

  return (
    <>
      {current && (
        <IncomingCallScreen invite={current} busy={busy} error={error} onAccept={accept} onDecline={decline} />
      )}
      {outgoing[0] && <OutgoingCallCard invite={outgoing[0]} onCancel={() => cancel(outgoing[0])} />}
      {notice && !outgoing[0] && (
        <div role="status" className="glass fixed bottom-4 right-4 z-[90] rounded-2xl px-4 py-3 text-sm text-white shadow-xl animate-slide-up">
          {notice}
        </div>
      )}
    </>
  );
}
