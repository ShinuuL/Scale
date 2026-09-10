'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';

interface InviteLinkCardProps {
  /** ID da sala (UUID) */
  roomId: string;
  /**
   * Token de convite. Quando presente, o link gerado é
   * `{origin}/room/{roomId}?token={inviteToken}` — necessário para salas privadas.
   */
  inviteToken?: string;
  /**
   * Exibir QR code do link. Reservado para uma próxima fase: exige dependência
   * de QR (ex.: qrcode.react), ainda não adicionada ao projeto. Por enquanto o
   * componente renderiza apenas link + botão Copiar.
   */
  showQr?: boolean;
  title?: string;
}

export function InviteLinkCard({
  roomId,
  inviteToken,
  showQr = false,
  title = 'Link de convite',
}: InviteLinkCardProps) {
  const [copied, setCopied] = useState(false);

  // Client-side apenas: usa o origin da janela (http://<host>:3000 no dev),
  // o mesmo padrão usado em RoomControls e na página da sala.
  const inviteUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/room/${roomId}${inviteToken ? `?token=${inviteToken}` : ''}`
      : '';

  const handleCopy = async () => {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card
      variant="subtle"
      className="space-y-3"
      // showQr fica reservado para a fase de QR (sem dependência adicionada)
      data-show-qr={showQr ? 'true' : undefined}
    >
      <CardHeader className="mb-0">
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription>
          {inviteToken
            ? 'Só quem tem este link pode entrar na sala.'
            : 'Compartilhe este link para convidar participantes.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <input
            readOnly
            value={inviteUrl}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Link de convite"
            className="input-base font-mono text-xs flex-1 min-w-0 select-all"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={handleCopy}
            aria-label="Copiar link de convite"
            disabled={!inviteUrl}
          >
            {copied ? '✓ Copiado' : 'Copiar'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}