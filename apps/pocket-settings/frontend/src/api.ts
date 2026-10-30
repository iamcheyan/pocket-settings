export type Capability = { available: boolean; enabled: boolean; controllable: boolean; source: string; reason?: string; mock?: boolean };
export type Capabilities = Record<string, Capability>;
export type Domain = 'display' | 'audio' | 'network' | 'storage' | 'remote' | 'accounts' | 'sync' | 'updates' | 'power' | 'developer' | 'system';
export type Category = { id: Domain | string; title?: string; label?: string; icon?: string; capabilities?: string[] };
export type Service = { id: string; status: string; available?: boolean; source?: string; updatedAt?: string; mock?: boolean; restartable?: boolean; restartMode?: string; reason?: string };
export type Profile = 'RG34XX' | 'RG35XX' | 'RG40XX' | 'CubeXX' | 'M21' | 'Leaf3C' | 'Desktop';
export type SearchHit = {
  id?: string;
  title?: string;
  label?: string;
  type?: 'page' | 'setting' | 'capability' | string;
  domain?: string;
  key?: string;
  value?: unknown;
  capability?: string;
  description?: string;
  capabilities?: string[];
};
export type ProviderResult = {
  action?: string;
  capability?: string;
  mock?: boolean;
  performed?: boolean;
  available?: boolean;
  source?: string;
  reason?: string;
  confirmationRequired?: boolean;
};
export type ProviderMeta = { available?: boolean; mock?: boolean; source?: string; reason?: string; [key: string]: unknown };
export type WifiScanResult = ProviderMeta & { networks?: Record<string, unknown>[]; savedNetworks?: Record<string, unknown>[] };
export type BluetoothResult = ProviderMeta & { devices?: Record<string, unknown>[] };
export type StorageResult = ProviderMeta & { devices?: Record<string, unknown>[] };
export type AccountsResult = ProviderMeta & { accounts?: Record<string, unknown>[] };
export type SyncResult = ProviderMeta & { providers?: Record<string, unknown>[] };
export type UpdatesResult = ProviderMeta & {
  currentVersion?: string;
  latestVersion?: string;
  channel?: string;
  lastChecked?: string;
  updates?: Record<string, unknown>[];
  history?: Record<string, unknown>[];
};
export type AuditEntry = { id: number | string; action: string; domain: string; details: unknown; createdAt: string; dangerous?: boolean; confirmed?: boolean };
export type AuditSummary = {
  total?: number;
  dangerous?: number;
  confirmed?: number;
  rejected?: number;
  byAction?: Record<string, number>;
  byDomain?: Record<string, number>;
  lastEventAt?: string;
  sanitized?: boolean;
  mockOnly?: boolean;
};
export type AuditResult = { entries?: AuditEntry[]; summary?: AuditSummary; dangerousActions?: string[] };
export type OverridesResult = { domain: string; activeProfile: string; overrides: Record<string, Record<string, unknown>> };
export type OverrideResult = { domain: string; profile: string; value: Record<string, unknown>; updatedAt?: string };

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number, public payload: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...init, headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const error = payload.error;
    const detail = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
    throw new ApiError(
      typeof detail.code === 'string' ? detail.code : 'http_error',
      typeof detail.message === 'string' ? detail.message : `Request failed (${response.status})`,
      response.status,
      payload,
    );
  }
  return body as T;
}

