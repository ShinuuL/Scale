/** Own one OS blocker; duplicate media events and disposal are idempotent. */
export function createMediaPowerPolicy(blocker: { start: () => number; stop: (id: number) => void }) {
  let id: number | undefined;
  return {
    setPlaying(playing: boolean): void {
      if (playing && id === undefined) id = blocker.start();
      if (!playing && id !== undefined) { blocker.stop(id); id = undefined; }
    },
    dispose(): void {
      if (id !== undefined) blocker.stop(id);
      id = undefined;
    },
  };
}

export function shouldHideOnClose(quitting: boolean, trayAvailable: boolean): boolean {
  return !quitting && trayAvailable;
}
