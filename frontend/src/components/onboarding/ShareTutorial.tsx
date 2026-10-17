'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';

interface Step {
  id: number;
  icon: string;
  title: string;
}

const STEPS: Step[] = [
  { id: 1, icon: '🔐', title: 'Criar conta' },
  { id: 2, icon: '🎙️', title: 'Criar uma sala' },
  { id: 3, icon: '🔗', title: 'Copiar o link' },
  { id: 4, icon: '🎤', title: 'Permitir mic e tela' },
  { id: 5, icon: '👥', title: 'Entrar na chamada' },
];

export function ShareTutorial() {
  const [activeStep, setActiveStep] = useState(1);
  const [copied, setCopied] = useState(false);
  const [shareLink, setShareLink] = useState('/room/<UUID-da-sala>');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setShareLink(`${window.location.origin}/room/<UUID-da-sala>`);
    }
  }, []);

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
                  : 'text-slate-400 border border-transparent hover:text-slate-300 hover:border-white/10'
            }`}
            aria-current={activeStep === s.id ? 'step' : undefined}
          >
            <span className="text-base">{activeStep > s.id ? '✓' : s.icon}</span>
            <span className="hidden sm:inline">{s.title}</span>
          </button>
        ))}
      </nav>

      {/* ── Step 1: Account ──────────────────────────────────── */}
      {activeStep === 1 && (
        <div className="space-y-4 animate-slide-up">
          <Card variant="glass">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span className="text-2xl">🔐</span>
                Crie sua conta ou entre
              </CardTitle>
              <CardDescription>
                Criar uma sala exige login. Entrar numa sala existente, pelo link, não exige.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="glass-subtle p-4 rounded-xl space-y-3">
                <p className="text-sm text-slate-300 leading-relaxed">
                  A conta serve para identificar quem criou a sala e guardar suas salas
                  persistentes. Você precisa apenas de um e-mail e uma senha.
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Link href="/register" className="flex-1">
                    <Button className="w-full">Criar conta</Button>
                  </Link>
                  <Link href="/login" className="flex-1">
                    <Button variant="secondary" className="w-full">Entrar</Button>
                  </Link>
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={() => setActiveStep(2)}>Continuar →</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Step 2: Create room ──────────────────────────────── */}
      {activeStep === 2 && (
        <div className="space-y-4 animate-slide-up">
          <Card variant="glass">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span className="text-2xl">🎙️</span>
                Crie uma sala e dê um nome
              </CardTitle>
              <CardDescription>
                Na tela inicial, escreva um nome para a sala e clique em “Criar Sala”.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="glass-subtle p-4 rounded-xl space-y-3">
                <ol className="space-y-2 text-sm text-slate-300">
                  <li className="flex gap-2">
                    <span className="text-brand-400 font-mono text-xs mt-0.5">1.</span>
                    <span>Faça login (se ainda não fez)</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-brand-400 font-mono text-xs mt-0.5">2.</span>
                    <span>Dê um nome para a sala — de 3 a 50 caracteres</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-brand-400 font-mono text-xs mt-0.5">3.</span>
                    <span>Clique em “Criar Sala” e você entra direto na chamada</span>
                  </li>
                </ol>
              </div>

              <div className="glass-subtle p-3 rounded-xl flex items-start gap-2">
                <span className="text-lg flex-shrink-0">💡</span>
                <div>
                  <p className="text-xs text-slate-300 font-medium">Sala temporária ou persistente?</p>
                  <p className="text-xs text-slate-400">
                    A sala temporária expira sozinha e some depois da chamada. A
                    persistente fica salva na sua lista, aceita envio de arquivos no chat
                    e tem um código de convite próprio.
                  </p>
                </div>
              </div>

              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setActiveStep(1)}>← Voltar</Button>
                <Button onClick={() => setActiveStep(3)}>Continuar →</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Step 3: Share the link ───────────────────────────── */}
      {activeStep === 3 && (
        <div className="space-y-4 animate-slide-up">
          <Card variant="glass">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span className="text-2xl">🔗</span>
                Copie o link e envie para os participantes
              </CardTitle>
              <CardDescription>
                Cada sala tem um link único. Quem abrir o link entra na mesma chamada.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="glass-subtle p-4 rounded-xl space-y-3">
                <p className="text-sm text-slate-300 leading-relaxed">
                  Dentro da sala, o card de convite traz o link pronto com o endereço do
                  app e o ID da sala:
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
                <p className="text-xs text-slate-400">
                  Envie por WhatsApp, e-mail ou qualquer mensageiro — o link é público
                  para quem o receber. No exemplo acima, troque{' '}
                  <code className="bg-slate-900/60 px-1 py-0.5 rounded text-brand-300">UUID-da-sala</code>{' '}
                  pelo ID real mostrado na sala.
                </p>
              </div>

              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setActiveStep(2)}>← Voltar</Button>
                <Button onClick={() => setActiveStep(4)}>Continuar →</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Step 4: Permissions (mic + screen) ───────────────── */}
      {activeStep === 4 && (
        <div className="space-y-4 animate-slide-up">
          <Card variant="glass">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span className="text-2xl">🎤</span>
                Permita microfone e compartilhamento de tela
              </CardTitle>
              <CardDescription>
                O navegador pede essas permissões na primeira vez — é só aceitar.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="glass-subtle p-4 rounded-xl space-y-2">
                <p className="text-sm font-medium text-slate-200">O que esperar:</p>
                <ul className="space-y-2 text-sm text-slate-300">
                  <li className="flex gap-2">
                    <span className="text-brand-400">•</span>
                    <span>Ao entrar na sala, o navegador pede permissão de <strong className="text-white">microfone</strong></span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-brand-400">•</span>
                    <span>Ao clicar em compartilhar, você escolhe <strong className="text-white">tela, janela ou aba</strong> e pode parar quando quiser</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-brand-400">•</span>
                    <span>Você pode entrar ouvindo e ligar o microfone depois</span>
                  </li>
                </ul>
              </div>

              <div className="glass-subtle p-3 rounded-xl flex items-start gap-2">
                <span className="text-lg flex-shrink-0">🔒</span>
                <div>
                  <p className="text-xs text-slate-300 font-medium">Precisa de HTTPS</p>
                  <p className="text-xs text-slate-400">
                    Fora do localhost, o navegador só libera microfone e tela em páginas
                    HTTPS. O Scale precisa ser acessado por uma URL HTTPS (por exemplo,
                    publicada por um túnel).
                  </p>
                </div>
              </div>

              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setActiveStep(3)}>← Voltar</Button>
                <Button onClick={() => setActiveStep(5)}>Continuar →</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Step 5: Join the call ────────────────────────────── */}
      {activeStep === 5 && (
        <div className="space-y-4 animate-slide-up">
          <Card variant="glass">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span className="text-2xl">👥</span>
                Todos entram na chamada
              </CardTitle>
              <CardDescription>
                De 2 a 8 pessoas na mesma sala, com áudio e tela compartilhada.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="glass-subtle p-4 rounded-xl">
                <p className="text-sm font-medium text-slate-200 mb-3">Como funciona:</p>
                <div className="bg-slate-900/80 p-4 rounded-lg text-xs font-mono space-y-1.5">
                  <p className="text-slate-400">
                    <span className="text-emerald-400">Você</span> cria a sala e entra
                  </p>
                  <p className="text-slate-400">
                    <span className="text-emerald-400">Você</span> envia o link para os participantes
                  </p>
                  <p className="text-slate-400">
                    <span className="text-emerald-400">Cada um</span> abre o link e permite o microfone
                  </p>
                  <p className="text-slate-400">
                    <span className="text-emerald-400">WebRTC</span> conecta todos direto (P2P) → <span className="text-emerald-400">✓ Pronto!</span>
                  </p>
                </div>
              </div>

              <div className="glass-subtle p-4 rounded-xl space-y-3">
                <p className="text-sm font-medium text-slate-200">Checklist antes da chamada:</p>
                <ul className="space-y-2">
                  <li className="flex items-start gap-2 text-sm text-slate-300">
                    <span className="text-emerald-400 mt-0.5">✓</span>
                    <span>Todos abriram o link da sala</span>
                  </li>
                  <li className="flex items-start gap-2 text-sm text-slate-300">
                    <span className="text-emerald-400 mt-0.5">✓</span>
                    <span>Permissão de microfone concedida no navegador</span>
                  </li>
                  <li className="flex items-start gap-2 text-sm text-slate-300">
                    <span className="text-emerald-400 mt-0.5">✓</span>
                    <span>Página aberta em HTTPS (ou localhost)</span>
                  </li>
                </ul>
              </div>

              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setActiveStep(4)}>← Voltar</Button>
                <Link href="/">
                  <Button>Criar minha primeira sala →</Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Footer links ─────────────────────────────────────── */}
      <div className="text-center flex flex-wrap gap-2 justify-center">
        <Link
          href="/docs"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-slate-300 hover:bg-white/10 hover:text-white transition-all"
        >
          📖 Ver documentação completa
        </Link>
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600/20 border border-brand-500/30 text-sm text-brand-300 hover:bg-brand-600/30 transition-all"
        >
          🎙️ Ir para o Scale
        </Link>
      </div>
    </div>
  );
}
