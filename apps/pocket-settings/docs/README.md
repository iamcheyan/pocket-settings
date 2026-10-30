# Pocket Settings documentation

Pocket Settings is a PocketJS interface backed by the Go `settingsd` service. Hardware capability data and service status are mock/unavailable unless a real provider explicitly reports them. Existing Launcher and BaseOS flows remain supported; Launcher is unchanged.

- [Architecture](ARCHITECTURE.md): components, trust boundary, and PJOS Runtime API direction.
- [Settings](SETTINGS.md): settings domains, capability contract, mock profiles, and safety rules.
- [Services](SERVICES.md): provider status and evidence-grounded BaseOS/Launcher migration matrix.
- [Database](DATABASE.md): SQLite schema and persistence boundaries.
- [API](API.md): current HTTP endpoints and semantics.
- [Roadmap](ROADMAP.md): implementation baseline and future provider migration.
- [Screenshot manifest](SCREENSHOTS.md): generated Chromium captures and their metadata, when available.

For repository setup and development commands, see the [project README](../../../README.md).
