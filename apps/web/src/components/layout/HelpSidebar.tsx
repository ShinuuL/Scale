import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';

export function HelpSidebar({ active }: { active: 'tutorial' | 'docs' | 'privacy' | 'metrics' }) {
  return <>
    <h2 className="context-title">Ajuda e recursos</h2>
    <nav aria-label="Recursos do Scale" className="space-y-1">
      <Link href="/tutorial" className="context-link" data-active={active === 'tutorial'} aria-current={active === 'tutorial' ? 'page' : undefined}><Icon name="book" />Como usar</Link>
      <Link href="/docs" className="context-link" data-active={active === 'docs'} aria-current={active === 'docs' ? 'page' : undefined}><Icon name="document" />Documentação</Link>
      <Link href="/privacy" className="context-link" data-active={active === 'privacy'} aria-current={active === 'privacy' ? 'page' : undefined}><Icon name="shield" />Privacidade</Link>
      <Link href="/metrics" className="context-link" data-active={active === 'metrics'} aria-current={active === 'metrics' ? 'page' : undefined}><Icon name="monitor" />Métricas do sistema</Link>
    </nav>
    <p className="mt-6 border-t border-line pt-5 text-xs leading-5 text-ink-muted">As métricas são restritas aos administradores deste servidor.</p>
  </>;
}
