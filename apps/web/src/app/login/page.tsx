'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card, CardHeader, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Logo } from '@/components/ui/Logo';
import { Icon } from '@/components/ui/Icon';
import Link from 'next/link';
import { OAuthLoginButtons, readOAuthError } from '@/components/auth/OAuthLogin';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Erro do login externo (/login?github=<codigo> ou ?google=<codigo>). Em efeito, nao no
  // estado inicial: a pagina e pre-renderizada sem query (export estatico).
  useEffect(() => {
    const oauthError = readOAuthError();
    if (oauthError) setError(oauthError);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await api.login({ email: email.trim(), password });
      window.location.href = '/';
    } catch (err: unknown) {
      const apiErr = err as { error?: string; status?: number };
      if (apiErr.status === 401) {
        setError('Usuário ou senha incorretos');
      } else {
        setError(apiErr.error || 'Falha ao fazer login');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main id="main-content" className="auth-page">
      <Link href="/" className="auth-brand" aria-label="Scale — voltar às salas"><Logo variant="full" size={36} priority /></Link>
      <Card variant="glass" className="w-full max-w-md">
        <CardHeader>
          <h1 className="text-[28px] font-semibold tracking-tight">Entrar no Scale</h1>
          <CardDescription>
            Volte para suas salas e conversas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              id="login"
              label="E-mail ou nome de usuário"
              type="text"
              placeholder="seu@email.com ou @usuario"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
            />
            <Input
              label="Senha"
              type="password"
              placeholder="Sua senha"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />

            {error && (
              <p className="text-sm text-red-400 bg-red-500/10 p-3 rounded-lg" role="alert">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Entrando...' : 'Entrar'}
            </Button>
          </form>

          <OAuthLoginButtons />

          <div className="mt-4 text-center">
            <Link
              href="/register"
              className="text-sm text-brand-400 hover:text-brand-300 transition-colors"
            >
              Não tem conta? Criar conta
            </Link>
          </div>

          <div className="mt-3 text-center">
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition-colors"
            >
              <Icon name="arrowLeft" size={12} /> Voltar às salas
            </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
