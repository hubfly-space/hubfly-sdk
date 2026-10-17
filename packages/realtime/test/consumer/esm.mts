// Type-level smoke test of the published declarations (ESM consumer, node16 resolution).
import { Realtime, type MessageMeta, type RealtimeOptions } from '@hubfly/realtime';
import { RealtimeServer, type SendResult } from '@hubfly/realtime/server';
import { createClientE2E, deriveKey, parseKeyList, type V1Message } from '@hubfly/realtime/e2e';

const options: RealtimeOptions = { url: 'https://blue.rt.hubfly.app', key: 'k', authEndpoint: '/auth', e2e: true };
const rt = new Realtime(options);
rt.on('order.updated', (data: unknown, meta?: MessageMeta) => meta?.kind);
rt.subscribe('presence-room').bind('pusher:member_added', (m: { id: string }) => m.id);
export const id: Promise<string> = rt.connect().then((r) => r.id);

const server = RealtimeServer.fromEnv({ HUBFLY_REALTIME_URL: 'https://x', HUBFLY_REALTIME_APP_ID: '1', HUBFLY_REALTIME_KEY: 'k', HUBFLY_REALTIME_SECRET: 's' });
export const sent: Promise<SendResult> = server.send('1.2', 'e', { a: 1 }, { ack: true });
export const handler: (r: Request) => Promise<Response> = server.authHandler({ getUser: () => ({ id: 'u_1' }) });

const msg: V1Message = { e: 'x', d: 1, to: 'c', m: 'm', t: 0 };
export const key: Uint8Array = deriveKey(msg.to, parseKeyList('k1:' + 'A'.repeat(43) + '=')[0].key);
export const engine = createClientE2E({ maxAgeMs: 1000 });
