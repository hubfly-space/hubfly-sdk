.PHONY: help install build test clean build-ts test-ts build-go test-go build-realtime test-realtime build-go-realtime test-go-realtime verify-spec generate-managed verify-spec-managed

help:
	@echo "Hubfly SDK Monorepo - Available Targets:"
	@echo "  make install     - Install node dependencies for TypeScript SDK"
	@echo "  make build       - Build both TypeScript and Go SDKs"
	@echo "  make test        - Test both TypeScript and Go SDKs"
	@echo "  make build-ts    - Build TypeScript SDK"
	@echo "  make test-ts     - Run TypeScript SDK tests"
	@echo "  make build-go    - Build Go SDK"
	@echo "  make test-go     - Run Go SDK tests"
	@echo "  make build-realtime    - Build @hubfly/realtime (packages/realtime)"
	@echo "  make test-realtime     - Test @hubfly/realtime (typecheck + bun test)"
	@echo "  make build-go-realtime - Build the Go realtime module (packages/go/realtime)"
	@echo "  make test-go-realtime  - Vet and test the Go realtime module"
	@echo "  make verify-spec - Verify SDK alignment against hubfly-dashboard openapi.json"
	@echo "  make generate-managed    - Regenerate the Managed Services types (TS + Go) from openapi.json"
	@echo "  make verify-spec-managed - Strict check: every managed operation covered, generated types in sync"
	@echo "  make clean       - Clean build artifacts"

install:
	cd packages/ts && bun install

build-ts:
	cd packages/ts && bun run build

test-ts:
	cd packages/ts && bun test

build-go:
	cd packages/go && go build ./...

test-go:
	cd packages/go && go test ./...

build-realtime:
	cd packages/realtime && bun run build

test-realtime:
	cd packages/realtime && bun run typecheck && bun test

# packages/go/realtime is a nested module: packages/go's ./... does not include it.
build-go-realtime:
	cd packages/go/realtime && go build ./...

test-go-realtime:
	cd packages/go/realtime && go vet ./... && go test ./...

verify-spec:
	bun run scripts/verify-spec-diff.ts

# Managed Services (Databases + Realtime): types and operation tables are
# generated from hubfly-dashboard/openapi.json (OPENAPI_PATH overrides it).
generate-managed:
	bun run scripts/generate-managed.ts

verify-spec-managed:
	bun run scripts/verify-spec-diff.ts --scope managed --strict

build: build-ts build-go build-realtime build-go-realtime

test: test-ts test-go test-realtime test-go-realtime

clean:
	rm -rf packages/ts/dist packages/ts/node_modules packages/realtime/dist
