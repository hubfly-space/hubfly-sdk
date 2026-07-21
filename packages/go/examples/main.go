package main

import (
	"context"
	"fmt"
	"log"

	"github.com/hubfly/hubfly-sdk/go"
)

func main() {
	// Initialize client
	client := hubfly.NewClient(
		hubfly.WithToken("demo_token_123"),
		hubfly.WithBaseURL("https://api.hubfly.space"),
	)

	ctx := context.Background()

	// 1. Fetch System Health
	health, err := client.System.Health(ctx)
	if err != nil {
		fmt.Printf("Health check error: %v\n", err)
	} else {
		fmt.Printf("System Status: %s (Uptime: %d seconds)\n", health.Data.Status, health.Data.UptimeSeconds)
	}

	// 2. List Projects
	projects, err := client.Projects.List(ctx)
	if err != nil {
		log.Printf("Projects list error: %v\n", err)
		return
	}

	fmt.Printf("Found %d Projects:\n", len(projects.Data))
	for _, p := range projects.Data {
		fmt.Printf(" - [%s] %s (Region: %s)\n", p.ID, p.Name, p.Region)
	}
}
