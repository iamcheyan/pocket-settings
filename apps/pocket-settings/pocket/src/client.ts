// Settings client: capability-driven settings over settingsd.
// Hardware/network/service values stay mock; actions never pretend otherwise.
import { createPortClient } from "./client-kit";
import type { AppConfig, Metric, Section, SettingRow } from "./model";

const sections: Section[] = [
  {
    id: "display", title: "DISPLAY", jp: "表示", items: [
      { id: "display", title: "Display", subtitle: "Brightness 72% · DPI 200%", meta: "RG34XX", badge: "UI", progress: 0.72, body: "UI scale, brightness and e-ink mode for the handheld panel.", lines: [{ label: "profile", value: "RG34XX" }, { label: "source", value: "mock" }, { label: "controllable", value: "no" }] },
      { id: "audio", title: "Audio", subtitle: "Output speaker · volume 60%", meta: "mock", badge: "UI", progress: 0.6, body: "Volume and output routing. Real hardware writes are unavailable.", lines: [{ label: "output", value: "speaker" }, { label: "source", value: "mock" }, { label: "controllable", value: "no" }] },
      { id: "theme", title: "Appearance", subtitle: "Dark · 12 px grid · motion full", meta: "theme", badge: "UI", body: "Theme, density and reduced motion." },
    ],
  },
  {
    id: "system", title: "SYSTEM", jp: "システム", items: [
      { id: "wifi", title: "Wi-Fi", subtitle: "Home-5G · signal 82%", meta: "mock", badge: "NET", body: "Scan and join are provider stubs; no real NetworkManager call.", lines: [{ label: "ssid", value: "Home-5G" }, { label: "source", value: "mock" }, { label: "controllable", value: "no" }] },
      { id: "services", title: "Services", subtitle: "6 healthy · 1 mock", meta: "systemd", badge: "SYS", body: "Service status and restart audit. Restart is refused on real units." },
      { id: "updates", title: "Updates", subtitle: "1.4.2 · channel stable", meta: "checked", badge: "UPD", body: "Update check is a mock provider; install and rollback are refused." },
    ],
  },
];

const metrics: Metric[] = [
  { label: "PROFILE", value: "RG34XX" },
  { label: "CAPS", value: "11" },
  { label: "MOCK", value: "yes" },
];

const settings: SettingRow[] = [
  { id: "ui", label: "UI profile", jp: "UIプロファイル", value: "HANDHELD", options: ["HANDHELD", "DAP", "EINK", "DESKTOP"] },
  { id: "density", label: "DPI", jp: "解像度", value: "200%", options: ["100%", "150%", "200%"] },
  { id: "locale", label: "Language", jp: "言語", value: "日本語", options: ["日本語", "English", "简体中文"] },
];

export const APP: AppConfig = {
  title: "SETTINGS",
  jp: "設定",
  kind: "detail",
  page: "SETTINGS",
  tabs: ["設定", "項目", "情報"],
  actions: ["APPLY", "PROFILE", "AUDIT"],
  settingsTitle: "PREFERENCES",
  settingsJp: "環境設定",
  deviceGap: "settingsd bridge missing.",
  sourceNote: "/api/capabilities · /api/settings",
};

export const client = createPortClient({
  resource: "settings",
  fixture: { sections, metrics, settings },
  endpoints: {
    list: "/api/settings/categories",
    get: (id) => `/api/settings/${encodeURIComponent(id)}`,
    action: (name) => `/api/settings/action/${encodeURIComponent(name)}`,
    metrics: "/api/capabilities",
    settings: "/api/preferences",
  },
  act(name, payload, bundle) {
    const item = bundle.sections.flatMap((section) => section.items).find((entry) => entry.id === payload?.id);
    if (!item) return { ok: false, message: "no setting selected" };
    if (name === "APPLY") return { ok: false, message: `${item.title}: provider_unavailable (mock)` };
    if (name === "PROFILE") { item.meta = "profile: eink"; return { ok: true, message: "mock UI profile switched to EINK" }; }
    if (name === "AUDIT") { item.badge = "AUD"; return { ok: true, message: `audit entry recorded for ${item.title}` }; }
    return { ok: false, message: `${name} unavailable` };
  },
});
