import { Transform } from 'node:stream';

// Um processo de API por volume SQLite, como no Compose. Locks nao atravessam
// processos; escalar replicas exige reserva persistida no banco.
const held = new Set<string>();
export function tryResourceLock(key: string): (() => void) | null {
  if (held.has(key)) return null;
  held.add(key);
  return () => { held.delete(key); };
}

export class StreamLimitError extends Error {}

/** Recusa o chunk ANTES de repassa-lo ao disco. Memoria limitada ao highWaterMark. */
export function byteLimit(maxBytes: number, onBytes?: (bytes: number) => void): Transform {
  let received = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      if (chunk.length > maxBytes - received) {
        callback(new StreamLimitError('Upload byte limit exceeded'));
        return;
      }
      received += chunk.length;
      onBytes?.(chunk.length);
      callback(null, chunk);
    },
  });
}

let avatarStreams = 0;
export function tryAvatarSlot(): (() => void) | null {
  if (avatarStreams >= 2) return null;
  avatarStreams++;
  return () => { avatarStreams--; };
}
