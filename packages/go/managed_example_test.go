package hubfly_test

import (
	"context"
	"fmt"
	"log"

	"github.com/hubfly/hubfly-sdk/go"
)

// Creates a realtime server, waits for it, then publishes and sends events.
func ExampleManagedRealtimeService() {
	client := hubfly.NewClient() // HUBFLY_TOKEN
	ctx := context.Background()
	projectID := "proj_123"
	rt := client.Managed.Realtime

	catalog, err := client.Managed.Catalog(ctx)
	if err != nil {
		log.Fatal(err)
	}
	size := catalog.Data.Realtime.Sizes[0]
	created, err := client.Managed.Instances.Create(ctx, projectID, hubfly.CreateManagedInstanceBody{
		Name:              "chat",
		Service:           "realtime",
		Size:              &hubfly.ManagedInstanceSizeInput{CPU: size.CPU, MemoryMib: size.MemoryMib},
		QuotedHourlyTotal: size.Price.Hourly.Total,
		IdempotencyKey:    "create-chat-1",
		InitialApp:        &hubfly.ManagedRealtimeInitialAppInput{Name: "production"},
	})
	if err != nil {
		log.Fatal(err)
	}
	instanceID := created.Data.Instance.ID
	op, err := client.Managed.Instances.WaitForOperation(ctx, projectID, instanceID, created.Data.OperationID, nil)
	if err != nil || op.Status != "succeeded" {
		log.Fatalf("create: %v %+v", err, op)
	}
	appID := created.Data.InitialApp.AppID

	if _, err := rt.Publish(ctx, projectID, instanceID, appID, hubfly.PostManagedRealtimePublishBody{
		Event: "order.created", Data: `{"id":42}`, Channels: []string{"private-orders"},
	}); err != nil {
		log.Fatal(err)
	}
	sent, err := rt.Send(ctx, projectID, instanceID, appID, hubfly.PostManagedRealtimeSendBody{
		Event: "ping", Data: "hi", UserID: "user_1",
	})
	if err == nil {
		fmt.Printf("%+v\n", sent.Data.Counts)
	}

	_, err = rt.GetHistory(ctx, projectID, instanceID, appID, hubfly.GetManagedRealtimeHistoryQuery{
		Channel: "private-orders", Since: hubfly.Float(0),
	})
	if hubfly.IsAPIErrorCode(err, hubfly.ErrCodeManagedRealtimeEngineUnsupported) {
		fmt.Println("this server's engine version does not have history yet")
	}
}

// Creates a 100 Mbps stream server with a first input, then mints a test
// playback token for one channel. Production tokens are signed on your own
// server with github.com/hubfly/hubfly-sdk/go/streams.
func ExampleManagedStreamsService() {
	client := hubfly.NewClient() // HUBFLY_TOKEN
	ctx := context.Background()
	projectID := "proj_123"
	st := client.Managed.Streams

	quote, err := st.EstimatePrice(ctx, hubfly.GetStreamPriceEstimateQuery{SpeedMbps: 100})
	if err != nil {
		log.Fatal(err)
	}
	created, err := client.Managed.Instances.Create(ctx, projectID, hubfly.CreateManagedInstanceBody{
		Name:              "acme-tv",
		Service:           "stream",
		Stream:            &hubfly.CreateManagedInstanceStreamInput{SpeedMbps: 100, Timezone: "Africa/Kigali", FirstInput: &hubfly.CreateManagedInstanceStreamFirstInputInput{Name: "Studio A"}},
		QuotedHourlyTotal: quote.Data.Hourly.SpeedMicroUsd / 1e6,
		IdempotencyKey:    "create-acme-tv-1",
	})
	if err != nil {
		log.Fatal(err)
	}
	instanceID := created.Data.Instance.ID
	// created.Data.Stream.FirstInput.Keys.Primary is the stream key, shown once:
	// hand it to the encoder, never log it.

	channels, err := st.ListChannels(ctx, projectID, instanceID)
	if err != nil || len(channels.Data) == 0 {
		log.Fatal("no channel yet: ", err)
	}
	token, err := st.CreatePlaybackToken(ctx, projectID, instanceID, channels.Data[0].ID, hubfly.CreateManagedStreamPlaybackTokenBody{TTLSeconds: 3600})
	if hubfly.IsAPIErrorCode(err, hubfly.ErrCodeStreamNodeUnavailable) {
		fmt.Println("the stream node is not answering; retry shortly")
		return
	}
	if err == nil {
		fmt.Println("token expires at", token.Data.ExpiresAt)
	}
}
