# Database

`settingsd` uses SQLite through Go's `database/sql` and the pure-Go
`modernc.org/sqlite` driver (no CGO). Default file: `settingsd.sqlite` in the
daemon working directory; `SETTINGS_DB` overrides it, and `:memory:` is allowed
for tests.

## Migrations

`schema_migrations(version, applied_at)` records applied versions. Migrations
are an ordered list applied in a transaction, one version at a time:

| Version | Contents |
|---|---|
| 1 | Core tables and seeds |
| 2 | `profile_overrides` |
| 3 | Indexes for overrides and audit lookups |

Re-running `migrate` is idempotent, and upgrading an existing v1 database
preserves user data (verified by Go tests, including a v1 fixture upgrade).

## Tables

| Table | Purpose |
|---|---|
| `schema_migrations` | Applied schema versions and timestamps |
| `app_state` | Current UI profile and selected mock hardware profile |
| `settings` | One JSON object and `updated_at` per settings domain |
| `profile_overrides` | Per-profile overrides, `(domain, profile)` |
| `preferences` | UI preferences (`theme`, `locale`, `density`, `uiProfile`) |
| `profiles` | Hardware fixture metadata (`kind`, capability list JSON) |
| `service_status` | Service id, status, availability, source, timestamp |
| `accounts` | Provider placeholder rows; no real authd integration |
| `sync_providers` | Provider placeholder rows; no real syncd integration |
| `device_state` | Key/value device state reserved for providers |
| `audit_log` | Action, domain, redacted JSON details, UTC timestamp |

## Seeding

Seven mock hardware fixtures are seeded (RG34XX, RG35XX, RG40XX, CubeXX, M21,
Leaf3C, Desktop), each with its documented capability list. Every settings
domain gets default values. Service rows for `wifi`, `bluetooth`, `ssh`,
`updates`, `storaged`, `downloadsd`, `authd`, `syncd`, `mediad` and
`notificationd` start `unavailable` / `source=mock`. Two sample profile
overrides are seeded (RG34XX network, Leaf3C display) to exercise the override
path.

None of these rows represents detected physical hardware.

## Read/write semantics

- `GET /api/settings/{domain}` merges the base object with the active profile's
  override; the override wins and the response carries
  `X-Settings-Override-Profile`.
- Writes are rejected with `403 capability_unavailable` when the domain's
  capability is unavailable, so a database row alone can never authorize a
  write.
- Audit details are recursively redacted before insert and before output.

## Security limits

There is no credential vault. Passwords, tokens, API keys and SSH private
material must not be stored in `settings`, `profile_overrides`, `preferences` or
`audit_log`. Adding credential support requires a separate encrypted
CredentialStore with its own key handling; plaintext SQLite columns are not an
acceptable substitute.
