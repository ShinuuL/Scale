'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { api } from '@/lib/api';
import type { TailscaleStatus } from '@/lib/validation';

interface Step {
  id: number;
  icon: string;
  title: string;
}

const STEPS: Step[] = [
  { id: 1, icon: '📦', title: 'Instalar Tailscale' },
  { id: 2, icon: '🔐', title: 'Fazer login' },
  { id: 3, icon: '🌐', title: 'Verificar seu IP' },
  { id: 4, icon: '🔗', title: 'Compartilhar Scale' },
  { id: 5, icon: '👥', title: 'Convidar amigos' },
];

function detectOS(): string {
  if (typeof window === 'undefined') return 'unknown';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('win')) return 'Windows';
  if (ua.includes('mac')) return 'macOS';
  if (ua.includes('linux')) return 'Linux';
  return 'unknown';
}

function getInstallUrl(os: string): string {
  switch (os) {
    case 'Windows':
      return 'https://tailscale.com/download/windows';
    case 'macOS':
      return 'https://tailscale.com/download/mac';
    case 'Linux':
      return 'https://tailscale.com/download/linux';
    default:
      return 'https://tailscale.com/download';
  }
}

function getInstallCommand(os: string): string {
  switch (os) {
    case 'Windows':
      return 'Baixe em tailscale.com/download e execute o instalador';
    case 'macOS':
      return 'Baixe no App Store ou em tailscale.com/download';
    case 'Linux':
      return 'curl -fsSL https://tailscale.com/install.sh | sh';
    default:
      return 'Visite tailscale.com/download';
  }
}

