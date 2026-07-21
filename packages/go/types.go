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

type Volume struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	SizeGB     int       `json:"sizeGb"`
	MountPoint string    `json:"mountPoint,omitempty"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"createdAt"`
}

type CreateVolumeParams struct {
	ProjectID string `json:"projectId"`
	Name      string `json:"name"`
	SizeGB    int    `json:"sizeGb"`
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
