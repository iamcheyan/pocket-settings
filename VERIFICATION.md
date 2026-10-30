# Verification — pocket-settings @ 2026-10-31

- Verdict: PASS
- Commit: `__COMMIT__` (fixes + screenshots; this document is the following commit)
- Remote: `__REMOTE__`
- Runtime: `settingsd` on `127.0.0.1:8090` (fresh temp SQLite, mock capability providers) + Vite `127.0.0.1:15173`; `make build` production bundle
- Toolchain: go 1.26.0, node v22.23.3, Chrome 155.0.8059.84

## Test gate
| command | result | notes |
|---|---|---|
| `node scripts/check-i18n.mjs` | PASS | 3 locales × 405 keys |
| `go test ./...` | PASS | 30 settingsd tests, 0 failures |
| `npm run build` | PASS | `tsc -b && vite build` |
| `node scripts/ui-smoke.mjs` | PASS | keyboard-only real-browser walk: dark/en Overview → light/ja 概要, no console errors |

`make test` runs all four gates (it also boots a temporary settingsd + Vite on
18091/15174, selects the mock Desktop profile and runs the smoke walk); green.

## Runtime
Health `{"status":"ok"}`. The URL contract drives every capture
(`?page=…&hardware=…&theme=…&locale=…`); hardware profiles are the documented mock
capability sets (Desktop, RG34XX, RG40XX, Leaf3C), and no real system write is claimed or
performed. The UI renders all 15 settings pages, 3 themes (dark/light/OLED), 3 locales and
6 viewport sizes.

## Screenshot matrix
All 28 images were regenerated this run by the repo harness
`apps/pocket-settings/tests/screenshots.mjs` (raw DevTools protocol, system Chrome) against
the live stack; `manifest.json` was rewritten with the new hashes.

| screen | viewport | file | note |
|---|---|---|---|
| home | 1280×720 | `apps/pocket-settings/docs/screenshots/home-Desktop-dark-en.png` | sha256 fc8b123de9da4cd9 |
| display | 1280×720 | `apps/pocket-settings/docs/screenshots/display-Desktop-dark-en.png` | sha256 99464d2d9d8da2b6 |
| audio | 1280×720 | `apps/pocket-settings/docs/screenshots/audio-Desktop-dark-en.png` | sha256 c175b874f1deeb1a |
| network | 1280×720 | `apps/pocket-settings/docs/screenshots/network-Desktop-dark-en.png` | sha256 de8b93025364de02 |
| wifi | 1280×720 | `apps/pocket-settings/docs/screenshots/wifi-Desktop-dark-en.png` | sha256 4a1a23d871ee8915 |
| bluetooth | 1280×720 | `apps/pocket-settings/docs/screenshots/bluetooth-Desktop-dark-en.png` | sha256 845017bbdd3e25d5 |
| remote | 1280×720 | `apps/pocket-settings/docs/screenshots/remote-Desktop-dark-en.png` | sha256 12588d1fe45fc440 |
| storage | 1280×720 | `apps/pocket-settings/docs/screenshots/storage-Desktop-dark-en.png` | sha256 f9ba0ec07e7ea994 |
| accounts | 1280×720 | `apps/pocket-settings/docs/screenshots/accounts-Desktop-dark-en.png` | sha256 9f99723453477e73 |
| sync | 1280×720 | `apps/pocket-settings/docs/screenshots/sync-Desktop-dark-en.png` | sha256 7de5cbc51dc06636 |
| updates | 1280×720 | `apps/pocket-settings/docs/screenshots/updates-Desktop-dark-en.png` | sha256 53b7c219348d2a42 |
| power | 1280×720 | `apps/pocket-settings/docs/screenshots/power-Desktop-dark-en.png` | sha256 cb9957b8da164329 |
| developer | 1280×720 | `apps/pocket-settings/docs/screenshots/developer-Desktop-dark-en.png` | sha256 950c1ffe3c4fbbd1 |
| system | 1280×720 | `apps/pocket-settings/docs/screenshots/system-Desktop-dark-en.png` | sha256 9b5610bb977025f3 |
| services | 1280×720 | `apps/pocket-settings/docs/screenshots/services-Desktop-dark-en.png` | sha256 391bff2305c2f66d |
| home | 1280×720 | `apps/pocket-settings/docs/screenshots/home-handheld-RG34XX.png` | sha256 919d27ab3f11be0c |
| home | 1280×720 | `apps/pocket-settings/docs/screenshots/home-light-en-Desktop.png` | sha256 e46ba8754636e91c |
| home-light | 1280×720 | `apps/pocket-settings/docs/screenshots/home-light-zh-CN-Desktop.png` | sha256 4a81861342690a22 |
| home | 1280×720 | `apps/pocket-settings/docs/screenshots/home-oled-ja-Desktop.png` | sha256 c40bc5ea52be6151 |
| display | 1280×720 | `apps/pocket-settings/docs/screenshots/display-light-en-Desktop.png` | sha256 80c12f074d22b8ff |
| display | 1280×720 | `apps/pocket-settings/docs/screenshots/display-oled-ja-Desktop.png` | sha256 0b0ff0ad0c89a0b1 |
| display | 1280×720 | `apps/pocket-settings/docs/screenshots/display-Leaf3C-eink.png` | sha256 987da1659ba31321 |
| wifi | 1280×720 | `apps/pocket-settings/docs/screenshots/wifi-Leaf3C-dark-en.png` | sha256 77e1ee22d8537362 |
| home | 320×240 | `apps/pocket-settings/docs/screenshots/home-320x240.png` | sha256 ef3a9321469c632a |
| home | 480×320 | `apps/pocket-settings/docs/screenshots/home-480x320.png` | sha256 361bac425db63bb3 |
| home | 640×480 | `apps/pocket-settings/docs/screenshots/home-640x480.png` | sha256 78b0f6d212341cb3 |
| home | 720×720 | `apps/pocket-settings/docs/screenshots/home-720x720.png` | sha256 045d9b4c647a2382 |
| home | 1920×1080 | `apps/pocket-settings/docs/screenshots/home-1920x1080.png` | sha256 63f24e9bace17291 |

