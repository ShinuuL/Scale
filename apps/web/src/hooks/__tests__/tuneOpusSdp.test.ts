import { describe, it, expect } from 'vitest';
import { tuneOpusSdp } from '../useWebRTC';

const BASE = [
  'v=0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 63',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=0;usedtx=1',
  'a=rtpmap:63 red/48000/2',
  '',
].join('\r\n');

describe('tuneOpusSdp', () => {
  it('força FEC, desliga DTX, mono e teto de bitrate preservando os demais', () => {
    const out = tuneOpusSdp(BASE);
    const fmtp = /a=fmtp:111 ([^\r\n]*)/.exec(out)?.[1] ?? '';
    expect(fmtp).toContain('minptime=10');
    expect(fmtp).toContain('useinbandfec=1');
    expect(fmtp).toContain('usedtx=0');
    expect(fmtp).toContain('stereo=0');
    expect(fmtp).toContain('maxaveragebitrate=40000');
    expect(fmtp).not.toContain('usedtx=1');
  });

  it('cria o fmtp quando o Opus não tem um', () => {
    const sdp = BASE.replace(/a=fmtp:111[^\r\n]*\r\n/, '');
    expect(tuneOpusSdp(sdp)).toMatch(/a=rtpmap:111 opus\/48000\/2\r\na=fmtp:111 useinbandfec=1/);
  });

  it('não mexe em SDP sem Opus', () => {
    const sdp = 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n';
    expect(tuneOpusSdp(sdp)).toBe(sdp);
  });

  it('é idempotente', () => {
    const once = tuneOpusSdp(BASE);
    expect(tuneOpusSdp(once)).toBe(once);
  });
});
