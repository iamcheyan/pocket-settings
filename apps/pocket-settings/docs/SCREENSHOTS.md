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
| `accounts-Desktop-dark-en.png` | 1280x720 | `9f99723453477e73c354a756cd6a98024512a16ec0c17ecedfa9a5022eb33f72` |
| `audio-Desktop-dark-en.png` | 1280x720 | `c175b874f1deeb1a415368aa16280df10833be4a54bdbac2a3fa458bd6c40446` |
| `bluetooth-Desktop-dark-en.png` | 1280x720 | `845017bbdd3e25d5cdb0fb46a774b3b1a68266f963fa1a03cd4871770de75a6c` |
| `developer-Desktop-dark-en.png` | 1280x720 | `950c1ffe3c4fbbd1016e22ef85f9580453179e7a4a0c48fa2d015596a9dbf271` |
| `display-Desktop-dark-en.png` | 1280x720 | `99464d2d9d8da2b6a6aaf9b9a5e5b2f364c1202ff93b587be91e5b62be3cafbc` |
| `display-Leaf3C-eink.png` | 1280x720 | `987da1659ba31321a7c8d1f4095d02a2434d8873e4272ede0b9d181a3ad76b1f` |
| `display-light-en-Desktop.png` | 1280x720 | `80c12f074d22b8ffe9321c36fb468093e9f280686a548f83847453fabd904fdd` |
| `display-oled-ja-Desktop.png` | 1280x720 | `0b0ff0ad0c89a0b1be90880108554a5d5b52f842fa440a4c6ea4361742bf36b9` |
| `home-1920x1080.png` | 1920x1080 | `63f24e9bace17291b0e61688e042ba96481b6c8cc3d0e924259b21be8de150ba` |
| `home-320x240.png` | 320x240 | `ef3a9321469c632a7e91162558d213cd1c5a1fda6c7d508e0c59be072756028c` |
| `home-480x320.png` | 480x320 | `361bac425db63bb351f20fe2238f6d315a682d08b15aad9ccd09fa496d060ff7` |
| `home-640x480.png` | 640x480 | `78b0f6d212341cb364ee09fd63fd160224d27ea6685b8253c088bef03dfcb5dd` |
| `home-720x720.png` | 720x720 | `045d9b4c647a23822ec56bc3c9dba7b41d8d4c741746ae8bb5cddb60fe9035c3` |
| `home-Desktop-dark-en.png` | 1280x720 | `fc8b123de9da4cd976df9fd4744cea45166fcdd5c5de7ed4d7233da83f65fc30` |
| `home-handheld-RG34XX.png` | 1280x720 | `919d27ab3f11be0cc372bde0b9add22f60d51a689a0f101284bd8bf9cb7caa52` |
| `home-light-en-Desktop.png` | 1280x720 | `e46ba8754636e91cabdb3b8baa4f93a50b1cb37ef102fefaf47aaa6394ea38e2` |
| `home-light-zh-CN-Desktop.png` | 1280x720 | `4a81861342690a222ebac5aacf37f1c26cddf9e214b2172258cee6444c037666` |
| `home-oled-ja-Desktop.png` | 1280x720 | `c40bc5ea52be6151c38138bfe3cca0b58dbe93b38298d8ffec49c9490b85a9be` |
| `network-Desktop-dark-en.png` | 1280x720 | `de8b93025364de023649b6a8e81bdd6b8e1f1dee87cbf1081c3da6cc630befb7` |
| `power-Desktop-dark-en.png` | 1280x720 | `cb9957b8da164329f384515179c23a9b74af52ef994940d1cb0f80f72a23a40e` |
| `remote-Desktop-dark-en.png` | 1280x720 | `12588d1fe45fc440a50115b5005451110ffd84521fea101028a7439715f59961` |
| `services-Desktop-dark-en.png` | 1280x720 | `391bff2305c2f66d1c0df7880c99155410e3234ec28d3725329dc475b5c74e78` |
| `storage-Desktop-dark-en.png` | 1280x720 | `f9ba0ec07e7ea994a9f302b3f5b96fc92898ba33766c873f0a492c09641181c1` |
| `sync-Desktop-dark-en.png` | 1280x720 | `7de5cbc51dc06636dd9459cbdfd05e79fc3d092c60442a9cf1b34f61c360a293` |
| `system-Desktop-dark-en.png` | 1280x720 | `9b5610bb977025f3327cca49415d765576e41cb340eddfab105fb18f84867bbc` |
| `updates-Desktop-dark-en.png` | 1280x720 | `53b7c219348d2a428e74961cf988ff4a18c3e8f388df27161664d71f9cef2e69` |
| `wifi-Desktop-dark-en.png` | 1280x720 | `4a1a23d871ee8915a2ed927aaf3132373eb60ecbd40e432e0788f03f49d3181d` |
| `wifi-Leaf3C-dark-en.png` | 1280x720 | `77e1ee22d8537362e0dabb57eeb51e80b89b90781137268564d0a7368338915b` |


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