Count: 28 screenshots, 28 unique hashes (0 duplicates). `tools/check_shots.py`: all PNGs valid,
dimensions match, minimum per-image RGB stddev above the blank threshold (no blank frames).
`docs/SCREENSHOTS.md` hash column was refreshed from this run's manifest.

Runtime probe (`tools/probe.mjs`) on `?page=home&hardware=Desktop&theme=dark&locale=en` at
1280×720 and 480×320: HTTP 200, non-empty document, no console/page errors, no failed or
4xx/5xx requests, no horizontal overflow.

## Fixed
- `make test` failed immediately on this host: both browser scripts spawned the literal binary
  `chromium`, which does not exist on Debian (`spawn chromium ENOENT`). The harness ignored
  `CHROME_PATH` and only honoured `CHROMIUM`. → resolve the binary from
  `CHROMIUM`/`CHROME_PATH` and fall back to `/usr/bin/google-chrome`, `/usr/bin/chromium`,
  `/usr/bin/chromium-browser`, `/run/current-system/sw/bin/chromium`, failing with a clear
  error when none exists → `apps/pocket-settings/frontend/scripts/ui-smoke.mjs` and
  `apps/pocket-settings/tests/screenshots.mjs` → `make test` now passes and the 28-shot
  capture runs unchanged.
- Every page logged a console 404 for `/favicon.ico`. → added
  `apps/pocket-settings/frontend/public/favicon.svg` plus the `<link rel="icon">` in
  `index.html`; probe is now clean at both viewports.

## Blocked / open questions
- Wi-Fi/Bluetooth/storage/accounts/sync/updates/power/services remain intentionally mock and
  non-controllable (`503 provider_unavailable` after confirmation); this is the documented
  product boundary, not a regression.

## Not verified here
- 掌机真机（RG34XX / PJOS-LINUX）未验证；本轮只在本机 headless Chrome 里跑真实进程。
- Real system settings writes, real hardware capability detection, real PJOS service clients.
