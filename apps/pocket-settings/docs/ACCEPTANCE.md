# Acceptance record

Evidence collected on the HX90 development host (NixOS, Go 1.26.6, Node
24.19.0, Chromium 152.0.7977.75). No real Wi-Fi, Bluetooth, display, audio,
SSH/ADB, storage, update, power, service, or account write was executed; only
localhost mock APIs and read-only host queries were used.

## Commands

| Command | Result |
|---|---|
| `make test` | `i18n parity ok: 3 locales, 405 keys`; `ok pocket-settings/settingsd`; `UI smoke passed: dark\|en\|Overview vs light\|ja\|概要` |
| `make build` | `tsc -b && vite build` succeeded (1579 modules); `go build ./...` succeeded |
| `go vet ./...` | clean |
| `gofmt -l .` | no output |

`make test` is self-contained: it starts `settingsd` and Vite on spare ports,
waits for both, runs the Go suite plus the browser keyboard smoke, and stops
both processes.

## API acceptance (fresh database)

| Check | Result |
|---|---|
| `GET /api/health` | `{"status":"ok"}` |
| Default capabilities | every entry `available:false` (no hardware profile selected) |
| `GET /api/settings/categories` default | `{"categories":[]}` |
| RG34XX / Leaf3C / M21 / Desktop | non-empty, capability-specific category lists |
| `PUT /api/settings/display` on RG34XX | `403 capability_unavailable` |
| `PUT /api/settings/display` on Leaf3C | `200`, value persisted |
| Credential-shaped key write | `400 credential_not_allowed`, nothing stored (SQLite scanned) |
| `POST /api/power/shutdown` without confirm | `409 confirmation_required`, no audit row |
| `POST /api/power/shutdown` with `{"confirm":true}` | `503 provider_unavailable`, `performed:false`, audited |
| `GET /api/audit` | `summary.sanitized=true`, `mockOnly=true`, no credential values |
| `GET /api/services` | includes `storaged`, `downloadsd`, `authd`, `syncd`, `mediad`, `notificationd` |
| `GET /api/accounts` | Google, GitHub, Microsoft, Mozilla — all `available:false` |
| `GET /api/sync/providers` | WebDAV, Nextcloud, Syncthing, Git — all `available:false` |
| Unknown route | `404 not_found` |
| Unknown domain | `404 {"error":{"code":"unknown_domain",...}}` |

Persistence was verified by writing settings, terminating `settingsd`, then
restarting against the same SQLite file: the mock hardware profile and audio
settings survived, and `schema_migrations` contained versions 1, 2 and 3.

Read-only host data was verified once with `--allow-system-readonly`: it
returned hostname `hx90`, kernel `6.12.108`, the real CPU/memory and network
interfaces, labelled `mock:false` / `hostProfile:"host"`. That flag performs no
writes.

## UI acceptance (headless Chromium over DevTools protocol)

| Check | Result |
|---|---|
| Keyboard search (`Ctrl+K`, type, arrow, Enter) | opens Display; `ArrowUp/Down` move the cursor |
| `Escape` | returns to Home |
| `ArrowRight` | navigates to the next visible page |
| Keyboard edit | Tab reaches `setting-brightness-input`; arrow keys changed 63→68 and persisted |
| Keyboard toggle | Space toggled `nightMode` false→true and persisted |
| Capability gating | RG34XX nav has no Display/Audio; Leaf3C has Display, no Audio; M21 has Audio; Desktop has Remote/Power |
| Zero horizontal overflow | 320×240, 480×320, 640×480, 720×720, 1920×1080 |
| DPI scaling | `data-dpi` 1 / 1.5 / 2 / 3 applied as computed `zoom` |
| Themes/locales | light/dark/OLED and en/zh-CN/ja render with distinct digests |
| Mock device data | Wi-Fi shows two labelled mock networks on Desktop; M21 Storage shows capacity/health; Desktop (no Storage) shows unavailable |

## Screenshots

28 PNG files, 28 distinct SHA-256 digests, verified against
[SCREENSHOTS.md](SCREENSHOTS.md). The manifest records exact dimensions and
hashes; the check command prints matching counts:

```sh
python3 -c 'import glob,hashlib;f=glob.glob("**/screenshots/*.png",recursive=True);print(len(f),len({hashlib.sha256(open(x,"rb").read()).hexdigest() for x in f}))'
```

## Not performed (by design)

- No HX90 Wi-Fi/Bluetooth/display/audio/SSH/ADB/storage/power/service/account
  modification, no service restart, no shutdown/reboot, no package changes.
- No `nixos-rebuild` or `switch`: Go, Node and Chromium were already declared in
  `~/nixos-config` (`modules/dev.nix` `go`/`nodejs`, `desktop-runtime.nix`
  `chromium`), so no Nix dependency was added and the global lock was not needed.
- PJOS-LINUX source was only read; its untracked `overlay/storage/` remains
  untouched. Commits made there by other parallel work (keyboardd input
  framework) are unrelated to this project.
