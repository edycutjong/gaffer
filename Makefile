# Gaffer — convenience targets (thin wrappers over npm scripts)
.PHONY: help install test test-unit test-integration lint bench verify-offline ready seed demo-standalone demo-provider demo-client security-scan

help:
	@echo "Gaffer — offline AI co-commentator (QVAC × Pear)"
	@echo ""
	@echo "  make install           npm ci"
	@echo "  make test              full suite (unit + real-swarm integration)"
	@echo "  make lint              eslint"
	@echo "  make bench             local vs offloaded tok/s + connect latency"
	@echo "  make verify-offline    full loop with the internet blocked"
	@echo "  make ready             submission readiness gate"
	@echo "  make seed              regenerate deterministic match fixtures"
	@echo "  make demo-standalone   one-terminal demo"
	@echo "  make demo-provider     terminal A (laptop brain)"
	@echo "  make demo-client       terminal B (weak phone)"
	@echo "  make security-scan     npm audit"

install:
	npm ci

test:
	npm test

test-unit:
	npm run test:unit

test-integration:
	npm run test:integration

lint:
	npm run lint

bench:
	npm run bench

verify-offline:
	npm run verify:offline

ready:
	npm run check:ready

seed:
	npm run seed

demo-standalone:
	node cli.js --standalone --speed 400

demo-provider:
	node cli.js --provider

demo-client:
	node cli.js --client

security-scan:
	@echo "=== NPM AUDIT ==="
	npm audit --audit-level=high || true
