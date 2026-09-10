'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import type { PeerConnection } from '@/hooks/useWebRTC';

interface Participant {
  peerId: string;
  name: string;
  isMuted: boolean;
  isScreenSharing: boolean;
}

interface ParticipantListProps {
  peers: Map<string, PeerConnection>;
  localName?: string;
  localMuted: boolean;
  localScreenSharing: boolean;
}

export function ParticipantList({
  peers,
  localName,
  localMuted,
  localScreenSharing,
}: ParticipantListProps) {
  const remoteParticipants = Array.from(peers.values()).map((p) => ({
    peerId: p.peerId,
    name: p.name,
    isMuted: p.audioMuted,
    isScreenSharing: p.isScreenSharing,
  }));

  const participants: Participant[] = [
    {
      peerId: 'local',
      name: localName || 'Você',
      isMuted: localMuted,
      isScreenSharing: localScreenSharing,
    },
    ...remoteParticipants,
  ];

  return (
    <Card variant="subtle" className="h-full overflow-auto">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Participantes</CardTitle>
          <Badge variant="info">{participants.length}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2" role="list" aria-label="Lista de participantes">
          {participants.map((p) => (
            <li
              key={p.peerId}
              className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-full bg-brand-600/30 border border-brand-500/30 flex items-center justify-center text-xs font-medium text-brand-300 flex-shrink-0">
                  {p.name.charAt(0).toUpperCase()}
                </div>
                <span className="text-sm text-slate-300 truncate">
                  {p.peerId === 'local' ? `${p.name} (Você)` : p.name}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {p.isScreenSharing && (
                  <Badge variant="success">Tela</Badge>
                )}
                <span className="text-xs" aria-label={p.isMuted ? 'Mudo' : 'Com áudio'}>
                  {p.isMuted ? '🔇' : '🎤'}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
