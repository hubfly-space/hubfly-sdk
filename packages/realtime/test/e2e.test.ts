/**
 * E2E tests driven by test/fixtures/vectors.json.
 *
 * Origin of the fixture: a byte-for-byte copy of hubfly-realtime/testdata/e2e/vectors.json
 * (generated there by `go run ./scripts/e2evectors`; sha256
 * a34a1e6df343839f1056d34cf69fe3ef8f147ff2684705397b6740318ff43cce at copy time). Do not edit it
 * here; re-copy it when the engine regenerates it. The drift test below compares the two files
 * when the engine checkout is next to this repository.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CLIENT_E2E_EVENT,
  E2EError,
  E2E_EVENT,
  Receiver,
  checkEnvelope,
  createClientE2E,
  decryptPusher,
  decryptV1,
  deriveKey,
  deriveWireKeys,
  encryptPusher,
  encryptV1,
  formatConnectionId,
  fromBase64,
  fromBase64Url,
  newMessageId,
  parseConnectionId,
  parseEnvelope,
  parseKeyList,
  toBase64,
  toBase64Url,
  type V1Message,
} from '../src/e2e/index';
import { utf8Decode } from '../src/e2e/codec';

const fixturePath = join(import.meta.dir, 'fixtures', 'vectors.json');
const raw = readFileSync(fixturePath, 'utf8');
const V = JSON.parse(raw);
const masters: Record<string, Uint8Array> = Object.fromEntries(
  V.master_keys.map((k: { kid: string; key: string }) => [k.kid, fromBase64(k.key)]),
);

function reason(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return e instanceof E2EError ? e.reason : `other:${(e as Error).message}`;
  }
  return 'no error';
}

describe('vectors.json', () => {
  test('fixture matches the engine copy when available', () => {
    const engine = join(import.meta.dir, '..', '..', '..', '..', 'hubfly-realtime', 'testdata', 'e2e', 'vectors.json');
    if (!existsSync(engine)) return; // standalone checkout
    expect(readFileSync(engine, 'utf8')).toBe(raw);
  });

  test('derive', () => {
    expect(V.derive.length).toBeGreaterThan(0);
    for (const d of V.derive) {
      expect(toBase64(deriveKey(d.name, masters[d.kid]))).toBe(d.key);
    }
    const wire = deriveWireKeys('private-encrypted-orders', parseKeyList(`k1:${V.master_keys[0].key},k0:${V.master_keys[1].key}`));
    expect(wire).toEqual([
      { kid: 'k1', key: V.derive[0].key },
      { kid: 'k0', key: V.derive[1].key },
    ]);
  });

  test('pusher envelopes', () => {
    for (const p of V.pusher) {
      const key = fromBase64(p.key);
      expect(toBase64(deriveKey(p.channel, masters[p.kid]))).toBe(p.key);
      expect(JSON.stringify(p.data)).toBe(p.plaintext);
      expect(encryptPusher(key, p.data, fromBase64(p.nonce))).toBe(p.envelope);
      expect(decryptPusher(key, p.envelope)).toEqual(p.data);
      expect(decryptPusher([fromBase64(V.derive[1].key), key], JSON.parse(p.envelope))).toEqual(p.data);
      expect(reason(() => decryptPusher(fromBase64(V.derive[1].key), p.envelope))).toBe('decrypt_failed');
    }
  });

  test('v1 envelopes', () => {
    for (const v of V.v1) {
      const key = fromBase64(v.key);
      if (v.kid !== 'c') expect(toBase64(deriveKey(v.context, masters[v.kid]))).toBe(v.key);
      expect(JSON.stringify(v.message)).toBe(v.plaintext);
      expect(encryptV1(key, v.kid, v.message, fromBase64(v.nonce))).toBe(v.envelope);
      const opened = decryptV1(key, v.envelope);
      expect(opened).toEqual({ ...v.message, kid: v.kid });
      expect(decryptV1(new Map([[v.kid, key]]), v.envelope).m).toBe(v.message.m);
      expect(reason(() => decryptV1(() => undefined, v.envelope))).toBe('unknown_kid');
      expect(reason(() => decryptV1(new Uint8Array(32), v.envelope))).toBe('decrypt_failed');
    }
  });

  test('connection ids', () => {
    for (const c of V.connection_ids) {
      const key = fromBase64Url(c.key);
      expect(key.length).toBe(32);
      expect(formatConnectionId(c.socket_id, key)).toBe(c.id);
      const parsed = parseConnectionId(c.id);
      expect(parsed.socketId).toBe(c.socket_id);
      expect(toBase64Url(parsed.key!)).toBe(c.key);
      expect(parseConnectionId(c.socket_id)).toEqual({ socketId: c.socket_id });
    }
    // The direct-message vector is encrypted with the connection-id key.
    const direct = V.v1.find((v: { kid: string }) => v.kid === 'c');
    expect(toBase64(fromBase64Url(V.connection_ids[0].key))).toBe(direct.key);
    for (const bad of ['', 'abc', '1234.5678~', '1234.5678~AAAA', '1234.5678~' + 'A'.repeat(43) + '=', 'x1.2']) {
      expect(() => parseConnectionId(bad)).toThrow();
    }
  });

  test('envelope shapes', () => {
    for (const s of V.shape.valid_pusher) expect(checkEnvelope(s.envelope)).toEqual({ ok: true, kind: 'pusher' });
    for (const s of V.shape.valid_v1) {
      const r = checkEnvelope(s.envelope);
      expect(r.ok && r.kind).toBe('v1');
    }
    for (const s of V.shape.invalid) {
      expect({ envelope: s.envelope, reason: reason(() => parseEnvelope(s.envelope)) }).toEqual({
        envelope: s.envelope,
        reason: s.reason,
      });
      expect(checkEnvelope(s.envelope)).toEqual({ ok: false, reason: s.reason });
    }
  });
});

describe('codecs and keys', () => {
  test('strict base64', () => {
    expect(toBase64(new Uint8Array([1, 2, 3, 4]))).toBe('AQIDBA==');
    expect(Array.from(fromBase64('AQIDBA=='))).toEqual([1, 2, 3, 4]);
    for (const bad of ['AQIDBA', 'AQIDBA=', 'AQID BA==', 'AQ-_BA==', 'A===', '=AAA']) {
      expect(reason(() => fromBase64(bad))).toBe('bad_base64');
    }
    expect(toBase64Url(new Uint8Array([0xfb, 0xff]))).toBe('-_8');
    expect(Array.from(fromBase64Url('-_8'))).toEqual([0xfb, 0xff]);
    expect(reason(() => fromBase64Url('-_8='))).toBe('bad_base64');
    expect(reason(() => fromBase64Url('A'))).toBe('bad_base64');
    for (let n = 0; n < 70; n++) {
      const b = new Uint8Array(n).map((_, i) => (i * 37 + n) & 255);
      expect(Array.from(fromBase64(toBase64(b)))).toEqual(Array.from(b));
      expect(Array.from(fromBase64Url(toBase64Url(b)))).toEqual(Array.from(b));
      expect(toBase64(b)).toBe(Buffer.from(b).toString('base64'));
    }
  });

  test('utf8 decode is fatal', () => {
    expect(utf8Decode(new Uint8Array([0x63, 0x61, 0x66, 0xc3, 0xa9]))).toBe('café');
    expect(reason(() => utf8Decode(new Uint8Array([0xc3])))).toBe('bad_plaintext');
    expect(reason(() => utf8Decode(new Uint8Array([0xed, 0xa0, 0x80])))).toBe('bad_plaintext');
  });

  test('parseKeyList', () => {
    const [k1, k0] = V.master_keys;
    expect(parseKeyList(`k2:${k0.key}, k1:${k1.key}`).map((k) => k.kid)).toEqual(['k2', 'k1']);
    const bare = parseKeyList(k1.key);
    expect(bare.length).toBe(1);
    expect(bare[0].kid).toBe('k1');
    expect(Array.from(bare[0].key)).toEqual(Array.from(masters.k1));
    // lenient material: unpadded and URL alphabet
    expect(Array.from(parseKeyList(`a:${k1.key.replace(/=+$/, '')}`)[0].key)).toEqual(Array.from(masters.k1));
    const url = Buffer.from(masters.k0).toString('base64url');
    expect(Array.from(parseKeyList(`rot_2026-10:${url}`)[0].key)).toEqual(Array.from(masters.k0));
    expect(() => parseKeyList('')).toThrow(/no encryption keys/);
    expect(() => parseKeyList(`c:${k1.key}`)).toThrow(/invalid encryption key id/);
    expect(() => parseKeyList(`has space:${k1.key}`)).toThrow(/invalid encryption key id/);
    expect(() => parseKeyList(`k1:${k1.key},k1:${k0.key}`)).toThrow(/duplicate/);
    expect(() => parseKeyList(`${k1.key},${k0.key}`)).toThrow(/duplicate/);
    expect(() => parseKeyList('k1:AAAA')).toThrow(/32 bytes/);
    expect(() => parseKeyList('k1:!!!!')).toThrow(/base64/);
  });

  test('message ids', () => {
    const id = newMessageId(1760600000000);
    expect(id).toMatch(/^m_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(id.slice(0, 12)).toBe(newMessageId(1760600000000).slice(0, 12));
    expect(newMessageId(1760600000001) > newMessageId(1760600000000)).toBe(true);
  });
});

describe('Receiver', () => {
  const msg = (m: string, t = 1_000_000, to = 'private-orders'): V1Message => ({ e: 'x', d: 1, to, m, t });

  test('to, replay and age checks', () => {
    let now = 1_000_000;
    const r = new Receiver(1000, () => now);
    r.check('private-orders', msg('a'));
    expect(reason(() => r.check('private-orders', msg('a')))).toBe('replayed');
    expect(reason(() => r.check('private-other', msg('b')))).toBe('wrong_context');
    now += 1001;
    expect(reason(() => r.check('private-orders', msg('c')))).toBe('expired');
    r.check('private-orders', msg('d', now));
    // ids are per context
    r.check('private-x', msg('a', now, 'private-x'));
  });

  test('remembers the last 1000 ids per context', () => {
    const r = new Receiver(Infinity);
    for (let i = 0; i < 1001; i++) r.check('c1', msg(String(i), 0, 'c1'));
    r.check('c1', msg('0', 0, 'c1')); // evicted, accepted again
    expect(reason(() => r.check('c1', msg('1000', 0, 'c1')))).toBe('replayed');
  });
});

describe('createClientE2E', () => {
  const chan = 'private-orders';
  const encChan = 'private-encrypted-orders';
  const keysFor = (name: string) => deriveWireKeys(name, parseKeyList(`k1:${V.master_keys[0].key},k0:${V.master_keys[1].key}`));

  test('opens v1 channel messages and enforces receiver checks', () => {
    const now = 1760600000000;
    const e2e = createClientE2E({ now: () => now });
    const v = V.v1[0];
    expect(reason(() => e2e.open(chan, E2E_EVENT, v.envelope))).toBe('no_key');
    e2e.keys(chan, keysFor(chan));
    expect(e2e.has(chan)).toBe(true);
    expect(e2e.open(chan, E2E_EVENT, v.envelope)).toEqual(['order.updated', { id: 1 }]);
    expect(reason(() => e2e.open(chan, E2E_EVENT, v.envelope))).toBe('replayed');
    expect(reason(() => e2e.open(chan, 'order.updated', v.envelope))).toBe('wrong_envelope');
    // A member cannot pass a client event off as a server event and vice versa.
    const [, sealed] = e2e.seal(chan, 'client-typing', { a: 1 }, true)!;
    expect(reason(() => e2e.open(chan, E2E_EVENT, sealed))).toBe('bad_event');
    // Delivered on another channel: rejected by `to`.
    e2e.keys('private-other', keysFor(chan));
    const [, sealed2] = e2e.seal(chan, 'client-typing', { a: 2 }, true)!;
    expect(reason(() => e2e.open('private-other', CLIENT_E2E_EVENT, sealed2))).toBe('wrong_context');
    expect(reason(() => e2e.open(chan, CLIENT_E2E_EVENT, 'not json'))).toBe('not_json');
  });

  test('rejects old messages', () => {
    const e2e = createClientE2E({ now: () => 1760600000000 + 24 * 3600 * 1000 + 1 });
    e2e.keys(chan, keysFor(chan));
    expect(reason(() => e2e.open(chan, E2E_EVENT, V.v1[0].envelope))).toBe('expired');
    const lenient = createClientE2E({ now: () => 1760600000000 + 24 * 3600 * 1000 + 1, maxAgeMs: 48 * 3600 * 1000 });
    lenient.keys(chan, keysFor(chan));
    expect(lenient.open(chan, E2E_EVENT, V.v1[0].envelope)[0]).toBe('order.updated');
  });

  test('rotated user keys', () => {
    const ctx = '#server-to-user-u_42';
    const e2e = createClientE2E({ now: () => 1760600000010 });
    e2e.keys(ctx, keysFor(ctx));
    expect(e2e.open(ctx, E2E_EVENT, V.v1[1].envelope)).toEqual(['notice', { text: 'Hi ünïcode' }]);
    expect(e2e.open(ctx, E2E_EVENT, V.v1[2].envelope)).toEqual(['notice', 'old key']);
    e2e.keys(ctx, keysFor(ctx).slice(0, 1));
    expect(reason(() => e2e.open(ctx, E2E_EVENT, V.v1[2].envelope))).toBe('unknown_kid');
  });

  test('direct messages use the client key', () => {
    const e2e = createClientE2E();
    const k = e2e.newKey();
    const socketId = '1234567890.1234567890';
    const id = `${socketId}~${k}`;
    const parsed = parseConnectionId(id);
    const ctx = `#direct-${socketId}`;
    const env = encryptV1(parsed.key!, 'c', { e: 'order.updated', d: { orderId: 'o_9' }, to: ctx, m: newMessageId(), t: Date.now() });
    expect(e2e.open(ctx, E2E_EVENT, env)).toEqual(['order.updated', { orderId: 'o_9' }]);
    // Master-key kids are not accepted for direct messages, and `c` is not accepted elsewhere.
    const other = encryptV1(parsed.key!, 'k1', { e: 'x', d: 1, to: ctx, m: newMessageId(), t: Date.now() });
    expect(reason(() => e2e.open(ctx, E2E_EVENT, other))).toBe('unknown_kid');
    e2e.keys(chan, keysFor(chan));
    const wrong = encryptV1(parsed.key!, 'c', { e: 'x', d: 1, to: chan, m: newMessageId(), t: Date.now() });
    expect(reason(() => e2e.open(chan, E2E_EVENT, wrong))).toBe('unknown_kid');
    // The vector direct message opens with the vector client key only.
    expect(reason(() => e2e.open(V.v1[3].context, E2E_EVENT, V.v1[3].envelope))).toBe('decrypt_failed');
  });

  test('pusher envelopes on encrypted channels, any kid, shared_secret only', () => {
    const e2e = createClientE2E();
    const p = V.pusher[0];
    e2e.keys(encChan, keysFor(encChan).reverse()); // order does not matter for decryption
    expect(e2e.open(encChan, 'order.updated', p.envelope)).toEqual(['order.updated', p.data]);
    expect(reason(() => e2e.open(chan, 'order.updated', p.envelope))).toBe('wrong_envelope');
    const pusherOnly = createClientE2E();
    pusherOnly.keys(encChan, null, p.key);
    expect(pusherOnly.open(encChan, 'order.updated', JSON.parse(p.envelope))).toEqual(['order.updated', p.data]);
    expect(pusherOnly.has(encChan)).toBe(false);
    expect(pusherOnly.seal(encChan, 'client-x', 1, false)).toBeNull();
    expect(reason(() => pusherOnly.seal(encChan, 'client-x', 1, true))).toBe('no_key');
  });

  test('seal produces v1 client events with the active kid', () => {
    const e2e = createClientE2E();
    e2e.keys(encChan, keysFor(encChan));
    const [event, data] = e2e.seal(encChan, 'client-typing', { typing: true }, true)!;
    expect(event).toBe(CLIENT_E2E_EVENT);
    const opened = decryptV1(fromBase64(V.derive[0].key), data);
    expect(opened.kid).toBe('k1');
    expect(opened.e).toBe('client-typing');
    expect(opened.to).toBe(encChan);
    expect(opened.m).toMatch(/^m_/);
    const receiver = createClientE2E();
    receiver.keys(encChan, keysFor(encChan));
    expect(receiver.open(encChan, CLIENT_E2E_EVENT, data)).toEqual(['client-typing', { typing: true }]);
    expect(createClientE2E().seal(chan, 'client-x', 1, false)).toBeNull();
  });

  test('sealed presence user_info', () => {
    const e2e = createClientE2E({ now: () => 0 }); // age/replay checks do not apply to user_info
    const ch = 'presence-room-1';
    e2e.keys(ch, keysFor(ch));
    const sealed = JSON.parse(V.v1[4].envelope);
    expect(e2e.info(ch, 'u_42', sealed)).toEqual({ name: 'Ann' });
    expect(e2e.info(ch, 'u_42', sealed)).toEqual({ name: 'Ann' });
    expect(reason(() => e2e.info(ch, 'u_43', sealed))).toBe('bad_event');
    // Plaintext user_info in a context with keys is refused; absent stays absent.
    expect(reason(() => e2e.info(ch, 'u_1', { name: 'plain' }))).toBe('plaintext');
    expect(reason(() => e2e.info(ch, 'u_1', 'plain'))).toBe('plaintext');
    expect(e2e.info(ch, 'u_1', undefined)).toBeUndefined();
    expect(e2e.info(ch, 'u_1', null)).toBeNull();
    // Without keys for the context, or with allowPlaintext, plaintext passes through.
    expect(e2e.info('presence-other', 'u_1', { name: 'plain' })).toEqual({ name: 'plain' });
    const lax = createClientE2E({ now: () => 0, allowPlaintext: true });
    lax.keys(ch, keysFor(ch));
    expect(lax.info(ch, 'u_1', { name: 'plain' })).toEqual({ name: 'plain' });
    expect(lax.info(ch, 'u_42', sealed)).toEqual({ name: 'Ann' });
  });
});
