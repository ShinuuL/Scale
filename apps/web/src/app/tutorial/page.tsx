'use client';

import { ShareTutorial } from '@/components/onboarding/ShareTutorial';
import { AppShell } from '@/components/layout/AppShell';
import { HelpSidebar } from '@/components/layout/HelpSidebar';

export default function TutorialPage() {
  return (
    <AppShell activeSection="help" title="Como usar o Scale" contextSidebar={<HelpSidebar active="tutorial" />}>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-[28px] font-semibold leading-9 tracking-tight">Da primeira sala à conversa.</h2>
          <p className="mb-8 mt-3 max-w-[65ch] text-sm leading-6 text-ink-secondary">Crie sua conta, abra uma sala e convide as pessoas. Este guia acompanha cada etapa, do primeiro link ao compartilhamento de tela.</p>
          <ShareTutorial />
        </div>
      </div>
    </AppShell>
  );
}
