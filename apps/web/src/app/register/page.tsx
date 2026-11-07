'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { Card, CardHeader, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Logo } from '@/components/ui/Logo';
import { Icon } from '@/components/ui/Icon';
import Link from 'next/link';
import { GithubLoginButton } from '@/components/auth/GithubLogin';

export default function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await api.register({ name, email, password });
      window.location.href = '/';
    } catch (err: unknown) {
      const apiErr = err as { error?: string; status?: number };
      if (apiErr.status === 409) {
        setError('Este email já está registrado');
      } else {
        setError(apiErr.error || 'Falha ao criar conta');
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
          <h1 className="text-[28px] font-semibold tracking-tight">Crie sua conta</h1>
          <CardDescription>
            Um espaço para seus amigos e sua equipe.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Nome"
              type="text"
              placeholder="Seu nome"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
            />
            <Input
              label="E-mail"
              type="email"
              placeholder="seu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
            <Input
              label="Senha"
              type="password"
              placeholder="Mínimo 8 caracteres"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />

            {error && (
              <p className="text-sm text-red-400 bg-red-500/10 p-3 rounded-lg" role="alert">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Criando conta...' : 'Criar conta'}
            </Button>
          </form>

          <GithubLoginButton label="Criar conta com GitHub" />

          <div className="mt-4 text-center">
            <Link
              href="/login"
              className="text-sm text-brand-400 hover:text-brand-300 transition-colors"
            >
              Já tem conta? Entrar
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
