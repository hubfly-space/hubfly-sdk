// Type-level smoke test of the published declarations (CommonJS consumer, node16 resolution).
import streams = require('@hubfly/streams');
import player = require('@hubfly/streams/player');
import pub = require('@hubfly/streams/publish');
import server = require('@hubfly/streams/server');

export const urls: streams.PlaybackURLs = streams.playbackURLs('https://dev.localhost:18443', 'sch_main0001');
export const make = (el: HTMLElement): player.Player => player.createPlayer(el, { host: 'h', channel: 'c' });
export const start = (s: MediaStream): Promise<pub.PublishHandle> => pub.publish({ url: 'https://h/whip/i', token: 'k', stream: s });
export const valid: Promise<boolean> = server.verifyWebhook('whsec_x', '{}', 't=1,v1=00');
