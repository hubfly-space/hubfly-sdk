package hubfly

import "time"

// Meta holds metadata included in Hubfly API responses
type Meta struct {
	RequestID string `json:"requestId"`
	Timestamp string `json:"timestamp"`
}

// Response is the standard generic response wrapper
type Response[T any] struct {
	OK   bool `json:"ok"`
	Data T    `json:"data"`
	Meta Meta `json:"meta"`
}

// ErrorResponse holds error payload from Hubfly API
type ErrorResponse struct {
	OK    bool   `json:"ok"`
	Error string `json:"error"`
	Meta  Meta   `json:"meta"`
}

// ==========================================
// Auth Models
// ==========================================

type LoginParams struct {
	Email    string `json:"email,omitempty"`
	Password string `json:"password,omitempty"`
}

type LoginResult struct {
	OK                   bool   `json:"ok"`
	RequiresVerification bool   `json:"requiresVerification,omitempty"`
	Email                string `json:"email,omitempty"`
	Token                string `json:"token,omitempty"`
	Error                string `json:"error,omitempty"`
}

type RegisterParams struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name,omitempty"`
}

type UserProfile struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	Name      string    `json:"name,omitempty"`
	AvatarURL string    `json:"avatarUrl,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

type APIToken struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	TokenMasked string     `json:"tokenMasked"`
	CreatedAt   time.Time  `json:"createdAt"`
	ExpiresAt   *time.Time `json:"expiresAt,omitempty"`
}

type CreateTokenParams struct {
	Name          string `json:"name"`
	ExpiresInDays int    `json:"expiresInDays,omitempty"`
}

type Subaccount struct {
	ID                    string    `json:"id"`
	Name                  string    `json:"name"`
	ExternalRef           *string   `json:"externalRef,omitempty"`
	Status                string    `json:"status"`
	BackingOrganizationID string    `json:"backingOrganizationId"`
	ParentType            string    `json:"parentType"`
	ParentID              string    `json:"parentId"`
	CreatedAt             time.Time `json:"createdAt"`
	UpdatedAt             time.Time `json:"updatedAt"`
}

type SubaccountKey struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	TokenPrefix string     `json:"tokenPrefix"`
	Scopes      []string   `json:"scopes"`
	LastUsedAt  *time.Time `json:"lastUsedAt,omitempty"`
	ExpiresAt   *time.Time `json:"expiresAt,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
	Token       string     `json:"token,omitempty"`
}

type CreateSubaccountParams struct {
	Name        string            `json:"name"`
	ExternalRef string            `json:"externalRef,omitempty"`
	Metadata    map[string]string `json:"metadata,omitempty"`
	ParentType  string            `json:"parentType,omitempty"`
	ParentID    string            `json:"parentId,omitempty"`
}

// ==========================================
// Project & Container Models
// ==========================================

