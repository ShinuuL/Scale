import { describe, expect, it, vi } from 'vitest';
import { createMediaPowerPolicy, shouldHideOnClose } from './lifecycle';

describe('desktop lifecycle', () => {
  it('close hides only with a working tray; quit always closes', () => {
    expect(shouldHideOnClose(false, true)).toBe(true);
    expect(shouldHideOnClose(true, true)).toBe(false);
    expect(shouldHideOnClose(false, false)).toBe(false);
  });
  it('owns one blocker and releases on pause/suspend/destroy', () => {
    const start = vi.fn(() => 7);
    const stop = vi.fn();
    const policy = createMediaPowerPolicy({ start, stop });
    policy.setPlaying(false);
    expect(stop).not.toHaveBeenCalled();
    policy.setPlaying(true);
    policy.setPlaying(true);
    expect(start).toHaveBeenCalledTimes(1);
    policy.setPlaying(false);
    policy.dispose();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledWith(7);
    policy.setPlaying(true);
    policy.dispose();
    expect(stop).toHaveBeenCalledTimes(2);
  });
});
