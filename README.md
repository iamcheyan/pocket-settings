# Pocket Settings

Pocket Settings is the PJOS system settings application: a PocketJS UI
(React + TypeScript + Vite) over a local Go service, `settingsd`, backed by
SQLite and capability providers. It is designed to become the single source of
truth for settings while the existing PJOS-LINUX Launcher keeps working
unchanged.

```text
apps/pocket-settings/
├── frontend/          PocketJS UI — no OS, shell, or SQLite access
├── backend/settingsd/ Go HTTP service, migrations, capability providers
├── docs/              Architecture, settings, services/migration, DB, API, roadmap
└── tests/             Chromium DevTools screenshot harness
```

## Status: what is real and what is mock

| Area | Status |
|---|---|
| Capability-driven UI, categories, page visibility | Implemented |
| Settings persistence, profile overrides, migrations | Implemented (SQLite) |
| UI profiles, i18n (en/zh-CN/ja), themes, DPI, keyboard/gamepad input | Implemented |
| Search, audit with redaction, dangerous-action confirmation | Implemented |
| Wi-Fi, Bluetooth, storage, accounts, sync, updates, power, services | **Mock / unavailable**, clearly labelled |
| Real PJOS Runtime / service clients | Not implemented |
| Real system writes (network, power, services, updates, storage) | **Never executed** |

All device and service data comes from mock fixtures. `source` is `mock`, and no
capability reports `controllable:true`. Actions that would change a real system
return a refusal (`503 provider_unavailable`) after confirmation and audit; the
optional `--allow-system-control` flag only changes the refusal code, it does
not add privileged execution.

## Requirements

Go 1.24+ and Node.js 20+ (npm). The frontend needs no runtime network access
once dependencies are installed.

## Run

```sh
make dev          # settingsd + Vite
```

or separately:

```sh
cd apps/pocket-settings/backend/settingsd && go run .
cd apps/pocket-settings/frontend && npm install && npm run dev
```

`settingsd` defaults to `127.0.0.1:8090` and `settingsd.sqlite` in its working
directory. `SETTINGS_ADDR` and `SETTINGS_DB` override these. Vite proxies
`/api` to `POCKET_SETTINGS_API` (default `http://127.0.0.1:8090`).

The initial hardware profile is **unavailable**. Select a mock hardware profile
from the Home page (or `PUT /api/capabilities/profile {"hardwareProfile":"…"}`)
to inspect capability-driven pages. UI profiles change layout only.

## Test and build

```sh
make test         # i18n parity + Go tests + real-browser keyboard smoke
make build        # tsc/vite build + go build
make screenshots  # regenerate verified Chromium screenshots
```

`make test` is self-contained: it starts `settingsd` and Vite on spare ports,
waits for readiness, and shuts both down afterwards.

Screenshot uniqueness check:

```sh
python3 -c 'import glob,hashlib;f=glob.glob("**/screenshots/*.png",recursive=True);print(len(f),len({hashlib.sha256(open(x,"rb").read()).hexdigest() for x in f}))'
```

## Security

- The frontend only calls `/api`; it never runs commands, opens SQLite, or uses
  Electron.
- Capability availability is enforced by the backend (`403
  capability_unavailable`), not only by disabled UI.
- Dangerous actions need `{"confirm":true}`; without it → `409
  confirmation_required` and no audit row. Confirmed actions are audited and
  still not performed.
- Audit output is recursively redacted (passwords, tokens, secrets, keys).
- Credentials have no storage yet and must never be written to settings JSON or
  SQLite; a dedicated encrypted CredentialStore is required first.
- HX90 is a development host. This project performs no real network, Bluetooth,
  display, audio, SSH/ADB, storage, update, power, service, or account writes.

## Compatibility

PJOS-LINUX is treated as read-only and remains unchanged, including its
untracked `overlay/storage/` directory. Existing BaseOS entrypoints
(`baseos.conf`, `timedatectl`, service wrappers, boot MENU action) keep working.
The migration matrix and non-regression policy are in
[docs/SERVICES.md](apps/pocket-settings/docs/SERVICES.md).

## Documentation

- [Architecture](apps/pocket-settings/docs/ARCHITECTURE.md)
- [Settings & capabilities](apps/pocket-settings/docs/SETTINGS.md)
- [Services & Launcher migration](apps/pocket-settings/docs/SERVICES.md)
- [Database](apps/pocket-settings/docs/DATABASE.md)
- [API](apps/pocket-settings/docs/API.md)
- [Roadmap](apps/pocket-settings/docs/ROADMAP.md)
- [Screenshot manifest](apps/pocket-settings/docs/SCREENSHOTS.md)
