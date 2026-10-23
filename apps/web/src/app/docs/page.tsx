'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';

interface DocSection {
  icon: IconName;
  title: string;
  description: string;
  items: string[];
}

const SECTIONS: DocSection[] = [
  {
    icon: 'key',
    title: 'Criar conta ou entrar',
    description: 'A conta é o que permite criar salas e mantê-las salvas.',
    items: [
      'Cadastre-se em /register com e-mail e senha (mínimo 8 caracteres)',
      'Entre em /login se já tiver conta',
      'Entrar numa sala pelo link não exige conta',
    ],
  },
  {
    icon: 'mic',
    title: 'Criar uma sala',
    description: 'Criar sala exige estar logado.',
    items: [
      'Na tela inicial, digite um nome de 3 a 50 caracteres e clique em “Criar Sala”',
      'Sala temporária: expira sozinha depois da chamada',
      'Sala persistente: fica na sua lista, aceita arquivos no chat e tem código de convite',
      'De 2 a 8 participantes por sala',
    ],
  },
  {
    icon: 'users',
    title: 'Entrar numa sala',
    description: 'Duas formas: pelo link ou pelo código da sala.',
    items: [
      'Abra o link /room/<ID> que alguém enviou',
      'Ou cole o ID da sala no campo “Entrar numa Sala” da tela inicial',
      'Seu nome aparece para os outros participantes assim que você entra',
    ],
  },
  {
    icon: 'link',
    title: 'Compartilhar o link',
    description: 'Cada sala tem uma URL única com o ID dela.',
    items: [
      'Dentro da sala, use o card de convite para copiar o link',
      'Formato: https://<endereço-do-app>/room/<ID-da-sala>',
      'Envie o link por qualquer mensageiro — quem abrir entra na chamada',
    ],
  },
  {
    icon: 'mic',
    title: 'Microfone, tela e HTTPS',
    description: 'Navegadores só liberam microfone e tela em contexto seguro.',
    items: [
      'Permissão de microfone: pedida pelo navegador ao entrar na sala',
      'Compartilhar tela: botão dentro da sala; escolha tela, janela ou aba',
      'Fora do localhost, o acesso precisa ser HTTPS — em HTTP o navegador bloqueia microfone e tela',
    ],
  },
];

export default function DocsPage() {
  return (
    <main id="main-content" className="min-h-screen">
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-brand-600/10 via-transparent to-transparent pointer-events-none" />
        <div className="relative max-w-3xl mx-auto px-4 pt-12 pb-8">
          <Link
            href="/tutorial"
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors mb-6"
          >
            <Icon name="arrowLeft" /> Voltar ao tutorial
          </Link>
          <h1 className="text-3xl font-bold text-white mb-2">Documentação do Scale</h1>
          <p className="text-slate-400 text-sm">
            Guia de uso do Scale: conta, criação e entrada em salas, compartilhamento do
            link e permissões de microfone e tela. Para o passo a passo visual, abra o{' '}
            <Link href="/tutorial" className="text-brand-300 hover:text-white underline">
              tutorial
            </Link>
            .
          </p>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 pb-12 space-y-6">
        {SECTIONS.map((section) => (
          <Card variant="glass" key={section.title}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Icon name={section.icon} size={20} />
                {section.title}
              </CardTitle>
              <CardDescription>{section.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5 text-sm text-slate-300">
                {section.items.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="text-brand-400">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}

        <Card variant="glass">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Icon name="globe" size={20} />
              Expor o Scale na internet (túnel)
            </CardTitle>
            <CardDescription>
              Para usar fora da sua máquina, publique o app por um túnel HTTPS.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-slate-300 leading-relaxed">
            <p>
              O Scale roda localmente (frontend em <code className="bg-white/10 px-1.5 py-0.5 rounded text-brand-300">:3000</code>,
              backend em <code className="bg-white/10 px-1.5 py-0.5 rounded text-brand-300">:4000</code>).
              Para que outras pessoas acessem, exponha o frontend por um túnel HTTPS
              (por exemplo cloudflared ou ngrok) e compartilhe a URL gerada no lugar de
              um link local.
            </p>
            <p className="text-slate-400">
              O guia completo de configuração do túnel está versionado em{' '}
              <code className="bg-white/10 px-1.5 py-0.5 rounded text-brand-300 text-xs">docs/tunnel-setup.md</code>{' '}
              no repositório.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/tutorial"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-700 text-white text-sm font-medium hover:bg-brand-800 transition-colors"
              >
                <Icon name="book" /> Abrir tutorial interativo
              </Link>
              <Link
                href="/"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-slate-300 hover:bg-white/10 transition-colors"
              >
                <Icon name="mic" /> Ir para o Scale
              </Link>
            </div>
          </CardContent>
        </Card>

        <div className="text-center">
          <Link href="/">
            <Button variant="ghost" size="sm"><Icon name="arrowLeft" /> Voltar ao Scale</Button>
          </Link>
        </div>
      </section>
    </main>
  );
}
