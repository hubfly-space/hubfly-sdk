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
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	KeyMasked   string     `json:"keyMasked"`
	CreatedAt   time.Time  `json:"createdAt"`
	ExpiresAt   *time.Time `json:"expiresAt,omitempty"`
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
	UserID    string   `json:"userId"`
	Name      string   `json:"name"`
	Email     string   `json:"email"`
	Role      string   `json:"role"`
	Permissions []string `json:"permissions,omitempty"`
	JoinedAt  string   `json:"joinedAt"`
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
	WebhookID string   `json:"webhookId"`
	URL       string   `json:"url"`
	Events    []string `json:"events"`
	Secret    string   `json:"secret,omitempty"`
	Active    bool     `json:"active"`
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
