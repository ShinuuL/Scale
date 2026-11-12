'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { communityInviteCodeSchema } from '@scale/shared';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/Card';
import { Logo } from '@/components/ui/Logo';

const STORAGE_KEY = 'scale:community-invite';
type Preview = {
  community: { id: string; name: string; memberCount: number };
  alreadyMember: boolean;
};

export default function InvitePage() {
  const router = useRouter();
  const [code, setCode] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    let stored = '';
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null') as {
        code?: unknown;
        timestamp?: unknown;
      } | null;
      if (
        saved &&
        typeof saved.code === 'string' &&
        typeof saved.timestamp === 'number' &&
        Date.now() - saved.timestamp >= 0 &&
        Date.now() - saved.timestamp < 10 * 60 * 1000
      )
        stored = saved.code;
    } catch {
      /* Convite salvo inválido. */
    }
    const candidate = hash || stored;
    if (hash)
      window.history.replaceState(
        window.history.state,
        '',
        window.location.pathname + window.location.search,
      );
    const parsed = communityInviteCodeSchema.safeParse({ code: candidate });
    if (!parsed.success) {
      sessionStorage.removeItem(STORAGE_KEY);
      setError('Este convite é inválido ou não está mais disponível.');
      setLoading(false);
      return;
    }
    const inviteCode = parsed.data.code;
    if (hash)
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ code: inviteCode, timestamp: Date.now() }),
      );
    setCode(inviteCode);
    let active = true;
    api
      .previewCommunityInvite(inviteCode)
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch((err: unknown) => {
        if (!active) return;
        const status = (err as { status?: number })?.status;
        if (status === 401) {
          window.location.href = '/login?next=%2Finvite';
        } else if (status === 404) {
          sessionStorage.removeItem(STORAGE_KEY);
          setError('Este convite é inválido ou não está mais disponível.');
        } else {
          setError('Não foi possível carregar o convite. Tente novamente.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [router]);

  async function accept() {
    if (!code || accepting) return;
    setAccepting(true);
    setError(null);
    try {
      const result = await api.acceptCommunityInvite(code);
      sessionStorage.removeItem(STORAGE_KEY);
      router.push(`/communities?c=${encodeURIComponent(result.communityId)}`);
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 401) window.location.href = '/login?next=%2Finvite';
      else if (status === 404) {
        sessionStorage.removeItem(STORAGE_KEY);
        setError('Este convite é inválido ou não está mais disponível.');
      } else setError('Não foi possível aceitar o convite. Tente novamente.');
    } finally {
      setAccepting(false);
    }
  }

  return (
    <main id="main-content" className="auth-page">
      <Link href="/" className="auth-brand" aria-label="Scale — voltar às salas">
        <Logo variant="full" size={36} priority />
      </Link>
      <Card variant="glass" className="w-full max-w-md">
        <CardHeader>
          <h1 className="text-[28px] font-semibold tracking-tight">Convite para comunidade</h1>
          <CardDescription>Entre para conversar com os membros da comunidade.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading && <p role="status">Carregando convite...</p>}
          {preview && !loading && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold">{preview.community.name}</h2>
                <p className="text-sm text-ink-muted">
                  {preview.community.memberCount}{' '}
                  {preview.community.memberCount === 1 ? 'membro' : 'membros'}
                </p>
              </div>
              <Button className="w-full" onClick={accept} disabled={accepting}>
                {accepting
                  ? 'Entrando...'
                  : preview.alreadyMember
                    ? 'Abrir comunidade'
                    : 'Aceitar convite'}
              </Button>
            </div>
          )}
          {error && (
            <Banner variant="error" className="mt-4">
              {error}
            </Banner>
          )}
          <Link href="/" className="mt-4 inline-block text-sm text-accent">
            Voltar às salas
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
