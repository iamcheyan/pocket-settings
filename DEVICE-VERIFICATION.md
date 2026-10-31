# DEVICE VERIFICATION — pocket-settings

Status: **DEVICE-PASS** for the captured states. Local host verification is in
`apps/pocket-settings/POCKETJS-VERIFICATION.md`.

## Device

- Anbernic RG34XX, Base OS 1.5.2 (h700), kernel 4.9.170 aarch64.
- Access: Debian host -> HX90 -> USB ADB.
- Display: `/dev/fb0`, 720x480 visible page, 32 bpp.
- Runtime: `/mnt/sdcard/System/pocketjs/bin/pocket-linux-kms` (existing boot runtime, not rebuilt or replaced).
- Package: `pocket-settings` sha256 `ab81b33c1f4a400c3362484b4ba963306ec4af926826df03082ff65fc514c8fe`.
- Deployed to `/storage/pjs/pocket-settings/app.pocket` only.

## Procedure

1. Recorded boot launcher pid `17123` and `boot.pocket`
   sha256 `6ed41612bce1723d1eda64b5a0ee9333a105ed498b7085c03267539cf6c1b32d`.
2. Paused the launcher supervisor, stopped the launcher, and started the
   package with the same runtime and `/dev/fb0`.
3. Created a virtual keyboard with `/dev/uinput` and drove the native view
   tree through a FIFO (`uinputd-c`); no host browser and no HTML.
4. Captured `/dev/fb0` with `dd` -> base64 -> PIL.
5. Killed the package, restored the launcher, and read the pid
   `17713` and boot hash back.

Result: launcher pid changed, boot package sha256 stayed
`6ed41612bce1723d1eda64b5a0ee9333a105ed498b7085c03267539cf6c1b32d`. No write to `/storage/System`, `/storage/pocketjs`,
`/storage/baseos.conf` or `/storage/content`.

## Frames

The images are the device framebuffer. The UI was rasterized by the PocketJS
native renderer on the RG34XX, not by host Chrome.

| file | sha256 (first 16) |
|---|---|
| `docs/device/device-settings-detail-action.png` | `5810d81f69eba773` |
| `docs/device/device-settings-detail.png` | `1a30ecfd712a03f7` |
| `docs/device/device-settings-fb-after.png` | `d59130e3329b8496` |
| `docs/device/device-settings-fb-before.png` | `d59130e3329b8496` |
| `docs/device/device-settings-home-focus.png` | `173aa7f0c83fbd8d` |
| `docs/device/device-settings-home.png` | `946e80068b761f4b` |
| `docs/device/device-settings-settings-toggled.png` | `e418096cab924cd8` |
| `docs/device/device-settings-settings.png` | `d66bb95d7ee6f2c1` |

`device-settings-fb-before.png` and `device-settings-fb-after.png` are the boot
launcher before and after; they are byte-identical here, which is the intended
restore evidence.

Captured states: 6 states: home, focus, detail, detail action, settings, settings toggle.