export const api = {
  health: () => request<{ status?: string; [key: string]: unknown }>('/health'),
  capabilities: () => request<{ capabilities?: Capabilities; profile?: string; uiProfile?: string; hardwareProfile?: string; mock?: boolean; source?: string; requiredCapabilities?: string[]; [key: string]: unknown }>('/capabilities'),
  setProfile: (profile: Profile) => request<{ profile?: string; uiProfile?: string; hardwareProfile?: string }>('/capabilities/profile', { method: 'PUT', body: JSON.stringify({ profile }) }),
  setMockProfile: (profile: Profile) => request<{ hardwareProfile?: string; profile?: string; capabilities?: Capabilities }>('/mock/profile', { method: 'POST', body: JSON.stringify({ profile }) }),
  categories: () => request<{ categories?: Category[]; profile?: string }>('/settings/categories'),
  get: (domain: Domain) => request<Record<string, unknown>>(`/settings/${domain}`),
  put: (domain: Domain, value: Record<string, unknown>) => request<Record<string, unknown>>(`/settings/${domain}`, { method: 'PUT', body: JSON.stringify(value) }),
  overrides: (domain: Domain) => request<OverridesResult>(`/settings/${domain}/overrides`),
  override: (domain: Domain, profile: Profile) => request<OverrideResult>(`/settings/${domain}/overrides/${encodeURIComponent(profile)}`),
  putOverride: (domain: Domain, profile: Profile, value: Record<string, unknown>) => request<OverrideResult>(`/settings/${domain}/overrides/${encodeURIComponent(profile)}`, { method: 'PUT', body: JSON.stringify(value) }),
  deleteOverride: (domain: Domain, profile: Profile) => request<{ deleted?: boolean }>(`/settings/${domain}/overrides/${encodeURIComponent(profile)}`, { method: 'DELETE' }),
  preferences: () => request<{ preferences?: Record<string, string> }>('/preferences'),
  putPreferences: (value: Record<string, string>) => request('/preferences', { method: 'PUT', body: JSON.stringify(value) }),
  setUIProfilePreference: (profile: Profile) => request('/preferences/profile', { method: 'PUT', body: JSON.stringify({ profile }) }),
  services: () => request<{ services?: Service[]; count?: number; mock?: boolean }>('/services'),
  restartService: (id: string, confirm = true) => request<ProviderResult>(`/services/${encodeURIComponent(id)}/restart`, { method: 'POST', body: JSON.stringify({ confirm }) }),
  systemInfo: () => request<Record<string, unknown>>('/system/info'),
  wifiScan: () => request<WifiScanResult>('/network/wifi/scan'),
  wifiConnect: (ssid: string, passphrase?: string) => request<ProviderResult>('/network/wifi/connect', { method: 'POST', body: JSON.stringify(passphrase ? { ssid, passphrase } : { ssid }) }),
  wifiDisconnect: (ssid?: string) => request<ProviderResult>('/network/wifi/disconnect', { method: 'POST', body: JSON.stringify(ssid ? { ssid } : {}) }),
  wifiForget: (ssid: string) => request<ProviderResult>('/network/wifi/forget', { method: 'POST', body: JSON.stringify({ ssid }) }),
  bluetoothDevices: () => request<BluetoothResult>('/bluetooth/devices'),
  bluetoothPair: (id: string) => request<ProviderResult>('/bluetooth/pair', { method: 'POST', body: JSON.stringify({ id }) }),
  bluetoothForget: (id: string) => request<ProviderResult>('/bluetooth/forget', { method: 'POST', body: JSON.stringify({ id }) }),
  bluetoothConnect: (id: string) => request<ProviderResult>('/bluetooth/connect', { method: 'POST', body: JSON.stringify({ id }) }),
  bluetoothDisconnect: (id: string) => request<ProviderResult>('/bluetooth/disconnect', { method: 'POST', body: JSON.stringify({ id }) }),
  storageDevices: () => request<StorageResult>('/storage/devices'),
  accounts: () => request<AccountsResult>('/accounts'),
  accountSwitch: (id: string) => request<ProviderResult>('/accounts/switch', { method: 'POST', body: JSON.stringify({ id }) }),
  accountLogout: (id: string) => request<ProviderResult>('/accounts/logout', { method: 'POST', body: JSON.stringify({ id }) }),
  syncProviders: () => request<SyncResult>('/sync/providers'),
  syncConfig: (value: Record<string, unknown>) => request<ProviderResult>('/sync/config', { method: 'PUT', body: JSON.stringify(value) }),
  syncRun: (id: string) => request<ProviderResult>('/sync/run', { method: 'POST', body: JSON.stringify({ provider: id }) }),
  updates: () => request<UpdatesResult>('/updates'),
  updatesCheck: () => request<ProviderResult>('/updates/check', { method: 'POST', body: JSON.stringify({}) }),
  updatesInstall: () => request<ProviderResult>('/updates/install', { method: 'POST', body: JSON.stringify({ confirm: true }) }),
  updatesRollback: () => request<ProviderResult>('/updates/rollback', { method: 'POST', body: JSON.stringify({ confirm: true }) }),
  powerSleep: (mode: 'sleep' | 'suspend' = 'sleep') => request<ProviderResult>('/power/sleep', { method: 'POST', body: JSON.stringify({ mode }) }),
  powerReboot: () => request<ProviderResult>('/power/reboot', { method: 'POST', body: JSON.stringify({ confirm: true }) }),
  powerShutdown: () => request<ProviderResult>('/power/shutdown', { method: 'POST', body: JSON.stringify({ confirm: true }) }),
  search: (q: string) => request<{ query?: string; results?: SearchHit[]; count?: number }>(`/search?q=${encodeURIComponent(q)}`),
  audit: () => request<AuditResult>('/audit'),
};
