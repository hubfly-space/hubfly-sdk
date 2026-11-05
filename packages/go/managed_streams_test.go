package hubfly

import (
	"context"
	"encoding/json"
	"reflect"
	"regexp"
	"testing"
)

// streamListPath matches the stream routes whose data is an array.
var streamListPath = regexp.MustCompile(`/stream/(inputs|channels|mixers|destinations|playback-keys|playlists|schedules|webhooks|graphics|storage-links|domains)$`)

// managedStreamListResponder answers array routes with [] and everything else with {}.
func managedStreamListResponder(r recordedRequest) (int, string) {
	data := "{}"
	if r.Method == "GET" && streamListPath.MatchString(r.Path) {
		data = "[]"
	}
	return 200, `{"ok":true,"data":` + data + `,"meta":{"requestId":"req_1","timestamp":"t"}}`
}

// managedStreamCalls makes one call per Managed Streams operation (appended to managedCalls).
func managedStreamCalls(c *Client) []struct {
	id   string
	call func(ctx context.Context) error
} {
	st := c.Managed.Streams
	type call = struct {
		id   string
		call func(ctx context.Context) error
	}
	return []call{
		{"getManagedStreamServer", func(ctx context.Context) error { return errOf(st.GetServer(ctx, tP, tI)) }},
		{"updateManagedStreamSettings", func(ctx context.Context) error {
			return errOf(st.UpdateSettings(ctx, tP, tI, UpdateManagedStreamSettingsBody{}))
		}},
		{"getManagedStreamLive", func(ctx context.Context) error { return errOf(st.GetLive(ctx, tP, tI)) }},
		{"getManagedStreamStats", func(ctx context.Context) error { return errOf(st.GetStats(ctx, tP, tI, nil)) }},
		{"getManagedStreamUsage", func(ctx context.Context) error { return errOf(st.GetUsage(ctx, tP, tI, nil)) }},
		{"listManagedStreamEvents", func(ctx context.Context) error { return errOf(st.ListEvents(ctx, tP, tI, nil)) }},
		{"postManagedStreamControl", func(ctx context.Context) error { return errOf(st.Control(ctx, tP, tI, PostManagedStreamControlBody{})) }},
		{"createManagedStreamStudioToken", func(ctx context.Context) error {
			return errOf(st.CreateStudioToken(ctx, tP, tI, CreateManagedStreamStudioTokenBody{}))
		}},
		{"getStreamPriceEstimate", func(ctx context.Context) error { return errOf(st.EstimatePrice(ctx, GetStreamPriceEstimateQuery{})) }},
		{"listManagedStreamInputs", func(ctx context.Context) error { return errOf(st.ListInputs(ctx, tP, tI)) }},
		{"getManagedStreamInput", func(ctx context.Context) error { return errOf(st.GetInput(ctx, tP, tI, "sin_cam1abcd")) }},
		{"createManagedStreamInput", func(ctx context.Context) error {
			return errOf(st.CreateInput(ctx, tP, tI, CreateManagedStreamInputBody{}))
		}},
		{"updateManagedStreamInput", func(ctx context.Context) error {
			return errOf(st.UpdateInput(ctx, tP, tI, "sin_cam1abcd", UpdateManagedStreamInputBody{}))
		}},
		{"deleteManagedStreamInput", func(ctx context.Context) error { return errOf(st.DeleteInput(ctx, tP, tI, "sin_cam1abcd")) }},
		{"revealManagedStreamInputKeys", func(ctx context.Context) error { return errOf(st.RevealInputKeys(ctx, tP, tI, "sin_cam1abcd")) }},
		{"rotateManagedStreamInputKey", func(ctx context.Context) error {
			return errOf(st.RotateInputKey(ctx, tP, tI, "sin_cam1abcd", RotateManagedStreamInputKeyBody{}))
		}},
		{"listManagedStreamChannels", func(ctx context.Context) error { return errOf(st.ListChannels(ctx, tP, tI)) }},
		{"getManagedStreamChannel", func(ctx context.Context) error { return errOf(st.GetChannel(ctx, tP, tI, "sch_main0001")) }},
		{"createManagedStreamChannel", func(ctx context.Context) error {
			return errOf(st.CreateChannel(ctx, tP, tI, CreateManagedStreamChannelBody{}))
		}},
		{"updateManagedStreamChannel", func(ctx context.Context) error {
			return errOf(st.UpdateChannel(ctx, tP, tI, "sch_main0001", UpdateManagedStreamChannelBody{}))
		}},
		{"deleteManagedStreamChannel", func(ctx context.Context) error { return errOf(st.DeleteChannel(ctx, tP, tI, "sch_main0001")) }},
		{"getManagedStreamChannelPlayback", func(ctx context.Context) error { return errOf(st.GetChannelPlayback(ctx, tP, tI, "sch_main0001")) }},
		{"createManagedStreamPlaybackToken", func(ctx context.Context) error {
			return errOf(st.CreatePlaybackToken(ctx, tP, tI, "sch_main0001", CreateManagedStreamPlaybackTokenBody{}))
		}},
		{"listManagedStreamMixers", func(ctx context.Context) error { return errOf(st.ListMixers(ctx, tP, tI)) }},
		{"getManagedStreamMixer", func(ctx context.Context) error { return errOf(st.GetMixer(ctx, tP, tI, "smx_show0001")) }},
		{"createManagedStreamMixer", func(ctx context.Context) error {
			return errOf(st.CreateMixer(ctx, tP, tI, CreateManagedStreamMixerBody{}))
		}},
		{"updateManagedStreamMixer", func(ctx context.Context) error {
			return errOf(st.UpdateMixer(ctx, tP, tI, "smx_show0001", UpdateManagedStreamMixerBody{}))
		}},
		{"deleteManagedStreamMixer", func(ctx context.Context) error { return errOf(st.DeleteMixer(ctx, tP, tI, "smx_show0001")) }},
		{"listManagedStreamDestinations", func(ctx context.Context) error { return errOf(st.ListDestinations(ctx, tP, tI)) }},
		{"getManagedStreamDestination", func(ctx context.Context) error { return errOf(st.GetDestination(ctx, tP, tI, "sds_yt000001")) }},
		{"createManagedStreamDestination", func(ctx context.Context) error {
			return errOf(st.CreateDestination(ctx, tP, tI, CreateManagedStreamDestinationBody{}))
		}},
		{"updateManagedStreamDestination", func(ctx context.Context) error {
			return errOf(st.UpdateDestination(ctx, tP, tI, "sds_yt000001", UpdateManagedStreamDestinationBody{}))
		}},
		{"deleteManagedStreamDestination", func(ctx context.Context) error { return errOf(st.DeleteDestination(ctx, tP, tI, "sds_yt000001")) }},
		{"listManagedStreamPlaybackKeys", func(ctx context.Context) error { return errOf(st.ListPlaybackKeys(ctx, tP, tI)) }},
		{"createManagedStreamPlaybackKey", func(ctx context.Context) error {
			return errOf(st.CreatePlaybackKey(ctx, tP, tI, CreateManagedStreamPlaybackKeyBody{}))
		}},
		{"rotateManagedStreamPlaybackKey", func(ctx context.Context) error { return errOf(st.RotatePlaybackKey(ctx, tP, tI, "spk_key00001")) }},
		{"deleteManagedStreamPlaybackKey", func(ctx context.Context) error { return errOf(st.DeletePlaybackKey(ctx, tP, tI, "spk_key00001")) }},
		{"listManagedStreamPlaylists", func(ctx context.Context) error { return errOf(st.ListPlaylists(ctx, tP, tI)) }},
		{"getManagedStreamPlaylist", func(ctx context.Context) error { return errOf(st.GetPlaylist(ctx, tP, tI, "spl_loop0001")) }},
		{"createManagedStreamPlaylist", func(ctx context.Context) error {
			return errOf(st.CreatePlaylist(ctx, tP, tI, CreateManagedStreamPlaylistBody{}))
		}},
		{"updateManagedStreamPlaylist", func(ctx context.Context) error {
			return errOf(st.UpdatePlaylist(ctx, tP, tI, "spl_loop0001", UpdateManagedStreamPlaylistBody{}))
		}},
		{"deleteManagedStreamPlaylist", func(ctx context.Context) error { return errOf(st.DeletePlaylist(ctx, tP, tI, "spl_loop0001")) }},
		{"listManagedStreamSchedules", func(ctx context.Context) error { return errOf(st.ListSchedules(ctx, tP, tI)) }},
		{"getManagedStreamSchedule", func(ctx context.Context) error { return errOf(st.GetSchedule(ctx, tP, tI, "ssc_daily001")) }},
		{"createManagedStreamSchedule", func(ctx context.Context) error {
			return errOf(st.CreateSchedule(ctx, tP, tI, CreateManagedStreamScheduleBody{}))
		}},
		{"updateManagedStreamSchedule", func(ctx context.Context) error {
			return errOf(st.UpdateSchedule(ctx, tP, tI, "ssc_daily001", UpdateManagedStreamScheduleBody{}))
		}},
		{"deleteManagedStreamSchedule", func(ctx context.Context) error { return errOf(st.DeleteSchedule(ctx, tP, tI, "ssc_daily001")) }},
		{"previewManagedStreamSchedule", func(ctx context.Context) error {
			return errOf(st.PreviewSchedule(ctx, tP, tI, PreviewManagedStreamScheduleBody{}))
		}},
		{"listManagedStreamScheduleRuns", func(ctx context.Context) error { return errOf(st.ListScheduleRuns(ctx, tP, tI, "ssc_daily001", nil)) }},
		{"listManagedStreamRecordings", func(ctx context.Context) error { return errOf(st.ListRecordings(ctx, tP, tI, nil)) }},
		{"createManagedStreamClip", func(ctx context.Context) error {
			return errOf(st.CreateClip(ctx, tP, tI, CreateManagedStreamClipBody{}))
		}},
		{"deleteManagedStreamRecording", func(ctx context.Context) error { return errOf(st.DeleteRecording(ctx, tP, tI, "srec_00000001", nil)) }},
		{"listManagedStreamWebhooks", func(ctx context.Context) error { return errOf(st.ListWebhooks(ctx, tP, tI)) }},
		{"createManagedStreamWebhook", func(ctx context.Context) error {
			return errOf(st.CreateWebhook(ctx, tP, tI, CreateManagedStreamWebhookBody{}))
		}},
		{"updateManagedStreamWebhook", func(ctx context.Context) error {
			return errOf(st.UpdateWebhook(ctx, tP, tI, "swh_hook0001", UpdateManagedStreamWebhookBody{}))
		}},
		{"deleteManagedStreamWebhook", func(ctx context.Context) error { return errOf(st.DeleteWebhook(ctx, tP, tI, "swh_hook0001")) }},
		{"listManagedStreamWebhookDeliveries", func(ctx context.Context) error {
			return errOf(st.ListWebhookDeliveries(ctx, tP, tI, "swh_hook0001", nil))
		}},
		{"testManagedStreamWebhook", func(ctx context.Context) error { return errOf(st.TestWebhook(ctx, tP, tI, "swh_hook0001")) }},
		{"listManagedStreamGraphics", func(ctx context.Context) error { return errOf(st.ListGraphics(ctx, tP, tI)) }},
		{"uploadManagedStreamGraphic", func(ctx context.Context) error {
			return errOf(st.UploadGraphic(ctx, tP, tI, UploadManagedStreamGraphicBody{}))
		}},
		{"updateManagedStreamGraphic", func(ctx context.Context) error {
			return errOf(st.UpdateGraphic(ctx, tP, tI, "sgr_logo0001", UpdateManagedStreamGraphicBody{}))
		}},
		{"deleteManagedStreamGraphic", func(ctx context.Context) error { return errOf(st.DeleteGraphic(ctx, tP, tI, "sgr_logo0001")) }},
		{"listManagedStreamStorageLinks", func(ctx context.Context) error { return errOf(st.ListStorageLinks(ctx, tP, tI)) }},
		{"createManagedStreamStorageLink", func(ctx context.Context) error {
			return errOf(st.CreateStorageLink(ctx, tP, tI, CreateManagedStreamStorageLinkBody{}))
		}},
		{"deleteManagedStreamStorageLink", func(ctx context.Context) error { return errOf(st.DeleteStorageLink(ctx, tP, tI, "ssl_link0001")) }},
		{"listManagedStreamStorageAssets", func(ctx context.Context) error { return errOf(st.ListStorageAssets(ctx, tP, tI, "ssl_link0001", nil)) }},
		{"listManagedStreamDomains", func(ctx context.Context) error { return errOf(st.ListDomains(ctx, tP, tI)) }},
		{"createManagedStreamDomain", func(ctx context.Context) error {
			return errOf(st.CreateDomain(ctx, tP, tI, CreateManagedStreamDomainBody{}))
		}},
		{"verifyManagedStreamDomain", func(ctx context.Context) error { return errOf(st.VerifyDomain(ctx, tP, tI, "sdm_dom00001")) }},
		{"deleteManagedStreamDomain", func(ctx context.Context) error { return errOf(st.DeleteDomain(ctx, tP, tI, "sdm_dom00001")) }},
		{"listManagedStreamBindings", func(ctx context.Context) error { return errOf(st.ListBindings(ctx, tP, tI)) }},
		{"createManagedStreamBinding", func(ctx context.Context) error {
			return errOf(st.CreateBinding(ctx, tP, tI, CreateManagedStreamBindingBody{}))
		}},
		{"deleteManagedStreamBinding", func(ctx context.Context) error { return errOf(st.DeleteBinding(ctx, tP, tI, "sbd_bind0001", nil)) }},
	}
}

