// WHEP/WHIP helpers shared by the player and the publisher (bundled into each entry).

/** Why a WHEP or WHIP request was refused, from its HTTP status (INGEST.md "Refusals", PLAYBACK.md). */
export type MediaErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'unavailable'
  | 'rate_limited'
  | 'bad_request'
  | 'network'
  | 'ice'
  | 'failed';

const CODES: Record<number, MediaErrorCode> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  429: 'rate_limited',
  503: 'unavailable',
};

/** A refused or failed WHEP/WHIP exchange. `reason` is the server's short reason text, when it sent one. */
export class MediaError extends Error {
  readonly name = 'MediaError';
  constructor(
    readonly code: MediaErrorCode,
    message: string,
    readonly status = 0,
    readonly reason = '',
    /** Seconds from `Retry-After`, when the server sent it. */
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

/** Builds a MediaError from a non-201 answer, reading a short reason from its body. */
export async function refused(response: Response, messages: Partial<Record<MediaErrorCode, string>>): Promise<MediaError> {
  const code = CODES[response.status] ?? 'failed';
  let reason = '';
  try {
    const text = (await response.text()).trim();
    try {
      const body = JSON.parse(text);
      reason = String(body.error?.code ?? body.error ?? body.code ?? body.reason ?? '');
    } catch {
      reason = text;
    }
  } catch {
    // No body.
  }
  reason = reason.slice(0, 120);
  const retry = Number(response.headers.get('Retry-After'));
  return new MediaError(
    code,
    messages[code] ?? `Request failed (HTTP ${response.status})`,
    response.status,
    reason,
    Number.isFinite(retry) && retry > 0 ? retry : undefined,
  );
}

/** Creates the offer and waits (≤ `timeoutMs`) for ICE gathering, so servers need no trickle ICE. */
export async function completeOffer(pc: RTCPeerConnection, timeoutMs = 5000): Promise<string> {
  await pc.setLocalDescription(await pc.createOffer());
  if (pc.iceGatheringState !== 'complete') {
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      };
      const check = () => {
        if (pc.iceGatheringState === 'complete') done();
      };
      // Gathering that never completes (a slow STUN-less interface) still has host candidates.
      const timer = setTimeout(done, timeoutMs);
      pc.addEventListener('icegatheringstatechange', check);
    });
  }
  const sdp = pc.localDescription?.sdp;
  if (!sdp) throw new MediaError('ice', 'Could not create a WebRTC offer');
  return sdp;
}

/**
 * POSTs an SDP offer and returns the answer and the session URL (`Location`). The session URL
 * must stay on the endpoint's origin, so a DELETE never sends the token elsewhere.
 */
export async function exchange(
  endpoint: string,
  offer: string,
  token: string | undefined,
  messages: Partial<Record<MediaErrorCode, string>>,
): Promise<{ answer: string; session?: string }> {
  let response: Response;
  try {
    response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/sdp', ...bearer(token) }, body: offer });
  } catch {
    throw new MediaError('network', 'Network error');
  }
  if (response.status !== 201 && response.status !== 200) throw await refused(response, messages);
  const location = response.headers.get('Location');
  let session: string | undefined;
  if (location) {
    const url = new URL(location, endpoint);
    if (url.origin === new URL(endpoint).origin) session = url.href;
  }
  return { answer: await response.text(), session };
}

/** Ends a WHEP/WHIP session; failures are ignored (the server times sessions out). */
export function endSession(session: string | undefined, token: string | undefined): void {
  if (session) fetch(session, { method: 'DELETE', headers: bearer(token), keepalive: true }).catch(() => {});
}

export function bearer(token: string | undefined): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
