'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { ROOM_NAME_MIN, ROOM_NAME_MAX } from '@/lib/validation';
import { roomPath } from '@/lib/roomLink';

const STORAGE_KEY = 'scale.onboardingDone';
const STEPS = [
  { id: 1, title: 'Bem-vindo ao Scale' },
  { id: 2, title: 'Criar conta ou entrar' },
  { id: 3, title: 'Criar ou entrar numa sala' },
  { id: 4, title: 'Compartilhar o link da sala' },
  { id: 5, title: 'Microfone e tela' },
] as const;

interface OnboardingWizardProps {
  onComplete: () => void;
  onSkip: () => void;
  /** Criar sala exige sessão — sem login o POST /api/rooms responde 401. */
  isAuthenticated: boolean;
}

export function OnboardingWizard({ onComplete, onSkip, isAuthenticated }: OnboardingWizardProps) {
  const [step, setStep] = useState(1);
  const [roomName, setRoomName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameTouched, setNameTouched] = useState(false);
  const [isInsecureContext, setIsInsecureContext] = useState(false);
  const [shareLink, setShareLink] = useState('/room?id=<UUID-da-sala>');

  const trimmedName = roomName.trim();
  const nameError =
    trimmedName.length === 0
      ? 'Informe um nome para a sala'
      : trimmedName.length < ROOM_NAME_MIN
        ? `O nome precisa de pelo menos ${ROOM_NAME_MIN} caracteres`
        : trimmedName.length > ROOM_NAME_MAX
          ? `O nome pode ter no máximo ${ROOM_NAME_MAX} caracteres`
          : null;

  // Contexto inseguro (HTTP fora do localhost) bloqueia micro/tela no browser.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setShareLink(`${window.location.origin}/room?id=<UUID-da-sala>`);
    if (!window.isSecureContext) {
      setIsInsecureContext(true);
    }
  }, []);

  const handleCreateRoom = async () => {
    setNameTouched(true);
    // Criar sala (temporária ou persistente) exige login: sem sessão não chamamos
    // a API (que responderia 401) — o aviso na tela aponta para /login.
    if (!isAuthenticated) return;
    if (nameError) return;

    setLoading(true);
    setError(null);
    try {
      const result = await api.createRoom({
        name: trimmedName,
        isPersistent: false,
        isPrivate: false,
        maxParticipants: 8,
      });
      localStorage.setItem(STORAGE_KEY, 'true');
      onComplete();
      window.location.href = roomPath(result.room.id);
    } catch (err) {
      setError('Falha ao criar sala. Tente novamente.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleJoinRoom = () => {
    if (!roomCode.trim()) return;
    localStorage.setItem(STORAGE_KEY, 'true');
    onComplete();
    window.location.href = roomPath(roomCode.trim());
  };

  const nextStep = () => setStep((s) => Math.min(s + 1, STEPS.length));
  const prevStep = () => setStep((s) => Math.max(s - 1, 1));

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-surface-secondary p-4">
      <Card variant="glass" className="w-full max-w-lg">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{STEPS[step - 1].title}</CardTitle>
              <CardDescription>
                Passo {step} de {STEPS.length}
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={onSkip}>
              Pular
            </Button>
          </div>

          {/* Progress bar */}
          <div className="mt-4 flex gap-1" role="progressbar" aria-label="Progresso do guia" aria-valuenow={step} aria-valuemin={1} aria-valuemax={STEPS.length}>
            {STEPS.map((s, i) => (
              <div
                key={s.id}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i + 1 <= step ? 'bg-brand-500' : 'bg-white/10'
                }`}
              />
            ))}
          </div>
        </CardHeader>

        <CardContent>
          {/* Step 1: Intro */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="text-center space-y-3 py-4">
                <div className="flex justify-center text-accent"><Icon name="mic" size={48} /></div>
                <p className="text-slate-300 text-sm leading-relaxed">
                  O Scale faz chamadas de voz com compartilhamento de tela direto no
                  navegador, de 2 a 8 participantes na mesma sala. O áudio e o vídeo
                  viajam direto entre os navegadores (P2P), sem gravação.
                </p>
                <ul className="text-left text-sm text-slate-300 space-y-1.5 inline-block">
                  <li className="flex gap-2">
                    <Icon name="check" size={16} className="mt-0.5 shrink-0 text-accent" />
                    <span>Criar conta ou entrar com sua conta</span>
                  </li>
                  <li className="flex gap-2">
                    <Icon name="check" size={16} className="mt-0.5 shrink-0 text-accent" />
                    <span>Criar uma sala e compartilhar o link</span>
                  </li>
                  <li className="flex gap-2">
                    <Icon name="check" size={16} className="mt-0.5 shrink-0 text-accent" />
                    <span>Falar e mostrar a tela durante a chamada</span>
                  </li>
                </ul>
              </div>
              <div className="flex justify-end">
                <Button onClick={nextStep}>Começar</Button>
              </div>
            </div>
          )}

          {/* Step 2: Account */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="glass-subtle p-4 rounded-xl space-y-3">
                <p className="text-sm text-slate-300 leading-relaxed">
                  Você precisa de uma conta para <strong className="text-white">criar</strong> uma
                  sala. Entrar numa sala existente (pelo link ou pelo código) não exige login.
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Link href="/register" className="flex-1">
                    <Button className="w-full">Criar conta</Button>
                  </Link>
                  <Link href="/login" className="flex-1">
                    <Button variant="secondary" className="w-full">
                      Entrar
                    </Button>
                  </Link>
                </div>
              </div>
              <p className="text-xs text-slate-400">
                {isAuthenticated
                  ? 'Você já está logado — pode seguir direto para criar sua sala.'
                  : 'Depois de criar a conta, volte para esta tela e continue o guia.'}
              </p>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={prevStep}>Voltar</Button>
                <Button onClick={nextStep}>
                  {isAuthenticated ? 'Continuar' : 'Já tenho conta'}
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Create/Join room */}
          {step === 3 && (
            <div className="space-y-4">
              {/* Create room */}
              <div className="glass-subtle p-4 rounded-xl space-y-3">
                <h4 className="text-sm font-medium text-white">Criar Nova Sala</h4>
                {!isAuthenticated ? (
                  <Banner
                    variant="warning"
                    icon={<Icon name="key" size={18} />}
                    title="Faça login para criar uma sala"
                    description={
                      <>
                        Criar sala exige uma conta.{' '}
                        <Link href="/login" className="underline hover:text-white">
                          Entrar agora
                        </Link>
                      </>
                    }
                  />
                ) : null}
                <Input
                  label="Nome da sala"
                  placeholder="Ex: Reunião de equipe"
                  value={roomName}
                  maxLength={ROOM_NAME_MAX}
                  onChange={(e) => setRoomName(e.target.value)}
                  onBlur={() => setNameTouched(true)}
                  error={nameTouched && nameError ? nameError : undefined}
                  disabled={!isAuthenticated}
                />
                <Button
                  onClick={handleCreateRoom}
                  disabled={!isAuthenticated || loading}
                  className="w-full"
                >
                  {loading ? 'Criando...' : 'Criar Sala'}
                </Button>
                <p className="text-xs text-slate-400">
                  A sala criada aqui é temporária (expira sozinha) e aberta para quem
                  tiver o link.
                </p>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/10" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="px-3 bg-slate-900 text-slate-400">ou</span>
                </div>
              </div>

              {/* Join room */}
              <div className="glass-subtle p-4 rounded-xl space-y-3">
                <h4 className="text-sm font-medium text-white">Entrar numa Sala</h4>
                <p className="text-xs text-slate-400">
                  Cole o código que aparece no link da sala (não precisa de login).
                </p>
                <Input
                  label="Código da sala (ID)"
                  placeholder="UUID da sala"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value)}
                />
                <Button
                  variant="secondary"
                  onClick={handleJoinRoom}
                  disabled={!roomCode.trim()}
                  className="w-full"
                >
                  Entrar na Sala
                </Button>
              </div>

              <div className="flex justify-between">
                <Button variant="ghost" onClick={prevStep}>Voltar</Button>
                <Button variant="ghost" onClick={nextStep}>Continuar</Button>
              </div>

              {error && (
                <p className="text-xs text-red-400">{error}</p>
              )}
            </div>
          )}

          {/* Step 4: Share the room link */}
          {step === 4 && (
            <div className="space-y-4">
              <div className="glass-subtle p-4 rounded-xl space-y-3">
                <p className="text-sm text-slate-300 leading-relaxed">
                  Toda sala tem um link próprio. Dentro da sala, use o botão de convite
                  para copiar e enviar para quem vai participar:
                </p>
                <code className="block bg-slate-900/80 p-3 rounded-lg text-xs text-brand-300 font-mono break-all select-all">
                  {shareLink}
                </code>
                <p className="text-xs text-slate-400">
                  Quem abrir o link entra na mesma sala — não precisa criar conta nem
                  instalar nada.
                </p>
              </div>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={prevStep}>Voltar</Button>
                <Button onClick={nextStep}>Continuar</Button>
              </div>
            </div>
          )}

          {/* Step 5: Mic + screen */}
          {step === 5 && (
            <div className="space-y-4">
              {isInsecureContext && (
                <Banner
                  variant="warning"
                  icon={<Icon name="lock" size={18} />}
                  title="Conexão não segura — microfone/tela bloqueados"
                  description="Este acesso via HTTP bloqueia microfone e compartilhamento de tela no browser. Use HTTPS (ou localhost) para chamadas com áudio."
                />
              )}
              <div className="glass-subtle p-4 rounded-xl space-y-3">
                <p className="text-sm text-slate-300 leading-relaxed">
                  Ao entrar na sala, o navegador vai pedir permissão para usar o
                  microfone e, quando você compartilhar, a tela. Aceite para falar e
                  mostrar o que quiser.
                </p>
                <ul className="space-y-2 text-sm text-slate-300">
                  <li className="flex gap-2">
                    <Icon name="check" size={16} className="mt-0.5 shrink-0 text-accent" />
                    <span>Permissão de microfone: pedida ao entrar na sala</span>
                  </li>
                  <li className="flex gap-2">
                    <Icon name="check" size={16} className="mt-0.5 shrink-0 text-accent" />
                    <span>Compartilhar tela: botão dentro da sala, cancelavel a qualquer momento</span>
                  </li>
                  <li className="flex gap-2">
                    <Icon name="check" size={16} className="mt-0.5 shrink-0 text-accent" />
                    <span>Fora do localhost, o navegador exige HTTPS para liberar microfone e tela</span>
                  </li>
                </ul>
              </div>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={prevStep}>Voltar</Button>
                <Button onClick={onComplete}>Começar a usar</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
