package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func testServer(t *testing.T) *server {
	t.Helper()
	db := openTestDB(t)
	if err := migrate(t.Context(), db); err != nil {
		t.Fatal(err)
	}
	return &server{db: db}
}

func testServerWithFlags(t *testing.T, readOnly, control bool) *server {
	t.Helper()
	db := openTestDB(t)
	if err := migrate(t.Context(), db); err != nil {
		t.Fatal(err)
	}
	return &server{db: db, allowSystemReadOnly: readOnly, allowSystemControl: control}
}

func request(t *testing.T, s *server, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	s.routes().ServeHTTP(w, r)
	return w
}

func decodeBody(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("invalid JSON body %q: %v", w.Body.String(), err)
	}
	return out
}

func errorCode(t *testing.T, w *httptest.ResponseRecorder) string {
	t.Helper()
	payload := decodeBody(t, w)
	envelope, ok := payload["error"].(map[string]any)
	if !ok {
		t.Fatalf("missing error envelope in %s", w.Body)
	}
	return fmt.Sprint(envelope["code"])
}

func auditActions(t *testing.T, s *server) []string {
	t.Helper()
	w := request(t, s, http.MethodGet, "/api/audit", "")
	if w.Code != http.StatusOK {
		t.Fatalf("audit status=%d", w.Code)
	}
	payload := decodeBody(t, w)
	entries := payload["entries"].([]any)
	actions := make([]string, 0, len(entries))
	for _, entry := range entries {
		actions = append(actions, fmt.Sprint(entry.(map[string]any)["action"]))
	}
	return actions
}

func TestSettingsPersistOnlyWhenCapabilityVisible(t *testing.T) {
	s := testServer(t)
	if w := request(t, s, http.MethodPut, "/api/capabilities/profile", `{"hardwareProfile":"Desktop"}`); w.Code != 200 {
		t.Fatalf("select local mock profile status=%d", w.Code)
	}
	if w := request(t, s, http.MethodPut, "/api/settings/display", `{"brightness":42}`); w.Code != 200 {
		t.Fatalf("PUT status=%d body=%s", w.Code, w.Body)
	}
	w := request(t, s, http.MethodGet, "/api/settings/display", "")
	var got map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got["brightness"] != float64(42) {
		t.Fatalf("persisted settings=%v", got)
	}
	if w := request(t, s, http.MethodGet, "/api/settings/arbitrary", ""); w.Code != 404 {
		t.Fatalf("unknown domain status=%d", w.Code)
	}
}

func TestMigrationCreatesRequiredTables(t *testing.T) {
	s := testServer(t)
	for _, table := range []string{"profiles", "service_status", "accounts", "sync_providers", "device_state", "preferences", "settings", "audit_log", "schema_migrations", "profile_overrides"} {
		var name string
		if err := s.db.QueryRow(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, table).Scan(&name); err != nil {
			t.Errorf("missing table %s: %v", table, err)
		}
	}
}

func TestUIAndHardwareProfilesAreIndependent(t *testing.T) {
	s := testServer(t)
	if s.currentProfile() != "Desktop" || s.currentHardwareProfile() != "unavailable" {
		t.Fatalf("defaults ui=%q hardware=%q", s.currentProfile(), s.currentHardwareProfile())
	}
	if w := request(t, s, http.MethodPut, "/api/capabilities/profile", `{"profile":"RG40XX"}`); w.Code != 200 {
		t.Fatalf("UI profile status=%d", w.Code)
	}
	if s.currentProfile() != "RG40XX" || s.currentHardwareProfile() != "unavailable" {
		t.Fatalf("UI update changed wrong state: ui=%q hardware=%q", s.currentProfile(), s.currentHardwareProfile())
	}
	if w := request(t, s, http.MethodPut, "/api/capabilities/profile", `{"hardwareProfile":"Leaf3C"}`); w.Code != 200 {
		t.Fatalf("hardware profile status=%d", w.Code)
	}
	if s.currentProfile() != "RG40XX" || s.currentHardwareProfile() != "Leaf3C" {
		t.Fatalf("hardware update changed wrong state: ui=%q hardware=%q", s.currentProfile(), s.currentHardwareProfile())
	}
	if w := request(t, s, http.MethodPut, "/api/capabilities/profile", `{"hardwareProfile":"unknown"}`); w.Code != 400 {
		t.Fatalf("invalid hardware profile status=%d", w.Code)
	}
	if w := request(t, s, http.MethodPut, "/api/capabilities/profile", `{"profile":"unknown"}`); w.Code != 400 {
		t.Fatalf("invalid UI profile status=%d", w.Code)
	}
}

func TestPreferencesRouteAlsoControlsUIProfile(t *testing.T) {
	s := testServer(t)
	if w := request(t, s, http.MethodPut, "/api/preferences/profile", `{"profile":"CubeXX"}`); w.Code != 200 {
		t.Fatalf("preferences profile status=%d", w.Code)
	}
	if s.currentProfile() != "CubeXX" || s.currentHardwareProfile() != "unavailable" {
		t.Fatalf("preferences UI update wrong: ui=%q hardware=%q", s.currentProfile(), s.currentHardwareProfile())
	}
	if w := request(t, s, http.MethodPut, "/api/preferences", `{"theme":"oled"}`); w.Code != 200 {
		t.Fatalf("preferences status=%d", w.Code)
	}
	if w := request(t, s, http.MethodGet, "/api/preferences", ""); w.Code != 200 {
		t.Fatalf("get preferences status=%d", w.Code)
	}
	if w := request(t, s, http.MethodPut, "/api/preferences", `{"theme":""}`); w.Code != 400 {
		t.Fatalf("empty preference status=%d", w.Code)
	}
}

