import type { IconName } from '@/components/ui/Icon';

export interface AdminSection {
  id: 'moderation' | 'metrics' | 'users';
  href: string;
  label: string;
  description: string;
  icon: IconName;
}

/** Telas de administracao: hub /admin e secao "Administração" das Configurações. */
export const ADMIN_SECTIONS: readonly AdminSection[] = [
  {
    id: 'moderation',
    href: '/admin/moderation',
    label: 'Moderação',
    description: 'Provedor, análise de tela, retenção e auditoria do assistente de moderação.',
    icon: 'shield',
  },
  {
    id: 'metrics',
    href: '/metrics',
    label: 'Métricas',
    description: 'Salas, participantes e saúde do servidor, atualizados a cada 10 segundos.',
    icon: 'chart',
  },
  {
    id: 'users',
    href: '/admin/users',
    label: 'Administradores',
    description: 'Usuários cadastrados: conceda ou remova o papel de administrador.',
    icon: 'users',
  },
];