type Project struct {
	ID             string    `json:"id"`
	Name           string    `json:"name"`
	OrganizationID string    `json:"organizationId,omitempty"`
	Region         string    `json:"region"`
	Status         string    `json:"status"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type CreateProjectParams struct {
	Name           string `json:"name"`
	OrganizationID string `json:"organizationId,omitempty"`
	Region         string `json:"region,omitempty"`
}

type PortMapping struct {
	Container  int    `json:"container"`
	Protocol   string `json:"protocol"`
	PublicPort int    `json:"publicPort,omitempty"`
}

type VolumeMount struct {
	ID               string `json:"id,omitempty"`
	Name             string `json:"name"`
	MountPoint       string `json:"mountPoint"`
	DockerVolumeName string `json:"dockerVolumeName,omitempty"`
}

type EnvVar struct {
	ID       string `json:"id,omitempty"`
	Key      string `json:"key"`
	Value    string `json:"value,omitempty"`
	IsSecret bool   `json:"isSecret,omitempty"`
}

type ContainerResources struct {
	CPULimit int `json:"cpuLimit,omitempty"`
	MemoryMB int `json:"memoryMb,omitempty"`
}

type ContainerRuntime struct {
	AutoSleep     bool   `json:"autoSleep,omitempty"`
	AutoScale     bool   `json:"autoScale,omitempty"`
	Is24x7        bool   `json:"is24x7,omitempty"`
	AutoScaleMode string `json:"autoScaleMode,omitempty"`
}

type Container struct {
	ID                 string              `json:"id"`
	Name               string              `json:"name"`
	ProjectID          string              `json:"projectId"`
	ProjectName        string              `json:"projectName,omitempty"`
	Status             string              `json:"status"`
	SourceType         string              `json:"sourceType"`
	SourceImageDisplay string              `json:"sourceImageDisplay"`
	ActualImageDisplay string              `json:"actualImageDisplay,omitempty"`
	Resources          *ContainerResources `json:"resources,omitempty"`
	Runtime            *ContainerRuntime   `json:"runtime,omitempty"`
	Ports              []PortMapping       `json:"ports,omitempty"`
	Volumes            []VolumeMount       `json:"volumes,omitempty"`
	Environment        []EnvVar            `json:"environment,omitempty"`
	RestartPolicy      string              `json:"restartPolicy,omitempty"`
	CreatedAt          string              `json:"createdAt,omitempty"`
}

type CreateContainerParams struct {
	ProjectID   string              `json:"projectId"`
	Name        string              `json:"name"`
	Image       string              `json:"image"`
	Ports       []PortMapping       `json:"ports,omitempty"`
	Environment []EnvVar            `json:"environment,omitempty"`
	Volumes     []VolumeMount       `json:"volumes,omitempty"`
	Resources   *ContainerResources `json:"resources,omitempty"`
}

// ==========================================
// Load Balancers Models
// ==========================================

type LoadBalancerTarget struct {
	ID       string `json:"id"`
	TargetID string `json:"targetId"`
	Port     int    `json:"port"`
	Weight   int    `json:"weight,omitempty"`
	Status   string `json:"status,omitempty"`
}

type LoadBalancerDomain struct {
	ID          string `json:"id"`
	DomainName  string `json:"domainName"`
	SSLEnabled  bool   `json:"sslEnabled,omitempty"`
	RedirectURL string `json:"redirectUrl,omitempty"`
}

type LoadBalancer struct {
	ID        string               `json:"id"`
	Name      string               `json:"name"`
	ProjectID string               `json:"projectId"`
	Algorithm string               `json:"algorithm,omitempty"`
	Domains   []LoadBalancerDomain `json:"domains,omitempty"`
	Targets   []LoadBalancerTarget `json:"targets,omitempty"`
	CreatedAt time.Time            `json:"createdAt"`
}

type CreateLoadBalancerParams struct {
	ProjectID string `json:"projectId"`
	Name      string `json:"name"`
	Algorithm string `json:"algorithm,omitempty"`
}

type UpdateLoadBalancerParams struct {
	Name      string `json:"name,omitempty"`
	Algorithm string `json:"algorithm,omitempty"`
}

type CreateLoadBalancerTargetParams struct {
	TargetID string `json:"targetId"`
	Port     int    `json:"port"`
	Weight   int    `json:"weight,omitempty"`
}

type CreateLoadBalancerDomainParams struct {
	DomainName string `json:"domainName"`
	SSLEnabled bool   `json:"sslEnabled,omitempty"`
}

// ==========================================
// Network & Firewall Models
// ==========================================

type NetworkAccess struct {
	ProjectID string `json:"projectId"`
	Enabled   bool   `json:"enabled"`
	PrivateIP string `json:"privateIp,omitempty"`
	VPNSubnet string `json:"vpnSubnet,omitempty"`
}

type NetworkAccessKey struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	KeyMasked string     `json:"keyMasked"`
	CreatedAt time.Time  `json:"createdAt"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
}

type NetworkFirewallRule struct {
	ID        string `json:"id"`
	Direction string `json:"direction"`
	Protocol  string `json:"protocol"`
	PortRange string `json:"portRange,omitempty"`
	CIDR      string `json:"cidr"`
	Action    string `json:"action"`
}

type NetworkFirewall struct {
	ProjectID string                `json:"projectId"`
	Enabled   bool                  `json:"enabled"`
	Rules     []NetworkFirewallRule `json:"rules"`
}

type NetworkLog struct {
	Timestamp string `json:"timestamp"`
	SourceIP  string `json:"sourceIp"`
	DestPort  int    `json:"destPort"`
	Action    string `json:"action"`
	Bytes     int64  `json:"bytes,omitempty"`
}

type NetworkProxy struct {
	ProxyURL string `json:"proxyUrl"`
	Status   string `json:"status"`
}

