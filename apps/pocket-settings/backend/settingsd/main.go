package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

var domains = []string{"display", "audio", "network", "storage", "remote", "accounts", "sync", "updates", "power", "developer", "system"}
var profiles = []string{"RG34XX", "RG35XX", "RG40XX", "CubeXX", "M21", "Leaf3C", "Desktop"}
var requiredCapabilities = []string{"Battery", "Brightness", "Audio", "Touchscreen", "SSH", "ADB", "USB", "SDCard", "EInk", "Ethernet", "PowerManagement", "DisplayRotation", "WiFi", "Bluetooth", "Storage", "Display"}

var categoryAliases = map[string][]string{
	"display": {"Display", "Brightness", "DisplayRotation", "EInk", "Touchscreen"}, "audio": {"Audio"}, "network": {"WiFi", "Ethernet"}, "storage": {"SDCard", "Storage", "USB"}, "remote": {"SSH"}, "power": {"PowerManagement"}, "system": {"Display", "Brightness", "DisplayRotation", "EInk", "Touchscreen", "Battery"}, "developer": {"ADB", "USB"},
}

// providerDomains maps settings domains that depend on a runtime service
// provider instead of mock hardware metadata.
var providerDomains = map[string]string{"accounts": "authd", "sync": "syncd", "updates": "updates"}

var domainLabels = map[string]string{"display": "Display", "audio": "Audio", "network": "Network", "storage": "Storage", "remote": "Remote Play", "accounts": "Accounts", "sync": "Sync", "updates": "Updates", "power": "Power", "developer": "Developer", "system": "System"}

var sensitive = map[string]bool{"password": true, "passwd": true, "token": true, "access_token": true, "refresh_token": true, "secret": true, "api_key": true, "apikey": true, "credential": true, "authorization": true}

type Capability struct {
	Available    bool   `json:"available"`
	Enabled      bool   `json:"enabled"`
	Controllable bool   `json:"controllable"`
	Source       string `json:"source"`
	Reason       string `json:"reason,omitempty"`
}

type server struct {
	db                  *sql.DB
	allowSystemReadOnly bool
	allowSystemControl  bool
}

// actionSpec describes a provider action. Actions are always mock-safe: nothing
// in this daemon writes to the host OS.
type actionSpec struct {
	Domain     string
	Capability string
	// Dangerous actions require an explicit {"confirm":true} body flag before
	// they are audited and always end in unavailable/refused in this build.
	Dangerous bool
	// MockSafe actions may return a clearly labelled {"mock":true} acceptance
	// when the capability is available in the selected mock profile.
	MockSafe bool
}

var providerActions = map[string]actionSpec{
	"/api/network/wifi/connect":    {Domain: "network", Capability: "WiFi", MockSafe: true},
	"/api/network/wifi/disconnect": {Domain: "network", Capability: "WiFi", MockSafe: true},
	"/api/network/wifi/forget":     {Domain: "network", Capability: "WiFi", MockSafe: true},
	"/api/bluetooth/pair":          {Capability: "Bluetooth", MockSafe: true},
	"/api/bluetooth/forget":        {Capability: "Bluetooth", MockSafe: true},
	"/api/bluetooth/connect":       {Capability: "Bluetooth", MockSafe: true},
	"/api/bluetooth/disconnect":    {Capability: "Bluetooth", MockSafe: true},
	"/api/storage/mount":           {Domain: "storage", MockSafe: true},
	"/api/storage/unmount":         {Domain: "storage", MockSafe: true},
	"/api/storage/format":          {Domain: "storage", Dangerous: true},
	"/api/accounts/login":          {Domain: "accounts", MockSafe: true},
	"/api/accounts/logout":         {Domain: "accounts", MockSafe: true},
	"/api/accounts/switch":         {Domain: "accounts", MockSafe: true},
	"/api/accounts/delete":         {Domain: "accounts", Dangerous: true},
	"/api/sync/run":                {Domain: "sync", MockSafe: true},
	"/api/sync/config":             {Domain: "sync", MockSafe: true},
	"/api/updates/check":           {Domain: "updates", MockSafe: true},
	"/api/updates/install":         {Domain: "updates", Dangerous: true},
	"/api/updates/rollback":        {Domain: "updates", Dangerous: true},
	"/api/remote/start":            {Domain: "remote", Capability: "SSH", Dangerous: true},
	"/api/remote/stop":             {Domain: "remote", Capability: "SSH", MockSafe: true},
	"/api/power/sleep":             {Domain: "power", Capability: "PowerManagement", MockSafe: true},
	"/api/power/reboot":            {Domain: "power", Dangerous: true},
	"/api/power/shutdown":          {Domain: "power", Dangerous: true},
	"/api/system/factory-reset":    {Domain: "system", Dangerous: true},
}

type migration struct {
	Version    int
	Statements []string
}

var migrations = []migration{
	{Version: 1, Statements: []string{
		`CREATE TABLE IF NOT EXISTS app_state(key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS settings(domain TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, domain TEXT, details TEXT NOT NULL, created_at TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY, kind TEXT NOT NULL, capabilities TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS service_status(id TEXT PRIMARY KEY, status TEXT NOT NULL, available INTEGER NOT NULL, source TEXT NOT NULL, updated_at TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, provider TEXT NOT NULL, details TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS sync_providers(id TEXT PRIMARY KEY, name TEXT NOT NULL, available INTEGER NOT NULL, details TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS device_state(key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS preferences(key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
	}},
	{Version: 2, Statements: []string{
		`CREATE TABLE IF NOT EXISTS profile_overrides(profile TEXT NOT NULL, domain TEXT NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(profile, domain))`,
	}},
	{Version: 3, Statements: []string{
		`CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at)`,
		`CREATE INDEX IF NOT EXISTS idx_profile_overrides_domain ON profile_overrides(domain)`,
	}},
}

func main() {
	readOnly := flag.Bool("allow-system-readonly", false, "expose read-only host system information (hostname/os/kernel/cpu/memory/network)")
	control := flag.Bool("allow-system-control", false, "reserved for privileged writes; this build refuses instead of executing any OS change")
	flag.Parse()
	path := os.Getenv("SETTINGS_DB")
	if path == "" {
		path = "settingsd.sqlite"
	}
	if path != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			log.Fatal(err)
		}
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		log.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	if err := migrate(context.Background(), db); err != nil {
		log.Fatal(err)
	}
	addr := os.Getenv("SETTINGS_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8090"
	}
	srv := &server{db: db, allowSystemReadOnly: *readOnly, allowSystemControl: *control}
	log.Printf("settingsd listening on %s (systemReadOnly=%t systemControl=%t)", addr, srv.allowSystemReadOnly, srv.allowSystemControl)
	log.Fatal(http.ListenAndServe(addr, srv.routes()))
}

func migrate(ctx context.Context, db *sql.DB) error {
	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`); err != nil {
		return err
	}
	for _, m := range migrations {
		var applied int
		if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM schema_migrations WHERE version=?`, m.Version).Scan(&applied); err != nil {
			return err
		}
		if applied > 0 {
			continue
		}
		if err := applyMigration(ctx, db, m); err != nil {
			return err
		}
	}
	return seed(ctx, db)
}

func applyMigration(ctx context.Context, db *sql.DB, m migration) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, stmt := range m.Statements {
		if _, err := tx.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("migration %d: %w", m.Version, err)
		}
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)`, m.Version, now()); err != nil {
		return err
	}
	return tx.Commit()
}

