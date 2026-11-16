import type {
  ChannelMessageDeleteEvent,
  ChannelMessageEditEvent,
  ChannelThreadEvent,
} from '@scale/shared';
import type { ChannelMessage } from '@/lib/api';

/**
 * Fase 4: eventos de topico (thread) repassados pelo socket da comunidade.
 * O painel do topico e o chat do canal assinam aqui, sem fiar callbacks novos
 * pela CommunityView.
 */
export type ThreadBusEvent =
  | { type: 'message'; message: ChannelMessage }
  | { type: 'thread'; event: ChannelThreadEvent }
  | { type: 'edit'; event: ChannelMessageEditEvent }
  | { type: 'delete'; event: ChannelMessageDeleteEvent };

type Listener = (event: ThreadBusEvent) => void;
const listeners = new Set<Listener>();

export const threadBus = {
  emit(event: ThreadBusEvent): void {
    for (const listener of listeners) listener(event);
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
