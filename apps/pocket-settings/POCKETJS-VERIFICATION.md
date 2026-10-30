# POCKETJS VERIFICATION — pocket-settings

Round: PocketJS refactor. Device acceptance is a later pass.

## Shape

- Pocket app: `apps/pocket-settings/pocket/`
- Frozen React reference: `apps/pocket-settings/frontend/` (design reference; not extended).
- TSX files in the port: **6** (`main.tsx`, `app.tsx`, `ui.tsx`, three screens).
- Native tree only: `View`/`Text` from `@pocketjs/framework/solid/components`; no DOM, iframe, texture screenshot, or `dangerouslySetInnerHTML`.

## Manifest

- id: `dev.pocket-settings.pocket`
- entry: `src/main.tsx`
- output: `pocket-settings`
- viewport: `360×240 @2x` → physical `720×480`
- capabilities: `text.glyphs.baked`, `input.buttons`
- target: `rocknix-h700-kms`

## Admission / compile

```sh
cd apps/pocket-settings/pocket
./setup-sdk.sh
SDK=${POCKETJS_SDK:-$HOME/development/.pocketjs-star-drift-sdk}
bun "$SDK/tools/pocket.ts" check \
  --runtime-config "$POCKET_VERIFY/pjs/profiles/pocket.runtime-config.ts" \
  --target rocknix-h700-kms --manifest pocket.json
bun "$SDK/tools/pocket.ts" compile \
  --runtime-config "$POCKET_VERIFY/pjs/profiles/pocket.runtime-config.ts" \
  --target rocknix-h700-kms --manifest pocket.json --output out.pocket
```

Admission: `sha256:842466c38cc8af474ee9baf7be4e02b0089a99bff427fcdcd125e6efc721676d`; TypeScript passes for the app module graph. Package: `out.pocket`, sha256 `7b8209ed497c2f6d99b85e440fb3723b2563237f7dbac3271001bbec55a39ab4`.

## Frames

Rendered with the SDK wasm core at `renderScaled(2)` (720×480), not a browser:

```sh
cd "$POCKET_VERIFY"
bun tools/render-pocket.ts \
  --dir repos/pocket-settings/apps/pocket-settings/pocket \
  --script repos/pocket-settings/apps/pocket-settings/pocket/frames.json \
  --out repos/pocket-settings/docs/pocket
```

| file | state | sha256 (first 16) |
|---|---|---|
| `docs/pocket/screen-home.png` | home | `58c23b64e8af8757` |
| `docs/pocket/screen-home-focus.png` | home-focus | `2c01be0e5791c53b` |
| `docs/pocket/screen-detail.png` | detail | `9ddd0f2dffcc27aa` |
| `docs/pocket/screen-detail-action.png` | detail-action | `23b2593da6e2f46c` |
| `docs/pocket/screen-settings.png` | settings | `166c451096dbcc9c` |
| `docs/pocket/screen-settings-toggled.png` | settings-toggled | `a3b2e6ead4a444b1` |

All six files have distinct bytes; the renderer rejects duplicate frames. The
tape is: move focus, open the item, run the first detail action, switch to
settings, move a row, toggle it.

Screens: Capability cards, domain detail, UI preferences. Interactions: CIRCLE opens a domain; APPLY reports provider_unavailable; PROFILE/AUDIT update the visible state.

## Adapter

- **fixture** — this port runs from JSON baked into the package and labels the
  header `fixture`. `client.ts` also contains the `http` and `bridge` adapters
  behind the same `list()/get()/action()` surface.
- `http` uses `@pocketjs/framework/net-api`; valid only in the host dev profile.
- `bridge` uses `host.__pvc(JSON.stringify(request))`; the runtime forwards to
  the Go daemon on `127.0.0.1:<port>` with a hard timeout.
- Device gap: settingsd bridge (GET/PUT /api/settings/:domain, services, audit). Real system writes are mock/unavailable by design.
- Daemon contract: /api/capabilities, /api/settings/*, /api/services; source=mock.

## Not done / open questions

- Device run, saves/annotations and the bridge itself are out of this round.
- Real media/audio, OAuth, emulator, engine and system writes stay unimplemented
  where the original product already marked them mock or unavailable.
- Long lists use the six-item fixture surface; paging/virtual lists are a
  follow-up once the bridge provides paginated data.
