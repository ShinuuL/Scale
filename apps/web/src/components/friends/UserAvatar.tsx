'use client';

import { clsx } from 'clsx';
import { userAvatarUrl } from '@/lib/api';

interface UserAvatarProps {
  userId: string;
  name: string;
  avatarUpdatedAt: string | null | undefined;
  size?: 'sm' | 'md' | 'xl';
  className?: string;
}

/** Foto do usuario ou, sem ela, a inicial do nome. Decorativo (o nome vem ao lado). */
export function UserAvatar({ userId, name, avatarUpdatedAt, size = 'md', className }: UserAvatarProps) {
  const box =
    size === 'sm' ? 'h-8 w-8 text-xs' : size === 'xl' ? 'h-28 w-28 text-4xl' : 'h-10 w-10 text-sm';
  const photo = userAvatarUrl(userId, avatarUpdatedAt);
  if (photo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- export estatico, sem otimizador de imagem
      <img src={photo} alt="" aria-hidden="true" className={clsx(box, 'flex-shrink-0 rounded-full object-cover', className)} />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={clsx(
        box,
        'flex flex-shrink-0 items-center justify-center rounded-full bg-brand-600/30 font-semibold text-brand-200',
        className,
      )}
    >
      {(name.trim().charAt(0) || '?').toUpperCase()}
    </span>
  );
}
