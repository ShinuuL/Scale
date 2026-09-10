'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { TailscaleStatus } from '@/lib/validation';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { buildTailscaleHttpsUrl } from '@/lib/tailscale';

const STORAGE_KEY = 'scale.onboardingDone';
const STEPS = [
  { id: 1, title: 'Bem-vindo ao Scale' },
  { id: 2, title: 'Instalar Tailscale' },
  { id: 3, title: 'Configurar Tailscale' },
  { id: 4, title: 'Verificar Conectividade' },
  { id: 5, title: 'Criar ou Entrar numa Sala' },
] as const;

interface TailscaleWizardProps {
  onComplete: () => void;
  onSkip: () => void;
}

export function TailscaleWizard({ onComplete, onSkip }: TailscaleWizardProps) {
  const [step, setStep] = useState(1);
  const [tailscaleStatus, setTailscaleStatus] = useState<TailscaleStatus | null>(null);
  const [tailscaleIp, setTailscaleIp] = useState<string>('');
  const [roomName, setRoomName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isInsecureContext, setIsInsecureContext] = useState(false);

  const detectOS = (): string => {
    if (typeof window === 'undefined') return 'unknown';
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('win')) return 'Windows';
    if (ua.includes('mac')) return 'macOS';
    if (ua.includes('linux')) return 'Linux';
    return 'unknown';
  };

  const getInstallInstructions = (os: string) => {
    switch (os) {
      case 'Windows':
        return {
          url: 'https://tailscale.com/download/windows',
          command: 'tailscale up',
          steps: [
            'Baixe o Tailscale em tailscale.com/download/windows',
            'Execute o instalador',
            'Abra o Tailscale e faça login',
            'Execute "tailscale up" no terminal',
          ],
        };
      case 'macOS':
        return {
          url: 'https://tailscale.com/download/mac',
          command: 'tailscale up',
          steps: [
            'Baixe via App Store ou tailscale.com/download/mac',
            'Abra o Tailscale e autorize',
            'Execute "tailscale up" no terminal',
          ],
        };
      case 'Linux':
        return {
          url: 'https://tailscale.com/download/linux',
          command: 'curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up',
          steps: [
            'Execute: curl -fsSL https://tailscale.com/install.sh | sh',
            'Execute: sudo tailscale up',
            'Abra o link de autenticação',
          ],
        };
      default:
        return {
          url: 'https://tailscale.com/download',
          command: 'tailscale up',
          steps: [
            'Visite tailscale.com/download',
            'Siga as instruções para seu sistema',
          ],
        };
    }
  };

  const checkConnectivity = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = await api.getTailscaleStatus();
      setTailscaleStatus(status);
      if (status.tailscaleIp) {
        setTailscaleIp(status.tailscaleIp);
      }
    } catch (err) {
      setError('Não foi possível verificar o status do Tailscale');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleCreateRoom = async () => {
    if (!roomName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.createRoom({
        name: roomName,
        isPersistent: false,
        isPrivate: false,
        maxParticipants: 8,
      });
      localStorage.setItem(STORAGE_KEY, 'true');
      onComplete();
      window.location.href = `/room/${result.room.id}`;
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
    window.location.href = `/room/${roomCode}`;
  };

  const copyShareLink = async (roomId: string) => {
    const link = `${window.location.origin}/room/${roomId}`;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    if (step === 4) {
      checkConnectivity();
    }
  }, [step, checkConnectivity]);

  // Contexto inseguro (HTTP fora do localhost) bloqueia micro/tela no browser
  useEffect(() => {
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setIsInsecureContext(true);
    }
  }, []);

  const nextStep = () => setStep((s) => Math.min(s + 1, STEPS.length));
  const prevStep = () => setStep((s) => Math.max(s - 1, 1));
  const os = detectOS();
  const installInfo = getInstallInstructions(os);
  const httpsUrl = buildTailscaleHttpsUrl('/');

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card variant="glass" className="w-full max-w-lg animate-fade-in">
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
          <div className="mt-4 flex gap-1" role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={STEPS.length}>
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
            <div className="space-y-4 animate-slide-up">
              <div className="text-center space-y-3 py-4">
                <div className="text-5xl">🎙️</div>
                <p className="text-slate-300 text-sm leading-relaxed">
                  Scale usa Tailscale para criar uma rede mesh privada entre os participantes.
                  Isso permite chamadas P2P de baixa latência sem exposição pública.
                </p>
                <p className="text-slate-500 text-xs">
                  Você pode pular esta etapa se já tem Tailscale configurado.
                </p>
              </div>
              <div className="flex justify-end">
                <Button onClick={nextStep}>Começar</Button>
              </div>
            </div>
          )}

          {/* Step 2: Install Tailscale */}
          {step === 2 && (
            <div className="space-y-4 animate-slide-up">
              <div className="glass-subtle p-4 rounded-xl">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm font-medium text-slate-200">Sistema detectado:</span>
                  <Badge variant="info">{os}</Badge>
                </div>
                <ol className="space-y-2 text-sm text-slate-300">
                  {installInfo.steps.map((s, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-brand-400 font-mono text-xs mt-0.5">{i + 1}.</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={prevStep}>Voltar</Button>
                <Button onClick={nextStep}>Já instalei</Button>
              </div>
            </div>
          )}

          {/* Step 3: Tailscale up + auth */}
          {step === 3 && (
            <div className="space-y-4 animate-slide-up">
              <div className="glass-subtle p-4 rounded-xl">
                <p className="text-sm text-slate-300 mb-2">
                  Execute o comando abaixo no terminal:
                </p>
                <code className="block bg-slate-900/80 p-3 rounded-lg text-xs text-brand-300 font-mono break-all select-all">
                  {installInfo.command}
                </code>
              </div>
              <div className="glass-subtle p-4 rounded-xl">
                <p className="text-sm text-slate-300">
                  Ao executar, um link de autenticação será aberto. Faça login com sua conta Tailscale.
                </p>
              </div>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={prevStep}>Voltar</Button>
                <Button onClick={nextStep}>Autenticado</Button>
              </div>
            </div>
          )}

          {/* Step 4: Connectivity test */}
          {step === 4 && (
            <div className="space-y-4 animate-slide-up">
              {isInsecureContext && (
                <Banner
                  variant="warning"
                  icon="🔒"
                  title="Conexão não segura — microfone/tela bloqueados"
                  description="Este acesso via HTTP na rede Tailscale bloqueia microfone e compartilhamento de tela no browser. Use HTTPS para chamadas com áudio."
                  action={
                    httpsUrl ? (
                      <a
                        className="btn-primary text-xs px-3 py-1.5 rounded-lg"
                        href={httpsUrl}
                        aria-label={`Abrir Scale via HTTPS (${httpsUrl})`}
                      >
                        Abrir via HTTPS
                      </a>
                    ) : (
                      <Link
                        href="/tutorial"
                        className="btn-ghost text-xs px-3 py-1.5 rounded-lg"
                        aria-label="Ver instruções de configuração HTTPS no guia"
                      >
                        Ver guia HTTPS
                      </Link>
                    )
                  }
                />
              )}
              {loading && (
                <div className="text-center py-8">
                  <div className="animate-pulse-soft text-brand-400 text-2xl mb-2">🔍</div>
                  <p className="text-sm text-slate-400">Verificando conectividade...</p>
                </div>
              )}
              {!loading && tailscaleStatus && (
                <div className="space-y-3">
                  <div className="glass-subtle p-4 rounded-xl">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-medium text-slate-200">Status:</span>
                      {tailscaleStatus.configured ? (
                        <Badge variant="success">Configurado</Badge>
                      ) : tailscaleStatus.interfaceDetected ? (
                        <Badge variant="warning">Interface detectada</Badge>
                      ) : (
                        <Badge variant="error">Não detectado</Badge>
                      )}
                    </div>
                    {tailscaleStatus.tailscaleIp && (
                      <div className="mt-2">
                        <span className="text-xs text-slate-500">IP no Tailnet:</span>
                        <code className="ml-2 text-xs text-brand-300 font-mono select-all">
                          {tailscaleStatus.tailscaleIp}
                        </code>
                      </div>
                    )}
                  </div>

                  {tailscaleStatus.tailscaleIp && (
                    <div className="glass-subtle p-3 rounded-xl flex items-center justify-between">
                      <span className="text-xs text-slate-400">Link compartilhável:</span>
                      <Button variant="ghost" size="sm" onClick={() => copyShareLink(window.location.pathname)}>
                        {copied ? '✓ Copiado' : 'Copiar link'}
                      </Button>
                    </div>
                  )}

                  {!tailscaleStatus.tailscaleIp && (
                    <p className="text-xs text-amber-400/80">
                      Configure o TAILSCALE_IP no .env do backend, ou certifique-se de que o Tailscale está rodando.
                    </p>
                  )}
                </div>
              )}
              {!loading && error && (
                <div className="space-y-3">
                  <p className="text-sm text-amber-400">{error}</p>
                  <div className="glass-subtle p-3 rounded-xl">
                    <p className="text-xs text-slate-400 mb-2">
                      Tailscale parece conectado mas o backend em Docker não enxergou o IP.
                      Isso é normal com Docker — já configurado via .env, pode continuar:
                    </p>
                    <code className="block bg-slate-900/80 p-2 rounded text-xs text-brand-300 font-mono select-all">TAILSCALE_IP=100.119.215.105 (seu .env atual)</code>
                    <p className="text-xs text-slate-500 mt-2">Após adicionar, faça: docker compose up --build -d</p>
                  </div>
                </div>
              )}
              <div className="flex justify-between">
                <Button variant="ghost" onClick={prevStep}>Voltar</Button>
                <Button onClick={nextStep}>Continuar</Button>
              </div>
            </div>
          )}

          {/* Step 5: Create/Join room */}
          {step === 5 && (
            <div className="space-y-4 animate-slide-up">
              {/* Create room */}
              <div className="glass-subtle p-4 rounded-xl space-y-3">
                <h4 className="text-sm font-medium text-white">Criar Nova Sala</h4>
                <Input
                  label="Nome da sala"
                  placeholder="Ex: Reunião de equipe"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                />
                <Button
                  onClick={handleCreateRoom}
                  disabled={!roomName.trim() || loading}
                  className="w-full"
                >
                  {loading ? 'Criando...' : 'Criar Sala'}
                </Button>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/10" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="px-3 bg-slate-900 text-slate-500">ou</span>
                </div>
              </div>

              {/* Join room */}
              <div className="glass-subtle p-4 rounded-xl space-y-3">
                <h4 className="text-sm font-medium text-white">Entrar numa Sala</h4>
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
                <Button variant="ghost" onClick={onSkip}>Rever guia depois</Button>
              </div>

              {error && (
                <p className="text-xs text-red-400">{error}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
