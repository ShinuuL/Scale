'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AdminModerationState, ModerationAuditEntry } from '@scale/shared';
import { AppShell } from '@/components/layout/AppShell';
import { ModerationAuditTable } from '@/components/admin/ModerationAuditTable';
import { ModerationSettingsForm } from '@/components/admin/ModerationSettingsForm';
import { ModerationTestSection } from '@/components/admin/ModerationTestSection';
import { Banner } from '@/components/ui/Banner';
import { Icon } from '@/components/ui/Icon';
import { ProfileMenu } from '@/components/ui/ProfileMenu';
import { Skeleton } from '@/components/ui/Skeleton';
import { ToastProvider, useToast } from '@/components/ui/Toast';
import { api, type MeUser } from '@/lib/api';
import { setFlash } from '@/lib/flash';
import { ADMIN_ONLY_FLASH, PROVIDER_LABELS } from '@/components/admin/moderationLabels';

export default function AdminModerationPage() {
  return (
    <ToastProvider>
      <AdminModerationContent />
    </ToastProvider>
  );
}

type AuthState = 'loading' | 'ready' | 'error';

function AdminModerationContent() {
  const router = useRouter();
  const { toast } = useToast();
  const [me, setMe] = useState<MeUser | null>(null);
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [state, setState] = useState<AdminModerationState | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const [audit, setAudit] = useState<ModerationAuditEntry[] | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);

  const loadAudit = useCallback(async () => {
    setAuditError(null);
    try {
      const { entries } = await api.getAdminModerationAudit(50);
      setAudit(entries);
    } catch {
      setAuditError('Não foi possível carregar a auditoria.');
    }
  }, []);

  // Sessao e permissao: sem login vai para /login; logado sem isAdmin volta
  // para a home com aviso. O servidor repete a checagem (403) em toda rota.
  useEffect(() => {
    let alive = true;
    (async () => {
      let user: MeUser;
      try {
        user = (await api.getMe()).user;
      } catch (err) {
        if (!alive) return;
        if ((err as { status?: number }).status === 401) {
          router.replace('/login');
          return;
        }
        setAuthState('error');
        return;
      }
      if (!alive) return;
      if (user.isAdmin !== true) {
        setFlash(ADMIN_ONLY_FLASH, 'error');
        router.replace('/');
        return;
      }
      setMe(user);
      setAuthState('ready');
      try {
        const current = await api.getAdminModeration();
        if (alive) setState(current);
      } catch (err) {
        if (!alive) return;
        if ((err as { status?: number }).status === 403) {
          setFlash(ADMIN_ONLY_FLASH, 'error');
          router.replace('/');
          return;
        }
        setStateError('Não foi possível carregar a configuração da moderação.');
      }
      void loadAudit();
    })();
    return () => {
      alive = false;
    };
  }, [router, loadAudit]);

  const onStateChange = (next: AdminModerationState) => {
    setState(next);
    void loadAudit();
  };

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
            <h2 className="text-[28px] font-semibold leading-9 tracking-tight">Moderação</h2>
            <p className="mt-2 text-sm text-ink-secondary">
              Configuração em tempo de execução do assistente de moderação. O que for definido aqui vale
              sobre o .env; campo vazio volta ao .env.
            </p>
          </header>

          <Banner
            variant="info"
            icon={<Icon name="shield" size={18} />}
            title="Tudo o que é configurado aqui é exibido aos usuários em /privacy e no termo de partilha de tela."
            description="Não existe monitoramento oculto. A configuração efetiva é pública (GET /api/moderation/config) e toda alteração fica na auditoria."
          />

          {authState === 'error' && (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200" role="alert">
              Sua conta não carregou. Recarregue a página para tentar de novo.
            </p>
          )}

          {authState === 'loading' && (
            <div role="status" aria-label="Carregando configuração" className="grid gap-4">
              <Skeleton />
              <Skeleton />
            </div>
          )}

          {stateError && (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200" role="alert">
              {stateError}
            </p>
          )}

          {state && (
            <>
              <p className="text-xs text-ink-muted">
                Efetivo agora: {PROVIDER_LABELS[state.effective.provider]}
                {state.effective.provider === 'claude' ? ` (${state.effective.model})` : ''}, análise de tela{' '}
                {state.effective.screen ? 'ligada' : 'desligada'}
                {state.updatedBy && state.updatedAt
                  ? `. Última alteração por ${state.updatedBy.name} em ${new Date(state.updatedAt).toLocaleString('pt-BR')}.`
                  : '.'}
              </p>
              <ModerationSettingsForm state={state} onStateChange={onStateChange} notify={toast} />
              <ModerationTestSection />
              <ModerationAuditTable entries={audit} error={auditError} onRetry={() => void loadAudit()} />
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
