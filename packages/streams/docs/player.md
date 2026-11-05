# Player details

[Get started](../README.md)

## Transports and fallbacks

| `latency` | Tries | Typical delay |
|---|---|---|
| `webrtc` (default) | WHEP, then LL-HLS, then HLS | under 1 s |
| `ll-hls` | LL-HLS, then HLS | 3–5 s |
| `hls` | HLS | 15–25 s |

- **WHEP** is a receive-only `RTCPeerConnection`; the offer goes out by `POST`
  with the token as `Authorization: Bearer`. The node answers `409
  webrtc_unavailable` when the source has B-frames and the channel has no
  transcode ladder, and `503 webrtc_full` at the channel's WebRTC session cap.
  Both, and ICE failures after 10 s, fall back to LL-HLS. A `401` or `403` is
  a refusal and does not fall back.
- **LL-HLS** plays natively where the browser can (Safari, iOS). Elsewhere the
  player imports `hls.js` at that moment: install it next to
  `@hubfly/streams`, or pass `loadHls: () => import('https://esm.sh/hls.js@1')`.
  Without either, the player shows `error` with `reason="unsupported"`.
- After two LL-HLS failures in a row, the player uses plain HLS.
- **Audio-only channels** (`audio-only`) play the Icecast-compatible output in
  an `<audio>` element: Opus where the browser supports it, otherwise MP3.

## Nothing live, stopped servers and refused tokens

The player reads `status/<channel>.json` before connecting and every 15 s
while live (5 s otherwise).

- **Nothing live:** the node plays the offline slate; the player plays it too,
  in state `offline` with `reason="not_live"`, and switches to `live` when the
  status says so.
- **Stopped or billing-paused server:** no media at all; the player stays
  `offline` (`reason` `stopped` or `paused`) without retrying media, and
  connects again when the status changes.
- **Refused token** (401/403 on status, WHEP or the HLS playlist): `error`,
  with **Try again**. Mint a fresh token and set the `token` attribute.

## Reconnects

A dropped WebRTC connection (failed, or disconnected for 4 s), a fatal
`hls.js` network error, or a media element error moves to `reconnecting` and
retries after 1, 2, 4, 8, 16 and then 30 s (with jitter). The browser's
`online` event retries at once. One fatal media decode error is recovered in
place first.

## Styling

The player renders a `div.hfp` inside the host element with the media element,
a `div.hfp-status` (a dot and a text label) and a `button.hfp-play`. The video
keeps a 16:9 box; size the host element to change it.

```css
hubfly-player { max-width: 960px; }
hubfly-player .hfp-status { font-family: inherit; }
hubfly-player[state="offline"] .hfp-status { background: rgb(11 13 16 / 0.6); }
```

## Accessibility

- The status label is a polite `aria-live` region: screen readers hear
  "Connecting…", "Live", "Reconnecting…" and why playback stopped.
- Every state has words; the red dot only repeats "Live".
- Play and Try again are `<button>` elements with a 3 px focus ring; native
  media controls stay on unless `controls="false"`.
- The only motion is a 200 ms fade of the status label, off under
  `prefers-reduced-motion: reduce`.
