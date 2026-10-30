# Settings and capabilities

## Capability contract

Every capability reports:

```json
{ "available": false, "enabled": false, "controllable": false,
  "source": "mock", "reason": "Not present on selected mock hardware profile" }
```

- `available` — the active provider/profile reports the feature exists.
- `enabled` — current state as reported (not a permission).
- `controllable` — an authorized provider could change it. **All values are
  currently `false`**; mock metadata never grants control.
- `source` — where the report came from (`mock` today).
- `reason` — why something is missing or limited. Missing capabilities are
  reported with a reason, never silently dropped.

Required capability IDs: Battery, Brightness, Audio, Touchscreen, SSH, ADB, USB,
SDCard, EInk, Ethernet, PowerManagement, DisplayRotation, WiFi, Bluetooth,
Storage, Display — plus every settings domain. All are always present in
`GET /api/capabilities`.

## Two independent profile concepts

| Concept | Controls | Values |
|---|---|---|
| Hardware mock profile | Which capabilities a fixture claims | RG34XX, RG35XX, RG40XX, CubeXX, M21, Leaf3C, Desktop |
| UI profile | Layout density and navigation only | Same name list |

A UI profile change never alters capability data or category visibility
(covered by a Go test). No hardware profile selected ⇒ capabilities and
categories are empty/unavailable.

## Fixtures

| Profile | Capabilities |
|---|---|
| RG34XX | WiFi, Bluetooth, Battery, SDCard, USB |
| RG35XX | WiFi, Bluetooth, Battery, SDCard |
| RG40XX | WiFi, Bluetooth, Battery, SDCard |
| CubeXX | WiFi, Bluetooth, Battery, SDCard |
| M21 | Audio, Bluetooth, Battery, Storage |
| Leaf3C | EInk, Touchscreen, Battery, WiFi |
| Desktop | WiFi, Bluetooth, Ethernet, Audio, Display, SSH, PowerManagement |

## Domains and controls

| Domain | Controls exposed |
|---|---|
| Display | brightness, scaling, DPI (1x/1.5x/2x/3x), rotation, resolution, color temperature, night mode, auto brightness, timeout; E-Ink-only refresh rate, full-refresh frequency, A2, grayscale, contrast (shown only when `EInk` is available) |
| Audio | volume, mute, input, output, default device, audio test |
| Network | hostname, DNS, proxy, Ethernet enable; separate Wi-Fi page with scan/saved networks/credentials fields |
| Wi-Fi | scan, available/saved networks, connect/disconnect/forget, IP/hostname/DNS/proxy/gateway/netmask/MAC (mock; actions refused without provider) |
| Bluetooth | paired/nearby devices with audio/input typing, pair/forget/reconnect (mock) |
| Remote | SSH/ADB/SFTP/remote-terminal endpoint, port, last-reported state, copy-command; explicitly read-only |
| Storage | Internal/TF-A/TF-B/USB devices with capacity, free/used, filesystem, mount, read-only, health; no format or mount UI action |
| Accounts | Google, GitHub, Microsoft, Mozilla cards with availability/reason, switch/sign-out |
| Sync | WebDAV, Nextcloud, Syncthing, Git profiles + config editor |
| Updates | check/install/rollback/history; install remains mock/unavailable |
| Power | battery level/status/health/charging, sleep/suspend/shutdown timer controls |
| Developer | developer mode, ADB, debug logs, performance overlay, runtime info, service status, environment, audit summary, API inspector, profile overrides |
| System | device/PJOS/Linux/kernel/arch/CPU/memory/storage/display/network, separating mock hardware profile from real read-only host profile |

Settings are JSON objects per domain. Reads merge the active profile override
(override wins). Writes persist only when the domain capability is available;
otherwise the backend returns `403 capability_unavailable`.

## Safety and persistence

- The frontend talks only to `settingsd`; no shell, SQLite, or hardware access.
- Capability checks are enforced server-side, not merely by disabled controls.
- Dangerous operations require `{"confirm":true}`; without it the backend
  returns `409 confirmation_required` and writes no audit entry. Confirmed
  actions are audited and still refused without a provider
  (`503 provider_unavailable`, `performed:false`).
- Audit details are recursively redacted (`password`, tokens, secrets,
  `*_key`, etc.).
- Credentials have no storage: settings and override writes reject
  credential-shaped keys (`400 credential_not_allowed`, nested paths included)
  before anything reaches SQLite. A future encrypted CredentialStore is needed
  before credential storage exists.
- Mock state is labelled in the UI and auditable. A stored preference is not
  proof any hardware accepted it.
- HX90 is a development host, never a target for real system-setting writes.
