package hubfly

type ProjectMigrationMode string

type ProjectMigrationKind string

type ProjectMigrationStatus string

type MoveIssueSeverity string

type RegionRef struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Location string `json:"location"`
}

type FreezeEstimate struct {
	Seconds     int64  `json:"seconds"`
	LowSeconds  int64  `json:"lowSeconds"`
	HighSeconds int64  `json:"highSeconds"`
	Basis       string `json:"basis"`
}

type UrlMapEntry struct {
	Kind     string `json:"kind"`
	Old      string `json:"old"`
	New      string `json:"new"`
	Editable bool   `json:"editable"`
}

type DnsRecordPlan struct {
	Name             string  `json:"name"`
	Type             string  `json:"type"`
	Current          string  `json:"current"`
	Next             string  `json:"next"`
	TtlSeconds       *int64  `json:"ttlSeconds"`
	Wildcard         bool    `json:"wildcard"`
	Status           string  `json:"status"`
	CheckedAt        *string `json:"checkedAt"`
	CertificateReady bool    `json:"certificateReady"`
}

type DnsPlan struct {
	Records      []DnsRecordPlan `json:"records"`
	RegistryHost *struct {
		Old string `json:"old"`
		New string `json:"new"`
	} `json:"registryHost"`
	TCPEndpoints []struct {
		Old string `json:"old"`
		New string `json:"new"`
	} `json:"tcpEndpoints"`
	Egress struct {
		Old []string `json:"old"`
		New []string `json:"new"`
	} `json:"egress"`
}

type ChecklistItem struct {
	ID       string            `json:"id"`
	Title    string            `json:"title"`
	Detail   string            `json:"detail"`
	Copy     *string           `json:"copy"`
	Severity MoveIssueSeverity `json:"severity"`
}

type MigrationTargetRegion struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Location    string  `json:"location"`
	Eligible    bool    `json:"eligible"`
	Reason      *string `json:"reason"`
	LatencyHint *string `json:"latencyHint"`
}

type ProjectMigrationPreview struct {
	ProjectID       string               `json:"projectId"`
	Source          RegionRef            `json:"source"`
	Target          RegionRef            `json:"target"`
	CanMigrate      bool                 `json:"canMigrate"`
	Blockers        []MoveIssue          `json:"blockers"`
	Warnings        []MoveIssue          `json:"warnings"`
	RecommendedMode ProjectMigrationMode `json:"recommendedMode"`
	Estimates       struct {
		Cold FreezeEstimate `json:"cold"`
		Warm FreezeEstimate `json:"warm"`
	} `json:"estimates"`
	Data struct {
		VolumeBytes int64 `json:"volumeBytes"`
		RootfsBytes int64 `json:"rootfsBytes"`
		ImageBytes  int64 `json:"imageBytes"`
	} `json:"data"`
	Bandwidth *struct {
		BytesPerSecond int64  `json:"bytesPerSecond"`
		MeasuredAt     string `json:"measuredAt"`
	} `json:"bandwidth"`
	FeeMicroUsd int64           `json:"feeMicroUsd"`
	FeeWaived   bool            `json:"feeWaived"`
	URLMap      []UrlMapEntry   `json:"urlMap"`
	DNSPlan     DnsPlan         `json:"dnsPlan"`
	Checklist   []ChecklistItem `json:"checklist"`
}

type MigrationPassView struct {
	Pass                  int64   `json:"pass"`
	StartedAt             string  `json:"startedAt"`
	FinishedAt            *string `json:"finishedAt"`
	BytesTransferred      int64   `json:"bytesTransferred"`
	ChangedChunks         int64   `json:"changedChunks"`
	Seconds               int64   `json:"seconds"`
	FreezeEstimateSeconds int64   `json:"freezeEstimateSeconds"`
}

type MigrationItemView struct {
	ResourceType       string `json:"resourceType"`
	ResourceID         string `json:"resourceId"`
	Label              string `json:"label"`
	State              string `json:"state"`
	BytesTotal         int64  `json:"bytesTotal"`
	BytesDone          int64  `json:"bytesDone"`
	RateBytesPerSecond *int64 `json:"rateBytesPerSecond"`
	ETASeconds         *int64 `json:"etaSeconds"`
}

type VerificationCheck struct {
	ID     string  `json:"id"`
	Label  string  `json:"label"`
	Status string  `json:"status"`
	Detail *string `json:"detail"`
}

