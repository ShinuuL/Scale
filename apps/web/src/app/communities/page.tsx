'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { ProfileMenu } from '@/components/ui/ProfileMenu';
import { CommunityView } from '@/components/communities/CommunityView';
import { api, type MeUser } from '@/lib/api';

export default function CommunitiesPage() {
  return (
    <Suspense fallback={null}>
      <CommunitiesContent />
    </Suspense>
  );
}

function CommunitiesContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [me, setMe] = useState<MeUser | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'guest' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setStatus('loading');
    api
      .getMe()
      .then(({ user }) => {
        if (active) {
          setMe(user);
          setStatus('ready');
        }
      })
      .catch((error: unknown) => {
        if (active) {
          if ((error as { status?: number }).status === 401)
            router.push('/login?next=/communities');
          else setStatus('error');
        }
      });
    return () => {
      active = false;
    };
  }, [attempt, router]);
  const navigate = (communityId?: string, channelId?: string) => {
    const query = new URLSearchParams();
    if (communityId) query.set('c', communityId);
    if (channelId) query.set('ch', channelId);
    router.push(`/communities${query.size ? `?${query}` : ''}`);
  };
  return (
    <AppShell
      activeSection="communities"
      title="Comunidades"
      hideContext
      accountSlot={
        me && status === 'ready' ? (
          <ProfileMenu
            name={me.name}
            email={me.email}
            isAuthenticated
            user={me}
            onUserChange={setMe}
          />
        ) : undefined
      }
    >
      {status === 'loading' && (
        <p className="p-6" role="status">
          Carregando...
        </p>
      )}
      {status === 'error' && (
        <div className="p-6" role="alert">
          Não foi possível carregar sua conta.{' '}
          <button
            type="button"
            className="text-accent underline"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Tentar novamente
          </button>
        </div>
      )}
      {status === 'ready' && me && (
        <CommunityView
          communityId={params.get('c') ?? undefined}
          channelId={params.get('ch') ?? undefined}
          onNavigate={navigate}
          meId={me.id}
        />
      )}
    </AppShell>
  );
}
