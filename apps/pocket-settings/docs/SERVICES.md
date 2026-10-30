# Services, providers, and Launcher migration

## Current status (evidence: `backend/settingsd/main.go`)

| Service / provider | Implementation | Real integration |
|---|---|---|
| `settingsd` + SQLite | Local API, persistence, overrides, audit | Implemented |
| `wifi` | Status row `unavailable`, `source=mock`; scan returns unavailable + reason | None |
| `bluetooth` | Status row `unavailable`; device list empty + reason | None |
| `storaged` | Status row `unavailable`; device discovery unavailable | None |
| `authd` | Status row `unavailable`; account list unavailable | None |
| `syncd` | Status row `unavailable`; provider list unavailable | None |
| `downloadsd` | Status row `unavailable` | None |
| `mediad` | Status row `unavailable` | None |
| `notificationd` | Status row `unavailable` | None |
| `updates` | Status row `unavailable`; actions refused | None |
| `ssh` | Status row `unavailable`; read-only endpoint reporting | None |

All writes (`wifi connect/disconnect`, bluetooth pair/forget, mount/unmount,
account login/logout/switch, sync config/run, update check, service restart)
are capability-gated mock results (`{mock:true, performed:false}`) or refusals.
Dangerous actions require `confirm:true` and are audited; nothing executes.
An absent service row makes its provider domain unavailable, so the UI cannot
invoke it.

The System Info page distinguishes a mock hardware profile from a real
read-only host profile. Host details appear only with `--allow-system-readonly`
and are labelled `provider:"host-readonly"`.

## Mock hardware fixtures

| Profile | Capabilities | Purpose |
|---|---|---|
| RG34XX | WiFi, Bluetooth, Battery, SDCard, USB | Handheld baseline |
| RG35XX / RG40XX / CubeXX | WiFi, Bluetooth, Battery, SDCard | Handheld variants |
| M21 | Audio, Bluetooth, Battery, Storage | Digital audio player |
| Leaf3C | EInk, Touchscreen, Battery, WiFi | E-Ink reader |
| Desktop | WiFi, Bluetooth, Ethernet, Audio, Display, SSH, PowerManagement | Desktop/host |

These are fixture metadata, not detected hardware.

## BaseOS / Launcher compatibility matrix

Investigation was read-only against `/home/tetsuya/development/PJOS-LINUX`
(including the untracked `overlay/storage/`). No file there was modified.
**BaseOS contains no settings UI of its own**; its README directs users to edit
`baseos.conf` on TF1 and restart. NextUI is described as a supported frontend,
but its menu/persistence code is not in the inspected repository — so no claim
is made about NextUI's own settings UI.

| Existing entry | Original mechanism (evidence) | Pocket Settings target | Status |
|---|---|---|---|
| Hostname | `hostname` in TF1 `baseos.conf`; `baseos-config` validates, writes `/run/hostname`, `/run/hosts`, calls `/bin/hostname` at boot | Network page `hostname` field + `PUT /api/settings/network` | **Adapted (stored preference only; no BaseOS writer)** |
| mDNS | `mdns=true/false` in `baseos.conf`; Avahi publishes via `baseos-mdns` | Network preference field | **Adapted (preference only)** |
| Root SSH password | `ssh_password` cleartext on TF1; hashed by `mkpasswd` into runtime `/run/shadow` | Remote page present; no credential write | **Not migrated (requires encrypted CredentialStore)** |
| Headphone pop fix | `headphone_pop_fix` in `baseos.conf`; module applied before frontend | Audio preference | **Adapted (preference only)** |
| Timezone / NTP | `overlay/usr/bin/timedatectl` `show`, `set-timezone`, `set-ntp`, boot `apply`; persists under `/data` | System page timezone; NTP state read-only | **Adapted (preference only)** |
| Bluetooth service | `setBluetooth.sh` (`init/enable/all/restart`) and `systemctl` compatibility wrapper | Service dashboard + Bluetooth page | **Adapted (mock status only)** |
| Wi-Fi service | BaseOS brings up `wlan0`; frontend associates; wrapper stops/waits for `wpa_supplicant` | Network/Wi-Fi pages | **Adapted (mock status only)** |
| Boot MENU action | `boot-menu-held` reads MENU GPIO; enters USB-storage maintenance mode | None | **Out of scope (hardware boot action)** |
| NextUI settings menu | Not present in inspected repository | N/A | **Unknown — not asserted** |

### Non-regression policy

1. PJOS-LINUX is unmodified; all existing entrypoints (`baseos.conf`, `timedatectl`,
   service wrappers, boot MENU behaviour) keep working.
2. Pocket Settings is additive: it stores its own preferences and never rewrites
   `baseos.conf`, `/run/shadow`, `/data`, service units, or GPIO state.
3. A feature counts as migrated only when a real provider/API exists **and** the
   old path has an explicitly authorized transition. Today only preference
   capture is implemented; runtime integration remains future work.
4. The Launcher UI is not changed by this project.
