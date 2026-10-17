import { HubflyApiError } from '../client.js';
import type { HubflyClient } from '../client.js';
import type { ApiResponse } from '../types.js';
import { MANAGED_OPERATIONS } from './managed-types.js';
import type { ManagedOperationId, ManagedOperationTypes } from './managed-types.js';

// Shared by the managed modules: the typed operation caller, error codes and
// the end-to-end connection id rules.

/** Error codes of the Managed Services API worth branching on (`HubflyApiError.code`). */
export const ManagedErrorCodes = {
  /** 409: the route belongs to the other service (database route on a realtime server or the reverse). */
  FEATURE_UNSUPPORTED: 'MANAGED_FEATURE_UNSUPPORTED',
  /** 409: the instance must be running. */
  INSTANCE_NOT_RUNNING: 'MANAGED_INSTANCE_NOT_RUNNING',
  /** 409: the quoted price no longer matches; fetch a new estimate and retry. */
  PRICE_CHANGED: 'MANAGED_PRICE_CHANGED',
  /** 400: the confirmation name does not match the instance or app name. */
  CONFIRMATION_MISMATCH: 'MANAGED_CONFIRMATION_MISMATCH',
  /** 429: too many requests; retry later. */
  RATE_LIMITED: 'MANAGED_RATE_LIMITED',
  /** 409: the running realtime engine version does not support this feature yet. */
  REALTIME_ENGINE_UNSUPPORTED: 'MANAGED_REALTIME_ENGINE_UNSUPPORTED',
  /** 403: the app requires end-to-end encryption, so HubFly cannot send plaintext. */
  REALTIME_E2E_REQUIRED: 'MANAGED_REALTIME_E2E_REQUIRED',
  /** 413: the payload is larger than the app allows. */
  REALTIME_PAYLOAD_TOO_LARGE: 'MANAGED_REALTIME_PAYLOAD_TOO_LARGE',
  /** 400: plaintext addressed to an end-to-end connection id (`<socket_id>~<key>`). */
  REALTIME_E2E_CONNECTION_ID: 'MANAGED_REALTIME_E2E_CONNECTION_ID',
  /** 404: no such connection. */
  REALTIME_CONNECTION_NOT_FOUND: 'MANAGED_REALTIME_CONNECTION_NOT_FOUND',
} as const;

export type ManagedErrorCode = (typeof ManagedErrorCodes)[keyof typeof ManagedErrorCodes];

/** True when `error` is a HubflyApiError, optionally with the given `code`. */
export function isManagedApiError(error: unknown, code?: string): error is HubflyApiError {
  return error instanceof HubflyApiError && (code === undefined || error.code === code);
}

type CallInput<K extends ManagedOperationId> = {
  query?: ManagedOperationTypes[K]['query'];
  body?: ManagedOperationTypes[K]['body'];
};

/**
 * Calls one Managed Services operation by its operationId. Path parameters
 * are URL-encoded; operations whose body is `{}` always send `{}`.
 * @internal Used by the managed modules; prefer their methods.
 */
export async function callManaged<K extends ManagedOperationId>(
  client: HubflyClient,
  id: K,
  params: ManagedOperationTypes[K]['params'],
  input: CallInput<K> = {},
): Promise<ApiResponse<ManagedOperationTypes[K]['response']>> {
  const op = MANAGED_OPERATIONS[id];
  const values = params as Record<string, unknown>;
  const path = op.path.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
    const value = values[name];
    if (typeof value !== 'string' || value === '') {
      throw new TypeError(`${id}: path parameter "${name}" must be a non-empty string`);
    }
    return encodeURIComponent(value);
  });
  return client.request<ManagedOperationTypes[K]['response']>(path, {
    method: op.method,
    query: input.query as Record<string, string | number | boolean | undefined> | undefined,
    body: op.body === 'empty' ? {} : input.body,
  });
}


/** Event name of the HubFly v1 end-to-end envelope (E2E.md). */
export const REALTIME_E2E_EVENT = 'hubfly.e2e';

/**
 * The socket id of a connection id. End-to-end connection ids are
 * `<socket_id>~<base64url(key)>`; the key part must never reach HubFly, so
 * every realtime method drops it with this function before the request is
 * built. Plain socket ids are returned unchanged.
 */
export function toSocketId(connectionId: string): string {
  const separator = connectionId.indexOf('~');
  return separator >= 0 ? connectionId.slice(0, separator) : connectionId;
}

/** True for an end-to-end connection id (`<socket_id>~<key>`). */
export function isE2EConnectionId(connectionId: string): boolean {
  return connectionId.includes('~');
}

/**
 * The error the SDK raises before sending plaintext to an end-to-end
 * connection id. It never contains the id (the id holds a key).
 */
export function e2eConnectionIdError(): HubflyApiError {
  const message =
    "End-to-end connection ids carry a client key after '~' that HubFly never uses, so HubFly cannot send plaintext to them. " +
    'Send end-to-end encrypted direct messages from your own server (@hubfly/realtime/server), or use the socket id alone to send plaintext.';
  return new HubflyApiError(message, 400, {
    ok: false,
    error: { code: ManagedErrorCodes.REALTIME_E2E_CONNECTION_ID, message },
  });
}

/** Event `data` as the API takes it: strings as they are, anything else JSON-encoded. */
export function encodeEventData(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data === undefined) throw new TypeError('Event data is required');
  return JSON.stringify(data);
}