func TestCredentialKeysAreRefusedAndAuditRedacts(t *testing.T) {
	s := testServer(t)
	if w := request(t, s, http.MethodPut, "/api/capabilities/profile", `{"hardwareProfile":"Desktop"}`); w.Code != 200 {
		t.Fatalf("select mock profile status=%d", w.Code)
	}
	// Credential-like keys must be refused before persistence, at any depth.
	for _, payload := range []string{
		`{"ssid":"Home","wifi_password":"secretvalue"}`,
		`{"nested":{"access_token":"abcvalue"}}`,
		`{"client_secret":"xyzvalue"}`,
	} {
		w := request(t, s, http.MethodPut, "/api/settings/network", payload)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("credential payload %s status=%d body=%s", payload, w.Code, w.Body)
		}
		if code := errorCode(t, w); code != "credential_not_allowed" {
			t.Fatalf("credential payload %s code=%s", payload, code)
		}
	}
	stored := request(t, s, http.MethodGet, "/api/settings/network", "")
	for _, secret := range []string{"secretvalue", "abcvalue", "xyzvalue"} {
		if bytes.Contains(stored.Body.Bytes(), []byte(secret)) {
			t.Fatalf("credential material persisted: %s", stored.Body)
		}
	}
	// Provider actions remain mock-acknowledged, and their audit details are
	// redacted rather than storing credential values.
	w := request(t, s, http.MethodPost, "/api/network/wifi/connect", `{"ssid":"Home","nested":{"access_token":"abcvalue","safe":"yes"}}`)
	if w.Code != http.StatusOK {
		t.Fatalf("mock wifi connect status=%d body=%s", w.Code, w.Body)
	}
	audit := request(t, s, http.MethodGet, "/api/audit", "")
	if bytes.Contains(audit.Body.Bytes(), []byte("abcvalue")) {
		t.Fatalf("audit leaked credential value: %s", audit.Body)
	}
	if !bytes.Contains(audit.Body.Bytes(), []byte("[REDACTED]")) || !bytes.Contains(audit.Body.Bytes(), []byte("sanitized")) {
		t.Fatalf("audit missing redaction/sanitized summary: %s", audit.Body)
	}
}

