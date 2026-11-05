/** WHIP publishing with a fake RTCPeerConnection and fetch: offer/answer, codecs, bitrate, errors, stop. */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { MediaError, publish } from '../src/publish';
import { FakePeerConnection, fakeFetch, flush, install } from './fakes';

const URL_ = 'https://acme-tv.live.hubfly.app/whip/sin_cam00001';
const KEY = 'sk_live_fixture_key';
const CODECS = ['video/VP9', 'video/rtx', 'video/VP8', 'video/H264', 'audio/PCMU', 'audio/opus'].map((mimeType) => ({ mimeType }));
const stream = {
  getTracks: () => [{ kind: 'audio' }, { kind: 'video' }],
} as unknown as MediaStream;

let restore: () => void;

function setup(routes: Parameters<typeof fakeFetch>[0]) {
  const f = fakeFetch(routes);
  restore = install({
    RTCPeerConnection: FakePeerConnection,
    RTCRtpSender: { getCapabilities: (kind: string) => ({ codecs: CODECS.filter((c) => c.mimeType.startsWith(kind)) }) },
    fetch: f.fetch,
  });
  return f;
}

beforeEach(() => {
  FakePeerConnection.instances = [];
  FakePeerConnection.behavior = 'connect';
});
afterEach(() => restore?.());

describe('publish', () => {
  test('offers sendonly tracks with H.264 first and Opus, then goes live', async () => {
    const f = setup({
      'POST /whip/sin_cam00001': () => new Response('v=0 answer', { status: 201, headers: { Location: '/whip/sin_cam00001/s_9' } }),
      'DELETE /whip/': () => new Response(null, { status: 204 }),
    });
    const handle = await publish({ url: URL_, token: KEY, stream, maxBitrateKbps: 4500 });
    const states: string[] = [];
    handle.addEventListener('statechange', () => states.push(handle.state));
    await flush();
    expect(handle.state).toBe('live');
    FakePeerConnection.instances[0].setState('disconnected');
    FakePeerConnection.instances[0].setState('connected');
    expect(states).toEqual(['reconnecting', 'live']);

    const pc = FakePeerConnection.instances[0];
    const [audio, video] = pc.transceivers;
    expect([audio.direction, video.direction]).toEqual(['sendonly', 'sendonly']);
    expect(video.preferences!.map((c) => c.mimeType)).toEqual(['video/H264', 'video/VP8', 'video/rtx', 'video/VP9']);
    expect(audio.preferences![0].mimeType).toBe('audio/opus');
    expect(video.parameters.encodings[0].maxBitrate).toBe(4_500_000);
    expect(audio.parameters.encodings[0].maxBitrate).toBeUndefined();

    const post = f.calls[0];
    expect(post.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(post.headers['content-type']).toBe('application/sdp');
    expect(post.body).toContain('offer');
    expect(pc.remote?.sdp).toBe('v=0 answer');

    await handle.stop();
    await flush();
    expect(handle.state).toBe('stopped');
    expect(pc.closed).toBe(true);
    expect(f.calls[1]).toMatchObject({ method: 'DELETE', url: `${URL_}/s_9` });
  });

  for (const [status, code, message] of [
    [401, 'unauthorized', 'The stream key was refused'],
    [403, 'forbidden', 'Publishing is not allowed'],
    [409, 'conflict', 'Another encoder is already publishing'],
    [503, 'unavailable', 'not accepting publishers'],
  ] as const) {
    test(`WHIP ${status} rejects with ${code}`, async () => {
      setup({ 'POST /whip/': () => new Response('input_disabled', { status, headers: { 'Retry-After': '5' } }) });
      const error = (await publish({ url: URL_, token: KEY, stream }).catch((e) => e)) as MediaError;
      expect(error).toBeInstanceOf(MediaError);
      expect(error.code).toBe(code);
      expect(error.status).toBe(status);
      expect(error.reason).toBe('input_disabled');
      expect(error.retryAfter).toBe(5);
      expect(error.message).toContain(message);
      expect(error.message).not.toContain(KEY);
      expect(FakePeerConnection.instances[0].closed).toBe(true);
    });
  }

  test('a network failure is a network error', async () => {
    restore = install({
      RTCPeerConnection: FakePeerConnection,
      fetch: () => Promise.reject(new TypeError('fetch failed')),
    });
    const error = (await publish({ url: URL_, token: KEY, stream }).catch((e) => e)) as MediaError;
    expect(error.code).toBe('network');
  });

  test('a lost connection reports reconnecting, then failed', async () => {
    setup({ 'POST /whip/': () => new Response('v=0', { status: 201 }) });
    const handle = await publish({ url: URL_, token: KEY, stream });
    await flush();
    const pc = FakePeerConnection.instances[0];
    pc.setState('disconnected');
    expect(handle.state).toBe('reconnecting');
    pc.setState('failed');
    expect(handle.state).toBe('failed');
  });
});
