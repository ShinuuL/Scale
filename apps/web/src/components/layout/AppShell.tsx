'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Logo } from '@/components/ui/Logo';

export interface AppShellProps {
  activeSection: 'rooms' | 'friends' | 'communities' | 'room' | 'help';
  title?: string;
  contextSidebar?: ReactNode;
  hideContext?: boolean;
  actions?: ReactNode;
  accountSlot?: ReactNode;
  children: ReactNode;
  onNavigate?: (href: string) => boolean;
}

const sections: { href: string; section: AppShellProps['activeSection']; label: string; icon: IconName }[] = [
  { href: '/', section: 'rooms', label: 'Salas', icon: 'speaker' },
  { href: '/friends', section: 'friends', label: 'Amigos', icon: 'users' },
  { href: '/communities', section: 'communities', label: 'Comunidades', icon: 'hash' },
  { href: '/tutorial', section: 'help', label: 'Ajuda', icon: 'book' },
];

/** Visual composition only. Account, connection and call state belong to each route. */
export function AppShell({ activeSection, title, contextSidebar, hideContext = false, actions, accountSlot, children, onNavigate }: AppShellProps) {
  const [compact, setCompact] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    const sync = () => { setCompact(media.matches); if (!media.matches) setContextOpen(false); };
    sync(); media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  const contextRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contextFocusTarget = useRef<string | null>(null);
  useEffect(() => { if (contextOpen) contextRef.current?.showModal(); }, [contextOpen]);
  const allowNavigation = (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (onNavigate && !onNavigate(href)) event.preventDefault();
  };
  return (
    <div className={`app-shell${hideContext ? ' app-shell-no-context' : ''}`}>
      <aside className="app-rail" aria-label="Navegação principal">
        <Link href="/" aria-label="Scale — Salas" onClick={(event) => allowNavigation(event, '/')} className="flex h-11 w-11 items-center justify-center rounded-lg">
          <Logo size={34} priority />
        </Link>
        <nav className="app-rail-nav" aria-label="Áreas do Scale">
          {sections.map(({ href, section, label, icon }) => (
            <Link key={href} href={href} className="app-nav-item" aria-current={activeSection === section || (section === 'rooms' && activeSection === 'room') ? 'page' : undefined} onClick={(event) => allowNavigation(event, href)}>
              <Icon name={icon} size={21} /><span>{label}</span>
            </Link>
          ))}
        </nav>
      </aside>
      {!hideContext && <aside className="app-context" aria-label="Painel lateral">
        {!compact && (contextSidebar ?? <><h2 className="context-title">Scale</h2><p className="text-sm leading-6 text-ink-secondary">Um lugar para conversar e compartilhar a tela.</p></>)}
      </aside>}
      <div className="app-workspace">
        <header className="app-header">
          <div className="flex min-w-0 items-center gap-3">
            <span className="app-mobile-logo"><Logo size={26} /></span>
            {!hideContext && contextSidebar && <button ref={triggerRef} type="button" className="app-context-trigger room-icon-button" aria-label="Abrir painel lateral" aria-haspopup="dialog" onClick={() => setContextOpen(true)}><Icon name="archive" size={19} /></button>}
            <h1 className="truncate">{title ?? 'Scale'}</h1>
          </div>
          <div className="app-header-actions flex shrink-0 items-center gap-2">
            {actions}
            <button type="button" className="room-icon-button" data-app-settings-trigger aria-label="Aplicativo e notificações" onClick={(event) => window.dispatchEvent(new CustomEvent('scale:app-settings', { detail: { trigger: event.currentTarget } }))}><Icon name="monitor" size={18} /></button>
            {accountSlot}
          </div>
        </header>
        <main id="main-content" className="app-main">{children}</main>
      </div>
      {!hideContext && contextSidebar && contextOpen && <dialog ref={contextRef} className="app-context-dialog" aria-label="Painel lateral" onClose={() => {
        setContextOpen(false);
        const focusId = contextFocusTarget.current;
        contextFocusTarget.current = null;
        if (focusId) requestAnimationFrame(() => document.getElementById(focusId)?.focus());
        else triggerRef.current?.focus();
      }} onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest('a,button') && !target.closest('[data-keep-context-open]')) {
          contextFocusTarget.current = target.closest('[data-context-focus-target]')?.getAttribute('data-context-focus-target') ?? null;
          contextRef.current?.close();
        }
      }}>
        <div className="mb-5 flex items-center justify-between gap-3"><span className="text-sm font-semibold">Painel lateral</span><button type="button" className="room-icon-button" aria-label="Fechar painel lateral" onClick={() => contextRef.current?.close()}><Icon name="close" size={18} /></button></div>
        {contextSidebar}
      </dialog>}
    </div>
  );
}