func TestManagedStreamsRequestEncoding(t *testing.T) {
	fake, client := newFakeManagedAPI(t, nil)
	ctx := context.Background()
	st := client.Managed.Streams

	if _, err := st.CreateInput(ctx, tP, tI, CreateManagedStreamInputBody{Name: "Studio A cam", Kind: "push", BackupKey: Ptr(true), Protocols: []string{"rtmp", "srt"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.RotateInputKey(ctx, tP, tI, "sin_cam1abcd", RotateManagedStreamInputKeyBody{Role: "backup", Remove: Ptr(true)}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.GetUsage(ctx, tP, tI, &GetManagedStreamUsageQuery{Month: "2026-11"}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.RevealInputKeys(ctx, tP, tI, "sin_cam1abcd"); err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreatePlaybackToken(ctx, tP, tI, "sch_main0001", CreateManagedStreamPlaybackTokenBody{TTLSeconds: 3600, Sub: "viewer-42"}); err != nil {
		t.Fatal(err)
	}

	reqs := fake.all()
	want := []recordedRequest{
		{Method: "POST", Path: "/api/v1/projects/proj_1/managed/instances/inst_1/stream/inputs/create", Body: `{"name":"Studio A cam","kind":"push","protocols":["rtmp","srt"],"backupKey":true}`},
		{Method: "POST", Path: "/api/v1/projects/proj_1/managed/instances/inst_1/stream/inputs/sin_cam1abcd/keys/rotate", Body: `{"role":"backup","remove":true}`},
		{Method: "GET", Path: "/api/v1/projects/proj_1/managed/instances/inst_1/stream/usage"},
		{Method: "POST", Path: "/api/v1/projects/proj_1/managed/instances/inst_1/stream/inputs/sin_cam1abcd/keys/reveal", Body: `{}`},
		{Method: "POST", Path: "/api/v1/projects/proj_1/managed/instances/inst_1/stream/channels/sch_main0001/token/create", Body: `{"ttlSeconds":3600,"sub":"viewer-42"}`},
	}
	if len(reqs) != len(want) {
		t.Fatalf("%d requests, want %d", len(reqs), len(want))
	}
	for i, w := range want {
		got := reqs[i]
		if got.Method != w.Method || got.Path != w.Path || !sameJSON(got.Body, w.Body) {
			t.Errorf("request %d = %s %s %s, want %s %s %s", i, got.Method, got.Path, got.Body, w.Method, w.Path, w.Body)
		}
	}
	if got := reqs[2].Query["month"]; len(got) != 1 || got[0] != "2026-11" {
		t.Errorf("usage month query = %v", got)
	}
}

func TestManagedStreamsErrors(t *testing.T) {
	for _, code := range []string{ErrCodeStreamRevisionConflict, ErrCodeStreamInUse, ErrCodeStreamNotLive} {
		_, client := newFakeManagedAPI(t, func(recordedRequest) (int, string) {
			return 409, `{"ok":false,"error":{"code":"` + code + `","message":"m"},"meta":{"requestId":"r","timestamp":"t"}}`
		})
		_, err := client.Managed.Streams.DeleteInput(context.Background(), tP, tI, "sin_cam1abcd")
		if !IsAPIErrorCode(err, code) {
			t.Errorf("%s: err = %v", code, err)
		}
	}
}

func TestManagedStreamsRevealDecoding(t *testing.T) {
	_, client := newFakeManagedAPI(t, func(recordedRequest) (int, string) {
		return 200, `{"ok":true,"data":{"primary":"hfls_cam1abcd_x","backup":null,"srtPassphrase":null},"meta":{"requestId":"r","timestamp":"t"}}`
	})
	res, err := client.Managed.Streams.RevealInputKeys(context.Background(), tP, tI, "sin_cam1abcd")
	if err != nil {
		t.Fatal(err)
	}
	if res.Data.Primary != "hfls_cam1abcd_x" || res.Data.Backup != "" {
		t.Errorf("reveal = %+v", res.Data)
	}
}

// sameJSON compares two JSON documents by value (an empty string equals an empty string).
func sameJSON(a, b string) bool {
	if a == "" || b == "" {
		return a == b
	}
	var x, y any
	return json.Unmarshal([]byte(a), &x) == nil && json.Unmarshal([]byte(b), &y) == nil && reflect.DeepEqual(x, y)
}