func TestUnavailableDefaultAndProfileCapabilityData(t *testing.T) {
	s := testServer(t)
	for _, c := range s.capabilityData() {
		if c.Available {
			t.Fatalf("capability unexpectedly available by default: %+v", c)
		}
	}
	if w := request(t, s, http.MethodPost, "/api/mock/profile", `{"profile":"RG35XX"}`); w.Code != 200 {
		t.Fatalf("mock profile status=%d", w.Code)
	}
	caps := s.capabilityData()
	if c := caps["display"]; c.Available {
		t.Fatalf("RG35XX must not expose display without a display capability: %+v", c)
	}
	if c := caps["remote"]; c.Available {
		t.Fatalf("unexpected remote capability=%+v", c)
	}
	w := request(t, s, http.MethodGet, "/api/settings/categories", "")
	var categories struct {
		Categories []map[string]any `json:"categories"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &categories); err != nil {
		t.Fatal(err)
	}
	if len(categories.Categories) == 0 {
		t.Fatal("selected profile should expose matching categories")
	}
}

func TestHardwareProfilesExposeRequiredCapabilitySets(t *testing.T) {
	s := testServer(t)
	wanted := map[string][]string{
		"RG34XX":  {"WiFi", "Bluetooth", "Battery", "SDCard", "USB"},
		"RG35XX":  {"WiFi", "Bluetooth", "Battery", "SDCard", "USB"},
		"RG40XX":  {"WiFi", "Bluetooth", "Battery", "SDCard", "USB"},
		"CubeXX":  {"WiFi", "Bluetooth", "Battery", "SDCard", "USB"},
		"M21":     {"Audio", "Bluetooth", "Battery", "Storage"},
		"Leaf3C":  {"EInk", "Touchscreen", "Battery", "WiFi"},
		"Desktop": {"WiFi", "Bluetooth", "Ethernet", "Audio", "Display", "SSH", "PowerManagement"},
	}
	for profile, want := range wanted {
		if w := request(t, s, http.MethodPut, "/api/capabilities/profile", fmt.Sprintf(`{"hardwareProfile":"%s"}`, profile)); w.Code != 200 {
			t.Fatalf("profile %s status=%d", profile, w.Code)
		}
		got := s.capabilityData()
		for _, name := range want {
			if c, ok := got[name]; !ok || !c.Available || c.Controllable {
				t.Errorf("profile %s capability %s=%+v", profile, name, c)
			}
		}
		for name, c := range got {
			if !c.Available && c.Reason == "" {
				t.Errorf("profile %s unavailable capability %s has no reason", profile, name)
			}
		}
		if len(got) != len(requiredCapabilities)+len(domains) {
			t.Errorf("profile %s metadata count=%d", profile, len(got))
		}
		if profile == "RG34XX" {
			if !got["developer"].Available {
				t.Errorf("RG34XX developer category must be reachable through USB: %+v", got["developer"])
			}
		}
	}
}

func TestCapabilityResponseListsEveryRequiredID(t *testing.T) {
	s := testServer(t)
	if w := request(t, s, http.MethodPut, "/api/capabilities/profile", `{"hardwareProfile":"RG34XX"}`); w.Code != 200 {
		t.Fatalf("hardware profile status=%d", w.Code)
	}
	w := request(t, s, http.MethodGet, "/api/capabilities", "")
	if w.Code != http.StatusOK {
		t.Fatalf("capabilities status=%d", w.Code)
	}
	payload := decodeBody(t, w)
	caps := payload["capabilities"].(map[string]any)
	for _, name := range requiredCapabilities {
		raw, ok := caps[name].(map[string]any)
		if !ok {
			t.Fatalf("missing required capability %s", name)
		}
		if raw["source"] != "mock" {
			t.Errorf("capability %s source=%v", name, raw["source"])
		}
		if raw["available"] == false && fmt.Sprint(raw["reason"]) == "" {
			t.Errorf("capability %s unavailable without reason", name)
		}
	}
	if payload["mock"] != true || payload["source"] != "mock" {
		t.Errorf("capability payload must be labelled mock: %v", payload)
	}
}

func TestUIProfileDoesNotChangeCapabilities(t *testing.T) {
	s := testServer(t)
	if w := request(t, s, http.MethodPut, "/api/capabilities/profile", `{"hardwareProfile":"Desktop"}`); w.Code != 200 {
		t.Fatalf("hardware profile status=%d", w.Code)
	}
	before, _ := json.Marshal(s.capabilityData())
	for _, uiProfile := range []string{"RG34XX", "Leaf3C", "M21"} {
		if w := request(t, s, http.MethodPut, "/api/capabilities/profile", fmt.Sprintf(`{"profile":"%s"}`, uiProfile)); w.Code != 200 {
			t.Fatalf("ui profile %s status=%d", uiProfile, w.Code)
		}
		after, _ := json.Marshal(s.capabilityData())
		if !bytes.Equal(before, after) {
			t.Fatalf("UI profile %s changed capabilities", uiProfile)
		}
	}
}

func TestProfileOverridesPrecedenceAndCRUD(t *testing.T) {
	s := testServer(t)
	if w := request(t, s, http.MethodPut, "/api/capabilities/profile", `{"hardwareProfile":"Desktop"}`); w.Code != 200 {
		t.Fatalf("hardware profile status=%d", w.Code)
	}
	if w := request(t, s, http.MethodPut, "/api/settings/display", `{"brightness":30,"rotation":90}`); w.Code != 200 {
		t.Fatalf("base settings status=%d", w.Code)
	}
	if w := request(t, s, http.MethodPut, "/api/settings/display/overrides/Desktop", `{"brightness":88}`); w.Code != 200 {
		t.Fatalf("override put status=%d body=%s", w.Code, w.Body)
	}
	w := request(t, s, http.MethodGet, "/api/settings/display", "")
	if got := decodeBody(t, w); got["brightness"] != float64(88) || got["rotation"] != float64(90) {
		t.Fatalf("merged settings=%v", got)
	}
	if w.Header().Get("X-Settings-Override-Profile") != "Desktop" {
		t.Fatalf("missing override header: %v", w.Header())
	}
	if w := request(t, s, http.MethodGet, "/api/settings/display/overrides/Desktop", ""); w.Code != 200 {
		t.Fatalf("override get status=%d", w.Code)
	} else if value := decodeBody(t, w)["value"].(map[string]any); value["brightness"] != float64(88) {
		t.Fatalf("override value=%v", value)
	}
	list := decodeBody(t, request(t, s, http.MethodGet, "/api/settings/display/overrides", ""))
	if list["activeProfile"] != "Desktop" {
		t.Fatalf("override list=%v", list)
	}
	if _, ok := list["overrides"].(map[string]any)["Desktop"]; !ok {
		t.Fatalf("override list missing Desktop: %v", list)
	}
	if w := request(t, s, http.MethodDelete, "/api/settings/display/overrides/Desktop", ""); w.Code != 200 {
		t.Fatalf("override delete status=%d", w.Code)
	}
	if got := decodeBody(t, request(t, s, http.MethodGet, "/api/settings/display", "")); got["brightness"] != float64(30) {
		t.Fatalf("override delete left stale value: %v", got)
	}
	if w := request(t, s, http.MethodDelete, "/api/settings/display/overrides/Desktop", ""); w.Code != 404 {
		t.Fatalf("second delete status=%d", w.Code)
	}
	if w := request(t, s, http.MethodPut, "/api/settings/display/overrides/Unknown", `{"brightness":1}`); w.Code != 400 {
		t.Fatalf("unknown profile override status=%d", w.Code)
	}
	if w := request(t, s, http.MethodPut, "/api/settings/display/overrides/Desktop", `{}`); w.Code != 400 {
		t.Fatalf("empty override status=%d", w.Code)
	}
	// Unknown domains are rejected before any override is written.
	if w := request(t, s, http.MethodPut, "/api/settings/balance/overrides/Desktop", `{"x":1}`); w.Code != 404 {
		t.Fatalf("unknown override domain status=%d", w.Code)
	}
}

func TestOverridesSeededAndAppliedForMockProfile(t *testing.T) {
	s := testServer(t)
	if w := request(t, s, http.MethodPut, "/api/capabilities/profile", `{"hardwareProfile":"RG34XX"}`); w.Code != 200 {
		t.Fatalf("hardware profile status=%d", w.Code)
	}
	// RG34XX has WiFi, so its seeded network override applies to reads.
	if w := request(t, s, http.MethodGet, "/api/settings/network", ""); w.Code != 200 {
		t.Fatalf("network settings status=%d", w.Code)
	} else if got := decodeBody(t, w); got["wifiEnabled"] != true {
		t.Fatalf("seeded RG34XX override not applied: %v", got)
	}
	if w := request(t, s, http.MethodGet, "/api/settings/network/overrides", ""); w.Code != 200 {
		t.Fatalf("override list status=%d", w.Code)
	} else if overrides := decodeBody(t, w)["overrides"].(map[string]any); overrides["RG34XX"] == nil {
		t.Fatalf("seeded override missing: %v", overrides)
	}
	// RG34XX has no Display capability, so display overrides are refused for writes.
	if w := request(t, s, http.MethodPut, "/api/settings/display/overrides/RG34XX", `{"brightness":10}`); w.Code != http.StatusForbidden {
		t.Fatalf("unavailable capability override status=%d", w.Code)
	}
	if code := errorCode(t, request(t, s, http.MethodPut, "/api/settings/display/overrides/RG34XX", `{"brightness":10}`)); code != "capability_unavailable" {
		t.Fatalf("override error code=%s", code)
	}
	if w := request(t, s, http.MethodDelete, "/api/settings/display/overrides/RG34XX", ""); w.Code != http.StatusForbidden {
		t.Fatalf("unavailable capability override delete status=%d", w.Code)
	}
	// A writable override for the active mock profile replaces the base value.
	if w := request(t, s, http.MethodPut, "/api/settings/network", `{"wifiEnabled":true,"ethernetEnabled":false}`); w.Code != 200 {
		t.Fatalf("base network write status=%d body=%s", w.Code, w.Body)
	}
	if w := request(t, s, http.MethodPut, "/api/settings/network/overrides/RG34XX", `{"wifiEnabled":false}`); w.Code != 200 {
		t.Fatalf("network override put status=%d body=%s", w.Code, w.Body)
	}
	if got := decodeBody(t, request(t, s, http.MethodGet, "/api/settings/network", "")); got["wifiEnabled"] != false {
		t.Fatalf("override precedence not applied: %v", got)
	}
	if got := decodeBody(t, request(t, s, http.MethodDelete, "/api/settings/network/overrides/RG34XX", "")); got["deleted"] != true {
		t.Fatalf("override delete response=%v", got)
	}
	if got := decodeBody(t, request(t, s, http.MethodGet, "/api/settings/network", "")); got["wifiEnabled"] != true {
		t.Fatalf("base settings not restored after override delete: %v", got)
	}
}

func TestDisabledProviderActionsAreRejectedAndAudited(t *testing.T) {
	s := testServer(t)
	w := request(t, s, http.MethodPost, "/api/power/shutdown", `{"reason":"requested","confirm":true}`)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("confirmed action status=%d body=%s", w.Code, w.Body)
	}
	if code := errorCode(t, w); code != "provider_unavailable" {
		t.Fatalf("action error code=%s", code)
	}
	if payload := decodeBody(t, w); payload["performed"] != false || payload["dangerous"] != true {
		t.Fatalf("action response=%v", payload)
	}
	w = request(t, s, http.MethodPost, "/api/services/wifi/restart", `{"confirm":true}`)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("restart action status=%d", w.Code)
	}
	actions := strings.Join(auditActions(t, s), ",")
	if !strings.Contains(actions, "provider_action.rejected") {
		t.Fatalf("audit actions=%s", actions)
	}
	if strings.Contains(actions, "mock_action.accepted") {
		t.Fatalf("dangerous action was not audited as rejected: %s", actions)
	}
}

func TestDangerousActionsRequireConfirmationBeforeAudit(t *testing.T) {
	s := testServer(t)
	for _, path := range []string{"/api/power/shutdown", "/api/power/reboot", "/api/system/factory-reset", "/api/updates/install", "/api/updates/rollback", "/api/accounts/delete", "/api/storage/format", "/api/remote/start", "/api/services/wifi/restart"} {
		w := request(t, s, http.MethodPost, path, `{}`)
		if w.Code != http.StatusConflict {
			t.Fatalf("%s missing confirmation status=%d body=%s", path, w.Code, w.Body)
		}
		if code := errorCode(t, w); code != "confirmation_required" {
			t.Fatalf("%s confirmation error code=%s", path, code)
		}
		payload := decodeBody(t, w)
		if payload["confirmationRequired"] != true {
			t.Fatalf("%s response=%v", path, payload)
		}
	}
	if actions := strings.Join(auditActions(t, s), ","); strings.Contains(actions, "provider_action") {
		t.Fatalf("unconfirmed actions must not be audited: %s", actions)
	}
	w := request(t, s, http.MethodPost, "/api/power/shutdown", `{"confirm":true}`)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("confirmed shutdown status=%d", w.Code)
	}
	entries := decodeBody(t, request(t, s, http.MethodGet, "/api/audit", ""))["entries"].([]any)
	entry := entries[0].(map[string]any)
	if entry["dangerous"] != true || entry["confirmed"] != true || entry["action"] != "provider_action.rejected" {
		t.Fatalf("audit entry=%v", entry)
	}
	details := entry["details"].(map[string]any)
	if details["confirmed"] != true || details["dangerous"] != true {
		t.Fatalf("audit details=%v", details)
	}
}

func TestSystemControlFlagRefusesInsteadOfExecuting(t *testing.T) {
	s := testServerWithFlags(t, false, true)
	w := request(t, s, http.MethodPost, "/api/power/shutdown", `{"confirm":true}`)
	if w.Code != http.StatusNotImplemented {
		t.Fatalf("system control status=%d body=%s", w.Code, w.Body)
	}
	if code := errorCode(t, w); code != "system_control_not_implemented" {
		t.Fatalf("system control code=%s", code)
	}
	if payload := decodeBody(t, w); payload["performed"] != false {
		t.Fatalf("system control response=%v", payload)
	}
	if !strings.Contains(strings.Join(auditActions(t, s), ","), "provider_action.refused") {
		t.Fatalf("refused action not audited: %v", auditActions(t, s))
	}
	w = request(t, s, http.MethodPost, "/api/services/wifi/restart", `{"confirm":true}`)
	if w.Code != http.StatusNotImplemented {
		t.Fatalf("service restart under control flag status=%d", w.Code)
	}
}

func TestCapabilityRouteAndDisabledSettingsWrite(t *testing.T) {
	s := testServer(t)
	w := request(t, s, http.MethodGet, "/api/capabilities", "")
	if w.Code != http.StatusOK {
		t.Fatalf("capabilities status=%d", w.Code)
	}
	var payload struct {
		Capabilities map[string]Capability `json:"capabilities"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	for _, name := range requiredCapabilities {
		if c, ok := payload.Capabilities[name]; !ok || c.Available {
			t.Errorf("default capability %s=%+v present=%v", name, c, ok)
		}
	}
	for _, domain := range domains {
		w := request(t, s, http.MethodPut, "/api/settings/"+domain, `{"enabled":true}`)
		if w.Code != http.StatusForbidden {
			t.Fatalf("disabled capability write for %s status=%d", domain, w.Code)
		}
		if code := errorCode(t, w); code != "capability_unavailable" {
			t.Fatalf("disabled capability write for %s code=%s", domain, code)
		}
	}
}

func TestAccountAndSyncProvidersAreListedUnavailable(t *testing.T) {
	s := testServer(t)
	accounts := request(t, s, http.MethodGet, "/api/accounts", "")
	if accounts.Code != http.StatusOK {
		t.Fatalf("accounts status=%d", accounts.Code)
	}
	for _, want := range []string{"Google", "GitHub", "Microsoft", "Mozilla"} {
		if !bytes.Contains(accounts.Body.Bytes(), []byte(`"`+want+`"`)) {
			t.Errorf("account provider %s missing: %s", want, accounts.Body)
		}
	}
	if bytes.Contains(accounts.Body.Bytes(), []byte(`"available":true`)) {
		t.Errorf("account providers must not claim availability: %s", accounts.Body)
	}
	sync := request(t, s, http.MethodGet, "/api/sync/providers", "")
	if sync.Code != http.StatusOK {
		t.Fatalf("sync providers status=%d", sync.Code)
	}
	for _, want := range []string{"WebDAV", "Nextcloud", "Syncthing", "Git"} {
		if !bytes.Contains(sync.Body.Bytes(), []byte(`"`+want+`"`)) {
			t.Errorf("sync provider %s missing: %s", want, sync.Body)
		}
	}
}

func TestProviderDomainsFollowServiceStatus(t *testing.T) {
	s := testServer(t)
	// Accounts/sync/updates are provider domains: unavailable while their mock
	// service rows are unavailable.
	for _, domain := range []string{"accounts", "sync", "updates"} {
		if s.capabilityData()[domain].Available {
			t.Fatalf("provider domain %s available without a service", domain)
		}
		if w := request(t, s, http.MethodPut, "/api/settings/"+domain, `{"x":1}`); w.Code != http.StatusForbidden {
			t.Fatalf("provider domain %s write status=%d", domain, w.Code)
		}
	}
	if _, err := s.db.Exec(`UPDATE service_status SET available=1,status='running' WHERE id='authd'`); err != nil {
		t.Fatal(err)
	}
	if c := s.capabilityData()["accounts"]; !c.Available || c.Controllable {
		t.Fatalf("accounts capability after authd running=%+v", c)
	}
	logout := request(t, s, http.MethodPost, "/api/accounts/logout", `{"id":"a"}`)
	if logout.Code != http.StatusOK {
		t.Fatalf("mock logout status=%d body=%s", logout.Code, logout.Body)
	}
	if payload := decodeBody(t, logout); payload["mock"] != true || payload["performed"] != false {
		t.Fatalf("mock logout response=%v", payload)
	}
	if _, err := s.db.Exec(`UPDATE service_status SET available=1,status='running' WHERE id='syncd'`); err != nil {
		t.Fatal(err)
	}
	sync := request(t, s, http.MethodPut, "/api/sync/config", `{"provider":"webdav","url":"https://example.invalid"}`)
	if sync.Code != http.StatusOK {
		t.Fatalf("sync config status=%d body=%s", sync.Code, sync.Body)
	}
	if payload := decodeBody(t, sync); payload["mock"] != true || payload["performed"] != false || payload["capability"] != "sync" {
		t.Fatalf("sync config response=%v", payload)
	}
}

func TestProviderActionsReturnStructuredResponses(t *testing.T) {
	s := testServer(t)
	// Unavailable capability: 403 with structured context.
	w := request(t, s, http.MethodPost, "/api/bluetooth/pair", `{"id":"pad"}`)
	if w.Code != http.StatusForbidden {
		t.Fatalf("bluetooth pair status=%d body=%s", w.Code, w.Body)
	}
	if code := errorCode(t, w); code != "capability_unavailable" {
		t.Fatalf("bluetooth pair code=%s", code)
	}
	if payload := decodeBody(t, w); payload["capability"] != "Bluetooth" {
		t.Fatalf("bluetooth pair response=%v", payload)
	}
	if w := request(t, s, http.MethodPut, "/api/sync/config", `{"provider":"webdav"}`); w.Code != http.StatusForbidden {
		t.Fatalf("sync config status=%d", w.Code)
	}
	if w := request(t, s, http.MethodPost, "/api/updates/check", "{}"); w.Code != http.StatusForbidden {
		t.Fatalf("updates check status=%d", w.Code)
	}
	// Available mock capability: labelled mock acceptance, never a real write.
	if w := request(t, s, http.MethodPut, "/api/capabilities/profile", `{"hardwareProfile":"Desktop"}`); w.Code != 200 {
		t.Fatalf("hardware profile status=%d", w.Code)
	}
	for _, path := range []string{"/api/network/wifi/connect", "/api/network/wifi/disconnect", "/api/bluetooth/pair", "/api/bluetooth/forget"} {
		w := request(t, s, http.MethodPost, path, `{"id":"x","ssid":"home"}`)
		if w.Code != http.StatusOK {
			t.Fatalf("%s status=%d body=%s", path, w.Code, w.Body)
		}
		payload := decodeBody(t, w)
		if payload["mock"] != true || payload["performed"] != false || payload["source"] != "mock" {
			t.Fatalf("%s response=%v", path, payload)
		}
	}
	// Storage depends on SDCard/Storage/USB: Desktop lacks them, RG34XX has them.
	if w := request(t, s, http.MethodPut, "/api/capabilities/profile", `{"hardwareProfile":"RG34XX"}`); w.Code != 200 {
		t.Fatalf("hardware profile status=%d", w.Code)
	}
	if w := request(t, s, http.MethodPost, "/api/storage/mount", `{"id":"x"}`); w.Code != http.StatusOK {
		t.Fatalf("storage mount status=%d body=%s", w.Code, w.Body)
	}
	if w := request(t, s, http.MethodPost, "/api/accounts/switch", `{"id":"a"}`); w.Code != http.StatusForbidden {
		t.Fatalf("accounts switch status=%d", w.Code)
	}
	if w := request(t, s, http.MethodPost, "/api/unknown/action", "{}"); w.Code != http.StatusNotFound {
		t.Fatalf("unknown action status=%d", w.Code)
	}
}

func TestServicesDashboardListsRequiredRows(t *testing.T) {
	s := testServer(t)
	w := request(t, s, http.MethodGet, "/api/services", "")
	if w.Code != http.StatusOK {
		t.Fatalf("services status=%d", w.Code)
	}
	payload := decodeBody(t, w)
	items := payload["services"].([]any)
	seen := map[string]bool{}
	for _, item := range items {
		row := item.(map[string]any)
		seen[fmt.Sprint(row["id"])] = true
		if row["mock"] != true || row["source"] != "mock" || row["restartable"] != false {
			t.Fatalf("service row not flagged mock: %v", row)
		}
		if row["available"] != false || row["status"] != "unavailable" {
			t.Fatalf("service row unexpectedly available: %v", row)
		}
		if fmt.Sprint(row["reason"]) == "" {
			t.Fatalf("service row missing reason: %v", row)
		}
	}
	for _, id := range []string{"storaged", "downloadsd", "authd", "syncd", "mediad", "notificationd"} {
		if !seen[id] {
			t.Errorf("service dashboard missing %s", id)
		}
	}
	if w := request(t, s, http.MethodPost, "/api/services/ghost/restart", `{"confirm":true}`); w.Code != http.StatusNotFound {
		t.Fatalf("unknown service status=%d", w.Code)
	}
}

func TestSearchCoversPagesSettingsAndCapabilities(t *testing.T) {
	s := testServer(t)
	if w := request(t, s, http.MethodGet, "/api/search?q=", ""); w.Code != 200 {
		t.Fatalf("empty search status=%d", w.Code)
	} else if results := decodeBody(t, w)["results"].([]any); len(results) != 0 {
		t.Fatalf("empty query returned results: %v", results)
	}
	if w := request(t, s, http.MethodPut, "/api/capabilities/profile", `{"hardwareProfile":"Desktop"}`); w.Code != 200 {
		t.Fatalf("hardware profile status=%d", w.Code)
	}
	w := request(t, s, http.MethodGet, "/api/search?q=wifi", "")
	if w.Code != 200 {
		t.Fatalf("search status=%d", w.Code)
	}
	results := decodeBody(t, w)["results"].([]any)
	var sawDomain, sawSetting, sawCapability bool
	for _, result := range results {
		row := result.(map[string]any)
		if row["type"] == "page" && row["domain"] == "network" {
			sawDomain = true
		}
		if row["type"] == "setting" && row["domain"] == "network" && row["key"] != nil {
			sawSetting = true
		}
		if row["type"] == "capability" && row["capability"] == "WiFi" {
			sawCapability = true
		}
	}
	if !sawDomain || !sawSetting || !sawCapability {
		t.Fatalf("search misses (domain=%v setting=%v capability=%v): %v", sawDomain, sawSetting, sawCapability, results)
	}
	// Search is capability filtered: RG34XX has no display capability.
	if w := request(t, s, http.MethodPut, "/api/capabilities/profile", `{"hardwareProfile":"RG34XX"}`); w.Code != 200 {
		t.Fatalf("hardware profile status=%d", w.Code)
	}
	if results := decodeBody(t, request(t, s, http.MethodGet, "/api/search?q=brightness", ""))["results"].([]any); len(results) != 0 {
		t.Fatalf("hidden capability leaked into search: %v", results)
	}
	// UI profile must not gate search results: hardware RG34XX has no EInk, so
	// the e-ink capability and display domain must stay hidden regardless of UI.
	if w := request(t, s, http.MethodPut, "/api/preferences/profile", `{"profile":"Leaf3C"}`); w.Code != 200 {
		t.Fatalf("ui profile status=%d", w.Code)
	}
	if s.capabilityData()["display"].Available {
		t.Fatal("UI profile leaked into capabilities")
	}
	if results := decodeBody(t, request(t, s, http.MethodGet, "/api/search?q=eink", ""))["results"].([]any); len(results) != 0 {
		t.Fatalf("UI profile changed capability filtering: %v", results)
	}
}

func TestAuditSummaryAndSanitization(t *testing.T) {
	s := testServer(t)
	if w := request(t, s, http.MethodPut, "/api/capabilities/profile", `{"hardwareProfile":"Desktop"}`); w.Code != 200 {
		t.Fatalf("hardware profile status=%d", w.Code)
	}
	if w := request(t, s, http.MethodPost, "/api/power/shutdown", `{"confirm":true,"password":"hunter2"}`); w.Code != http.StatusServiceUnavailable {
		t.Fatalf("shutdown status=%d", w.Code)
	}
	if w := request(t, s, http.MethodPost, "/api/power/shutdown", `{"confirm":true}`); w.Code != http.StatusServiceUnavailable {
		t.Fatalf("shutdown status=%d", w.Code)
	}
	w := request(t, s, http.MethodGet, "/api/audit", "")
	if w.Code != http.StatusOK {
		t.Fatalf("audit status=%d", w.Code)
	}
	payload := decodeBody(t, w)
	summary := payload["summary"].(map[string]any)
	if summary["sanitized"] != true || summary["mockOnly"] != true {
		t.Fatalf("audit summary=%v", summary)
	}
	if summary["dangerous"] != float64(2) || summary["confirmed"] != float64(2) || summary["rejected"] != float64(2) {
		t.Fatalf("audit counters=%v", summary)
	}
	byAction := summary["byAction"].(map[string]any)
	if byAction["provider_action.rejected"] != float64(2) {
		t.Fatalf("byAction=%v", byAction)
	}
	entries := payload["entries"].([]any)
	dangerousPaths := payload["dangerousActions"].([]any)
	foundShutdown := false
	for _, path := range dangerousPaths {
		if path == "/api/power/shutdown" {
			foundShutdown = true
		}
	}
	if !foundShutdown {
		t.Fatalf("dangerousActions=%v", dangerousPaths)
	}
	for _, entry := range entries {
		details := entry.(map[string]any)["details"].(map[string]any)
		if value, ok := details["password"]; ok && value != "[REDACTED]" {
			t.Fatalf("secret leaked into audit: %v", details)
		}
		if entry.(map[string]any)["dangerous"] != true {
			continue
		}
		if entry.(map[string]any)["confirmed"] != true {
			t.Fatalf("dangerous entry without confirmation flag: %v", entry)
		}
	}
}

func TestSystemInfoIsMockByDefault(t *testing.T) {
	s := testServer(t)
	w := request(t, s, http.MethodGet, "/api/system/info", "")
	if w.Code != http.StatusOK {
		t.Fatalf("system info status=%d", w.Code)
	}
	payload := decodeBody(t, w)
	if payload["available"] != false || payload["mock"] != true || payload["provider"] != "mock" {
		t.Fatalf("default system info=%v", payload)
	}
	for _, fake := range []string{"hostname", "kernel", "cpu", "memory", "os"} {
		if _, ok := payload[fake]; ok {
			t.Fatalf("default system info leaks host data %s: %v", fake, payload)
		}
	}
	if fmt.Sprint(payload["reason"]) == "" {
		t.Fatalf("default system info has no reason: %v", payload)
	}
}

func TestSystemInfoReadOnlyFlagExposesHostDataWithoutWrites(t *testing.T) {
	s := testServerWithFlags(t, true, false)
	payload := decodeBody(t, request(t, s, http.MethodGet, "/api/system/info", ""))
	if payload["available"] != true || payload["mock"] != false || payload["provider"] != "host-readonly" || payload["source"] != "host" {
		t.Fatalf("read-only system info=%v", payload)
	}
	if payload["hostProfile"] != "host" {
		t.Fatalf("host profile missing: %v", payload)
	}
	cpu, ok := payload["cpu"].(map[string]any)
	if !ok || cpu["cores"] == nil || fmt.Sprint(payload["arch"]) == "" {
		t.Fatalf("host arch/cpu missing: %v", payload)
	}
	if _, ok := payload["memory"].(map[string]any); !ok {
		t.Fatalf("host memory missing: %v", payload)
	}
	if _, ok := payload["network"].([]any); !ok {
		t.Fatalf("host network missing: %v", payload)
	}
	if osInfo, ok := payload["os"]; ok {
		if values, ok := osInfo.(map[string]any); !ok || len(values) == 0 {
			t.Fatalf("host os malformed: %v", payload)
		}
	}
}

func TestMigrationIsIdempotent(t *testing.T) {
	// Fresh database: running migrate twice must not duplicate seed rows or versions.
	db := openTestDB(t)
	if err := migrate(t.Context(), db); err != nil {
		t.Fatal(err)
	}
	if err := migrate(t.Context(), db); err != nil {
		t.Fatal(err)
	}
	var versions, settings, services int
	if err := db.QueryRow(`SELECT COUNT(*) FROM schema_migrations`).Scan(&versions); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM settings`).Scan(&settings); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM service_status`).Scan(&services); err != nil {
		t.Fatal(err)
	}
	if versions != latestMigrationVersion() {
		t.Fatalf("migration versions=%d want=%d", versions, latestMigrationVersion())
	}
	if settings != len(domains) {
		t.Fatalf("settings rows=%d", settings)
	}
	if services < 10 {
		t.Fatalf("service rows=%d", services)
	}
	var maxVersion int
	if err := db.QueryRow(`SELECT MAX(version) FROM schema_migrations`).Scan(&maxVersion); err != nil {
		t.Fatal(err)
	}
	if maxVersion != latestMigrationVersion() || maxVersion < 3 {
		t.Fatalf("ordered migration versions missing: max=%d", maxVersion)
	}
}

