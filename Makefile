.PHONY: build test dev screenshots check-i18n

build:
	cd apps/pocket-settings/frontend && npm run build
	cd apps/pocket-settings/backend/settingsd && go build ./...

check-i18n:
	node apps/pocket-settings/frontend/scripts/check-i18n.mjs

test: check-i18n
	cd apps/pocket-settings/backend/settingsd && go test ./...
	@set -e; \
	cd apps/pocket-settings/backend/settingsd; \
	cleanup() { kill $$backend $$frontend 2>/dev/null || true; wait $$backend $$frontend 2>/dev/null || true; }; \
	trap cleanup EXIT; \
	SETTINGS_ADDR=127.0.0.1:18091 SETTINGS_DB=$$(mktemp /tmp/pocket-settings-test-XXXX.sqlite) go run . >/tmp/pocket-settings-test-backend.log 2>&1 & backend=$$!; \
	cd - >/dev/null; \
	cd apps/pocket-settings/frontend; \
	POCKET_SETTINGS_API=http://127.0.0.1:18091 npm run dev -- --host 127.0.0.1 --port 15174 >/tmp/pocket-settings-test-frontend.log 2>&1 & frontend=$$!; \
	for i in $$(seq 1 120); do curl -fsS http://127.0.0.1:18091/api/health >/dev/null 2>&1 && break; sleep 0.5; done; \
	for i in $$(seq 1 120); do curl -fsS http://127.0.0.1:15174/ >/dev/null 2>&1 && break; sleep 0.5; done; \
	curl -fsS -X PUT http://127.0.0.1:18091/api/capabilities/profile -H 'Content-Type: application/json' -d '{"hardwareProfile":"Desktop"}' >/dev/null; \
	POCKET_SETTINGS_URL=http://127.0.0.1:15174 node scripts/ui-smoke.mjs

dev:
	@trap 'kill 0' EXIT; cd apps/pocket-settings/backend/settingsd && go run . & cd apps/pocket-settings/frontend && npm run dev

screenshots:
	node apps/pocket-settings/tests/screenshots.mjs