export function TailscaleShareTutorial() {
  const [activeStep, setActiveStep] = useState(1);
  const [os, setOs] = useState('unknown');
  const [tailscaleStatus, setTailscaleStatus] = useState<TailscaleStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shareLink, setShareLink] = useState('');

  useEffect(() => {
    setOs(detectOS());
    if (typeof window !== 'undefined') {
      setShareLink(`${window.location.origin}/room/<UUID-da-sala>`);
    }
  }, []);

  const checkConnectivity = useCallback(async () => {
    setChecking(true);
    try {
      const status = await api.getTailscaleStatus();
      setTailscaleStatus(status);
    } catch {
      setTailscaleStatus({ tailscaleIp: null, configured: false, interfaceDetected: false });
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (activeStep === 3) {
      checkConnectivity();
    }
  }, [activeStep, checkConnectivity]);

  const copyShareLink = async () => {
    if (!shareLink) return;
    await navigator.clipboard.writeText(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-8">
      {/* ── Step nav ──────────────────────────────────────────── */}
      <nav aria-label="Passos do tutorial" className="flex items-center gap-1 overflow-x-auto pb-2">
        {STEPS.map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveStep(s.id)}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
              activeStep === s.id
                ? 'bg-brand-600/20 text-brand-300 border border-brand-500/30'
                : activeStep > s.id
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : 'text-slate-500 border border-transparent hover:text-slate-300 hover:border-white/10'
            }`}
            aria-current={activeStep === s.id ? 'step' : undefined}
          >
            <span className="text-base">{activeStep > s.id ? '✓' : s.icon}</span>
            <span className="hidden sm:inline">{s.title}</span>
          </button>
        ))}
      </nav>

      {/* ── Step 1: Install ──────────────────────────────────── */}
      {activeStep === 1 && (
        <div className="space-y-4 animate-slide-up">
          <Card variant="glass">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span className="text-2xl">📦</span>
                Instale o Tailscale
              </CardTitle>
              <CardDescription>
                Tailscale cria uma rede mesh privada entre seus dispositivos.
                Sem port forwarding, sem exposição pública.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* OS badge */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-400">Sistema detectado:</span>
                <Badge variant="info">{os}</Badge>
              </div>

              {/* Visual flow diagram */}
              <div className="glass-subtle p-4 rounded-xl">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <div className="text-center space-y-1">
                    <div className="text-2xl">💻</div>
                    <p>Seu PC</p>
                  </div>
                  <div className="flex-1 mx-3 border-t border-dashed border-white/20" />
                  <div className="text-center space-y-1">
                    <div className="text-2xl">🔒</div>
                    <p>Tailscale</p>
                  </div>
                  <div className="flex-1 mx-3 border-t border-dashed border-white/20" />
                  <div className="text-center space-y-1">
                    <div className="text-2xl">👥</div>
                    <p>Amigos</p>
                  </div>
                </div>
              </div>

              {/* Install command */}
              <div className="glass-subtle p-4 rounded-xl space-y-2">
                <p className="text-sm font-medium text-slate-200">
                  {os === 'Linux' ? 'Execute no terminal:' : 'Passo a passo:'}
                </p>
                {os === 'Linux' ? (
                  <code className="block bg-slate-900/80 p-3 rounded-lg text-xs text-brand-300 font-mono break-all select-all">
                    {getInstallCommand(os)}
                  </code>
                ) : (
                  <ol className="space-y-1.5 text-sm text-slate-300">
                    <li className="flex gap-2">
                      <span className="text-brand-400 font-mono text-xs">1.</span>
                      <span>{getInstallCommand(os)}</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="text-brand-400 font-mono text-xs">2.</span>
                      <span>Execute <code className="bg-slate-900/60 px-1.5 py-0.5 rounded text-brand-300 text-xs font-mono">tailscale up</code></span>
                    </li>
                    <li className="flex gap-2">
                      <span className="text-brand-400 font-mono text-xs">3.</span>
                      <span>Faça login com sua conta (Google, Microsoft, GitHub...)</span>
                    </li>
                  </ol>
                )}
              </div>

              <a
                href={getInstallUrl(os)}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary w-full text-center"
              >
                Baixar Tailscale ↗
              </a>

              <div className="flex justify-end">
                <Button onClick={() => setActiveStep(2)}>Já instalei →</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Step 2: Login ────────────────────────────────────── */}
      {activeStep === 2 && (
        <div className="space-y-4 animate-slide-up">
          <Card variant="glass">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span className="text-2xl">🔐</span>
                Autentique-se no Tailscale
              </CardTitle>
              <CardDescription>
                Execute <code className="bg-slate-900/60 px-1.5 py-0.5 rounded text-brand-300 text-xs font-mono">tailscale up</code> e faça login.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="glass-subtle p-4 rounded-xl space-y-3">
                <p className="text-sm text-slate-300">
                  Ao executar <code className="bg-slate-900/60 px-1.5 py-0.5 rounded text-brand-300 text-xs font-mono">tailscale up</code>,
                  um link de autenticação será aberto no browser.
                </p>
                <p className="text-sm text-slate-300">
                  Faça login com sua conta (Google, Microsoft, GitHub, Apple, etc).
                  Seus dispositivos ficarão na mesma rede mesh privada.
                </p>
                <div className="bg-slate-900/60 p-3 rounded-lg">
                  <code className="text-xs text-brand-300 font-mono select-all">
                    {os === 'Linux'
                      ? 'sudo tailscale up'
                      : 'tailscale up'}
                  </code>
                </div>
              </div>

              <p className="text-xs text-slate-500">
                Plano gratuito inclui até 3 usuários e 100 dispositivos — mais que suficiente para uso pessoal.
              </p>

              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setActiveStep(1)}>← Voltar</Button>
                <Button onClick={() => setActiveStep(3)}>Autenticado →</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Step 3: Verify IP ────────────────────────────────── */}
      {activeStep === 3 && (
        <div className="space-y-4 animate-slide-up">
          <Card variant="glass">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span className="text-2xl">🌐</span>
                Verifique seu IP Tailscale
              </CardTitle>
              <CardDescription>
                Seu dispositivo recebe um IP na faixa <code className="bg-slate-900/60 px-1.5 py-0.5 rounded text-brand-300 text-xs font-mono">100.x.x.x</code> na rede mesh.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Test button */}
              <div className="glass-subtle p-4 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-200">Testar conectividade</span>
                  <Button variant="secondary" size="sm" onClick={checkConnectivity} disabled={checking}>
                    {checking ? 'Verificando...' : '🔄 Testar'}
                  </Button>
                </div>

                {tailscaleStatus && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-400">Status:</span>
                      {tailscaleStatus.configured ? (
                        <Badge variant="success">Configurado ✓</Badge>
                      ) : tailscaleStatus.interfaceDetected ? (
                        <Badge variant="warning">Interface detectada</Badge>
                      ) : (
                        <Badge variant="error">Não detectado</Badge>
                      )}
                    </div>
                    {tailscaleStatus.tailscaleIp && (
                      <div>
                        <span className="text-xs text-slate-500">Seu IP na rede:</span>
                        <code className="ml-2 text-sm text-brand-300 font-mono select-all bg-slate-900/60 px-2 py-1 rounded">
                          {tailscaleStatus.tailscaleIp}
                        </code>
                      </div>
                    )}
                    {!tailscaleStatus.tailscaleIp && (
                      <p className="text-xs text-amber-400/80">
                        Certifique-se de que o Tailscale está rodando e autenticado.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* How to check manually */}
              <div className="glass-subtle p-4 rounded-xl space-y-2">
                <p className="text-sm font-medium text-slate-200">Como verificar manualmente:</p>
                <code className="block bg-slate-900/80 p-3 rounded-lg text-xs text-brand-300 font-mono select-all">
                  tailscale ip -4
                </code>
                <p className="text-xs text-slate-500">
                  Saída esperada: <code className="text-brand-300">100.x.x.x</code> (ex: 100.64.0.1)
                </p>
              </div>

              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setActiveStep(2)}>← Voltar</Button>
                <Button onClick={() => setActiveStep(4)}>Meu IP está OK →</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Step 4: Share Scale ───────────────────────────────── */}
      {activeStep === 4 && (
        <div className="space-y-4 animate-slide-up">
          <Card variant="glass">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span className="text-2xl">🔗</span>
                Compartilhe o Scale
              </CardTitle>
              <CardDescription>
                Compartilhe o link da sala — sem port forwarding necessário!
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Visual explanation */}
              <div className="glass-subtle p-4 rounded-xl space-y-3">
                <p className="text-sm text-slate-300 leading-relaxed">
                  Scale já roda em <code className="bg-slate-900/60 px-1.5 py-0.5 rounded text-brand-300 text-xs font-mono">:3000</code>.
                  Basta compartilhar o link usando o IP Tailscale do servidor:
                </p>

                <div className="bg-slate-900/80 p-4 rounded-xl font-mono text-sm space-y-1">
                  <p className="text-slate-500 text-xs"># Formato do link:</p>
                  <p className="text-brand-300 break-all">
                    http://<span className="text-emerald-400">100.x.x.x</span>:3000/room/<span className="text-amber-300">&lt;UUID&gt;</span>
                  </p>
                </div>

                <div className="glass-subtle p-3 rounded-xl">
                  <p className="text-xs text-slate-400 mb-2">Exemplo real:</p>
                  <p className="text-xs text-brand-300 font-mono break-all">
                    http://100.64.0.10:3000/room/a1b2c3d4-e5f6-7890-abcd-ef1234567890
                  </p>
                </div>
              </div>

              {/* ASCII-style diagram */}
              <div className="glass-subtle p-4 rounded-xl">
                <p className="text-sm font-medium text-slate-200 mb-3">Como funciona:</p>
                <div className="bg-slate-900/80 p-4 rounded-lg text-xs font-mono space-y-1.5">
                  <p className="text-slate-400">
                    <span className="text-emerald-400">Você</span> cria sala → Scale roda em <span className="text-brand-300">:3000</span>
                  </p>
                  <p className="text-slate-400">
                    <span className="text-emerald-400">Tailscale</span> dá IP <span className="text-brand-300">100.x.x.x</span> a cada device
                  </p>
                  <p className="text-slate-400">
                    <span className="text-emerald-400">Amigos</span> abrem <span className="text-amber-300">http://100.x:3000/room/xxx</span>
                  </p>
                  <p className="text-slate-400">
                    <span className="text-emerald-400">WebRTC</span> conecta P2P via mesh → <span className="text-emerald-400">✓ Pronto!</span>
                  </p>
                </div>
              </div>

              {/* MagicDNS tip */}
              <div className="glass-subtle p-3 rounded-xl flex items-start gap-2">
                <span className="text-lg flex-shrink-0">💡</span>
                <div>
                  <p className="text-xs text-slate-300 font-medium">MagicDNS ativo?</p>
                  <p className="text-xs text-slate-500">
                    Use o nome do dispositivo em vez do IP:{' '}
                    <code className="text-brand-300 bg-slate-900/60 px-1 py-0.5 rounded">
                      http://meu-computador:3000/room/xxx
                    </code>
                  </p>
                </div>
              </div>

              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setActiveStep(3)}>← Voltar</Button>
                <Button onClick={() => setActiveStep(5)}>Entendi →</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Step 5: Invite friends ────────────────────────────── */}
      {activeStep === 5 && (
        <div className="space-y-4 animate-slide-up">
          <Card variant="glass">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span className="text-2xl">👥</span>
                Convide seus amigos
              </CardTitle>
              <CardDescription>
                Seus amigos precisam ter Tailscale na mesma rede (tailnet) para acessar o Scale.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Share link demo */}
              <div className="glass-subtle p-4 rounded-xl space-y-3">
                <p className="text-sm text-slate-300">
                  Copie o link da sala e envie para quem você quer chamar:
                </p>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={shareLink}
                    onFocus={(e) => e.currentTarget.select()}
                    className="input-base font-mono text-xs flex-1 min-w-0 select-all"
                    aria-label="Link da sala"
                  />
                  <Button variant="secondary" size="sm" onClick={copyShareLink}>
                    {copied ? '✓ Copiado' : 'Copiar'}
                  </Button>
                </div>
              </div>

              {/* Checklist */}
              <div className="glass-subtle p-4 rounded-xl space-y-3">
                <p className="text-sm font-medium text-slate-200">Antes de compartilhar, verifique:</p>
                <ul className="space-y-2">
                  <li className="flex items-start gap-2 text-sm text-slate-300">
                    <span className="text-emerald-400 mt-0.5">✓</span>
                    <span>Amigos instalaram o Tailscale e fizeram login</span>
                  </li>
                  <li className="flex items-start gap-2 text-sm text-slate-300">
                    <span className="text-emerald-400 mt-0.5">✓</span>
                    <span>Estão na mesma tailnet (mesma conta ou compartilhamento de rede)</span>
                  </li>
                  <li className="flex items-start gap-2 text-sm text-slate-300">
                    <span className="text-emerald-400 mt-0.5">✓</span>
                    <span>ACL permite tráfego TCP entre dispositivos</span>
                  </li>
                </ul>
              </div>

              {/* ACL quick note */}
              <div className="glass-subtle p-3 rounded-xl flex items-start gap-2">
                <span className="text-lg flex-shrink-0">⚡</span>
                <div>
                  <p className="text-xs text-slate-300 font-medium">ACL rápido</p>
                  <p className="text-xs text-slate-500">
                    Se você tem ACL configurado, garanta que as regras permitem tráfego TCP entre membros.
                    Veja em <a href="https://login.tailscale.com/admin/acls" target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:text-brand-300 underline">login.tailscale.com/admin/acls</a>.
                  </p>
                </div>
              </div>

              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setActiveStep(4)}>← Voltar</Button>
                <Button onClick={() => window.location.href = '/'}>
                  Criar minha primeira sala →
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Footer link to full docs ──────────────────────────── */}
      <div className="text-center">
        <a
          href="/docs/tailscale-setup.md"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors underline underline-offset-2"
        >
          📄 Ver documentação completa do Tailscale Setup
        </a>
      </div>
    </div>
  );
}