type ChallengePathRule struct {
	Path    string   `json:"path"`
	Match   string   `json:"match"`
	Methods []string `json:"methods,omitempty"`
}
type ChallengeBypassKey struct {
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	TokenPrefix  string     `json:"tokenPrefix"`
	Status       string     `json:"status"`
	AllowedPaths []string   `json:"allowedPaths"`
	ExpiresAt    *time.Time `json:"expiresAt,omitempty"`
	LastUsedAt   *time.Time `json:"lastUsedAt,omitempty"`
}
type RouteChallengePolicy struct {
	ID                    string               `json:"id"`
	ProjectID             string               `json:"projectId"`
	RouteType             string               `json:"routeType"`
	RouteID               string               `json:"routeId"`
	DomainName            string               `json:"domainName"`
	Enabled               bool                 `json:"enabled"`
	Mode                  string               `json:"mode"`
	PolicyRevision        int                  `json:"policyRevision"`
	ClearanceTTLSeconds   int                  `json:"clearanceTtlSeconds"`
	FailureMode           string               `json:"failureMode"`
	AllowVerifiedCrawlers bool                 `json:"allowVerifiedCrawlers"`
	ProtectedRules        []ChallengePathRule  `json:"protectedRules"`
	BypassRules           []ChallengePathRule  `json:"bypassRules"`
	BypassCIDRs           []string             `json:"bypassCidrs"`
	InjectHeaders         bool                 `json:"injectHeaders"`
	SyncStatus            string               `json:"syncStatus"`
	SyncError             *string              `json:"syncError,omitempty"`
	BypassKeys            []ChallengeBypassKey `json:"bypassKeys,omitempty"`
}
type UpdateChallengePolicyParams struct {
	Enabled               bool                `json:"enabled"`
	Mode                  string              `json:"mode,omitempty"`
	ClearanceTTLSeconds   int                 `json:"clearanceTtlSeconds,omitempty"`
	FailureMode           string              `json:"failureMode,omitempty"`
	AllowVerifiedCrawlers *bool               `json:"allowVerifiedCrawlers,omitempty"`
	ProtectedRules        []ChallengePathRule `json:"protectedRules,omitempty"`
	BypassRules           []ChallengePathRule `json:"bypassRules,omitempty"`
	BypassCIDRs           []string            `json:"bypassCidrs,omitempty"`
	InjectHeaders         *bool               `json:"injectHeaders,omitempty"`
}
type ChallengeRoute struct {
	RouteType       string                `json:"routeType"`
	RouteID         string                `json:"routeId"`
	Hostname        string                `json:"hostname"`
	Label           string                `json:"label"`
	ChallengePolicy *RouteChallengePolicy `json:"challengePolicy"`
}
type CreatedChallengeBypassKey struct {
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	Prefix       string     `json:"prefix"`
	Token        string     `json:"token"`
	AllowedPaths []string   `json:"allowedPaths"`
	ExpiresAt    *time.Time `json:"expiresAt,omitempty"`
}

type ChallengeAnalytics struct {
	Range                 string         `json:"range"`
	SampledRequests       int            `json:"sampledRequests"`
	Counts                map[string]int `json:"counts"`
	SolveRate             *float64       `json:"solveRate"`
	AverageProofLatencyMs *float64       `json:"averageProofLatencyMs"`
	TopChallengedPaths    []struct {
		Path  string `json:"path"`
		Count int    `json:"count"`
	} `json:"topChallengedPaths"`
	Truncated bool `json:"truncated"`
}

// ==========================================
// Port Reservations Models
// ==========================================

type PortReservation struct {
	ReservationID       string `json:"reservationId"`
	Port                int    `json:"port"`
	Protocol            string `json:"protocol"`
	Status              string `json:"status"`
	MappedContainerID   string `json:"mappedContainerId,omitempty"`
	MappedContainerPort int    `json:"mappedContainerPort,omitempty"`
}

type ReservePortParams struct {
	Protocol string `json:"protocol"`
	Port     int    `json:"port,omitempty"`
}

type MapPortParams struct {
	ContainerID   string `json:"containerId"`
	ContainerPort int    `json:"containerPort"`
}

// ==========================================
// Container Registry Models
// ==========================================