func latestMigrationVersion() int {
	version := 0
	for _, m := range migrations {
		if m.Version > version {
			version = m.Version
		}
	}
	return version
}

// seed is idempotent so it can run on every start and after an in-place schema upgrade.
func seed(ctx context.Context, db *sql.DB) error {
	if _, err := db.ExecContext(ctx, `INSERT OR IGNORE INTO app_state(key,value) VALUES('ui_profile','Desktop'),('hardware_profile','unavailable')`); err != nil {
		return err
	}
	capabilityProfiles := map[string][]string{"RG34XX": {"WiFi", "Bluetooth", "Battery", "SDCard", "USB"}, "RG35XX": {"WiFi", "Bluetooth", "Battery", "SDCard", "USB"}, "RG40XX": {"WiFi", "Bluetooth", "Battery", "SDCard", "USB"}, "CubeXX": {"WiFi", "Bluetooth", "Battery", "SDCard", "USB"}, "M21": {"Audio", "Bluetooth", "Battery", "Storage"}, "Leaf3C": {"EInk", "Touchscreen", "Battery", "WiFi"}, "Desktop": {"WiFi", "Bluetooth", "Ethernet", "Audio", "Display", "SSH", "PowerManagement"}}
	for profile, caps := range capabilityProfiles {
		b, _ := json.Marshal(caps)
		if _, err := db.ExecContext(ctx, `INSERT INTO profiles(id,kind,capabilities) VALUES(?, 'hardware', ?) ON CONFLICT(id) DO UPDATE SET capabilities=excluded.capabilities,kind='hardware'`, profile, string(b)); err != nil {
			return err
		}
	}
	defaults := map[string]map[string]any{"display": {"brightness": 50, "rotation": 0, "autoRotate": false, "theme": "system"}, "audio": {"volume": 50, "muted": false, "output": "default"}, "network": {"wifiEnabled": false, "ethernetEnabled": false}, "storage": {"autoMount": true}, "remote": {"sshEnabled": false}, "accounts": {"accounts": []any{}}, "sync": {"enabled": false, "provider": "none"}, "updates": {"automatic": false, "channel": "stable"}, "power": {"sleepTimeout": 300, "lowBatteryWarning": 20}, "developer": {"adbEnabled": false, "usbDebugging": false}, "system": {"locale": "en", "timezone": "UTC"}}
	for domain, value := range defaults {
		b, _ := json.Marshal(value)
		if _, err := db.ExecContext(ctx, `INSERT OR IGNORE INTO settings(domain,value,updated_at) VALUES(?,?,?)`, domain, string(b), now()); err != nil {
			return err
		}
	}
	for _, id := range []string{"wifi", "bluetooth", "updates", "ssh", "storaged", "downloadsd", "authd", "syncd", "mediad", "notificationd"} {
		if _, err := db.ExecContext(ctx, `INSERT OR IGNORE INTO service_status(id,status,available,source,updated_at) VALUES(?, 'unavailable', 0, 'mock', ?)`, id, now()); err != nil {
			return err
		}
	}
	seedOverrides := []struct {
		Profile string
		Domain  string
		Value   map[string]any
	}{
		{Profile: "RG34XX", Domain: "network", Value: map[string]any{"wifiEnabled": true, "mock": true}},
		{Profile: "Leaf3C", Domain: "display", Value: map[string]any{"brightness": 45}},
	}
	for _, override := range seedOverrides {
		b, _ := json.Marshal(override.Value)
		if _, err := db.ExecContext(ctx, `INSERT OR IGNORE INTO profile_overrides(profile,domain,value,updated_at) VALUES(?,?,?,?)`, override.Profile, override.Domain, string(b), now()); err != nil {
			return err
		}
	}
	for key, value := range map[string]string{"brightness": "50", "volume": "50", "theme": "system", "locale": "en", "uiProfile": "Desktop", "density": "comfortable"} {
		if _, err := db.ExecContext(ctx, `INSERT OR IGNORE INTO preferences(key,value) VALUES(?,?)`, key, value); err != nil {
			return err
		}
	}
	return nil
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.health)
	mux.HandleFunc("GET /api/capabilities", s.capabilities)
	mux.HandleFunc("PUT /api/capabilities/profile", s.setProfile)
	mux.HandleFunc("POST /api/mock/profile", s.mockProfile)
	mux.HandleFunc("GET /api/preferences", s.getPreferences)
	mux.HandleFunc("PUT /api/preferences", s.putPreferences)
	mux.HandleFunc("PUT /api/preferences/profile", s.setUIProfile)
	mux.HandleFunc("GET /api/settings/categories", s.categories)
	mux.HandleFunc("GET /api/settings/{domain}", s.getSettings)
	mux.HandleFunc("PUT /api/settings/{domain}", s.putSettings)
	mux.HandleFunc("GET /api/settings/{domain}/overrides", s.overridesList)
	mux.HandleFunc("GET /api/settings/{domain}/overrides/{profile}", s.overrideGet)
	mux.HandleFunc("PUT /api/settings/{domain}/overrides/{profile}", s.overridePut)
	mux.HandleFunc("DELETE /api/settings/{domain}/overrides/{profile}", s.overrideDelete)
	mux.HandleFunc("GET /api/services", s.services)
	mux.HandleFunc("POST /api/services/{id}/restart", s.restartService)
	mux.HandleFunc("GET /api/system/info", s.systemInfo)
	mux.HandleFunc("GET /api/network/wifi/scan", s.wifiScan)
	mux.HandleFunc("POST /api/network/wifi/scan", s.wifiScan)
	mux.HandleFunc("GET /api/bluetooth/devices", s.bluetoothDevices)
	mux.HandleFunc("GET /api/storage/devices", s.storageDevices)
	mux.HandleFunc("GET /api/accounts", s.accounts)
	mux.HandleFunc("GET /api/sync/providers", s.syncProviders)
	mux.HandleFunc("GET /api/updates", s.updates)
	for _, path := range providerActionPaths() {
		mux.HandleFunc("POST "+path, s.providerAction)
	}
	mux.HandleFunc("PUT /api/sync/config", s.providerAction)
	mux.HandleFunc("GET /api/search", s.search)
	mux.HandleFunc("GET /api/audit", s.audit)
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		fail(w, http.StatusNotFound, "not_found", fmt.Sprintf("no handler for %s %s", r.Method, r.URL.Path))
	})
	return cors(mux)
}

