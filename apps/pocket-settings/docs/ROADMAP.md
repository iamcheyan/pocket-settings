# Roadmap

No item below should be described as a completed physical device control until
a real provider exists, the backend enforces authorization, and evidence is
recorded. Everything shipped today is settings persistence plus mock capability
and service metadata.

## Implemented baseline

- React + TypeScript + Vite PocketJS UI; Go `settingsd`; pure-Go SQLite with
  ordered, transactional migrations (v1–v3) and profile overrides.
- Capability schema with `available/enabled/controllable/source/reason` for 16
  capability IDs plus domains; four hardware fixtures required by the spec and
  three additional handheld variants.
- Capability-driven categories and pages: Home, Display, Audio, Network,
  Wi-Fi, Bluetooth, Remote, Storage, Accounts, Sync, Updates, Power, Developer,
  System Info, Services, global search.
- UI profile separate from hardware fixture; profile influences layout only.
- Keyboard/D-pad/gamepad/touch navigation, visible focus, zero-mouse search,
  navigation, edit, and return.
- Light / Dark / OLED (#000) / System themes, English / 简体中文 / 日本語
  (405 keys each, parity-checked), DPI 1x–3x scaling.
- Confirmed, audited, redacted dangerous-action refusals; no real OS writes.
- 28 verified unique Chromium screenshots including page/theme/locale/profile/
  viewport variants (see [SCREENSHOTS.md](SCREENSHOTS.md)).
- `make test` runs i18n parity, Go tests, and a real-browser keyboard smoke;
  `make build` compiles both halves.

## Next phases

1. **Provider interfaces.** Define Go provider contracts for capability,
   device state, service health, and confirmed action execution, with
   structured errors and `source` propagation.
2. **Read-only PJOS Runtime integration.** Map runtime capability reports,
   system info, and service health into existing schemas; keep unavailable
   reasons. Validate against fixtures before touching hardware.
3. **Service clients.** Add storaged, authd, syncd, downloadsd, mediad and
   notificationd clients only where their runtime contracts exist; otherwise
   keep reporting unavailable.
4. **CredentialStore.** Encrypted credential storage with explicit rotation and
   redaction tests. Gate the BaseOS root-SSH flow on this.
5. **Authorized writes.** Enable per-capability writes only after runtime
   authorization, confirmation, and audit are proven; non-destructive controls
   first. Dangerous operations stay unavailable until policy review.
6. **Launcher transition.** Only with separate authorization and per-feature
   parity evidence; the existing Launcher/BaseOS entrypoints remain untouched.
7. **Visual regression.** Keep the screenshot harness in CI, asserting file
   count equals unique digest count to catch duplicated captures.