func TestMigrationUpgradesV1Fixture(t *testing.T) {
	db := openTestDB(t)
	if _, err := db.Exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	for _, stmt := range migrations[0].Statements {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatal(err)
		}
	}
	// Simulate an existing v1 database with user data and no override table.
	if _, err := db.Exec(`INSERT INTO schema_migrations(version,applied_at) VALUES(1,?)`, now()); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO settings(domain,value,updated_at) VALUES('display','{"brightness":77}',?)`, now()); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO app_state(key,value) VALUES('ui_profile','M21'),('hardware_profile','Desktop')`); err != nil {
		t.Fatal(err)
	}
	if err := migrate(t.Context(), db); err != nil {
		t.Fatal(err)
	}
	s := &server{db: db}
	if s.currentProfile() != "M21" || s.currentHardwareProfile() != "Desktop" {
		t.Fatalf("upgrade reset profiles: ui=%s hw=%s", s.currentProfile(), s.currentHardwareProfile())
	}
	got := decodeBody(t, request(t, s, http.MethodGet, "/api/settings/display", ""))
	if got["brightness"] != float64(77) {
		t.Fatalf("upgrade overwrote user settings: %v", got)
	}
	var version int
	if err := db.QueryRow(`SELECT MAX(version) FROM schema_migrations`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version != latestMigrationVersion() {
		t.Fatalf("upgrade stopped at version %d", version)
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM profile_overrides`).Scan(&count); err != nil {
		t.Fatalf("profile_overrides missing after upgrade: %v", err)
	}
	if count == 0 {
		t.Fatal("profile_overrides not seeded after upgrade")
	}
	if !s.capabilityData()["display"].Available {
		t.Fatal("Desktop capabilities lost after upgrade")
	}
}

func TestMigrationSeedsSettingsAndVersion(t *testing.T) {
	s := testServer(t)
	var count, version int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM settings`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if err := s.db.QueryRow(`SELECT MAX(version) FROM schema_migrations`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if count != len(domains) || version < 1 {
		t.Fatalf("settings rows=%d migration version=%d", count, version)
	}
	for _, d := range domains {
		if w := request(t, s, http.MethodGet, "/api/settings/"+d, ""); w.Code != http.StatusOK {
			t.Errorf("seeded domain %s status=%d", d, w.Code)
		}
	}
}

func TestPreferencesAndActionMethodContracts(t *testing.T) {
	s := testServer(t)
	if w := request(t, s, http.MethodPut, "/api/preferences/profile", `{"profile":"RG40XX"}`); w.Code != http.StatusOK || s.currentProfile() != "RG40XX" || s.currentHardwareProfile() != "unavailable" {
		t.Fatalf("UI preference transition status=%d ui=%s hardware=%s", w.Code, s.currentProfile(), s.currentHardwareProfile())
	}
	if w := request(t, s, http.MethodPost, "/api/network/wifi/scan", ""); w.Code != http.StatusOK {
		t.Fatalf("POST wifi scan status=%d", w.Code)
	}
	if w := request(t, s, http.MethodGet, "/api/network/wifi/scan", ""); w.Code != http.StatusOK {
		t.Fatalf("GET wifi scan status=%d", w.Code)
	}
	if w := request(t, s, http.MethodPost, "/api/network/wifi/scan", `not json`); w.Code != http.StatusBadRequest {
		t.Fatalf("invalid scan body status=%d", w.Code)
	}
}

func TestUnavailableReadRoutesStayStructured(t *testing.T) {
	s := testServer(t)
	for _, path := range []string{"/api/bluetooth/devices", "/api/storage/devices", "/api/accounts", "/api/sync/providers", "/api/updates"} {
		w := request(t, s, http.MethodGet, path, "")
		if w.Code != http.StatusOK {
			t.Fatalf("%s status=%d", path, w.Code)
		}
		payload := decodeBody(t, w)
		if payload["available"] != false || payload["mock"] != true || payload["source"] != "mock" || fmt.Sprint(payload["reason"]) == "" {
			t.Fatalf("%s payload=%v", path, payload)
		}
	}
}
