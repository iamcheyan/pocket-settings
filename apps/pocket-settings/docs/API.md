# HTTP API

`settingsd` serves JSON on `127.0.0.1:8090` by default. Environment overrides:

| Variable | Effect |
|---|---|
| `SETTINGS_ADDR` | Listen address |
| `SETTINGS_DB` | SQLite path (`:memory:` allowed) |

Flags (default off; no write path exists even when enabled):

| Flag | Effect |
|---|---|
| `--allow-system-readonly` | `GET /api/system/info` may include real read-only host details (`provider:"host-readonly"`, `mock:false`); no writes |
| `--allow-system-control` | Gated privileged actions report `501 system_control_not_implemented` instead of `503`; nothing is executed |

Errors use `{"error":{"code":"...","message":"..."}}` with an HTTP status.
`404 unknown_domain`, `400 invalid_json`/`invalid_profile`/`invalid_settings`,
`403 capability_unavailable`, `409 confirmation_required`,
`503 provider_unavailable`, `501 system_control_not_implemented`.

## Capabilities and profiles

| Method and path | Behaviour |
|---|---|
| `GET /api/health` | Database-backed health check |
| `GET /api/capabilities` | `hardwareProfile`, `uiProfile`, `capabilities`, `requiredCapabilities` |
| `PUT /api/capabilities/profile` | `{"hardwareProfile":"…"}` selects a **mock** hardware fixture; `{"profile":"…"}` sets the **UI** layout profile. They are independent. |
| `POST /api/mock/profile` | Legacy alias for selecting a mock hardware profile |
| `GET /api/preferences`, `PUT /api/preferences` | UI preferences (`theme`, `locale`, `density`, `uiProfile`) |
| `PUT /api/preferences/profile` | UI profile only |

Every capability ID (`Battery`, `Brightness`, `Audio`, `Touchscreen`, `SSH`,
`ADB`, `USB`, `SDCard`, `EInk`, `Ethernet`, `PowerManagement`,
`DisplayRotation`, `WiFi`, `Bluetooth`, `Storage`, `Display`) and every settings
domain is always present with
`{available, enabled, controllable, source, reason}`. Unsupported entries are
`available:false` with a reason. `source` is `mock`. No entry is
`controllable` — mock metadata never grants control. UI profile changes do not
alter capability data.

Mock hardware fixtures:

| Profile | Capabilities |
|---|---|
| RG34XX | WiFi, Bluetooth, Battery, SDCard, USB |
| RG35XX / RG40XX / CubeXX | WiFi, Bluetooth, Battery, SDCard |
| M21 | Audio, Bluetooth, Battery, Storage |
| Leaf3C | EInk, Touchscreen, Battery, WiFi |
| Desktop | WiFi, Bluetooth, Ethernet, Audio, Display, SSH, PowerManagement |

## Settings

| Method and path | Behaviour |
|---|---|
| `GET /api/settings/categories` | Categories the current capability set exposes |
| `GET /api/settings/{domain}` | Domain JSON object, merged with the active profile override (override wins; `X-Settings-Override-Profile` header) |
| `PUT /api/settings/{domain}` | Persists the object; `403` when the category is unavailable |
| `GET /api/settings/{domain}/overrides` | All overrides for a domain plus `activeProfile` |
| `GET /api/settings/{domain}/overrides/{profile}` | One profile override |
| `PUT /api/settings/{domain}/overrides/{profile}` | Stores an override (capability-gated) |
| `DELETE /api/settings/{domain}/overrides/{profile}` | Removes an override (capability-gated) |

Domains: `display`, `audio`, `network`, `storage`, `remote`, `accounts`,
`sync`, `updates`, `power`, `developer`, `system`.

## Device and service surfaces

| Method and path | Behaviour |
|---|---|
| `GET /api/system/info` | Mock/unavailable by default; with `--allow-system-readonly`, real read-only host summary labelled `hostProfile:"host"` |
| `GET /api/network/wifi/scan` (`POST` accepted) | `available:false` + reason without a provider |
| `POST /api/network/wifi/connect\|disconnect\|forget` | `403` without `WiFi` capability; otherwise `{mock:true,performed:false}` |
| `GET /api/bluetooth/devices` | Device list or unavailable reason |
| `POST /api/bluetooth/pair\|forget\|connect\|disconnect` | Capability-gated mock result |
| `GET /api/storage/devices` | Storage device list or unavailable reason |
| `POST /api/storage/mount\|unmount\|format` | Mock result; `format` additionally requires `confirm:true` |
| `GET /api/accounts` | Account list or unavailable reason |
| `POST /api/accounts/logout\|switch\|login\|delete` | Capability-gated; `delete` requires `confirm:true` |
| `GET /api/sync/providers` | Sync providers or unavailable reason |
| `PUT /api/sync/config` | Capability-gated mock acceptance |
| `GET /api/updates` | Update status/history or unavailable reason |
| `POST /api/updates/check\|install\|rollback` | Capability-gated; `install`/`rollback` require `confirm:true` |
| `GET /api/services` | Service rows (`wifi`, `bluetooth`, `ssh`, `updates`, `storaged`, `downloadsd`, `authd`, `syncd`, `mediad`, `notificationd`) with status/source/`mock` |
| `POST /api/services/{id}/restart` | Mock-only; requires `confirm:true` |
| `GET /api/search?q=` | Pages, setting keys (with values) and capability names, filtered by capability |
| `GET /api/audit` | Redacted `entries`, `summary` (`total`, `dangerous`, `confirmed`, `rejected`, `byAction`, `byDomain`, `lastEventAt`, `sanitized`, `mockOnly`), `dangerousActions` |

## Dangerous-action policy

`power/shutdown`, `power/reboot`, `system/factory-reset`, `updates/install`,
`updates/rollback`, `accounts/delete`, `storage/format`, `remote/start` and
`services/{id}/restart` require an explicit `{"confirm":true}`.

1. Missing confirmation → `409 confirmation_required`, **no audit entry**.
2. Confirmed with no provider → `503 provider_unavailable` with
   `performed:false`, audited.
3. With `--allow-system-control` → `501 system_control_not_implemented`,
   audited. No privileged OS command is ever executed.

Audit details pass through recursive redaction: `password`,
`passwd`, `token`, `access_token`, `refresh_token`, `secret`, `api_key`,
`apikey`, `credential`, `authorization`, and any key containing `password`,
`passwd`, or ending in `_token`, `_secret`, `_key` become `[REDACTED]`.
Credentials must never be placed in settings JSON; an encrypted
CredentialStore is future work.
