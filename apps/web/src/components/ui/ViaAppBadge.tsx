import { Icon } from '@/components/ui/Icon';

/**
 * Selo de mensagem/acao feita por app conectado (servidor MCP). Sem modo
 * oculto: quem le sabe que o texto veio de um app em nome do autor.
 * Nome longo corta com reticencias; o nome completo fica no `title`.
 */
export function ViaAppBadge({ name, className = '' }: { name: string; className?: string }) {
  return (
    <span
      className={`inline-flex max-w-[14rem] items-center gap-1 rounded border border-white/[0.1] px-1.5 py-px text-[11px] leading-4 text-ink-muted ${className}`}
      title={`Enviado pelo app conectado ${name}, em nome do autor`}
    >
      <Icon name="link" size={11} className="shrink-0" />
      <span className="truncate">via {name}</span>
    </span>
  );
}
