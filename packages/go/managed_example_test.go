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
		Size:              hubfly.ManagedInstanceSizeInput{CPU: size.CPU, MemoryMib: size.MemoryMib},
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
