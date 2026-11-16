'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Radio, RadioGroup } from 'react-aria-components';
import type { AdminRoleAuditEntry, AdminUserRow } from '@scale/shared';
import { AppShell } from '@/components/layout/AppShell';
import { AdminRoleAuditTable } from '@/components/admin/AdminRoleAuditTable';
import { AdminUsersTable } from '@/components/admin/AdminUsersTable';
import { BackToAdminLink } from '@/components/admin/BackToAdminLink';
import { useAdminGuard } from '@/components/admin/useAdminGuard';
import { AppModal } from '@/components/ui/AppModal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ProfileMenu } from '@/components/ui/ProfileMenu';
import { Skeleton } from '@/components/ui/Skeleton';
import { ToastProvider, useToast } from '@/components/ui/Toast';
import { adminRoleErrorMessage, api } from '@/lib/api';

const SEARCH_DEBOUNCE_MS = 300;
const PAGE_SIZE = 25;

type Filter = 'all' | 'admins';
type Pending = { row: AdminUserRow; action: 'grant' | 'revoke' } | null;

export default function AdminUsersPage() {
  return (
    <ToastProvider>
      <AdminUsersContent />
    </ToastProvider>
  );
}

function AdminUsersContent() {
  const { toast } = useToast();
  const { me, setMe, authState, denied } = useAdminGuard();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [audit, setAudit] = useState<AdminRoleAuditEntry[] | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [saving, setSaving] = useState(false);
  // Respostas fora de ordem (busca digitada rapido): so a ultima vale.
  const requestSeq = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const onApiError = useCallback(
    (err: unknown): boolean => {
      if ((err as { status?: number }).status === 403) {
        denied();
        return true;
      }
      return false;
    },
    [denied],
  );

  const loadAudit = useCallback(async () => {
    setAuditError(null);
    try {
      const { entries } = await api.getAdminRoleAudit(50);
      setAudit(entries);
    } catch {
      setAuditError('Não foi possível carregar a auditoria.');
    }
  }, []);

  useEffect(() => {
    if (authState !== 'ready') return;
    const seq = ++requestSeq.current;
    setListError(null);
    api
      .getAdminUsers({ q: debouncedQuery || undefined, filter, limit: PAGE_SIZE })
      .then((page) => {
        if (seq !== requestSeq.current) return;
        setUsers(page.users);
        setNextCursor(page.nextCursor);
      })
      .catch((err: unknown) => {
        if (seq !== requestSeq.current || onApiError(err)) return;
        setListError('Não foi possível carregar os usuários.');
      });
  }, [authState, debouncedQuery, filter, onApiError]);

  useEffect(() => {
    if (authState === 'ready') void loadAudit();
  }, [authState, loadAudit]);

  const loadMore = async () => {
    if (!nextCursor) return;
    const seq = requestSeq.current;
    setLoadingMore(true);
    try {
      const page = await api.getAdminUsers({
        q: debouncedQuery || undefined,
        filter,
        cursor: nextCursor,
        limit: PAGE_SIZE,
      });
      if (seq !== requestSeq.current) return;
      setUsers((prev) => [...(prev ?? []), ...page.users]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      if (!onApiError(err)) toast('Não foi possível carregar mais usuários.', 'error');
    } finally {
      setLoadingMore(false);
    }
  };

  const confirm = async () => {
    if (!pending) return;
    setSaving(true);
    try {
      const updated =
        pending.action === 'grant' ? await api.grantAdmin(pending.row.id) : await api.revokeAdmin(pending.row.id);
      setUsers((prev) => {
        const next = (prev ?? []).map((u) => (u.id === updated.id ? updated : u));
        // No filtro "Admins", quem perdeu o papel sai da lista.
        return filter === 'admins' ? next.filter((u) => u.admin !== null) : next;
      });
      toast(
        pending.action === 'grant'
          ? `${updated.name} agora é admin.`
          : `${updated.name} deixou de ser admin.`,
        'success',
      );
      setPending(null);
      void loadAudit();
    } catch (err) {
      if (onApiError(err)) return;
      toast(adminRoleErrorMessage(err, 'Não foi possível salvar a alteração.'), 'error');
      setPending(null);
    } finally {
      setSaving(false);
    }
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
        <div className="mx-auto max-w-5xl space-y-6">
          <header>
            <BackToAdminLink />
            <h2 className="text-[28px] font-semibold leading-9 tracking-tight">Administradores</h2>
            <p className="mt-2 text-sm text-ink-secondary">
              Usuários cadastrados e papel de administrador. Admin raiz vem do .env e só sai editando o .env;
              ninguém remove o próprio acesso por aqui.
            </p>
          </header>

          {authState === 'error' && (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200" role="alert">
              Sua conta não carregou. Recarregue a página para tentar de novo.
            </p>
          )}

          {authState === 'loading' && (
            <div role="status" aria-label="Carregando usuários" className="grid gap-4">
              <Skeleton />
              <Skeleton />
            </div>
          )}

          {authState === 'ready' && (
            <>
              <section className="glass space-y-4 p-5 sm:p-6" aria-labelledby="admin-users-title">
                <h3 id="admin-users-title" className="sr-only">
                  Usuários
                </h3>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="min-w-0 flex-1">
                    <Input
                      id="admin-users-search"
                      label="Buscar por nome, @nome ou e-mail"
                      type="search"
                      value={query}
                      maxLength={120}
                      onChange={(e) => setQuery(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                  <RadioGroup
                    aria-label="Filtrar usuários"
                    orientation="horizontal"
                    value={filter}
                    onChange={(v) => setFilter(v === 'admins' ? 'admins' : 'all')}
                    className="flex shrink-0 rounded-xl border border-line p-1"
                  >
                    {(
                      [
                        ['all', 'Todos'],
                        ['admins', 'Admins'],
                      ] as const
                    ).map(([value, label]) => (
                      <Radio
                        key={value}
                        value={value}
                        className="cursor-pointer rounded-lg px-3 py-1.5 text-sm text-ink-secondary outline-none transition-colors data-[selected]:bg-brand-500/20 data-[selected]:text-ink-primary data-[focus-visible]:ring-2 data-[focus-visible]:ring-brand-400"
                      >
                        {label}
                      </Radio>
                    ))}
                  </RadioGroup>
                </div>

                {listError && (
                  <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200" role="alert">
                    {listError}
                  </p>
                )}
                {!users && !listError && (
                  <div role="status" aria-label="Carregando lista">
                    <Skeleton />
                  </div>
                )}
                {users && users.length === 0 && (
                  <p className="text-sm text-ink-muted">Nenhum usuário encontrado.</p>
                )}
                {users && users.length > 0 && (
                  <AdminUsersTable
                    users={users}
                    busyId={saving ? (pending?.row.id ?? null) : null}
                    onGrant={(row) => setPending({ row, action: 'grant' })}
                    onRevoke={(row) => setPending({ row, action: 'revoke' })}
                  />
                )}
                {nextCursor && (
                  <div className="flex justify-center">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void loadMore()}
                      disabled={loadingMore}
                      aria-busy={loadingMore}
                    >
                      {loadingMore ? 'Carregando...' : 'Carregar mais'}
                    </Button>
                  </div>
                )}
              </section>

              <AdminRoleAuditTable entries={audit} error={auditError} onRetry={() => void loadAudit()} />
            </>
          )}
        </div>
      </div>

      {pending && (
        <AppModal
          title={pending.action === 'grant' ? 'Tornar admin' : 'Remover admin'}
          icon="shield"
          closeLabel="Fechar"
          onClose={() => setPending(null)}
          locked={saving}
          size="sm"
          role="alertdialog"
          describedBy="admin-role-confirm-text"
        >
          <p id="admin-role-confirm-text" className="text-sm text-ink-secondary">
            {pending.action === 'grant'
              ? `${pending.row.name} passa a ver Moderação, Métricas e Administradores e poderá conceder ou remover o papel de outros usuários.`
              : `${pending.row.name} deixa de acessar as telas de administração.`}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setPending(null)} disabled={saving}>
              Cancelar
            </Button>
            <Button
              variant={pending.action === 'grant' ? 'primary' : 'danger'}
              size="sm"
              onClick={() => void confirm()}
              disabled={saving}
              aria-busy={saving}
            >
              {saving ? 'Salvando...' : pending.action === 'grant' ? 'Confirmar' : 'Remover'}
            </Button>
          </div>
        </AppModal>
      )}
    </AppShell>
  );
}
