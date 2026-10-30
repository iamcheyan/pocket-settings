# Screenshot manifest

Every image was captured from the running Pocket Settings UI (Vite dev server
against a live `settingsd` using mock providers) with the installed Chromium
152.0.7977.75 in headless mode over the DevTools protocol. The harness is
[`apps/pocket-settings/tests/screenshots.mjs`](../tests/screenshots.mjs): it
navigates the app's URL-driven state (page, hardware mock profile, theme,
locale, viewport), waits for render, and writes the PNG bytes plus
`screenshots/manifest.json`.

**28 PNG files, 28 distinct SHA-256 digests.** PNG signature and IHDR
dimensions were checked with Python; no image is synthetic, cropped from a
different page, or reused. Every hardware/profile/theme/locale below is mock
presentation metadata — no physical capability or service state is implied.

| File | Dimensions | SHA-256 |
|---|---|---|
| `accounts-Desktop-dark-en.png` | 1280x720 | `bb30a0f9ca427efe0a9af7fbe715e45607aa40f7472b8216c03b7acea03cf4fc` |
| `audio-Desktop-dark-en.png` | 1280x720 | `fee7591e44867461bb563960b28ca110ab71bbc384a5af39086c4c985a7c0131` |
| `bluetooth-Desktop-dark-en.png` | 1280x720 | `3a2147bd474bd5170984ee9545c2c37511175a3e0038ef1b3479e80957654aab` |
| `developer-Desktop-dark-en.png` | 1280x720 | `b16eb551f09fcd3c41be903ab164fc0316763bf978143b359b3e9a03846d9ad8` |
| `display-Desktop-dark-en.png` | 1280x720 | `5356d99d1128e3420fdc66034d1368d0bb18c735395d927d43f002ea30e642c0` |
| `display-Leaf3C-eink.png` | 1280x720 | `fb4bb42c4b64810af954dffafdf3d7650d5e77d2a55b435fbbbb4b6172ff4a2a` |
| `display-light-en-Desktop.png` | 1280x720 | `cb008c2e94f1545fc2bd9e590fdae671df98d90853af8b32d50fbedf397eb78b` |
| `display-oled-ja-Desktop.png` | 1280x720 | `37948f87874fe7b6935e6d64a3e77a0fe211db23f726b4d495100ee099077a85` |
| `home-1920x1080.png` | 1920x1080 | `9874aa14799ba7b24db8e53a3eab19bdf535870710f2286333e13046a0de4d77` |
| `home-320x240.png` | 320x240 | `ab6a9b0932ef62d35b36bd08a2ed250368735494232494d4596e60bb23b78ef5` |
| `home-480x320.png` | 480x320 | `2a218f278b2e77bfba31db48f990781a2639f34b066803c43599755e2cee0ada` |
| `home-640x480.png` | 640x480 | `6282cfae762c4860826e1f20bf803345a787634f85c48bc86fcd713eeefd6f3f` |
| `home-720x720.png` | 720x720 | `fdc26d291eb2f9bc2650ed9ee28cfac77dee8e713cb167ae27c3d76f3db1c4e0` |
| `home-Desktop-dark-en.png` | 1280x720 | `2f54b83f3dcb7872aa831f7ca9f1f1676fab6edbe5192c5192d561bef5c652a6` |
| `home-handheld-RG34XX.png` | 1280x720 | `515eb44300bd7836348ab89d7d31d50b04b25a0122e8c3f38e7fc186544fa7c5` |
| `home-light-en-Desktop.png` | 1280x720 | `e2ba55cde6cfd49ed9037d9423391a726af988dd0ba018a9ffc3a1b89b6dbd66` |
| `home-light-zh-CN-Desktop.png` | 1280x720 | `72e55ef3374ea296f50c3dea85daf73e2453b91e97d09ff9d8fe93c81726a081` |
| `home-oled-ja-Desktop.png` | 1280x720 | `1d6d913f03b8aed45c11be315838af3f405ad5f1e181ec25fb0345cee4bc1f0e` |
| `network-Desktop-dark-en.png` | 1280x720 | `4b4af7edaf9d5de3b6c38d9af7350ac9a2d58b5065e0fe05ae497db04308fa07` |
| `power-Desktop-dark-en.png` | 1280x720 | `13ceec750630d9dfb4727df67bbf39ef1aea2fe94c045406759128ec82056006` |
| `remote-Desktop-dark-en.png` | 1280x720 | `911b7fd41b29e3fe1e95b3f27f4f5d09894484bf978a39c2bbf5d13571349012` |
| `services-Desktop-dark-en.png` | 1280x720 | `3336b6820dc8832fcd543a470b0d5a1699cb4548549ff8462692a43efd3f2395` |
| `storage-Desktop-dark-en.png` | 1280x720 | `64de83d244384965d42172ae795c280ad80dff51aef9e174e86f0af201a78f59` |
| `sync-Desktop-dark-en.png` | 1280x720 | `97bbd99135a212329b9d5236bb7330e5d77bf4e6aae9e84e11bbde9ebb867b01` |
| `system-Desktop-dark-en.png` | 1280x720 | `b3132f6d96f6422bcd7a8c59e9d5239fb3c84d73226caf8048b4685c00b33f9a` |
| `updates-Desktop-dark-en.png` | 1280x720 | `93c14b47d0fc767e680ba813e3dacb6ee6273f3a5aa15a12d551d2143b5ee40a` |
| `wifi-Desktop-dark-en.png` | 1280x720 | `54c80b77e3b7bf556d3bc9134e6d05ba5bee10ca4172773c93613067c85d22c7` |
| `wifi-Leaf3C-dark-en.png` | 1280x720 | `ba12606b258eda4b025bb8a29c99fa2f6da2a9491b49b8deb046787f40c94ca8` |


## Coverage

- Pages: Home, Display, Audio, Network & Ethernet, Wi-Fi, Bluetooth, Remote
  Access, Storage, Accounts, Sync, Updates, Power, Developer, System Info,
  Services (15 distinct page captures).
- Themes: light, dark, and OLED captures; the app also offers System.
- Locales: English, Simplified Chinese, Japanese (each rendered in its own
  capture: `home-light-zh-CN-Desktop`, `home-oled-ja-Desktop`).
- UI profile/hardware mock: Desktop and RG34XX handheld; Leaf3C E-Ink display
  and Wi-Fi pages.
- Viewports: 320×240, 480×320, 640×480, 720×720, 1280×720, 1920×1080.

## Reproduction

```sh
# terminal 1 — backend
cd apps/pocket-settings/backend/settingsd
SETTINGS_ADDR=127.0.0.1:8090 SETTINGS_DB=/tmp/pocket-settings.sqlite go run .

# terminal 2 — frontend
cd apps/pocket-settings/frontend
POCKET_SETTINGS_API=http://127.0.0.1:8090 npm run dev -- --host 127.0.0.1 --port 15175

# terminal 3 — captures + uniqueness check
POCKET_SETTINGS_URL=http://127.0.0.1:15175 node apps/pocket-settings/tests/screenshots.mjs
python3 -c 'import glob,hashlib;f=glob.glob("**/screenshots/*.png",recursive=True);print(len(f),len({hashlib.sha256(open(x,"rb").read()).hexdigest() for x in f}))'
```

The final command must print two equal numbers; the recorded run printed
`28 28`.
