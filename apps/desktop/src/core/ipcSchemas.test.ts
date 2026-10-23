import { describe, expect, it } from 'vitest';
import { healthUrl, isHealthy, pickerChoiceSchema } from './ipcSchemas';

describe('health', () => {
  it('monta a url de health na origin', () => {
    expect(healthUrl('https://a.com')).toBe('https://a.com/api/health');
    expect(healthUrl('http://localhost:8090')).toBe('http://localhost:8090/api/health');
  });
  it('reconhece resposta ok', () => {
    expect(isHealthy({ status: 'ok', timestamp: 'x' })).toBe(true);
    expect(isHealthy({ status: 'down' })).toBe(false);
    expect(isHealthy('ok')).toBe(false);
    expect(isHealthy(null)).toBe(false);
  });
});

describe('pickerChoiceSchema', () => {
  it('aceita ids do desktopCapturer', () => {
    expect(pickerChoiceSchema.safeParse({ sourceId: 'screen:0:0', shareAudio: false }).success).toBe(true);
    expect(pickerChoiceSchema.safeParse({ sourceId: 'window:132456:0', shareAudio: true }).success).toBe(true);
  });
  it('recusa formatos estranhos', () => {
    expect(pickerChoiceSchema.safeParse({ sourceId: 'tab:1', shareAudio: false }).success).toBe(false);
    expect(pickerChoiceSchema.safeParse({ sourceId: 'screen:0', shareAudio: 'sim' }).success).toBe(false);
    expect(pickerChoiceSchema.safeParse({ sourceId: 'screen:0', shareAudio: false, x: 1 }).success).toBe(false);
  });
});