type ProjectMigrationView struct {
	ID               string                 `json:"id"`
	ProjectID        *string                `json:"projectId"`
	ProjectName      string                 `json:"projectName"`
	Kind             ProjectMigrationKind   `json:"kind"`
	Status           ProjectMigrationStatus `json:"status"`
	Mode             ProjectMigrationMode   `json:"mode"`
	InitiatedBy      string                 `json:"initiatedBy"`
	Source           RegionRef              `json:"source"`
	Target           RegionRef              `json:"target"`
	ScheduledAt      *string                `json:"scheduledAt"`
	MaxFreezeSeconds *int64                 `json:"maxFreezeSeconds"`
	Estimates        struct {
		Cold    *FreezeEstimate `json:"cold,omitempty"`
		Warm    *FreezeEstimate `json:"warm,omitempty"`
		Current *FreezeEstimate `json:"current,omitempty"`
	} `json:"estimates"`
	BytesTotal      int64               `json:"bytesTotal"`
	BytesDone       int64               `json:"bytesDone"`
	Passes          []MigrationPassView `json:"passes"`
	Items           []MigrationItemView `json:"items"`
	FreezeStartedAt *string             `json:"freezeStartedAt"`
	FreezeEndedAt   *string             `json:"freezeEndedAt"`
	CutoverAt       *string             `json:"cutoverAt"`
	CompletedAt     *string             `json:"completedAt"`
	URLMap          []UrlMapEntry       `json:"urlMap"`
	DNSPlan         DnsPlan             `json:"dnsPlan"`
	Checklist       []ChecklistItem     `json:"checklist"`
	Verification    struct {
		Checks []VerificationCheck `json:"checks"`
		Passed *bool               `json:"passed"`
	} `json:"verification"`
	Bridge struct {
		Status                 string  `json:"status"`
		Until                  *string `json:"until"`
		TrafficOnTargetPercent *int64  `json:"trafficOnTargetPercent"`
	} `json:"bridge"`
	SourceRetainedUntil *string         `json:"sourceRetainedUntil"`
	SourceCleanedAt     *string         `json:"sourceCleanedAt"`
	FeeMicroUsd         int64           `json:"feeMicroUsd"`
	Refunded            bool            `json:"refunded"`
	CanCancel           bool            `json:"canCancel"`
	CanMoveBack         bool            `json:"canMoveBack"`
	DecisionPending     bool            `json:"decisionPending"`
	Job                 *ProjectJobView `json:"job"`
	FailureCode         *string         `json:"failureCode"`
	FailureMessage      *string         `json:"failureMessage"`
	CreatedAt           string          `json:"createdAt"`
}

type ProjectMigrationDnsStatus struct {
	Records     []DnsRecordPlan `json:"records"`
	CheckedAt   *string         `json:"checkedAt"`
	BridgeUntil *string         `json:"bridgeUntil"`
}

type MigrationAttestation struct {
	Attestation struct {
		Version     int     `json:"version"`
		MigrationID string  `json:"migrationId"`
		ProjectID   *string `json:"projectId"`
		Source      string  `json:"source"`
		Target      string  `json:"target"`
		Objects     []struct {
			Kind       string `json:"kind"`
			Name       string `json:"name"`
			SizeBytes  int64  `json:"sizeBytes"`
			MerkleRoot string `json:"merkleRoot"`
		} `json:"objects"`
		Images []struct {
			Reference string `json:"reference"`
			Digest    string `json:"digest"`
		} `json:"images"`
		FreezeStartedAt *string `json:"freezeStartedAt"`
		CutoverAt       *string `json:"cutoverAt"`
		SourceCleanedAt *string `json:"sourceCleanedAt"`
		IssuedAt        string  `json:"issuedAt"`
	} `json:"attestation"`
	Signature string `json:"signature"`
	KeyID     string `json:"keyId"`
}

type MigrationBatchView struct {
	ID          string                 `json:"id"`
	Kind        string                 `json:"kind"`
	Status      string                 `json:"status"`
	Target      *RegionRef             `json:"target"`
	Source      *RegionRef             `json:"source"`
	Concurrency int64                  `json:"concurrency"`
	DeadlineAt  *string                `json:"deadlineAt"`
	Counters    map[string]int64       `json:"counters"`
	Migrations  []ProjectMigrationView `json:"migrations"`
	CreatedAt   string                 `json:"createdAt"`
}

type ProjectMoveNotice struct {
	ID         string  `json:"id"`
	Kind       string  `json:"kind"`
	Title      string  `json:"title"`
	Detail     string  `json:"detail"`
	Href       string  `json:"href"`
	DeadlineAt *string `json:"deadlineAt"`
	ProjectID  *string `json:"projectId"`
}

type CreateProjectMigrationParams struct {
	TargetRegionID    string               `json:"targetRegionId"`
	Mode              ProjectMigrationMode `json:"mode"`
	ConfirmName       string               `json:"confirmName"`
	ScheduledAt       *string              `json:"scheduledAt,omitempty"`
	MaxFreezeSeconds  *int64               `json:"maxFreezeSeconds,omitempty"`
	HostnameOverrides []struct {
		Old string `json:"old"`
		New string `json:"new"`
	} `json:"hostnameOverrides,omitempty"`
	ManagedAllowlistConsent bool `json:"managedAllowlistConsent,omitempty"`
}
type CreateMigrationBatchParams struct {
	ProjectIDs       []string             `json:"projectIds"`
	TargetRegionID   string               `json:"targetRegionId"`
	Mode             ProjectMigrationMode `json:"mode"`
	ConfirmText      string               `json:"confirmText"`
	ScheduledAt      *string              `json:"scheduledAt,omitempty"`
	MaxFreezeSeconds *int64               `json:"maxFreezeSeconds,omitempty"`
}
type MigrationBandwidthProbe struct {
	BytesPerSecond   int64   `json:"bytesPerSecond"`
	MeasuredAt       string  `json:"measuredAt"`
	ObservedEgressIP *string `json:"observedEgressIp"`
}
type ProjectMoveNotices struct {
	Notices []ProjectMoveNotice `json:"notices"`
}
type MigrationTargetRegions struct {
	Regions []MigrationTargetRegion `json:"regions"`
}
type MoveBackProjectMigrationParams struct {
	ConfirmName string               `json:"confirmName"`
	Mode        ProjectMigrationMode `json:"mode,omitempty"`
}
type CreateProjectRehomeParams struct {
	TargetRegionID string `json:"targetRegionId"`
	ConfirmName    string `json:"confirmName"`
}
