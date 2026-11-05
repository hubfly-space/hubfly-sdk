# Contributing

[Get started](../README.md)

From the repository root, install dependencies with `bun install`, then:

```sh
cd packages/streams
bun run build
bun run typecheck
bun test
```

The build produces ESM, CommonJS and TypeScript declarations for the `.`,
`./player`, `./publish` and `./server` entries. `hls.js` stays external: the
player imports it only when LL-HLS needs it.

## Tests

- `test/server.test.ts`: playback token and webhook signature vectors.
- `test/player.test.ts`: the player state machine against the fakes in
  `test/fakes.ts` (DOM, `RTCPeerConnection`, `fetch`, a manual clock): WHEP,
  fallbacks, the lazy `hls.js` load, offline slates, refused tokens,
  reconnects and `<hubfly-player>`.
- `test/publish.test.ts`: WHIP offer, codec order, bitrate, errors and stop.
- `test/size.test.ts`: the player stays within 12 KB and the publisher within
  6 KB, minified and gzipped.
- `test/dist.test.ts`: the built entries load in Node (ESM and CJS) and type-check
  for node16 consumers. It skips without `dist/`.

## Test vectors

`test/vectors/playback.json` and `test/vectors/webhook-signatures.json` are
byte copies of `hubfly-stream/testdata/tokens/playback.json` and
`testdata/webhooks/signature.json`. Never edit them by hand: regenerate in
hubfly-stream and copy. `make -C hubfly-stream vectors-sync-check` compares
every copy.
