// Package realtime is the Go server SDK for HubFly Realtime, the managed WebSocket service that
// speaks the Pusher Channels protocol 7 plus HubFly v1 extensions, with built-in end-to-end
// encryption.
//
// A Client signs Pusher-compatible REST requests (Trigger, TriggerBatch, Channels, ChannelInfo,
// ChannelUsers, TerminateUserConnections), calls the HubFly endpoints (Publish with message-id
// idempotency and channel offsets, SendToConnection(s) and SendToUser(s) with delivery results,
// ConnectionStatus/IsOnline, UserStatus, TerminateConnection/DisconnectConnection, History,
// MessageReceipt), signs channel and user authorization for clients (AuthorizeChannel,
// AuthenticateUser, AuthHandler), and verifies webhooks (VerifyWebhook).
//
// # Quick start
//
//	rt, err := realtime.FromEnv() // HUBFLY_REALTIME_URL, _APP_ID, _KEY, _SECRET, _E2E_KEYS
//	if err != nil {
//		log.Fatal(err)
//	}
//	// Send to the connection id a browser got from `await rt.connect()`.
//	res, err := rt.SendToConnection(ctx, id, "order.updated", map[string]any{"orderId": "o_9"}, &realtime.SendOptions{Ack: true})
//	// Every device of a signed-in user.
//	_, err = rt.SendToUser(ctx, "u_42", "notice", map[string]string{"text": "Hi"}, nil)
//	// A channel, with recovery offsets for clients.
//	_, err = rt.Publish(ctx, []string{"private-encrypted-orders"}, "created", order, nil)
//
//	// The client's authEndpoint and userAuthEndpoint:
//	http.Handle("/api/realtime/auth", rt.AuthHandler(realtime.AuthHandlerOptions{
//		GetUser: func(r *http.Request) (*realtime.User, error) { return currentUser(r) },
//	}))
//
// # End-to-end encryption
//
// Set EncryptionKeys (HUBFLY_REALTIME_E2E_KEYS: "kid:base64,…", first is active) to encrypt
// payloads so HubFly only sees ciphertext. private-encrypted-* channels get Pusher envelopes
// (pusher-js with-encryption can read them), user messages and full-E2E channels get v1
// envelopes, and direct messages to E2E connection ids (<socket_id>~<key>) are encrypted with
// the key the client generated, which never travels through HubFly. AuthorizeChannel and
// AuthenticateUser hand derived keys to authorized clients only. See docs/E2E.md in
// hubfly-realtime for the wire format; testdata/vectors.json is shared with the engine and the
// TypeScript SDK.
package realtime