type RegistryCredential struct {
	CredentialID string    `json:"credentialId"`
	Name         string    `json:"name"`
	RegistryURL  string    `json:"registryUrl"`
	Username     string    `json:"username"`
	CreatedAt    time.Time `json:"createdAt"`
}

type CreateRegistryCredentialParams struct {
	Name        string `json:"name"`
	RegistryURL string `json:"registryUrl"`
	Username    string `json:"username"`
	Password    string `json:"password,omitempty"`
}

type RegistryImage struct {
	ImageID   string    `json:"imageId"`
	Name      string    `json:"name"`
	Tag       string    `json:"tag"`
	Digest    string    `json:"digest"`
	SizeBytes int64     `json:"sizeBytes"`
	CreatedAt time.Time `json:"createdAt"`
}

type ImageScanResult struct {
	ImageID       string `json:"imageId"`
	Status        string `json:"status"`
	CriticalCount int    `json:"criticalCount"`
	HighCount     int    `json:"highCount"`
	MediumCount   int    `json:"mediumCount"`
	LowCount      int    `json:"lowCount"`
	ScannedAt     string `json:"scannedAt"`
}

// ==========================================
// Subdomain Models
// ==========================================

type SubdomainReservation struct {
	SubdomainID string    `json:"subdomainId"`
	Subdomain   string    `json:"subdomain"`
	FullDomain  string    `json:"fullDomain"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"createdAt"`
}

type CreateSubdomainParams struct {
	Subdomain string `json:"subdomain"`
}

// ==========================================
// Team Models
// ==========================================

type TeamMember struct {
	UserID      string   `json:"userId"`
	Name        string   `json:"name"`
	Email       string   `json:"email"`
	Role        string   `json:"role"`
	Permissions []string `json:"permissions,omitempty"`
	JoinedAt    string   `json:"joinedAt"`
}

type TeamInvitation struct {
	InvitationID string    `json:"invitationId"`
	Email        string    `json:"email"`
	Role         string    `json:"role"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"createdAt"`
}

type CreateTeamInvitationParams struct {
	Email string `json:"email"`
	Role  string `json:"role,omitempty"`
}

// ==========================================
// Tunnel Models
// ==========================================

type ProjectTunnel struct {
	TunnelID   string    `json:"tunnelId"`
	Name       string    `json:"name"`
	TargetPort int       `json:"targetPort"`
	PublicURL  string    `json:"publicUrl"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"createdAt"`
}

type CreateTunnelParams struct {
	Name       string `json:"name"`
	TargetPort int    `json:"targetPort"`
}

// ==========================================
// Volume Models
// ==========================================

type Volume struct {
	ID         string            `json:"id"`
	Name       string            `json:"name"`
	SizeGB     int               `json:"sizeGb"`
	MountPoint string            `json:"mountPoint,omitempty"`
	Status     string            `json:"status"`
	Labels     map[string]string `json:"labels,omitempty"`
	CreatedAt  time.Time         `json:"createdAt"`
}

type CreateVolumeParams struct {
	ProjectID string `json:"projectId"`
	Name      string `json:"name"`
	SizeGB    int    `json:"sizeGb"`
}

// ==========================================
// Webhook Models
// ==========================================

type ProjectWebhook struct {
	WebhookID string    `json:"webhookId"`
	URL       string    `json:"url"`
	Events    []string  `json:"events"`
	Secret    string    `json:"secret,omitempty"`
	Active    bool      `json:"active"`
	CreatedAt time.Time `json:"createdAt"`
}

type CreateWebhookParams struct {
	URL    string   `json:"url"`
	Events []string `json:"events"`
	Secret string   `json:"secret,omitempty"`
}

// ==========================================
// Hibernation Models
// ==========================================

type HibernationStatus struct {
	ProjectID    string `json:"projectId"`
	Hibernated   bool   `json:"hibernated"`
	HibernatedAt string `json:"hibernatedAt,omitempty"`
	Reason       string `json:"reason,omitempty"`
}

type HibernationPreview struct {
	ProjectID            string `json:"projectId"`
	Eligible             bool   `json:"eligible"`
	EstimatedDiskSavedMB int64  `json:"estimatedDiskSavedMb,omitempty"`
}

// ==========================================
// Project Moves (transfers, region migration, history)
// ==========================================
// Shapes of hubfly-dashboard/shared/project-moves.ts. Region migration types
// join this section.

