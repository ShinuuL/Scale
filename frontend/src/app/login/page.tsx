'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import Link from 'next/link';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await api.login({ email, password });
      window.location.href = '/';
    } catch (err: unknown) {
      const apiErr = err as { error?: string; status?: number };
      if (apiErr.status === 401) {
        setError('Email ou senha incorretos');
      } else {
        setError(apiErr.error || 'Falha ao fazer login');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main id="main-content" className="min-h-screen flex items-center justify-center p-4">
      <Card variant="glass" className="w-full max-w-md animate-fade-in">
        <CardHeader>
          <CardTitle>Entrar</CardTitle>
          <CardDescription>
            Acesse sua conta para gerenciar salas
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <Input
              label="Email"
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
              className="text-xs text-slate-500 hover:text-slate-400 transition-colors"
            >
              ← Voltar ao início
            </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
