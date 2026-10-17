package realtime_test

import (
	"fmt"
	"strings"

	"github.com/hubfly/hubfly-sdk/go/realtime"
)

// The documented Pusher example: key 278d425bdf160c739803, secret 7ad3773142a6692b25b8.
func ExampleClient_AuthorizeChannel() {
	rt := &realtime.Client{URL: "https://blue-river.rt.hubfly.app", AppID: "1", Key: "278d425bdf160c739803", Secret: "7ad3773142a6692b25b8"}
	auth, err := rt.AuthorizeChannel("1234.1234", "private-foobar", nil)
	if err != nil {
		panic(err)
	}
	fmt.Println(auth.Auth)
	// Output: 278d425bdf160c739803:58df8b0c36d6982b82c3ecf6b4662e34fe8c25bba48f5369f135bf843651c3a4
}

func ExampleParseConnectionID() {
	socketID, key, err := realtime.ParseConnectionID("1234567890.1234567890~QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8")
	if err != nil {
		panic(err)
	}
	fmt.Println(socketID, len(key))
	// Output: 1234567890.1234567890 32
}

func ExampleFromEnvFunc() {
	env := map[string]string{
		"HUBFLY_REALTIME_URL":    "https://blue-river.rt.hubfly.app",
		"HUBFLY_REALTIME_APP_ID": "1000001",
		"HUBFLY_REALTIME_KEY":    "k3n9x2m4q8w1e7r5t6y0",
		"HUBFLY_REALTIME_SECRET": "secret",
	}
	rt, err := realtime.FromEnvFunc(func(k string) string { return env[k] })
	if err != nil {
		panic(err)
	}
	fmt.Println(rt.URL, rt.AppID)
	// Output: https://blue-river.rt.hubfly.app 1000001
}

func ExampleParseKeyList() {
	keys, err := realtime.ParseKeyList("k2:" + strings.Repeat("B", 43) + "=,k1:" + strings.Repeat("A", 43) + "=")
	if err != nil {
		panic(err)
	}
	fmt.Println(keys[0].Kid, keys[1].Kid, len(keys[0].Key))
	// Output: k2 k1 32
}
