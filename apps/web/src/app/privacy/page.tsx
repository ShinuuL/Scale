'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { ModerationConfig } from '@scale/shared';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { AppShell } from '@/components/layout/AppShell';
import { HelpSidebar } from '@/components/layout/HelpSidebar';
import { Icon, type IconName } from '@/components/ui/Icon';
import { api } from '@/lib/api';

interface Section {
  icon: IconName;
  title: string;
  description: string;
  items: string[];
}

const RETENTION_DAYS = 90;

function sections(config: ModerationConfig | null): Section[] {
  const screenOn = config?.screen === true;
  const external = config?.provider === 'claude';
  return [
    {
      icon: 'key',
      title: 'O que coletamos',
      description: 'Só o necessário para a conta funcionar e para a partilha de tela ser liberada.',
      items: [
        'Conta: e-mail, nome, @nome e foto de perfil (opcional). Login com GitHub ou Google guarda apenas o identificador do provedor; a senha de acesso ao provedor nunca passa por aqui.',
        'Data de nascimento: informada por você e usada SÓ para verificar a idade mínima da partilha de tela. Nunca é exibida a outras pessoas nem sai da sua conta; pode ser removida a qualquer momento.',
        'Eventos de moderação: quando uma mensagem é bloqueada ou gera aviso, quando uma partilha de tela é encerrada e quando alguém faz uma denúncia. Guardamos categoria, severidade, ação tomada e, para texto, um trecho de até 120 caracteres.',
        'Convidados sem conta recebem um identificador aleatório em cookie, só para reconhecer a autoria das próprias mensagens.',
      ],
    },
    {
      icon: 'eye',
      title: 'O que o assistente de moderação analisa',
      description: 'Um assistente ajuda a evitar conteúdo depreciativo e bullying nas salas.',
      items: [
        'Texto do chat da sala e das mensagens privadas: analisado antes de ser gravado ou entregue. Só a mensagem é analisada, sem nome, e-mail ou histórico.',
        screenOn
          ? 'Amostras da tela: enquanto VOCÊ compartilha a tela, seu navegador envia uma imagem pequena a cada ' +
            `${config?.frameIntervalSec ?? 20} segundos. A amostra é analisada na memória e descartada; nunca é gravada. Quem assiste não envia nada.`
          : 'Amostras da tela: a análise de tela está desligada neste servidor. Nenhuma imagem da sua tela é enviada ao servidor.',
        'Áudio: NÃO é monitorado. A voz vai direto entre os participantes (P2P) e o servidor nunca a recebe, grava ou transcreve. Problemas no áudio são tratados por denúncia e pela ação do dono da sala.',
        external
          ? 'Análise por Anthropic Claude: o texto da mensagem (e, quando ligada, a amostra da tela) é enviado à API da Anthropic para classificação. Nenhum dado de identificação acompanha o conteúdo.'
          : 'A classificação é feita neste próprio servidor, sem envio de conteúdo a terceiros.',
      ],
    },
    {
      icon: 'clock',
      title: 'Por quanto tempo guardamos',
      description: 'Retenção curta, apagamento automático.',
      items: [
        `Eventos de moderação são apagados automaticamente após ${RETENTION_DAYS} dias.`,
        'Amostras de tela nunca são guardadas: existem só durante a análise.',
        'Mensagens de sala persistente ficam enquanto a sala existir; sala temporária é apagada ao expirar.',
        'Excluir a conta remove em cascata perfil, vínculos, amizades, mensagens privadas e eventos de moderação próprios.',
      ],
    },
    {
      icon: 'shield',
      title: 'Seus direitos (LGPD)',
      description: 'Lei 13.709/2018. Tudo abaixo está em Configurações > Privacidade.',
      items: [
        'Acesso e portabilidade: "Baixar meus dados" gera um arquivo JSON com perfil, situação dos consentimentos e eventos de moderação próprios.',
        'Revogação: o consentimento de partilha de tela pode ser revogado a qualquer momento; a data de nascimento pode ser removida.',
        'Exclusão: a exclusão da conta apaga seus dados. Fale com o encarregado abaixo se precisar de ajuda.',
        'Base legal: verificação de idade (cumprimento de obrigação legal e execução de contrato); moderação de texto e tela (legítimo interesse, com consentimento para a amostragem de tela); denúncias (legítimo interesse).',
      ],
    },
  ];
}

export default function PrivacyPage() {
  const [config, setConfig] = useState<ModerationConfig | null>(null);
  const [configFailed, setConfigFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .getModerationConfig()
      .then((c) => alive && setConfig(c))
      .catch(() => alive && setConfigFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const contact = config?.privacyContactEmail?.trim() || null;

  return (
    <AppShell activeSection="help" title="Privacidade" contextSidebar={<HelpSidebar active="privacy" />}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="relative overflow-hidden">
          <div className="relative max-w-3xl mx-auto px-4 pt-12 pb-8">
            <Link
              href="/docs"
              className="inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink-primary transition-colors mb-6"
            >
              <Icon name="arrowLeft" /> Voltar à documentação
            </Link>
            <h2 className="text-[28px] font-semibold leading-9 tracking-tight text-ink-primary mb-2">
              Política de privacidade e moderação
            </h2>
            <p className="text-ink-muted text-sm">
              Como o Scale trata seus dados, o que o assistente de moderação analisa e como exercer
              seus direitos. Em termos simples e sem letras miúdas.
            </p>
            {config && (
              <p className="mt-3 text-xs text-ink-muted" role="status">
                Moderação neste servidor:{' '}
                {config.provider === 'off'
                  ? 'desligada'
                  : config.provider === 'claude'
                    ? 'análise por Anthropic Claude'
                    : 'análise local (heurística)'}
                {'; '}
                análise de tela: {config.screen ? 'ligada' : 'desligada'}; idade mínima para partilha de
                tela: {config.minAge} anos.
              </p>
            )}
            {configFailed && (
              <p className="mt-3 text-xs text-ink-muted" role="status">
                Não foi possível consultar a configuração de moderação deste servidor agora.
              </p>
            )}
          </div>
        </section>

        <section className="max-w-3xl mx-auto px-4 pb-12 space-y-6">
          {sections(config).map((section) => (
            <Card
              variant="glass"
              key={section.title}
              className="!rounded-none !border-0 !border-b !border-line !bg-transparent !px-0"
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Icon name={section.icon} size={20} />
                  {section.title}
                </CardTitle>
                <CardDescription>{section.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5 text-sm text-ink-secondary">
                  {section.items.map((item) => (
                    <li key={item} className="flex gap-2">
                      <Icon name="check" className="mt-0.5 shrink-0 text-accent" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}

          <Card variant="glass" className="!rounded-none !border-0 !bg-transparent !px-0">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Icon name="users" size={20} />
                Encarregado de dados (DPO)
              </CardTitle>
              <CardDescription>
                Para dúvidas, pedidos de acesso, correção ou exclusão de dados.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-ink-secondary leading-relaxed">
              <p>
                Contato:{' '}
                {contact ? (
                  <a href={`mailto:${contact}`} className="text-brand-300 underline hover:text-ink-primary">
                    {contact}
                  </a>
                ) : (
                  <span className="text-ink-muted">não configurado neste servidor</span>
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-700 text-ink-primary text-sm font-medium hover:bg-brand-800 transition-colors"
                >
                  <Icon name="settings" /> Abrir o Scale (Configurações &gt; Privacidade)
                </Link>
                <Link
                  href="/docs"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-ink-secondary hover:bg-white/10 transition-colors"
                >
                  <Icon name="book" /> Documentação
                </Link>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </AppShell>
  );
}
