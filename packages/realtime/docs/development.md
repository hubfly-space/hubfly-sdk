# Contributing

[Get started](../README.md)

From the repository root, install dependencies with `bun install`, then:

```sh
cd packages/realtime
bun run build
bun run typecheck
bun test
```

The build produces ESM, CommonJS, and TypeScript declarations for the client,
server, and encryption entries. Tests cover protocol handling, Pusher
interoperability, encryption, package exports, and bundle size.

## Live tests

Live tests skip unless these variables point to a test Realtime app:

```dotenv
HUBFLY_REALTIME_TEST_URL=https://your-test-server.rt.hubfly.app
HUBFLY_REALTIME_TEST_APP_ID=your-app-id
HUBFLY_REALTIME_TEST_KEY=your-app-key
HUBFLY_REALTIME_TEST_SECRET=your-app-secret
```

Enable the offline queue and a detach TTL of at least 10 seconds on that app.
Use a disposable test app: these tests publish messages and change connections.

```sh
bun test test/live.test.ts
```

Optional coverage:

| Variables | Enables |
| --- | --- |
| `HUBFLY_REALTIME_TEST_REQUIRED_APP_ID`, `_KEY`, `_SECRET` | Tests against a second app with encryption policy `required`. |
| `HUBFLY_REALTIME_TEST_RESTART` | Planned-restart test. Set to a command that gracefully restarts the instance and returns when it is ready. |

For local engine development, the sibling `hubfly-realtime` repository
provides `cmd/rt-devserver`. This package's
`test/fixtures/rt-devserver-apps.json` contains test-only app credentials.
