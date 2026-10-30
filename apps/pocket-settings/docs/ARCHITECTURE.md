# Architecture

Pocket Settings is a PocketJS system settings application with a strict
privilege boundary:

```text
PocketJS UI (React + TypeScript + Vite)
        │  JSON over /api (fetch)
        ▼
settingsd (Go, net/http + database/sql)
        ├── SQLite (modernc.org/sqlite, pure Go)
        └── Capability providers / runtime service clients (mock today)
```

The frontend never opens SQLite, executes shell commands, or touches hardware.
Vite proxies `/api` to the daemon in development (override with
`POCKET_SETTINGS_API`). `settingsd` owns settings persistence, profile
overrides, capability reports, service status, and the audit trail.

## Components

| Path | Role |
|---|---|
| `apps/pocket-settings/frontend/src/App.tsx` | Pages, capability gating, keyboard/gamepad navigation, global search |
| `apps/pocket-settings/frontend/src/api.ts` | Typed HTTP client; the only network surface |
| `apps/pocket-settings/frontend/src/i18n.ts` | English / Simplified Chinese / Japanese dictionaries (405 keys, parity-checked) |
| `apps/pocket-settings/frontend/src/styles.css` | Themes, density, DPI scaling, responsive tokens |
| `apps/pocket-settings/backend/settingsd/main.go` | HTTP API, migrations, capability provider, mock actions, audit |
| `apps/pocket-settings/tests/screenshots.mjs` | Chromium DevTools screenshot harness |
| `Makefile` | `build`, `test` (self-contained), `screenshots` |

## Capability model

Capabilities are the source of truth for which UI exists. Each ID reports
`{available, enabled, controllable, source, reason}`; the schema covers Battery,
Brightness, Audio, Touchscreen, SSH, ADB, USB, SDCard, EInk, Ethernet,
PowerManagement, DisplayRotation, WiFi, Bluetooth, Storage and Display, plus
each settings domain. Missing provider support yields `available:false` **with a
reason** instead of hiding the fact. `source` is `mock`; nothing reports
`controllable:true`.

Two independent concepts:

1. **Hardware mock profile** — selects which capabilities a fixture claims
   (RG34XX, RG35XX, RG40XX, CubeXX, M21, Leaf3C, Desktop). Always mock; never
   evidence of real hardware.
2. **UI profile** — layout density/navigation only. It cannot create
   capability.

Changing a UI profile leaves `capabilityData()` untouched; this is asserted in
Go tests.

## Enforcement boundary

Capability is not permission. The backend is the final gate:

- `PUT /api/settings/{domain}` and override writes return `403
  capability_unavailable` when the category is unavailable.
- Provider actions are classified (`providerActions`): capability-gated
  mock-safe actions return `{mock:true, performed:false}`; dangerous actions
  additionally require `confirm:true`.
- Missing confirmation → `409 confirmation_required` and nothing is audited.
- Confirmed dangerous action with no provider → `503 provider_unavailable`,
  `performed:false`, audited. `--allow-system-control` only changes the refusal
  to `501 system_control_not_implemented`; no privileged execution exists.
- `--allow-system-readonly` permits a read-only host summary
  (`hostProfile:"host"`, `provider:"host-readonly"`). It never writes.

## Persistence and profiles

SQLite stores per-domain settings, profile overrides, preferences, capability
fixture metadata, service status, accounts/sync placeholders, device state and
the audit log. Reads merge the base domain object with the active profile
override (override wins, signalled by `X-Settings-Override-Profile`).
Migrations are ordered and transactional: v1 tables, v2 `profile_overrides`,
v3 indexes. Re-running is idempotent and preserves data.

## Safety posture

No real Wi-Fi, Bluetooth, display, audio, SSH/ADB, storage mount, update,
service restart, power or account operation is performed anywhere in this
codebase. Mock fixtures are labelled in the UI (`Mock data`, `UI ONLY`,
capability `source`), and audit output is recursively redacted. Credentials
belong in an encrypted CredentialStore, which does not exist yet; settings JSON
and SQLite must not hold secrets. HX90 is a development host and is never a
control target for this project.

## PJOS Runtime API direction

Keep the JSON domain contracts stable while replacing mock providers with PJOS
Runtime clients. An adapter maps runtime capability reports, state, service
health and structured errors onto the existing schemas, preserving `source` and
`reason`. Read-only integration precedes writes; writes require runtime
authorization, user confirmation, and audit. The Launcher/BaseOS entrypoints
remain untouched until a separately authorized migration.
