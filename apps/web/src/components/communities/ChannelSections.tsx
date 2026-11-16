'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { CommunityLayout } from '@scale/shared';
import { Icon } from '@/components/ui/Icon';
import {
  buildSections, dropOnChannel, dropOnSection, moveCategory, moveChannel, readCollapsed, writeCollapsed,
  type LayoutCategory, type LayoutChannel,
} from './channelLayout';

/**
 * Lista de canais agrupada: grupos "Canais de texto"/"Canais de voz" para quem
 * nao tem categoria e uma secao recolhivel por categoria. Com `onLayout`
 * (permissao manageChannels) arrastar reordena e muda de categoria; Alt+Seta
 * move o canal (ou a categoria, no titulo) dentro do grupo.
 */
export function ChannelSections<C extends LayoutChannel>({
  channels,
  categories,
  renderChannel,
  onLayout,
}: {
  channels: C[];
  categories: LayoutCategory[];
  renderChannel: (channel: C) => ReactNode;
  onLayout?: (layout: CommunityLayout) => void;
}) {
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  useEffect(() => setCollapsed(readCollapsed()), []);
  const sections = buildSections(channels, categories);
  const toggle = (id: string) => {
    const next = collapsed.includes(id) ? collapsed.filter((item) => item !== id) : [...collapsed, id];
    setCollapsed(next);
    writeCollapsed(next);
  };
  const endDrag = () => {
    setDragId(null);
    setOverKey(null);
  };
  const apply = (layout: CommunityLayout | null) => {
    if (layout) onLayout?.(layout);
  };
  const keepFocus = (element: HTMLElement) => requestAnimationFrame(() => element.focus());
  const dropProps = (key: string, onDrop: (id: string) => void) =>
    onLayout
      ? {
          onDragOver: (event: React.DragEvent) => {
            if (!dragId) return;
            event.preventDefault();
            event.stopPropagation();
            setOverKey(key);
          },
          onDragLeave: () => setOverKey((current) => (current === key ? null : current)),
          onDrop: (event: React.DragEvent) => {
            event.preventDefault();
            event.stopPropagation();
            if (dragId) onDrop(dragId);
            endDrag();
          },
        }
      : {};
  return (
    <>
      {sections.map((section) => {
        const isCategory = section.type === 'category';
        if (!isCategory && section.channels.length === 0 && sections.some((s) => s.type === 'category')) return null;
        const open = !isCategory || !collapsed.includes(section.category.id);
        const title = isCategory ? section.category.name : section.kind === 'TEXT' ? 'Canais de texto' : 'Canais de voz';
        const listId = `channel-section-${section.key.replace(':', '-')}`;
        return (
          <div
            key={section.key}
            data-testid="channel-section"
            className={`mb-5 rounded-lg ${overKey === section.key ? 'outline outline-2 outline-accent' : ''}`}
            {...dropProps(section.key, (id) => apply(dropOnSection(sections, id, section.key)))}
          >
            <h3 className="px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {isCategory ? (
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={listId}
                  aria-keyshortcuts={onLayout ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
                  onClick={() => toggle(section.category.id)}
                  onKeyDown={(event) => {
                    if (!onLayout || !event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
                    event.preventDefault();
                    const target = event.currentTarget;
                    apply(moveCategory(sections, section.category.id, event.key === 'ArrowUp' ? -1 : 1));
                    keepFocus(target);
                  }}
                  className="flex w-full items-center gap-1 rounded px-2 py-0.5 text-left uppercase hover:text-ink-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <Icon
                    name="chevronDown"
                    size={12}
                    className={`shrink-0 transition-transform motion-reduce:transition-none ${open ? '' : '-rotate-90'}`}
                  />
                  <span className="truncate">{title}</span>
                </button>
              ) : (
                <span className="px-2">{title}</span>
              )}
            </h3>
            {open && (
              <ul id={listId}>
                {section.channels.map((channel) => (
                  <li
                    key={channel.id}
                    data-testid="channel-item"
                    draggable={Boolean(onLayout)}
                    className={`rounded-lg ${dragId === channel.id ? 'opacity-50' : ''} ${overKey === channel.id && dragId !== channel.id ? 'outline outline-2 outline-accent' : ''}`}
                    onDragStart={(event) => {
                      if (!onLayout) return;
                      setDragId(channel.id);
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', channel.id);
                    }}
                    onDragEnd={endDrag}
                    onKeyDownCapture={(event) => {
                      if (!onLayout || !event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
                      // So o botao principal do canal (o primeiro focavel) reordena.
                      const target = event.target as HTMLElement;
                      if (target !== event.currentTarget.querySelector('button')) return;
                      event.preventDefault();
                      event.stopPropagation();
                      apply(moveChannel(sections, channel.id, event.key === 'ArrowUp' ? -1 : 1));
                      keepFocus(target);
                    }}
                    {...dropProps(channel.id, (id) => apply(dropOnChannel(sections, id, channel.id)))}
                  >
                    {renderChannel(channel)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </>
  );
}
