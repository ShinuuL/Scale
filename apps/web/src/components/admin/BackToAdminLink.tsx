import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';

/** "Voltar à Administração" (hub /admin), navegação pelo roteador do Next. */
export function BackToAdminLink() {
  return (
    <Link
      href="/admin"
      className="mb-3 inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-ink-secondary hover:text-ink-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400"
    >
      <Icon name="arrowLeft" size={14} />
      Voltar à Administração
    </Link>
  );
}
