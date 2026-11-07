'use client';

import { useEffect, useState } from 'react';
import { usernameSchema } from '@scale/shared';
import { api } from '@/lib/api';
import { Card, CardHeader, CardDescription, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Logo } from '@/components/ui/Logo';
import { Icon } from '@/components/ui/Icon';
import Link from 'next/link';
import { OAuthLoginButtons } from '@/components/auth/OAuthLogin';

type UsernameState =
  | { kind: 'idle' }
  | { kind: 'invalid'; message: string }
  | { kind: 'checking' }
  | { kind: 'available'; name: string }
  | { kind: 'taken'; name: string }
  | { kind: 'unknown' };

/** Atraso entre a ultima tecla e a consulta ao servidor. */
const USERNAME_CHECK_DELAY_MS = 400;

export default function RegisterPage() {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameState, setUsernameState] = useState<UsernameState>({ kind: 'idle' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Valida o formato na hora e, se estiver certo, pergunta ao servidor se o
  // @nome esta livre (com atraso, para nao consultar a cada tecla).
  useEffect(() => {
    if (!username.trim()) {
      setUsernameState({ kind: 'idle' });
      return;
    }
    const parsed = usernameSchema.safeParse(username);
    if (!parsed.success) {
      setUsernameState({ kind: 'invalid', message: parsed.error.issues[0]?.message ?? 'Nome inválido' });
      return;
    }
    setUsernameState({ kind: 'checking' });
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .checkUsername(parsed.data)
        .then((r) => {
          if (cancelled) return;
          setUsernameState(r.available ? { kind: 'available', name: r.username } : { kind: 'taken', name: r.username });
        })
        .catch(() => {
          // Sem resposta (limite ou rede): o servidor confere de novo no envio.
          if (!cancelled) setUsernameState({ kind: 'unknown' });
        });
    }, USERNAME_CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [username]);

  const usernameError =
    usernameState.kind === 'invalid'
      ? usernameState.message
      : usernameState.kind === 'taken'
        ? `@${usernameState.name} já está em uso`
        : undefined;
  const usernameHelper =
    usernameState.kind === 'checking'
      ? 'Verificando...'
      : usernameState.kind === 'available'
        ? `@${usernameState.name} está disponível ✓`
        : 'Seus amigos vão te encontrar por ele. Letras, números e _.';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsedUsername = usernameSchema.safeParse(username);
    if (!parsedUsername.success) {
      setError('Escolha um nome de usuário válido');
      return;
    }
    if (usernameState.kind === 'taken') {
      setError(`@${usernameState.name} já está em uso`);
      return;
    }

    setLoading(true);

    try {
      await api.register({ name, email, password, username: parsedUsername.data });
      window.location.href = '/';
    } catch (err: unknown) {
      const apiErr = err as { error?: string; status?: number };
      if (apiErr.status === 409 && apiErr.error === 'Username already taken') {
        setUsernameState({ kind: 'taken', name: parsedUsername.data });
        setError(`@${parsedUsername.data} já está em uso`);
      } else if (apiErr.status === 409) {
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
              id="username"
              label="Nome de usuário"
              type="text"
              placeholder="ex.: fulano_123"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={21}
              error={usernameError}
              helperText={usernameHelper}
            />
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

          <OAuthLoginButtons mode="register" />

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
