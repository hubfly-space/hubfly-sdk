// Type-level smoke test of the published declarations (ESM consumer, node16 resolution).
import { playbackURLs, withToken, type PlaybackURLs, type PlayerState } from '@hubfly/streams';
import { createPlayer, defineHubflyPlayer, MediaError, type Player, type PlayerStateDetail } from '@hubfly/streams/player';
import { publish, type PublishHandle, type PublishState } from '@hubfly/streams/publish';
import { PlaybackTokenError, signPlaybackToken, signWebhook, verifyPlaybackToken, verifyWebhook, type PlaybackClaims } from '@hubfly/streams/server';

const urls: PlaybackURLs = playbackURLs('acme-tv.live.hubfly.app', 'sch_main0001');
export const hls: string = withToken(urls.hls, 't');
export function mount(el: HTMLElement): Player {
  const player = createPlayer(el, { urls, token: 't', latency: 'webrtc', autoplay: true, muted: true });
  el.addEventListener('statechange', (e) => (e as CustomEvent<PlayerStateDetail>).detail.message);
  const state: PlayerState = player.state;
  return state === 'error' && player.reason ? player : player;
}
defineHubflyPlayer('my-player');
export const handle: Promise<PublishHandle> = publish({ url: 'https://h/whip/sin_1', token: 'k', stream: new MediaStream() });
export const state: Promise<PublishState> = handle.then((h) => h.state);
export const isMedia = (e: unknown): boolean => e instanceof MediaError && e.code === 'conflict';
export const token: Promise<string> = signPlaybackToken({ id: 'spk_1', secret: 'AAAA' }, { ch: '*' }, { ttlSeconds: 60 });
export const claims: Promise<PlaybackClaims> = verifyPlaybackToken('x', [{ id: 'spk_1', secret: 'AAAA', status: 'active' }], { channel: 'c' });
export const ok: Promise<boolean> = signWebhook('whsec_x', '{}').then((h) => verifyWebhook('whsec_x', '{}', h));
export const refused = new PlaybackTokenError();
