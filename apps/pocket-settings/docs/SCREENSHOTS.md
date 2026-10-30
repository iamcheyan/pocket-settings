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
| `accounts-Desktop-dark-en.png` | 1280x720 | `82018cf29fcc2a78a6236c615864fbb1e65ce5be51136397be7cff132f9ceb9d` |
| `audio-Desktop-dark-en.png` | 1280x720 | `1d06341f27256f289967a9d79205d4f354c50fb1fbf472883fb7994465a5655c` |
| `bluetooth-Desktop-dark-en.png` | 1280x720 | `0d554019d883fcfb513e6abff7db46e9005aaac9dcd547f89a03aab96243e007` |
| `developer-Desktop-dark-en.png` | 1280x720 | `a838f10be01b678e424d085ab4c4cdf46484eca1c07b80956d5b4516b26722a3` |
| `display-Desktop-dark-en.png` | 1280x720 | `023891e3a354fa55538057d618ab4e4365970cafebda58cfe8018da107f86bbd` |
| `display-Leaf3C-eink.png` | 1280x720 | `65a94a01b0500c1bf75878cd7627a628922ecde41691921ca416674266d4ca99` |
| `display-light-en-Desktop.png` | 1280x720 | `f646bec7f9c507d715d44e04f9c6b908bdd6c4243ad32abc30ee0114d3ddada3` |
| `display-oled-ja-Desktop.png` | 1280x720 | `c0d99a4fea0c867aead9c522e57966001fba90883abfcea3111f1e741f3b0b74` |
| `home-1920x1080.png` | 1920x1080 | `4159214157bfe48f4087bb77e88e5272bd7962a60791d4676f22cb3ac30af201` |
| `home-320x240.png` | 320x240 | `ab6a9b0932ef62d35b36bd08a2ed250368735494232494d4596e60bb23b78ef5` |
| `home-480x320.png` | 480x320 | `2a218f278b2e77bfba31db48f990781a2639f34b066803c43599755e2cee0ada` |
| `home-640x480.png` | 640x480 | `6282cfae762c4860826e1f20bf803345a787634f85c48bc86fcd713eeefd6f3f` |
| `home-720x720.png` | 720x720 | `a6e93df5039c065e57b29567d8cee4c836dd9b2638de8a3170b54f8747e3c5d9` |
| `home-Desktop-dark-en.png` | 1280x720 | `ae9e199047a73446130365d0a20837f5856c1cfcafbc617708f1d11bef6b2404` |
| `home-handheld-RG34XX.png` | 1280x720 | `515eb44300bd7836348ab89d7d31d50b04b25a0122e8c3f38e7fc186544fa7c5` |
| `home-light-en-Desktop.png` | 1280x720 | `5515dd03098dff1352d8bfd55f0cc3395f40c795fbb517db0423840b2c8fba90` |
| `home-light-zh-CN-Desktop.png` | 1280x720 | `24db42ba90603782bc57d2b98e43cd9bccd22dc91786139dcf7e36f46db5d467` |
| `home-oled-ja-Desktop.png` | 1280x720 | `9237ef98ca095ff75dc6b73ed09eae214eb690773359aa4206d21b258058e5c5` |
| `network-Desktop-dark-en.png` | 1280x720 | `89f7b7e790a1c94ccca90d42d2a241242ebd36e70058d83f9a6184ab91235547` |
| `power-Desktop-dark-en.png` | 1280x720 | `c1bad73454552c34e17c4c4f1bc24ef822163cea19ae8b00e1d4fa2d8fa3be52` |
| `remote-Desktop-dark-en.png` | 1280x720 | `cda0ccdb8b2c0500446e802fdcae18b9faf12e88a5125aec202bd502d831ece5` |
| `services-Desktop-dark-en.png` | 1280x720 | `f4472fa825ab1a7a07a2c5693a9a5a384266ade2f1b40ed4e325093f8765a4a2` |
| `storage-Desktop-dark-en.png` | 1280x720 | `526835c6640f320f0f445fb79d7f288bbf11fadd13290db78825787d5ed49b11` |
| `sync-Desktop-dark-en.png` | 1280x720 | `62c9457dd22b1449c2089357384ad5797df2de7e760bb7905da44f1969103e2d` |
| `system-Desktop-dark-en.png` | 1280x720 | `6ce78e7185de194873e7b73b830d83ef99fa65363fd75ca8425da7805d31521c` |
| `updates-Desktop-dark-en.png` | 1280x720 | `4af6aae7d91487b9a121bd32209cc3bfb1fdd05d2186000373a9d999b0a2b702` |
| `wifi-Desktop-dark-en.png` | 1280x720 | `92a7a5b02584d72c2f0431669d35e66f813a666379b3311f669c43ed5d51256b` |
| `wifi-Leaf3C-dark-en.png` | 1280x720 | `312c8dcc48b5c57e2012874679364e9cf5ae55b1e72be304a39161fbef469106` |


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
