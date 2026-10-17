/**
 * `@hubfly/realtime`: the HubFly Realtime client (browsers, React Native, Node, Bun, Deno).
 * Zero runtime dependencies; end-to-end encryption is loaded from `@hubfly/realtime/e2e` only
 * when `e2e` is enabled.
 */
export { Realtime, VERSION } from './client/realtime';
export { Channel, Members } from './client/channel';
export type { Member } from './client/channel';
export type {
  AuthRequestOptions,
  ChannelAuth,
  ConnectionState,
  E2EErrorInfo,
  E2EModule,
  E2EOptions,
  Handler,
  MessageMeta,
  RealtimeOptions,
  RecoveryInfo,
  UserAuth,
  WebSocketConstructor,
  WebSocketLike,
} from './client/types';