// ProjectJobStep is one step of a project job.
type ProjectJobStep struct {
	Key        string  `json:"key"`
	Label      string  `json:"label"`
	Status     string  `json:"status"` // pending | running | succeeded | failed | skipped
	Phase      string  `json:"phase"`  // forward | compensation
	StartedAt  *string `json:"startedAt"`
	FinishedAt *string `json:"finishedAt"`
}

// ProjectJobView is the long-running job behind a transfer or a region move.
type ProjectJobView struct {
	ID string `json:"id"`
	// Kind is project_transfer, project_migration, migration_reverse or metadata_rehome.
	Kind string `json:"kind"`
	// Status is queued, running, waiting, rolling_back, succeeded, failed, canceled or needs_attention.
	Status string `json:"status"`
	Phase  string `json:"phase"` // forward | compensation
	// Lock is "config" (changes paused) or "full" (workloads stopped too); nil when unlocked.
	Lock            *string          `json:"lock"`
	Step            *string          `json:"step"`
	StepLabel       *string          `json:"stepLabel"`
	StepIndex       int              `json:"stepIndex"`
	StepCount       int              `json:"stepCount"`
	Steps           []ProjectJobStep `json:"steps"`
	Progress        *float64         `json:"progress"`
	ETASeconds      *int64           `json:"etaSeconds"`
	ErrorCode       *string          `json:"errorCode"`
	ErrorMessage    *string          `json:"errorMessage"`
	RemediationCode *string          `json:"remediationCode"`
	StartedAt       *string          `json:"startedAt"`
	FinishedAt      *string          `json:"finishedAt"`
	NextRunAt       *string          `json:"nextRunAt"`
}

// OwnerRef is a personal account (Type "user") or an organization.
type OwnerRef struct {
	Type string `json:"type"`
	ID   string `json:"id"`
	Name string `json:"name"`
}

// MoveIssue is a blocker, warning or note of a transfer or migration preview.
type MoveIssue struct {
	Code     string         `json:"code"`
	Severity string         `json:"severity"` // blocker | warning | info
	Message  string         `json:"message"`
	Detail   map[string]any `json:"detail,omitempty"`
}

// MoveCount counts one kind of resource that moves or is revoked.
type MoveCount struct {
	Kind  string `json:"kind"`
	Label string `json:"label"`
	Count int    `json:"count"`
}

// ProjectTransferView is a transfer of a project to another owner. Status is
// pending, accepted, declined, canceled, expired, completed or failed.
type ProjectTransferView struct {
	ID string `json:"id"`
	// ProjectID is nil once the project was deleted.
	ProjectID      *string   `json:"projectId"`
	ProjectName    string    `json:"projectName"`
	ProjectType    string    `json:"projectType"`
	Status         string    `json:"status"`
	RecipientEmail string    `json:"recipientEmail"`
	From           OwnerRef  `json:"from"`
	To             *OwnerRef `json:"to"`
	ExpiresAt      string    `json:"expiresAt"`
	CreatedAt      string    `json:"createdAt"`
	AcceptedAt     *string   `json:"acceptedAt"`
	CompletedAt    *string   `json:"completedAt"`
	// HandoverAt is the full hour at which the owner changes.
	HandoverAt     *string         `json:"handoverAt"`
	Job            *ProjectJobView `json:"job"`
	FailureCode    *string         `json:"failureCode"`
	FailureMessage *string         `json:"failureMessage"`
}

// ProjectTransferPreview is what a transfer would move and revoke, and what
// blocks it (sender only).
type ProjectTransferPreview struct {
	ProjectID                  string      `json:"projectId"`
	ProjectName                string      `json:"projectName"`
	ProjectType                string      `json:"projectType"`
	CanTransfer                bool        `json:"canTransfer"`
	Blockers                   []MoveIssue `json:"blockers"`
	Warnings                   []MoveIssue `json:"warnings"`
	Moves                      []MoveCount `json:"moves"`
	RevokedIfSenderLosesAccess []MoveCount `json:"revokedIfSenderLosesAccess"`
	EnvValueCount              int         `json:"envValueCount"`
	RequiresOTP                bool        `json:"requiresOtp"`
}

// ProjectTransferOTP says where the confirmation code was sent.
type ProjectTransferOTP struct {
	SentTo    string `json:"sentTo"`
	ExpiresAt string `json:"expiresAt"`
}

