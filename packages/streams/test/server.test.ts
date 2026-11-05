/**
 * The shared vectors (byte copies of hubfly-stream/testdata/tokens/playback.json and
 * testdata/webhooks/signature.json): every case verifies at its `now`, signing vectors also sign
 * to the exact token.
 */
import { describe, expect, test } from 'bun:test';
import {
  PlaybackTokenError,
  signPlaybackToken,
  signWebhook,
  verifyPlaybackToken,
  verifyWebhook,
  type PlaybackClaims,
  type PlaybackKey,
} from '../src/server';
import playback from './vectors/playback.json';
import webhooks from './vectors/webhook-signatures.json';

const keys = playback.keys as PlaybackKey[];

describe('playback token vectors', () => {
  for (const c of playback.cases) {
    test(c.name, async () => {
      const verified = verifyPlaybackToken(c.token, keys, { channel: c.channel, clientIp: c.client_ip, now: playback.now });
      if (c.valid) expect((await verified).ch).toBe((c.claims as PlaybackClaims).ch);
      else await expect(verified).rejects.toBeInstanceOf(PlaybackTokenError);
      if (c.signing_vector) {
        const key = keys.find((k) => k.id === c.header?.kid)!;
        const claims = c.claims as Partial<PlaybackClaims>;
        if (!claims.ch) {
          // The signer refuses to mint a token without a channel ...
          await expect(signPlaybackToken(key, claims as PlaybackClaims)).rejects.toThrow(TypeError);
        } else if (claims.exp === undefined) {
          // ... and always sets exp (now + ttl), so these two vectors only test verification.
          expect(await signPlaybackToken(key, { ...claims, ch: claims.ch }, { now: playback.now })).not.toBe(c.token);
        } else {
          expect(await signPlaybackToken(key, claims as PlaybackClaims)).toBe(c.token);
        }
      }
    });
  }
});

describe('playback tokens', () => {
  const key = keys[0];
  const now = playback.now;

  test('exp defaults to now + ttl and round-trips', async () => {
    const token = await signPlaybackToken(key, { ch: 'sch_main0001', sub: 'viewer-42' }, { now, ttlSeconds: 600 });
    expect(await verifyPlaybackToken(token, keys, { channel: 'sch_main0001', now })).toEqual({
      ch: 'sch_main0001',
      exp: now + 600,
      sub: 'viewer-42',
    });
  });

  test('revoked keys never verify', async () => {
    const token = await signPlaybackToken(key, { ch: '*' }, { now });
    await expect(verifyPlaybackToken(token, [{ ...key, status: 'revoked' }], { channel: 'x', now })).rejects.toBeInstanceOf(
      PlaybackTokenError,
    );
  });

  test('an ip claim needs the client address', async () => {
    const token = await signPlaybackToken(key, { ch: '*', ip: '203.0.113.0/24' }, { now });
    await expect(verifyPlaybackToken(token, keys, { channel: 'x', now })).rejects.toBeInstanceOf(PlaybackTokenError);
    expect((await verifyPlaybackToken(token, keys, { channel: 'x', clientIp: '203.0.113.9', now })).ip).toBe('203.0.113.0/24');
  });

  test('refuses bad input to signing', async () => {
    await expect(signPlaybackToken(key, { ch: '' })).rejects.toThrow(TypeError);
    await expect(signPlaybackToken(key, { ch: 'a' }, { ttlSeconds: 32 * 86_400 })).rejects.toThrow(RangeError);
  });

  test('the refusal never names the check or the secret', async () => {
    const error = await verifyPlaybackToken('a.b.c', keys, { channel: 'x', now }).catch((e) => e);
    expect(error.message).toBe('Playback token refused');
    expect(String(error.stack)).not.toContain(key.secret);
  });
});

describe('webhook signature vectors', () => {
  for (const c of webhooks.cases) {
    test(c.name, async () => {
      expect(await verifyWebhook(c.secret, c.body, c.header, { now: c.now, toleranceSeconds: c.tolerance_seconds })).toBe(c.valid);
    });
  }

  test('signWebhook reproduces the valid header', async () => {
    const c = webhooks.cases.find((x) => x.name === 'valid')!;
    const t = Number(/t=(\d+)/.exec(c.header)![1]);
    expect(await signWebhook(c.secret, c.body, t)).toBe(c.header);
  });

  test('missing header or secret is invalid', async () => {
    expect(await verifyWebhook('whsec_x', '{}', null)).toBe(false);
    expect(await verifyWebhook('', '{}', `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`)).toBe(false);
  });
});
