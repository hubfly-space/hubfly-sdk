.PHONY: help install build test clean build-ts test-ts build-go test-go verify-spec

help:
	@echo "Hubfly SDK Monorepo - Available Targets:"
	@echo "  make install     - Install node dependencies for TypeScript SDK"
	@echo "  make build       - Build both TypeScript and Go SDKs"
	@echo "  make test        - Test both TypeScript and Go SDKs"
	@echo "  make build-ts    - Build TypeScript SDK"
	@echo "  make test-ts     - Run TypeScript SDK tests"
	@echo "  make build-go    - Build Go SDK"
	@echo "  make test-go     - Run Go SDK tests"
	@echo "  make verify-spec - Verify SDK alignment against hubfly-dashboard openapi.json"
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

verify-spec:
	bun run scripts/verify-spec-diff.ts

build: build-ts build-go

test: test-ts test-go

clean:
	rm -rf packages/ts/dist packages/ts/node_modules