// ProjectTransferOfferSummary is an offer waiting for you. Its token is only
// in the offer email.
type ProjectTransferOfferSummary struct {
	TransferID  string  `json:"transferId"`
	BatchID     *string `json:"batchId"`
	ProjectName string  `json:"projectName"`
	ProjectType string  `json:"projectType"`
	SenderName  string  `json:"senderName"`
	ExpiresAt   string  `json:"expiresAt"`
	Status      string  `json:"status"`
}

// ProjectTransferList holds offers for you and transfers you started.
type ProjectTransferList struct {
	Incoming []ProjectTransferOfferSummary `json:"incoming"`
	Outgoing []ProjectTransferView         `json:"outgoing"`
}

// ProjectTransferOfferMember is a direct member of an offered project; they
// lose access unless kept with KeepMembers.
type ProjectTransferOfferMember struct {
	UserID      string   `json:"userId"`
	Name        string   `json:"name"`
	Email       string   `json:"email"`
	Permissions []string `json:"permissions"`
	Credentials []string `json:"credentials"`
}

// ProjectTransferOfferProject is one project of an offer.
type ProjectTransferOfferProject struct {
	TransferID  string `json:"transferId"`
	ProjectName string `json:"projectName"`
	ProjectType string `json:"projectType"`
	Hosting     struct {
		Hostnames     []string `json:"hostnames"`
		CustomDomains []string `json:"customDomains"`
		MailDomains   []string `json:"mailDomains"`
		Buckets       int      `json:"buckets"`
		Containers    int      `json:"containers"`
		Volumes       int      `json:"volumes"`
		Boxes         int      `json:"boxes"`
	} `json:"hosting"`
	Members []ProjectTransferOfferMember `json:"members"`
}

// ProjectTransferDestination is an account the recipient can accept into.
type ProjectTransferDestination struct {
	Type     string  `json:"type"` // user | organization
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Eligible bool    `json:"eligible"`
	Reason   *string `json:"reason"`
}

// ProjectTransferOfferView is the offer behind an emailed token.
type ProjectTransferOfferView struct {
	BatchID      *string                       `json:"batchId"`
	SenderName   string                        `json:"senderName"`
	ExpiresAt    string                        `json:"expiresAt"`
	Status       string                        `json:"status"`
	Projects     []ProjectTransferOfferProject `json:"projects"`
	Destinations []ProjectTransferDestination  `json:"destinations"`
}

// ProjectTransferAcceptancePreview is what accepting into a destination
// costs and requires (recipient only).
type ProjectTransferAcceptancePreview struct {
	Eligible                bool        `json:"eligible"`
	Blockers                []MoveIssue `json:"blockers"`
	Warnings                []MoveIssue `json:"warnings"`
	BalanceMicroUSD         int64       `json:"balanceMicroUsd"`
	RequiredBalanceMicroUSD int64       `json:"requiredBalanceMicroUsd"`
	HourlyBurnMicroUSD      int64       `json:"hourlyBurnMicroUsd"`
	BilledPlans             []struct {
		Kind           string `json:"kind"`
		Label          string `json:"label"`
		AmountMicroUSD int64  `json:"amountMicroUsd"`
		Period         string `json:"period"`
	} `json:"billedPlans"`
	CredentialPolicy string      `json:"credentialPolicy"` // rotate | keep
	Revoked          []MoveCount `json:"revoked"`
}

// ProjectTransferOptions tunes a transfer. CredentialPolicy "rotate" revokes
// every project credential at the handover; "auto" (default) only those of
// people who lose access.
type ProjectTransferOptions struct {
	CredentialPolicy string `json:"credentialPolicy,omitempty"`
}

// CreateProjectTransferParams offers a project. ConfirmName is the project
// name, typed to confirm; OTP is the code from ProjectTransfers.CreateOTP.
type CreateProjectTransferParams struct {
	RecipientEmail string                  `json:"recipientEmail"`
	ConfirmName    string                  `json:"confirmName"`
	OTP            string                  `json:"otp"`
	Options        *ProjectTransferOptions `json:"options,omitempty"`
}

// CreateProjectTransferBundleOTPParams asks for a code covering several projects.
type CreateProjectTransferBundleOTPParams struct {
	ProjectIDs     []string `json:"projectIds"`
	RecipientEmail string   `json:"recipientEmail"`
}

