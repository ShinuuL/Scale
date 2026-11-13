'use client';

import { useRef, useState } from 'react';
import { AVATAR_FILE_ACCEPT, CATEGORY_NAME_MAX, MAX_AVATAR_SIZE_BYTES, MAX_CHANNEL_CATEGORIES, type CommunityImageKind } from '@scale/shared';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { api, communityImageUrl, type CommunityCategory } from '@/lib/api';

/**
 * Secoes das Configuracoes da comunidade (Fase 1): icone/banner (OWNER/ADMIN)
 * e categorias de canais (manageChannels).
 */

const LABELS: Record<CommunityImageKind, { title: string; noun: string }> = {
  icon: { title: 'Ícone', noun: 'ícone' },
  banner: { title: 'Banner', noun: 'banner' },
};

function ImagePicker({
  communityId,
  kind,
  updatedAt,
  fallback,
  onChanged,
}: {
  communityId: string;
  kind: CommunityImageKind;
  updatedAt: string | null | undefined;
  fallback: string;
  onChanged: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const url = communityImageUrl(communityId, kind, updatedAt);
  const { title, noun } = LABELS[kind];
  const act = async (action: () => Promise<void>, failure: string) => {
    setBusy(true);
    setError('');
    try {
      await action();
      onChanged();
    } catch {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  const box = kind === 'icon' ? 'h-16 w-16 rounded-xl' : 'h-16 w-40 rounded-lg';
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- export estatico, sem otimizador de imagem
          <img src={url} alt={`${title} atual da comunidade`} className={`${box} shrink-0 object-cover`} />
        ) : (
          <span aria-hidden="true" className={`${box} flex shrink-0 items-center justify-center bg-surface-hover text-lg font-bold text-ink-muted`}>
            {kind === 'icon' ? fallback : ''}
          </span>
        )}
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept={AVATAR_FILE_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            data-testid={`community-${kind}-input`}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              if (file.size > MAX_AVATAR_SIZE_BYTES) {
                setError('A imagem passa de 32 MB.');
                return;
              }
              void act(() => api.uploadCommunityImage(communityId, kind, file), `Não foi possível enviar o ${noun}. Use PNG, JPEG ou WebP.`);
            }}
          />
          <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={busy} aria-busy={busy}>
            <Icon name="image" size={14} />
            {busy ? 'Enviando...' : url ? `Trocar ${noun}` : `Enviar ${noun}`}
          </Button>
          {url && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void act(() => api.deleteCommunityImage(communityId, kind), `Não foi possível remover o ${noun}.`)}>
              Remover {noun}
            </Button>
          )}
        </div>
      </div>
      {error && <Banner variant="error">{error}</Banner>}
    </div>
  );
}

export function CommunityImagesSection({
  community,
  onChanged,
}: {
  community: { id: string; name: string; iconUpdatedAt?: string | null; bannerUpdatedAt?: string | null };
  onChanged: () => void;
}) {
  return (
    <section className="space-y-3" aria-labelledby="community-images-heading">
      <h3 id="community-images-heading" className="font-semibold text-ink-primary">Aparência</h3>
      <p className="text-sm text-ink-muted">PNG, JPEG ou WebP, até 32 MB. O ícone aparece na barra de comunidades; o banner, no topo da lista de canais.</p>
      <ImagePicker communityId={community.id} kind="icon" updatedAt={community.iconUpdatedAt} fallback={community.name.slice(0, 2).toLocaleUpperCase('pt-BR')} onChanged={onChanged} />
      <ImagePicker communityId={community.id} kind="banner" updatedAt={community.bannerUpdatedAt} fallback="" onChanged={onChanged} />
    </section>
  );
}

function CategoryRow({ category, run, onDelete }: { category: CommunityCategory; run: (action: () => Promise<unknown>) => Promise<boolean>; onDelete: () => void }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(category.name);
  if (renaming)
    return (
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => api.renameCategory(category.id, name)).then((ok) => {
            if (ok) setRenaming(false);
          });
        }}
      >
        <Input label="Novo nome da categoria" value={name} maxLength={CATEGORY_NAME_MAX} required onChange={(event) => setName(event.target.value)} />
        <Button type="submit" size="sm">Salvar</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setRenaming(false)}>Cancelar</Button>
      </form>
    );
  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-sm text-ink-primary">{category.name}</span>
      <Button variant="ghost" size="sm" aria-label={`Renomear categoria ${category.name}`} onClick={() => { setName(category.name); setRenaming(true); }}>
        Renomear
      </Button>
      <Button variant="ghost" size="sm" aria-label={`Apagar categoria ${category.name}`} onClick={onDelete}>
        Apagar
      </Button>
    </div>
  );
}

export function CategoriesSection({
  communityId,
  categories,
  run,
  onDelete,
}: {
  communityId: string;
  categories: CommunityCategory[];
  /** Executa e recarrega; false em erro (mensagem fica no dialogo). */
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  onDelete: (category: CommunityCategory) => void;
}) {
  const [name, setName] = useState('');
  const full = categories.length >= MAX_CHANNEL_CATEGORIES;
  return (
    <section className="space-y-2" aria-labelledby="community-categories-heading">
      <h3 id="community-categories-heading" className="font-semibold text-ink-primary">Categorias</h3>
      <p className="text-sm text-ink-muted">
        Agrupam canais na lista. Arraste um canal para outra categoria ou use Alt+Seta para mudar a ordem. Apagar a categoria não apaga os canais.
      </p>
      {categories.map((category) => (
        <CategoryRow key={category.id} category={category} run={run} onDelete={() => onDelete(category)} />
      ))}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => api.createCategory(communityId, name)).then((ok) => {
            if (ok) setName('');
          });
        }}
      >
        <Input label="Nome da nova categoria" maxLength={CATEGORY_NAME_MAX} required value={name} onChange={(event) => setName(event.target.value)} />
        <Button type="submit" size="sm" disabled={full}>Criar categoria</Button>
      </form>
      {full && <p className="text-xs text-ink-muted">Limite de {MAX_CHANNEL_CATEGORIES} categorias atingido.</p>}
    </section>
  );
}
