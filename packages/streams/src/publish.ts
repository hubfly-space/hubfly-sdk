/**
 * `@hubfly/streams/publish`: publishes a browser `MediaStream` (camera, screen, canvas) to a
 * WHIP input (INGEST.md). Video prefers H.264, then VP8; audio is Opus.
 *
 * ```ts
 * const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
 * const handle = await publish({ url: 'https://acme-tv.live.hubfly.app/whip/sin_cam00001', token: streamKey, stream });
 * handle.addEventListener('statechange', () => console.log(handle.state));
 * await handle.stop();
 * ```
 */
import { completeOffer, endSession, exchange, MediaError } from './rtc';

export { MediaError } from './rtc';
export type { MediaErrorCode } from './rtc';

export interface PublishOptions {
  /** The input's WHIP URL (`https://<host>/whip/<input id>`). */
  url: string;
  /** The input's stream key (sent as `Authorization: Bearer`). */
  token: string;
  stream: MediaStream;
  /** Upper bound for the video bitrate, in kbit/s. */
  maxBitrateKbps?: number;
}

/**
 * - `connecting`: the offer is out or ICE is connecting;
 * - `live`: media is flowing to the node;
 * - `reconnecting`: the connection dropped and the browser is trying to restore it;
 * - `failed`: the connection was lost for good (publish again);
 * - `stopped`: `stop()` was called.
 */
export type PublishState = 'connecting' | 'live' | 'reconnecting' | 'failed' | 'stopped';

/** The handle of a running publication; dispatches `statechange` events. */
export interface PublishHandle extends EventTarget {
  readonly state: PublishState;
  readonly peerConnection: RTCPeerConnection;
  /** Ends the WHIP session (DELETE) and closes the connection. Tracks stay open. */
  stop(): Promise<void>;
}

const WHIP_MESSAGES = {
  unauthorized: 'The stream key was refused',
  forbidden: 'Publishing is not allowed (input disabled, server stopped or paused, or address not allowed)',
  conflict: 'Another encoder is already publishing to this input',
  not_found: 'This input does not exist',
  unavailable: 'The stream server is not accepting publishers right now',
};

function rank(mime: string): number {
  const m = mime.toLowerCase();
  if (m === 'video/h264' || m === 'audio/opus') return 0;
  if (m === 'video/vp8') return 1;
  if (m.endsWith('/rtx') || m.endsWith('/red') || m.endsWith('/ulpfec')) return 2; // keep repair codecs available
  return 3;
}

function preferCodecs(transceiver: RTCRtpTransceiver, kind: string) {
  const codecs = typeof RTCRtpSender !== 'undefined' ? RTCRtpSender.getCapabilities?.(kind)?.codecs : undefined;
  if (!codecs?.length || !transceiver.setCodecPreferences) return;
  // H.264 packetization-mode 1 first: the only mode the node accepts.
  const h264 = (c: RTCRtpCodec) => (c.sdpFmtpLine?.includes('packetization-mode=1') ? 0 : 1);
  const sorted = [...codecs].sort((a, b) => rank(a.mimeType) - rank(b.mimeType) || h264(a) - h264(b));
  try {
    transceiver.setCodecPreferences(sorted);
  } catch {
    // Some browsers reject reordered lists; their default order still negotiates.
  }
}

/**
 * Starts publishing. Resolves once the node accepted the offer (`201`); rejects with a
 * `MediaError` whose `code` comes from the WHIP status: `unauthorized` (401, bad key),
 * `forbidden` (403, with `reason`), `conflict` (409, already publishing), `not_found`,
 * `unavailable`, `network` or `ice`.
 */
export async function publish(options: PublishOptions): Promise<PublishHandle> {
  const { url, token, stream } = options;
  const pc = new RTCPeerConnection({ bundlePolicy: 'max-bundle' });
  let session: string | undefined;
  try {
    for (const track of stream.getTracks()) {
      const transceiver = pc.addTransceiver(track, { direction: 'sendonly', streams: [stream] });
      preferCodecs(transceiver, track.kind);
      if (track.kind === 'video' && options.maxBitrateKbps) {
        const params = transceiver.sender.getParameters();
        params.encodings = [{ ...(params.encodings?.[0] ?? {}), maxBitrate: options.maxBitrateKbps * 1000 }];
        await transceiver.sender.setParameters(params).catch(() => {});
      }
    }
    const answer = await exchange(url, await completeOffer(pc), token, WHIP_MESSAGES);
    session = answer.session;
    await pc.setRemoteDescription({ type: 'answer', sdp: answer.answer });
  } catch (error) {
    pc.close();
    endSession(session, token);
    throw error instanceof MediaError ? error : new MediaError('failed', String((error as Error)?.message ?? error));
  }
  return new Handle(pc, session, token);
}

class Handle extends EventTarget implements PublishHandle {
  state: PublishState = 'connecting';

  constructor(
    readonly peerConnection: RTCPeerConnection,
    private session: string | undefined,
    private token: string,
  ) {
    super();
    const sync = () => {
      const s = peerConnection.connectionState;
      if (s === 'connected') this.set('live');
      else if (s === 'disconnected') this.set('reconnecting');
      else if (s === 'failed') this.set('failed');
    };
    peerConnection.addEventListener('connectionstatechange', sync);
    sync(); // ICE may have connected before the handle existed
  }

  private set(next: PublishState) {
    if (this.state === next || this.state === 'stopped') return;
    this.state = next;
    this.dispatchEvent(new Event('statechange'));
  }

  async stop(): Promise<void> {
    if (this.state === 'stopped') return;
    this.set('stopped');
    this.peerConnection.close();
    endSession(this.session, this.token);
    this.session = undefined;
  }
}