func providerActionPaths() []string {
	paths := make([]string, 0, len(providerActions))
	for path := range providerActions {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	return paths
}

func dangerousActionPaths() []string {
	paths := []string{"/api/services/{id}/restart"}
	for path, spec := range providerActions {
		if spec.Dangerous {
			paths = append(paths, path)
		}
	}
	sort.Strings(paths)
	return paths
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Accept")
		w.Header().Set("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func jsonResponse(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, status int, code, msg string) {
	failWith(w, status, code, msg, nil)
}

func failWith(w http.ResponseWriter, status int, code, msg string, extra map[string]any) {
	payload := map[string]any{"error": map[string]string{"code": code, "message": msg}}
	for key, value := range extra {
		payload[key] = value
	}
	jsonResponse(w, status, payload)
}

func now() string { return time.Now().UTC().Format(time.RFC3339Nano) }

func (s *server) health(w http.ResponseWriter, _ *http.Request) {
	if err := s.db.Ping(); err != nil {
		fail(w, 503, "database_unavailable", "settings database unavailable")
		return
	}
	jsonResponse(w, 200, map[string]string{"status": "ok"})
}

func (s *server) profileValue(key, fallback string) string {
	var value string
	if s.db.QueryRow(`SELECT value FROM app_state WHERE key=?`, key).Scan(&value) != nil {
		return fallback
	}
	return value
}

func (s *server) currentProfile() string { return s.profileValue("ui_profile", "Desktop") }

func (s *server) currentHardwareProfile() string {
	return s.profileValue("hardware_profile", "unavailable")
}

// activeOverrideProfile selects the profile whose overrides are applied to
// settings reads: the selected mock hardware profile when one is chosen,
// otherwise the device/UI profile.
func (s *server) activeOverrideProfile() string {
	if hardware := s.currentHardwareProfile(); hardware != "" && hardware != "unavailable" {
		return hardware
	}
	return s.currentProfile()
}

func (s *server) capabilities(w http.ResponseWriter, _ *http.Request) {
	jsonResponse(w, 200, map[string]any{
		"hardwareProfile":      s.currentHardwareProfile(),
		"uiProfile":            s.currentProfile(),
		"profile":              s.currentProfile(),
		"source":               "mock",
		"mock":                 true,
		"requiredCapabilities": requiredCapabilities,
		"capabilities":         s.capabilityData(),
	})
}

func knownProfile(profile string) bool {
	for _, p := range profiles {
		if p == profile {
			return true
		}
	}
	return false
}

func (s *server) setProfile(w http.ResponseWriter, r *http.Request) {
	var body struct {
		HardwareProfile string `json:"hardwareProfile"`
		Profile         string `json:"profile"`
	}
	if err := decodeOne(r, w, &body); err != nil {
		fail(w, 400, "invalid_json", "request body must be valid JSON")
		return
	}
	if body.HardwareProfile != "" {
		if !knownProfile(body.HardwareProfile) {
			fail(w, 400, "invalid_profile", "unknown hardware mock profile")
			return
		}
		if _, err := s.db.Exec(`UPDATE app_state SET value=? WHERE key='hardware_profile'`, body.HardwareProfile); err != nil {
			fail(w, 500, "database_error", "could not save hardware profile")
			return
		}
		s.logAudit("hardware_mock_profile.change", "profiles", map[string]any{"hardwareProfile": body.HardwareProfile})
	} else {
		if !knownProfile(body.Profile) {
			fail(w, 400, "invalid_profile", "unknown UI profile")
			return
		}
		if _, err := s.db.Exec(`UPDATE app_state SET value=? WHERE key='ui_profile'`, body.Profile); err != nil {
			fail(w, 500, "database_error", "could not save UI profile")
			return
		}
		_, _ = s.db.Exec(`INSERT INTO preferences(key,value) VALUES('uiProfile',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, body.Profile)
		s.logAudit("ui_profile.change", "preferences", map[string]any{"profile": body.Profile})
	}
	jsonResponse(w, 200, map[string]any{"hardwareProfile": s.currentHardwareProfile(), "uiProfile": s.currentProfile(), "profile": s.currentProfile(), "capabilities": s.capabilityData()})
}

func (s *server) setUIProfile(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Profile string `json:"profile"`
	}
	if err := decodeOne(r, w, &body); err != nil {
		fail(w, 400, "invalid_json", "request body must be valid JSON")
		return
	}
	if !knownProfile(body.Profile) {
		fail(w, 400, "invalid_profile", "unknown UI profile")
		return
	}
	if _, err := s.db.Exec(`UPDATE app_state SET value=? WHERE key='ui_profile'`, body.Profile); err != nil {
		fail(w, 500, "database_error", "could not save UI profile")
		return
	}
	_, _ = s.db.Exec(`INSERT INTO preferences(key,value) VALUES('uiProfile',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, body.Profile)
	s.logAudit("ui_profile.change", "preferences", map[string]any{"profile": body.Profile})
	jsonResponse(w, 200, map[string]any{"hardwareProfile": s.currentHardwareProfile(), "uiProfile": body.Profile, "profile": body.Profile, "capabilities": s.capabilityData()})
}

func (s *server) mockProfile(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Profile string `json:"profile"`
	}
	if err := decodeOne(r, w, &body); err != nil {
		fail(w, 400, "invalid_json", "request body must be valid JSON")
		return
	}
	if !knownProfile(body.Profile) {
		fail(w, 400, "invalid_profile", "unknown hardware mock profile")
		return
	}
	if _, err := s.db.Exec(`UPDATE app_state SET value=? WHERE key='hardware_profile'`, body.Profile); err != nil {
		fail(w, 500, "database_error", "could not save hardware profile")
		return
	}
	s.logAudit("hardware_mock_profile.change", "profiles", map[string]any{"profile": body.Profile})
	jsonResponse(w, 200, map[string]any{"hardwareProfile": body.Profile, "uiProfile": s.currentProfile(), "capabilities": s.capabilityData()})
}

type serviceState struct {
	Status    string
	Available bool
}

func (s *server) serviceStates() map[string]serviceState {
	out := map[string]serviceState{}
	rows, err := s.db.Query(`SELECT id,status,available FROM service_status`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id, status string
		var available bool
		if rows.Scan(&id, &status, &available) == nil {
			out[id] = serviceState{Status: status, Available: available}
		}
	}
	return out
}

func (s *server) capabilityData() map[string]Capability {
	active := map[string]bool{}
	var raw string
	if err := s.db.QueryRow(`SELECT capabilities FROM profiles WHERE id=? AND kind='hardware'`, s.currentHardwareProfile()).Scan(&raw); err == nil {
		var names []string
		if json.Unmarshal([]byte(raw), &names) == nil {
			for _, name := range names {
				active[name] = true
			}
		}
	}
	services := s.serviceStates()
	out := make(map[string]Capability, len(requiredCapabilities)+len(domains))
	for _, name := range requiredCapabilities {
		available := active[name]
		reason := "Not present on selected mock hardware profile"
		if available {
			reason = "Mock hardware metadata only; no system provider is connected"
		}
		out[name] = Capability{Available: available, Enabled: false, Controllable: false, Source: "mock", Reason: reason}
	}
	for _, domain := range domains {
		if serviceID, ok := providerDomains[domain]; ok {
			state, known := services[serviceID]
			available := known && state.Available
			reason := fmt.Sprintf("Service provider %s is not registered", serviceID)
			if known {
				reason = fmt.Sprintf("Service provider %s is unavailable (status: %s)", serviceID, state.Status)
				if available {
					reason = fmt.Sprintf("Service provider %s is available (mock status: %s); hardware control remains disabled", serviceID, state.Status)
				}
			}
			out[domain] = Capability{Available: available, Enabled: available, Controllable: false, Source: "mock", Reason: reason}
			continue
		}
		available := false
		for _, name := range categoryAliases[domain] {
			if active[name] {
				available = true
				break
			}
		}
		reason := "No matching capability on selected mock hardware profile"
		if available {
			reason = "Settings are stored locally; hardware control is unavailable"
		}
		out[domain] = Capability{Available: available, Enabled: available, Controllable: false, Source: "mock", Reason: reason}
	}
	return out
}

func (s *server) categories(w http.ResponseWriter, _ *http.Request) {
	caps := s.capabilityData()
	out := make([]map[string]any, 0, len(domains))
	for _, domain := range domains {
		if !caps[domain].Available {
			continue
		}
		out = append(out, map[string]any{"id": domain, "title": domainLabels[domain], "label": domainLabels[domain], "icon": domain, "capabilities": categoryAliases[domain]})
	}
	jsonResponse(w, 200, map[string]any{"categories": out, "profile": s.activeOverrideProfile()})
}

func validDomain(domain string) bool {
	for _, value := range domains {
		if value == domain {
			return true
		}
	}
	return false
}

// settingsObject returns the effective settings object for a domain: the stored
// base settings merged with the active profile override (override wins).
func (s *server) settingsObject(domain string) (map[string]json.RawMessage, bool, error) {
	var raw string
	if err := s.db.QueryRow(`SELECT value FROM settings WHERE domain=?`, domain).Scan(&raw); err != nil {
		return nil, false, err
	}
	base := map[string]json.RawMessage{}
	if err := json.Unmarshal([]byte(raw), &base); err != nil {
		return nil, false, err
	}
	overridden := false
	var overrideRaw string
	if err := s.db.QueryRow(`SELECT value FROM profile_overrides WHERE profile=? AND domain=?`, s.activeOverrideProfile(), domain).Scan(&overrideRaw); err == nil {
		override := map[string]json.RawMessage{}
		if json.Unmarshal([]byte(overrideRaw), &override) == nil && len(override) > 0 {
			for key, value := range override {
				base[key] = value
			}
			overridden = true
		}
	}
	return base, overridden, nil
}

func (s *server) getSettings(w http.ResponseWriter, r *http.Request) {
	domain := r.PathValue("domain")
	if !validDomain(domain) {
		fail(w, 404, "unknown_domain", "unknown settings domain")
		return
	}
	value, overridden, err := s.settingsObject(domain)
	if err != nil {
		fail(w, 500, "database_error", "could not read settings")
		return
	}
	if overridden {
		w.Header().Set("X-Settings-Override-Profile", s.activeOverrideProfile())
	}
	jsonResponse(w, 200, value)
}

func (s *server) putSettings(w http.ResponseWriter, r *http.Request) {
	domain := r.PathValue("domain")
	if !validDomain(domain) {
		fail(w, 404, "unknown_domain", "unknown settings domain")
		return
	}
	if capability := s.capabilityData()[domain]; !capability.Available {
		failWith(w, http.StatusForbidden, "capability_unavailable", "settings category is unavailable on selected mock profile", map[string]any{"domain": domain, "reason": capability.Reason, "source": "mock"})
		return
	}
	var value map[string]any
	if err := decodeOne(r, w, &value); err != nil || value == nil {
		fail(w, 400, "invalid_json", "request body must be a JSON object")
		return
	}
	if len(value) > 64 {
		fail(w, 400, "invalid_settings", "too many settings fields")
		return
	}
	for key, item := range value {
		if len(key) > 64 || len(fmt.Sprint(item)) > 4096 {
			fail(w, 400, "invalid_settings", "setting key or value exceeds domain limits")
			return
		}
	}
	if path := findCredentialKey(value, ""); path != "" {
		fail(w, 400, "credential_not_allowed", "credentials must not be stored in settings; an encrypted CredentialStore is required ("+path+")")
		return
	}
	b, err := json.Marshal(value)
	if err != nil || len(b) > 65536 {
		fail(w, 400, "invalid_settings", "settings payload exceeds domain limit")
		return
	}
	res, err := s.db.Exec(`UPDATE settings SET value=?,updated_at=? WHERE domain=?`, string(b), now(), domain)
	if err != nil {
		fail(w, 500, "database_error", "could not save settings")
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		fail(w, 500, "database_error", "settings row is missing")
		return
	}
	s.logAudit("settings.update", domain, value)
	jsonResponse(w, 200, value)
}

func (s *server) overridesList(w http.ResponseWriter, r *http.Request) {
	domain := r.PathValue("domain")
	if !validDomain(domain) {
		fail(w, 404, "unknown_domain", "unknown settings domain")
		return
	}
	rows, err := s.db.Query(`SELECT profile,value,updated_at FROM profile_overrides WHERE domain=? ORDER BY profile`, domain)
	if err != nil {
		fail(w, 500, "database_error", "could not read profile overrides")
		return
	}
	defer rows.Close()
	overrides := map[string]any{}
	for rows.Next() {
		var profile, raw, updated string
		if rows.Scan(&profile, &raw, &updated) != nil {
			continue
		}
		var value any = map[string]any{}
		if json.Unmarshal([]byte(raw), &value) != nil {
			value = map[string]any{}
		}
		overrides[profile] = value
	}
	jsonResponse(w, 200, map[string]any{"domain": domain, "activeProfile": s.activeOverrideProfile(), "overrides": overrides})
}

func (s *server) overrideGet(w http.ResponseWriter, r *http.Request) {
	domain := r.PathValue("domain")
	if !validDomain(domain) {
		fail(w, 404, "unknown_domain", "unknown settings domain")
		return
	}
	profile := r.PathValue("profile")
	if !knownProfile(profile) {
		fail(w, 400, "invalid_profile", "unknown profile")
		return
	}
	var raw, updated string
	err := s.db.QueryRow(`SELECT value,updated_at FROM profile_overrides WHERE profile=? AND domain=?`, profile, domain).Scan(&raw, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 404, "override_not_found", "no profile override for this domain")
		return
	}
	if err != nil {
		fail(w, 500, "database_error", "could not read profile override")
		return
	}
	var value any = map[string]any{}
	if json.Unmarshal([]byte(raw), &value) != nil {
		value = map[string]any{}
	}
	jsonResponse(w, 200, map[string]any{"domain": domain, "profile": profile, "value": value, "updatedAt": updated})
}

func (s *server) overridePut(w http.ResponseWriter, r *http.Request) {
	domain := r.PathValue("domain")
	if !validDomain(domain) {
		fail(w, 404, "unknown_domain", "unknown settings domain")
		return
	}
	profile := r.PathValue("profile")
	if !knownProfile(profile) {
		fail(w, 400, "invalid_profile", "unknown profile")
		return
	}
	if capability := s.capabilityData()[domain]; !capability.Available {
		failWith(w, http.StatusForbidden, "capability_unavailable", "settings category is unavailable on selected mock profile", map[string]any{"domain": domain, "reason": capability.Reason, "source": "mock"})
		return
	}
	var value map[string]any
	if err := decodeOne(r, w, &value); err != nil || value == nil || len(value) == 0 {
		fail(w, 400, "invalid_override", "request body must be a non-empty JSON object")
		return
	}
	if len(value) > 64 {
		fail(w, 400, "invalid_override", "too many override fields")
		return
	}
	for key, item := range value {
		if len(key) > 64 || len(fmt.Sprint(item)) > 4096 {
			fail(w, 400, "invalid_override", "override key or value exceeds limits")
			return
		}
	}
	if path := findCredentialKey(value, ""); path != "" {
		fail(w, 400, "credential_not_allowed", "credentials must not be stored in settings; an encrypted CredentialStore is required ("+path+")")
		return
	}
	b, err := json.Marshal(value)
	if err != nil || len(b) > 65536 {
		fail(w, 400, "invalid_override", "override payload exceeds limit")
		return
	}
	updated := now()
	if _, err := s.db.Exec(`INSERT INTO profile_overrides(profile,domain,value,updated_at) VALUES(?,?,?,?) ON CONFLICT(profile,domain) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`, profile, domain, string(b), updated); err != nil {
		fail(w, 500, "database_error", "could not save profile override")
		return
	}
	s.logAudit("settings.override.update", domain, map[string]any{"profile": profile, "value": value})
	jsonResponse(w, 200, map[string]any{"domain": domain, "profile": profile, "value": value, "updatedAt": updated})
}

func (s *server) overrideDelete(w http.ResponseWriter, r *http.Request) {
	domain := r.PathValue("domain")
	if !validDomain(domain) {
		fail(w, 404, "unknown_domain", "unknown settings domain")
		return
	}
	profile := r.PathValue("profile")
	if !knownProfile(profile) {
		fail(w, 400, "invalid_profile", "unknown profile")
		return
	}
	if capability := s.capabilityData()[domain]; !capability.Available {
		failWith(w, http.StatusForbidden, "capability_unavailable", "settings category is unavailable on selected mock profile", map[string]any{"domain": domain, "reason": capability.Reason, "source": "mock"})
		return
	}
	res, err := s.db.Exec(`DELETE FROM profile_overrides WHERE profile=? AND domain=?`, profile, domain)
	if err != nil {
		fail(w, 500, "database_error", "could not delete profile override")
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		fail(w, 404, "override_not_found", "no profile override for this domain")
		return
	}
	s.logAudit("settings.override.delete", domain, map[string]any{"profile": profile})
	jsonResponse(w, 200, map[string]any{"domain": domain, "profile": profile, "deleted": true})
}

func (s *server) getPreferences(w http.ResponseWriter, _ *http.Request) {
	rows, err := s.db.Query(`SELECT key,value FROM preferences ORDER BY key`)
	if err != nil {
		fail(w, 500, "database_error", "could not read preferences")
		return
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var key, value string
		if rows.Scan(&key, &value) == nil {
			out[key] = value
		}
	}
	jsonResponse(w, 200, map[string]any{"preferences": out})
}

func (s *server) putPreferences(w http.ResponseWriter, r *http.Request) {
	var body map[string]string
	if err := decodeOne(r, w, &body); err != nil || body == nil || len(body) == 0 {
		fail(w, 400, "invalid_json", "request body must be a non-empty JSON object of strings")
		return
	}
	allowed := map[string]bool{"theme": true, "locale": true, "density": true, "uiProfile": true}
	for key, value := range body {
		if !allowed[key] || strings.TrimSpace(value) == "" || len(value) > 64 {
			fail(w, 400, "invalid_preference", "unknown preference or invalid value")
			return
		}
		if key == "uiProfile" && !knownProfile(value) {
			fail(w, 400, "invalid_profile", "unknown UI profile")
			return
		}
	}
	tx, err := s.db.Begin()
	if err != nil {
		fail(w, 500, "database_error", "could not save preferences")
		return
	}
	defer tx.Rollback()
	for key, value := range body {
		if _, err = tx.Exec(`INSERT INTO preferences(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value); err != nil {
			fail(w, 500, "database_error", "could not save preferences")
			return
		}
		if key == "uiProfile" {
			if _, err = tx.Exec(`UPDATE app_state SET value=? WHERE key='ui_profile'`, value); err != nil {
				fail(w, 500, "database_error", "could not save UI profile")
				return
			}
		}
	}
	if err = tx.Commit(); err != nil {
		fail(w, 500, "database_error", "could not save preferences")
		return
	}
	auditDetails := make(map[string]any, len(body))
	for key, value := range body {
		auditDetails[key] = value
	}
	s.logAudit("preferences.update", "preferences", auditDetails)
	jsonResponse(w, 200, map[string]any{"preferences": body, "uiProfile": s.currentProfile()})
}

func serviceReason(id, status, source string, available bool) string {
	if !available {
		return fmt.Sprintf("Mock service registry: %s is not running (status: %s)", id, status)
	}
	if source == "mock" {
		return "Mock service registry entry; real service control is disabled"
	}
	return "Service reported available by its provider"
}

func (s *server) services(w http.ResponseWriter, _ *http.Request) {
	rows, err := s.db.Query(`SELECT id,status,available,source,updated_at FROM service_status ORDER BY id`)
	if err != nil {
		fail(w, 500, "database_error", "could not read service status")
		return
	}
	defer rows.Close()
	services := make([]map[string]any, 0)
	for rows.Next() {
		var id, status, source, updated string
		var available bool
		if rows.Scan(&id, &status, &available, &source, &updated) != nil {
			continue
		}
		services = append(services, map[string]any{
			"id": id, "status": status, "available": available, "source": source, "updatedAt": updated,
			"mock": source == "mock", "restartable": false, "restartMode": "mock",
			"reason": serviceReason(id, status, source, available),
		})
	}
	jsonResponse(w, 200, map[string]any{"services": services, "count": len(services), "mock": true})
}

func (s *server) systemInfo(w http.ResponseWriter, _ *http.Request) {
	out := map[string]any{
		"profile":         s.currentProfile(),
		"uiProfile":       s.currentProfile(),
		"hardwareProfile": s.currentHardwareProfile(),
		"profileSource":   "mock",
	}
	if !s.allowSystemReadOnly {
		out["available"] = false
		out["provider"] = "mock"
		out["source"] = "mock"
		out["mock"] = true
		out["reason"] = "read-only host information is disabled; start settingsd with --allow-system-readonly to query these host details"
		jsonResponse(w, 200, out)
		return
	}
	info := readHostInfo()
	for key, value := range info {
		out[key] = value
	}
	out["available"] = true
	out["provider"] = "host-readonly"
	out["source"] = "host"
	out["mock"] = false
	out["hostProfile"] = "host"
	out["reason"] = "read-only host information; no system changes are performed"
	jsonResponse(w, 200, out)
}

// mockNetworks / mockBluetoothDevices / mockStorageDevices are sample payloads
// for the capability fixtures. They are labelled `mock` and never derived from
// the host, so an available mock capability still yields inspectable data while
// clearly not claiming real discovery.
var mockNetworks = []map[string]any{
	{"ssid": "Pocket-Lab", "signal": 82, "security": "WPA2", "saved": true, "source": "mock"},
	{"ssid": "Home-5G", "signal": 64, "security": "WPA3", "saved": false, "source": "mock"},
}
var mockBluetoothDevices = []map[string]any{
	{"id": "mock-audio-01", "name": "Mock Headphones", "type": "audio", "paired": true, "source": "mock"},
	{"id": "mock-input-01", "name": "Mock Gamepad", "type": "input", "paired": false, "source": "mock"},
}
var mockStorageDevices = []map[string]any{
	{"id": "internal", "label": "Internal", "kind": "internal", "filesystem": "ext4", "mount": "/", "total": 137438953472, "free": 68719476736, "readOnly": false, "health": "ok", "source": "mock"},
	{"id": "tf-a", "label": "TF-A", "kind": "tf-a", "filesystem": "exfat", "mount": "/run/media/tf-a", "total": 128849018880, "free": 98784247808, "readOnly": false, "health": "ok", "source": "mock"},
	{"id": "tf-b", "label": "TF-B", "kind": "tf-b", "filesystem": "exfat", "mount": "/run/media/tf-b", "total": 128849018880, "free": 120259084288, "readOnly": false, "health": "ok", "source": "mock"},
	{"id": "usb", "label": "USB", "kind": "usb", "filesystem": "vfat", "mount": "/run/media/usb", "total": 32212254720, "free": 21474836480, "readOnly": true, "health": "unknown", "source": "mock"},
}

func (s *server) devicePayload(w http.ResponseWriter, capability, key string, payload []map[string]any, unavailableReason string) {
	if c := s.capabilityData()[capability]; !c.Available {
		jsonResponse(w, 200, map[string]any{"available": false, key: []any{}, "source": "mock", "mock": true, "reason": unavailableReason})
		return
	}
	jsonResponse(w, 200, map[string]any{"available": true, key: payload, "source": "mock", "mock": true, "reason": "mock fixture data for the selected hardware profile"})
}

func (s *server) wifiScan(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		if _, ok := s.decodeActionBody(w, r); !ok {
			return
		}
	}
	s.devicePayload(w, "WiFi", "networks", mockNetworks, "Wi-Fi scanning is unavailable without a system provider")
}

func (s *server) bluetoothDevices(w http.ResponseWriter, _ *http.Request) {
	s.devicePayload(w, "Bluetooth", "devices", mockBluetoothDevices, "Bluetooth is unavailable without a system provider")
}

func (s *server) storageDevices(w http.ResponseWriter, _ *http.Request) {
	s.devicePayload(w, "Storage", "devices", mockStorageDevices, "Storage discovery is unavailable without a system provider")
}

// accountProviders lists the identity providers Pocket Settings is designed to
// surface. None is deployed today, so every entry is explicitly unavailable
// rather than omitted.
var accountProviders = []struct{ ID, Name string }{
	{"google", "Google"},
	{"github", "GitHub"},
	{"microsoft", "Microsoft"},
	{"mozilla", "Mozilla"},
}

// syncProviderKinds lists the sync backends the Sync page is designed for.
var syncProviderKinds = []struct{ ID, Name string }{
	{"webdav", "WebDAV"},
	{"nextcloud", "Nextcloud"},
	{"syncthing", "Syncthing"},
	{"git", "Git"},
}

func (s *server) accounts(w http.ResponseWriter, _ *http.Request) {
	reason := "No authd client is deployed"
	accounts := make([]map[string]any, 0, len(accountProviders))
	for _, provider := range accountProviders {
		accounts = append(accounts, map[string]any{
			"id": provider.ID, "provider": provider.ID, "name": provider.Name,
			"available": false, "signedIn": false, "source": "mock",
			"reason": reason,
		})
	}
	jsonResponse(w, 200, map[string]any{"available": false, "accounts": accounts, "source": "mock", "mock": true, "reason": reason})
}

func (s *server) syncProviders(w http.ResponseWriter, _ *http.Request) {
	reason := "No syncd client is deployed"
	providers := make([]map[string]any, 0, len(syncProviderKinds))
	for _, provider := range syncProviderKinds {
		providers = append(providers, map[string]any{
			"id": provider.ID, "name": provider.Name, "kind": provider.ID,
			"available": false, "configured": false, "status": "unavailable",
			"source": "mock", "reason": reason,
		})
	}
	jsonResponse(w, 200, map[string]any{"available": false, "providers": providers, "source": "mock", "mock": true, "reason": reason})
}

func (s *server) updates(w http.ResponseWriter, _ *http.Request) {
	jsonResponse(w, 200, map[string]any{"available": false, "updates": []any{}, "source": "mock", "mock": true, "reason": "Update service is unavailable"})
}

type searchPage struct {
	ID          string
	Title       string
	Description string
}

var staticPages = []searchPage{
	{ID: "home", Title: "Home", Description: "Dashboard with capability driven settings categories"},
	{ID: "services", Title: "Services", Description: "Service dashboard with mock service status"},
	{ID: "search", Title: "Search", Description: "Global settings search"},
	{ID: "audit", Title: "Audit Log", Description: "Recent audited settings and provider actions"},
	{ID: "system-info", Title: "System Info", Description: "Device and host information"},
}

func matchQuery(query string, fields ...string) bool {
	for _, field := range fields {
		if field != "" && strings.Contains(strings.ToLower(field), query) {
			return true
		}
	}
	return false
}

// search returns capability-filtered hits: pages/domains, settings keys and
// capability names. A query only sees what is currently available.
func (s *server) search(w http.ResponseWriter, r *http.Request) {
	rawQuery := r.URL.Query().Get("q")
	query := strings.ToLower(strings.TrimSpace(rawQuery))
	results := make([]map[string]any, 0)
	if query != "" {
		caps := s.capabilityData()
		for _, page := range staticPages {
			if matchQuery(query, page.ID, page.Title, page.Description) {
				results = append(results, map[string]any{"id": "page:" + page.ID, "title": page.Title, "label": page.Title, "type": "page", "description": page.Description})
			}
		}
		for _, domain := range domains {
			if !caps[domain].Available {
				continue
			}
			availableAliases := make([]string, 0, len(categoryAliases[domain]))
			for _, alias := range categoryAliases[domain] {
				if capability, ok := caps[alias]; ok && capability.Available {
					availableAliases = append(availableAliases, alias)
				}
			}
			provider := providerDomains[domain]
			label := domainLabels[domain]
			if matchQuery(query, domain, label, strings.Join(availableAliases, " "), provider) {
				results = append(results, map[string]any{"id": "page:" + domain, "title": label, "label": label, "type": "page", "domain": domain, "description": "Settings category", "capabilities": categoryAliases[domain]})
			}
			value, _, err := s.settingsObject(domain)
			if err != nil {
				continue
			}
			for key, rawValue := range value {
				var parsed any
				_ = json.Unmarshal(rawValue, &parsed)
				if matchQuery(query, key) {
					results = append(results, map[string]any{"id": domain + "." + key, "title": key, "label": key, "type": "setting", "domain": domain, "key": key, "value": parsed, "description": label + " setting"})
				}
			}
		}
		for _, name := range requiredCapabilities {
			if capability := caps[name]; capability.Available && matchQuery(query, name) {
				results = append(results, map[string]any{"id": "capability:" + name, "title": name, "label": name, "type": "capability", "capability": name, "description": capability.Reason})
			}
		}
		sort.SliceStable(results, func(i, j int) bool {
			left, right := fmt.Sprint(results[i]["type"]), fmt.Sprint(results[j]["type"])
			if left != right {
				return left < right
			}
			return fmt.Sprint(results[i]["id"]) < fmt.Sprint(results[j]["id"])
		})
	}
	jsonResponse(w, 200, map[string]any{"query": rawQuery, "results": results, "count": len(results)})
}

func confirmedRequest(body map[string]any) bool {
	value, ok := body["confirm"]
	if !ok {
		return false
	}
	confirmed, ok := value.(bool)
	return ok && confirmed
}

func actionCapabilityName(spec actionSpec) string {
	if spec.Capability != "" {
		return spec.Capability
	}
	return spec.Domain
}

// actionAuditDomain attributes an audit entry to a settings domain or capability.
func actionAuditDomain(spec actionSpec) string {
	if spec.Domain != "" {
		return spec.Domain
	}
	return actionCapabilityName(spec)
}

func actionAuditDetails(path string, spec actionSpec, body map[string]any, confirmed bool) map[string]any {
	details := map[string]any{"path": path, "dangerous": spec.Dangerous, "confirmed": confirmed}
	if name := actionCapabilityName(spec); name != "" {
		details["capability"] = name
	}
	if spec.Domain != "" {
		details["domain"] = spec.Domain
	}
	for key, value := range body {
		if key == "confirm" {
			continue
		}
		details[key] = value
	}
	return details
}

func (s *server) decodeActionBody(w http.ResponseWriter, r *http.Request) (map[string]any, bool) {
	body := map[string]any{}
	if r.Body == nil {
		return body, true
	}
	if err := decodeOne(r, w, &body); err != nil && !errors.Is(err, io.EOF) {
		fail(w, 400, "invalid_json", "request body must be valid JSON")
		return nil, false
	}
	if body == nil {
		body = map[string]any{}
	}
	return body, true
}

// providerAction handles non-settings provider calls. It never performs an OS
// write: mock-safe actions return a labelled {"mock":true} acceptance, dangerous
// actions require explicit confirmation and stay unavailable.
func (s *server) providerAction(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	spec, ok := providerActions[path]
	if !ok {
		fail(w, 404, "unknown_action", "unknown provider action")
		return
	}
	body, ok := s.decodeActionBody(w, r)
	if !ok {
		return
	}
	confirmed := confirmedRequest(body)
	if spec.Dangerous && !confirmed {
		failWith(w, http.StatusConflict, "confirmation_required", "dangerous actions require an explicit \"confirm\": true in the request body", map[string]any{"confirmationRequired": true, "action": path})
		return
	}
	details := actionAuditDetails(path, spec, body, spec.Dangerous && confirmed)
	if spec.Dangerous && s.allowSystemControl {
		s.logAudit("provider_action.refused", actionAuditDomain(spec), details)
		failWith(w, http.StatusNotImplemented, "system_control_not_implemented", "settingsd does not implement privileged system control; no action was performed", map[string]any{"action": path, "available": false, "source": "mock", "mock": true, "performed": false, "dangerous": true, "confirmed": confirmed})
		return
	}
	if spec.Dangerous {
		s.logAudit("provider_action.rejected", actionAuditDomain(spec), details)
		failWith(w, http.StatusServiceUnavailable, "provider_unavailable", "no privileged system provider is configured; no action was performed", map[string]any{"action": path, "available": false, "source": "mock", "mock": true, "performed": false, "dangerous": true, "confirmed": true})
		return
	}
	name := actionCapabilityName(spec)
	capability := s.capabilityData()[name]
	if !capability.Available {
		s.logAudit("provider_action.rejected", actionAuditDomain(spec), details)
		failWith(w, http.StatusForbidden, "capability_unavailable", fmt.Sprintf("capability %s is unavailable: %s", name, capability.Reason), map[string]any{"action": path, "capability": name, "domain": spec.Domain, "reason": capability.Reason, "available": false, "source": "mock", "mock": true})
		return
	}
	if !spec.MockSafe {
		s.logAudit("provider_action.rejected", actionAuditDomain(spec), details)
		failWith(w, http.StatusServiceUnavailable, "provider_unavailable", "no system provider is configured; no action was performed", map[string]any{"action": path, "capability": name, "available": false, "source": "mock", "mock": true, "performed": false})
		return
	}
	s.logAudit("mock_action.accepted", actionAuditDomain(spec), details)
	jsonResponse(w, 200, map[string]any{"action": path, "capability": name, "mock": true, "performed": false, "available": true, "source": "mock", "confirmationRequired": false, "reason": "mock provider accepted the request; no system changes were performed"})
}

func (s *server) restartService(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var status string
	var available bool
	err := s.db.QueryRow(`SELECT status,available FROM service_status WHERE id=?`, id).Scan(&status, &available)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 404, "unknown_service", "unknown service id")
		return
	}
	if err != nil {
		fail(w, 500, "database_error", "could not read service status")
		return
	}
	body, ok := s.decodeActionBody(w, r)
	if !ok {
		return
	}
	path := "services/" + id + "/restart"
	if !confirmedRequest(body) {
		failWith(w, http.StatusConflict, "confirmation_required", "service restart requires an explicit \"confirm\": true in the request body", map[string]any{"confirmationRequired": true, "service": id})
		return
	}
	details := map[string]any{"path": path, "service": id, "status": status, "available": available, "dangerous": true, "confirmed": true}
	if s.allowSystemControl {
		s.logAudit("provider_action.refused", id, details)
		failWith(w, http.StatusNotImplemented, "system_control_not_implemented", "settingsd does not implement privileged system control; no service was restarted", map[string]any{"service": id, "mock": true, "performed": false, "dangerous": true, "confirmed": true})
		return
	}
	s.logAudit("provider_action.rejected", id, details)
	failWith(w, http.StatusServiceUnavailable, "provider_unavailable", "service restart is mock-only; no privileged service provider is configured", map[string]any{"service": id, "status": status, "available": available, "mock": true, "performed": false, "restartable": false, "source": "mock"})
}

func (s *server) logAudit(action, domain string, details map[string]any) {
	b, _ := json.Marshal(redact(details))
	_, _ = s.db.Exec(`INSERT INTO audit_log(action,domain,details,created_at) VALUES(?,?,?,?)`, action, domain, string(b), now())
}

func auditFlags(parsed any) (dangerous, confirmed bool) {
	details, ok := parsed.(map[string]any)
	if !ok {
		return false, false
	}
	if value, ok := details["dangerous"].(bool); ok {
		dangerous = value
	}
	if value, ok := details["confirmed"].(bool); ok {
		confirmed = value
	}
	return dangerous, confirmed
}

// audit returns recent redacted entries plus a sanitized summary of audited
// settings changes and provider actions.
func (s *server) audit(w http.ResponseWriter, _ *http.Request) {
	rows, err := s.db.Query(`SELECT id,action,domain,details,created_at FROM audit_log ORDER BY id DESC LIMIT 200`)
	if err != nil {
		fail(w, 500, "database_error", "could not read audit log")
		return
	}
	defer rows.Close()
	entries := make([]map[string]any, 0)
	byAction := map[string]int{}
	byDomain := map[string]int{}
	dangerousCount, confirmedCount, rejectedCount := 0, 0, 0
	lastEventAt := ""
	for rows.Next() {
		var id int64
		var action, domain, details, created string
		if rows.Scan(&id, &action, &domain, &details, &created) != nil {
			continue
		}
		var parsed any = map[string]any{}
		if json.Unmarshal([]byte(details), &parsed) != nil {
			parsed = map[string]any{}
		}
		parsed = redact(parsed)
		dangerous, confirmed := auditFlags(parsed)
		entries = append(entries, map[string]any{"id": id, "action": action, "domain": domain, "details": parsed, "createdAt": created, "dangerous": dangerous, "confirmed": confirmed})
		byAction[action]++
		if domain != "" {
			byDomain[domain]++
		}
		if dangerous {
			dangerousCount++
		}
		if confirmed {
			confirmedCount++
		}
		if action == "provider_action.rejected" {
			rejectedCount++
		}
		if lastEventAt == "" {
			lastEventAt = created
		}
	}
	summary := map[string]any{
		"total": len(entries), "dangerous": dangerousCount, "confirmed": confirmedCount, "rejected": rejectedCount,
		"byAction": byAction, "byDomain": byDomain, "lastEventAt": lastEventAt,
		"sanitized": true, "mockOnly": true,
	}
	jsonResponse(w, 200, map[string]any{"entries": entries, "summary": summary, "dangerousActions": dangerousActionPaths()})
}

// credentialKey reports whether a settings key names a credential. Settings
// JSON is stored in plaintext SQLite, so such keys must be refused outright
// rather than merely redacted in the audit trail.
func credentialKey(key string) bool {
	normalized := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(key, "-", "_"), " ", "_"))
	return sensitive[normalized] || strings.Contains(normalized, "password") || strings.Contains(normalized, "passwd") ||
		strings.HasSuffix(normalized, "_token") || strings.HasSuffix(normalized, "_secret") || strings.HasSuffix(normalized, "_key") ||
		strings.Contains(normalized, "credential")
}

// findCredentialKey walks a settings value and returns the first credential-like
// key path, or "" when the payload contains no credentials.
func findCredentialKey(value any, path string) string {
	switch v := value.(type) {
	case map[string]any:
		for key, item := range v {
			child := key
			if path != "" {
				child = path + "." + key
			}
			if credentialKey(key) {
				return child
			}
			if found := findCredentialKey(item, child); found != "" {
				return found
			}
		}
	case []any:
		for i, item := range v {
			if found := findCredentialKey(item, fmt.Sprintf("%s[%d]", path, i)); found != "" {
				return found
			}
		}
	}
	return ""
}

func redact(value any) any {
	switch v := value.(type) {
	case map[string]any:
		out := make(map[string]any, len(v))
		for key, item := range v {
			normalized := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(key, "-", "_"), " ", "_"))
			if sensitive[normalized] || strings.Contains(normalized, "password") || strings.Contains(normalized, "passwd") || strings.HasSuffix(normalized, "_token") || strings.HasSuffix(normalized, "_secret") || strings.HasSuffix(normalized, "_key") {
				out[key] = "[REDACTED]"
			} else {
				out[key] = redact(item)
			}
		}
		return out
	case []any:
		out := make([]any, len(v))
		for i, item := range v {
			out[i] = redact(item)
		}
		return out
	default:
		return value
	}
}

func decodeOne(r *http.Request, w http.ResponseWriter, dst any) error {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.UseNumber()
	if err := dec.Decode(dst); err != nil {
		return err
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		return errors.New("request contains multiple JSON values")
	}
	return nil
}

// readHostInfo collects read-only host information. It never writes to the host
// and returns partial data when a specific /proc file is unavailable.
func readHostInfo() map[string]any {
	info := map[string]any{"collectedAt": now(), "arch": runtime.GOARCH}
	if hostname, err := os.Hostname(); err == nil && hostname != "" {
		info["hostname"] = hostname
	}
	if kernel := readTrimmedFile("/proc/sys/kernel/osrelease"); kernel != "" {
		info["kernel"] = kernel
	}
	if osRelease := parseKeyValueFile("/etc/os-release", "="); len(osRelease) > 0 {
		info["os"] = osRelease
	}
	memory := map[string]any{}
	meminfo := parseMemInfo("/proc/meminfo")
	if total, ok := meminfo["MemTotal"]; ok {
		memory["totalBytes"] = total
	}
	if available, ok := meminfo["MemAvailable"]; ok {
		memory["availableBytes"] = available
	}
	info["memory"] = memory
	cpu := map[string]any{"cores": runtime.NumCPU()}
	if model := cpuModel(); model != "" {
		cpu["model"] = model
	}
	info["cpu"] = cpu
	info["network"] = networkSummary()
	return info
}

func readTrimmedFile(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

func parseKeyValueFile(path, separator string) map[string]string {
	out := map[string]string{}
	data, err := os.ReadFile(path)
	if err != nil {
		return out
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, separator)
		if !ok {
			continue
		}
		out[strings.TrimSpace(key)] = strings.Trim(strings.TrimSpace(value), `"'`)
	}
	return out
}

func parseMemInfo(path string) map[string]int64 {
	out := map[string]int64{}
	data, err := os.ReadFile(path)
	if err != nil {
		return out
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		key := strings.TrimSuffix(fields[0], ":")
		value, err := strconv.ParseInt(fields[1], 10, 64)
		if err != nil {
			continue
		}
		if len(fields) > 2 && strings.EqualFold(fields[2], "kB") {
			value *= 1024
		}
		out[key] = value
	}
	return out
}

func cpuModel() string {
	data, err := os.ReadFile("/proc/cpuinfo")
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		switch strings.TrimSpace(key) {
		case "model name", "Hardware", "Processor":
			if model := strings.TrimSpace(value); model != "" {
				return model
			}
		}
	}
	return ""
}

type networkInterface struct {
	Name      string   `json:"name"`
	Up        bool     `json:"up"`
	Loopback  bool     `json:"loopback"`
	Addresses []string `json:"addresses"`
}

func networkSummary() []networkInterface {
	out := make([]networkInterface, 0)
	interfaces, err := net.Interfaces()
	if err != nil {
		return out
	}
	for _, iface := range interfaces {
		addresses := make([]string, 0, 2)
		if addrs, err := iface.Addrs(); err == nil {
			for _, addr := range addrs {
				if len(addresses) >= 4 {
					break
				}
				addresses = append(addresses, addr.String())
			}
		}
		out = append(out, networkInterface{Name: iface.Name, Up: iface.Flags&net.FlagUp != 0, Loopback: iface.Flags&net.FlagLoopback != 0, Addresses: addresses})
		if len(out) >= 16 {
			break
		}
	}
	return out
}