// CreateProjectTransferBundleParams offers several projects with one token.
// ConfirmText is TransferBundleConfirmText(len(ProjectIDs)).
type CreateProjectTransferBundleParams struct {
	ProjectIDs     []string                `json:"projectIds"`
	RecipientEmail string                  `json:"recipientEmail"`
	ConfirmText    string                  `json:"confirmText"`
	OTP            string                  `json:"otp"`
	Options        *ProjectTransferOptions `json:"options,omitempty"`
}

// ProjectTransferBundle is a bundle offer.
type ProjectTransferBundle struct {
	BatchID   string                `json:"batchId"`
	Transfers []ProjectTransferView `json:"transfers"`
}

// ProjectTransferDestinationParams names where to accept: DestinationType
// "user" (your account) or "organization" with DestinationID. TransferIDs
// selects part of a bundle; every open project when empty.
type ProjectTransferDestinationParams struct {
	DestinationType string   `json:"destinationType"`
	DestinationID   string   `json:"destinationId,omitempty"`
	TransferIDs     []string `json:"transferIds,omitempty"`
}

// ProjectTransferKeepMembers keeps direct members of one offered project.
type ProjectTransferKeepMembers struct {
	TransferID string   `json:"transferId"`
	UserIDs    []string `json:"userIds"`
}

// AcceptProjectTransferParams accepts an offer. Members not listed in
// KeepMembers lose their access.
type AcceptProjectTransferParams struct {
	DestinationType string                       `json:"destinationType"`
	DestinationID   string                       `json:"destinationId,omitempty"`
	TransferIDs     []string                     `json:"transferIds,omitempty"`
	KeepMembers     []ProjectTransferKeepMembers `json:"keepMembers,omitempty"`
}

// ProjectHistoryEntry is one transfer or region move of a project. Kind is
// transfer, migration, reverse, rehome or evacuation.
type ProjectHistoryEntry struct {
	ID     string  `json:"id"`
	Kind   string  `json:"kind"`
	Status string  `json:"status"`
	Title  string  `json:"title"`
	Detail *string `json:"detail"`
	Actor  *string `json:"actor"`
	At     string  `json:"at"`
	Href   *string `json:"href"`
}

// ProjectHistory lists a project's transfers and region moves, newest first.
type ProjectHistory struct {
	Entries []ProjectHistoryEntry `json:"entries"`
}

// ==========================================
// Region & Template Models
// ==========================================

type Region struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Code      string `json:"code"`
	Country   string `json:"country"`
	Available bool   `json:"available"`
}

type Template struct {
	ID                   string              `json:"id"`
	Name                 string              `json:"name"`
	Description          string              `json:"description"`
	Category             string              `json:"category"`
	IconURL              string              `json:"iconUrl,omitempty"`
	RecommendedResources *ContainerResources `json:"recommendedResources,omitempty"`
}

// ==========================================
// Organization Models
// ==========================================

type Organization struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Slug      string    `json:"slug"`
	OwnerID   string    `json:"ownerId"`
	CreatedAt time.Time `json:"createdAt"`
}

type OrgMember struct {
	ID       string    `json:"id"`
	UserID   string    `json:"userId"`
	Email    string    `json:"email"`
	Role     string    `json:"role"`
	JoinedAt time.Time `json:"joinedAt"`
}

// ==========================================
// Domain Models
// ==========================================

type Domain struct {
	ID                string    `json:"id"`
	DomainName        string    `json:"domainName"`
	Verified          bool      `json:"verified"`
	VerificationHost  string    `json:"verificationHost,omitempty"`
	VerificationToken string    `json:"verificationToken,omitempty"`
	CreatedAt         time.Time `json:"createdAt"`
}

type CreateDomainParams struct {
	DomainName string `json:"domainName"`
}

// ==========================================
// GPU Models
// ==========================================

type GpuInstance struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	GpuType   string    `json:"gpuType"`
	GpuCount  int       `json:"gpuCount"`
	Status    string    `json:"status"`
	IPAddress string    `json:"ipAddress,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// ==========================================
// System Models
// ==========================================

type SystemHealth struct {
	Status        string `json:"status"`
	Version       string `json:"version"`
	UptimeSeconds int64  `json:"uptimeSeconds"`
	Timestamp     string `json:"timestamp"`
}
