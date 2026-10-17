// Type-level smoke test of the published declarations (CommonJS consumer, node16 resolution).
import realtime = require('@hubfly/realtime');
import serverPkg = require('@hubfly/realtime/server');
import e2e = require('@hubfly/realtime/e2e');

export const rt = new realtime.Realtime({ url: 'https://x', key: 'k' });
export const server = new serverPkg.RealtimeServer({ url: 'https://x', appId: '1', key: 'k', secret: 's' });
export const id: string = e2e.formatConnectionId('1.2', new Uint8Array(32));
