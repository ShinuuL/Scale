'use client';

import Link from 'next/link';
import { AppShell } from '@/components/layout/AppShell';
import { ADMIN_SECTIONS } from '@/components/admin/adminSections';
import { useAdminGuard } from '@/components/admin/useAdminGuard';
import { Icon } from '@/components/ui/Icon';
import { ProfileMenu } from '@/components/ui/ProfileMenu';
import { Skeleton } from '@/components/ui/Skeleton';

/** Hub da administracao: Moderacao, Metricas e Administradores (so admin). */
export default function AdminHubPage() {
  const { me, setMe, authState } = useAdminGuard();

  return (
    <AppShell
      activeSection="help"
      title="Administração"
      accountSlot={
        authState === 'ready' && me ? (
          <ProfileMenu name={me.name} email={me.email} isAuthenticated user={me} onUserChange={setMe} />
        ) : undefined
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-3xl space-y-6">
          <header>
            <h2 className="text-[28px] font-semibold leading-9 tracking-tight">Administração</h2>
            <p className="mt-2 text-sm text-ink-secondary">
              Ferramentas restritas aos administradores deste servidor.
            </p>
          </header>

          {authState === 'error' && (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200" role="alert">
              Sua conta não carregou. Recarregue a página para tentar de novo.
            </p>
          )}

          {authState === 'loading' && (
            <div role="status" aria-label="Carregando administração" className="grid gap-4">
              <Skeleton />
              <Skeleton />
            </div>
          )}

          {authState === 'ready' && (
            <ul className="grid gap-4 sm:grid-cols-3">
              {ADMIN_SECTIONS.map((section) => (
                <li key={section.id}>
                  <Link
                    href={section.href}
                    className="glass flex h-full flex-col gap-3 p-5 transition-colors hover:border-brand-400/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400"
                  >
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/15 text-brand-300">
                      <Icon name={section.icon} size={20} />
                    </span>
                    <span className="text-base font-semibold text-ink-primary">{section.label}</span>
                    <span className="text-sm text-ink-muted">{section.description}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AppShell>
  );
}
