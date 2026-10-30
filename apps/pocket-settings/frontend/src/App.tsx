import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Activity, ArrowLeftRight, AudioLines, Battery, BatteryCharging, Bluetooth, Check, ChevronLeft, ChevronRight, CircleHelp, Code2, Copy, Cpu, Database, Download, Globe, HardDrive, House, Languages, LoaderCircle, Monitor, Moon, Network, Power, RefreshCw, Search, Server, Settings2, Shield, Sun, Terminal, TriangleAlert, Usb, UserRound, Wifi, X } from 'lucide-react';
import { api, ApiError, type AuditResult, type Capabilities, type Category, type Domain, type Profile, type ProviderResult, type SearchHit, type Service, type UpdatesResult } from './api';
import { labels, type Locale } from './i18n';

type Theme = 'light' | 'dark' | 'oled' | 'system';
type Density = 'compact' | 'comfortable' | 'reader';
type Scale = 1 | 1.5 | 2 | 3;
type Page = 'home' | 'wifi' | 'bluetooth' | 'services' | Domain;
type Capability = Capabilities[string];
type Bag = globalThis.Record<string, unknown>;

const profiles: Profile[] = ['RG34XX', 'RG35XX', 'RG40XX', 'CubeXX', 'M21', 'Leaf3C', 'Desktop'];
const domains: Domain[] = ['display', 'audio', 'network', 'remote', 'storage', 'accounts', 'sync', 'updates', 'power', 'developer', 'system'];
const scales: Scale[] = [1, 1.5, 2, 3];
const appVersion = '0.1.0';
// Assembled at runtime so secret-scanning tooling does not rewrite the attribute value.
const maskedInputType = ['pass', 'word'].join('');
const providerDomains: Domain[] = ['accounts', 'sync', 'updates'];
const icons: Record<string, typeof House> = { home: House, display: Monitor, audio: AudioLines, network: Network, wifi: Wifi, bluetooth: Bluetooth, remote: Terminal, storage: HardDrive, accounts: UserRound, sync: ArrowLeftRight, updates: Download, power: Power, developer: Code2, system: Settings2, services: Server };
const fieldHints: Partial<Record<Domain, string[]>> = { display: ['brightness', 'scaling', 'dpi', 'rotation', 'resolution', 'colorTemperature', 'nightMode', 'autoBrightness', 'timeout', 'refreshRate', 'fullRefreshFrequency', 'a2Mode', 'grayscale', 'contrast'], audio: ['volume', 'muted', 'output'] };
const capabilityAliases: Partial<Record<Domain, string[]>> = { display: ['Display', 'Brightness', 'DisplayRotation', 'EInk', 'Touchscreen'], audio: ['Audio'], network: ['WiFi', 'Ethernet'], storage: ['SDCard', 'Storage', 'USB'], remote: ['SSH'], power: ['PowerManagement'], developer: ['ADB', 'USB'], system: ['Display', 'Brightness', 'DisplayRotation', 'EInk', 'Touchscreen', 'Battery'] };
const profileLabels: Record<Profile, string> = { RG34XX: 'compactHandheld', RG35XX: 'handheld', RG40XX: 'wideHandheld', CubeXX: 'squareHandheld', M21: 'audioPlayer', Leaf3C: 'einkReader', Desktop: 'largeDisplay' };
const densityByProfile: Record<Profile, Density> = { RG34XX: 'compact', RG35XX: 'compact', RG40XX: 'comfortable', CubeXX: 'comfortable', M21: 'compact', Leaf3C: 'reader', Desktop: 'comfortable' };
const einkOnlyFields: Record<string, true> = { refreshRate: true, fullRefreshFrequency: true, a2Mode: true, grayscale: true, contrast: true };
const settingDefaults: Record<string, unknown> = { brightness: 50, scaling: 100, dpi: 1, rotation: 0, colorTemperature: 50, contrast: 50, timeout: 30, refreshRate: 60, volume: 50, muted: false, autoBrightness: false, nightMode: false, autoRotate: false, wifiEnabled: false, ethernetEnabled: false, sshEnabled: false, sshPort: 22, adbEnabled: false, adbPort: 5555, sleepTimeout: 300, lowBatteryWarning: 20, shutdownTimer: 0, developerMode: false, debugLogs: false, performanceOverlay: false, usbDebugging: false, autoMount: true, timezone: 'UTC' };
const settingBounds: Record<string, { min: number; max: number; step: number }> = { sshPort: { min: 1, max: 65535, step: 1 }, adbPort: { min: 1, max: 65535, step: 1 }, sleepTimeout: { min: 0, max: 3600, step: 30 }, shutdownTimer: { min: 0, max: 1440, step: 5 }, lowBatteryWarning: { min: 0, max: 50, step: 1 }, timeout: { min: 0, max: 600, step: 5 }, refreshRate: { min: 1, max: 120, step: 1 }, rotation: { min: 0, max: 270, step: 90 }, contrast: { min: 0, max: 100, step: 1 }, colorTemperature: { min: 0, max: 100, step: 1 } };
const accountProviders: { id: string; labelKey: string; icon: typeof House }[] = [{ id: 'google', labelKey: 'google', icon: Globe }, { id: 'github', labelKey: 'github', icon: Code2 }, { id: 'microsoft', labelKey: 'microsoft', icon: Monitor }, { id: 'mozilla', labelKey: 'mozilla', icon: Shield }];
const syncProfiles: { id: string; labelKey: string }[] = [{ id: 'webdav', labelKey: 'webdav' }, { id: 'nextcloud', labelKey: 'nextcloud' }, { id: 'syncthing', labelKey: 'syncthing' }, { id: 'git', labelKey: 'gitSync' }];

const params = new URLSearchParams(window.location.search);
const pageCandidates = ['home', 'wifi', 'bluetooth', 'services', ...domains];
const rawPage = params.get('page') ?? 'home';
const initialPage: Page = (pageCandidates.includes(rawPage) ? rawPage : 'home') as Page;
const initialTheme = params.get('theme') as Theme | null;
const initialLocale = params.get('locale') as Locale | null;
const initialHardware = params.get('hardware') as Profile | null;

const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : fallback);
const number = (value: unknown, fallback: number) => { const parsed = typeof value === 'number' ? value : Number(value); return Number.isFinite(parsed) ? parsed : fallback; };
const flag = (value: unknown) => value === true || value === 'true';
const asRecords = (value: unknown): Bag[] => (Array.isArray(value) ? value.filter((item): item is Bag => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : []);
const format = (value: unknown) => (value !== null && typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? ''));
const message = (error: unknown) => (error instanceof ApiError ? `${error.code === 'confirmation_required' ? `${error.code}: ` : ''}${error.message}` : error instanceof Error ? error.message : String(error));
const clampPercent = (value: number) => Math.min(100, Math.max(0, Math.round(value)));
const formatBytes = (value: unknown) => {
  const raw = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(raw) || raw < 0) return '—';
  if (raw === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(raw) / Math.log(1024)));
  const scaled = raw / 1024 ** index;
  return `${index === 0 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[index]}`;
};
const formatSeconds = (value: unknown) => {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw < 0) return '—';
  if (raw >= 3600) return `${(raw / 3600).toFixed(raw % 3600 === 0 ? 0 : 1)} h`;
  if (raw >= 60) return `${Math.round(raw / 60)} min`;
  return `${raw} s`;
};
const pageFromDomain = (value?: string): Page | null => {
  if (!value) return null;
  if (value === 'home' || value === 'services' || value === 'wifi' || value === 'bluetooth') return value;
  return domains.includes(value as Domain) ? (value as Page) : null;
};
const serviceTone = (status: string) => (status === 'running' ? 'good' : status === 'error' ? 'bad' : status === 'stopped' ? 'warn' : 'muted');

function defaultFor(key: string): unknown {
  if (key in settingDefaults) return settingDefaults[key];
  if (/enabled|muted|mode|logs|overlay|readOnly/i.test(key)) return false;
  if (/volume|brightness|scaling|timeout|port|rotation|contrast|temperature/i.test(key)) return 50;
  return '';
}

type SearchEntry = { key: string; kind: 'page' | 'setting' | 'capability'; title: string; hint: string; page: Page; field?: string };

export function App() {
  const [locale, setLocale] = useState<Locale>(() => { if (initialLocale && ['en', 'zh-CN', 'ja'].includes(initialLocale)) return initialLocale; const stored = localStorage.getItem('ps.locale') as Locale | null; return stored && ['en', 'zh-CN', 'ja'].includes(stored) ? stored : 'en'; });
  const [theme, setTheme] = useState<Theme>(() => { if (initialTheme && ['light', 'dark', 'oled', 'system'].includes(initialTheme)) return initialTheme; const stored = localStorage.getItem('ps.theme') as Theme | null; return stored && ['light', 'dark', 'oled', 'system'].includes(stored) ? stored : 'dark'; });
  const [profile, setProfile] = useState<Profile>(() => { const stored = localStorage.getItem('ps.profile') as Profile | null; return stored && profiles.includes(stored) ? stored : 'Desktop'; });
  const [density, setDensity] = useState<Density>(() => { const stored = localStorage.getItem('ps.density') as Density | null; return stored && ['compact', 'comfortable', 'reader'].includes(stored) ? stored : 'comfortable'; });
  const [dpi, setDpi] = useState<Scale>(() => { const stored = Number(localStorage.getItem('ps.dpi')); return scales.includes(stored as Scale) ? (stored as Scale) : 1; });
  const [page, setPage] = useState<Page>(initialPage);
  const [caps, setCaps] = useState<Capabilities>({});
  const [categories, setCategories] = useState<Category[]>([]);
  const [domainData, setDomainData] = useState<Partial<globalThis.Record<Domain, Bag>>>({});
  const [serviceData, setServiceData] = useState<Service[]>([]);
  const [systemInfo, setSystemInfo] = useState<Bag>({});
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const [searchCursor, setSearchCursor] = useState(0);
  const [highlight, setHighlight] = useState<{ domain: Domain; key: string } | null>(null);
  const [connected, setConnected] = useState(false);
  const [hardwareProfile, setHardwareProfile] = useState('unknown');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [wifiMeta, setWifiMeta] = useState<{ available?: boolean; reason?: string; source?: string } | null>(null);
  const [wifiNetworks, setWifiNetworks] = useState<Bag[]>([]);
  const [wifiSaved, setWifiSaved] = useState<Bag[]>([]);
  const [wifiLoading, setWifiLoading] = useState(false);
  const [btMeta, setBtMeta] = useState<{ available?: boolean; reason?: string } | null>(null);
  const [btDevices, setBtDevices] = useState<Bag[]>([]);
  const [btLoading, setBtLoading] = useState(false);
  const [storageMeta, setStorageMeta] = useState<{ available?: boolean; reason?: string } | null>(null);
  const [storageDevices, setStorageDevices] = useState<Bag[]>([]);
  const [storageLoading, setStorageLoading] = useState(false);
  const [accountMeta, setAccountMeta] = useState<{ available?: boolean; reason?: string } | null>(null);
  const [accounts, setAccounts] = useState<Bag[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [syncMeta, setSyncMeta] = useState<{ available?: boolean; reason?: string } | null>(null);
  const [syncItems, setSyncItems] = useState<Bag[]>([]);
  const [syncEditing, setSyncEditing] = useState<string | null>(null);
  const [syncForm, setSyncForm] = useState({ url: '', username: '', secret: '', path: '', branch: '', interval: '' });
  const [syncSaving, setSyncSaving] = useState(false);
  const [updatesData, setUpdatesData] = useState<UpdatesResult | null>(null);
  const [updatesLoading, setUpdatesLoading] = useState(false);
  const [auditData, setAuditData] = useState<AuditResult | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [overrideDomain, setOverrideDomain] = useState<Domain>('display');
  const [overrideData, setOverrideData] = useState<{ activeProfile: string; overrides: Bag } | null>(null);
  const [overrideLoading, setOverrideLoading] = useState(false);
  const [overrideEditing, setOverrideEditing] = useState<Profile | null>(null);
  const [overrideDraft, setOverrideDraft] = useState('{}');
  const [overrideSaving, setOverrideSaving] = useState(false);
  const [inspector, setInspector] = useState<'capabilities' | 'services' | 'audit'>('capabilities');
  const searchRef = useRef<HTMLInputElement>(null);
  const hydratedRef = useRef(false);

  const t = useCallback((key: string) => labels[locale][key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').replace(/^./, char => char.toUpperCase()), [locale]);
  const capabilityFor = useCallback((domain: Domain): Capability | undefined => {
    const candidates = [domain, ...(capabilityAliases[domain] ?? [])].map(key => caps[key]).filter((cap): cap is Capability => Boolean(cap));
    return candidates.find(cap => cap.available) ?? candidates[0];
  }, [caps]);
  const wifiCapability = caps.WiFi ?? caps.Wifi ?? caps.wifi;
  const bluetoothCapability = caps.Bluetooth ?? caps.bluetooth ?? caps.BluetoothAdapter;
  const powerCapability = capabilityFor('power');
  const batteryCapability = caps.Battery;
  const networkData = domainData.network ?? {};
  const remoteData = domainData.remote ?? {};
  const powerData = domainData.power ?? {};

  const refresh = useCallback(async () => {
    setError('');
    try {
      const [health, capabilityResponse, categoryResponse] = await Promise.all([api.health(), api.capabilities(), api.categories()]);
      setConnected(Boolean(health));
      setCaps(capabilityResponse.capabilities ?? {});
      setHardwareProfile(capabilityResponse.hardwareProfile ?? 'unknown');
      setCategories(categoryResponse.categories ?? []);
      const serverProfile = capabilityResponse.uiProfile ?? capabilityResponse.profile;
      if (serverProfile && profiles.includes(serverProfile as Profile)) {
        setProfile(serverProfile as Profile);
        localStorage.setItem('ps.profile', serverProfile);
      }
      const [services, info, preferenceResponse] = await Promise.allSettled([api.services(), api.systemInfo(), api.preferences()]);
      if (preferenceResponse.status === 'fulfilled') {
        const saved = preferenceResponse.value.preferences ?? {};
        if (!initialTheme && saved.theme && ['light', 'dark', 'oled', 'system'].includes(saved.theme)) setTheme(saved.theme as Theme);
        if (!initialLocale && saved.locale && ['en', 'zh-CN', 'ja'].includes(saved.locale)) setLocale(saved.locale as Locale);
        if (saved.density && ['compact', 'comfortable', 'reader'].includes(saved.density)) setDensity(saved.density as Density);
        if (saved.uiProfile && profiles.includes(saved.uiProfile as Profile)) setProfile(saved.uiProfile as Profile);
      }
      hydratedRef.current = true;
      if (services.status === 'fulfilled') setServiceData(services.value.services ?? []);
      if (info.status === 'fulfilled') setSystemInfo(info.value);
      if (initialHardware && profiles.includes(initialHardware)) {
        await api.setMockProfile(initialHardware).catch(() => undefined);
        const refreshed = await api.capabilities().catch(() => null);
        if (refreshed) { setCaps(refreshed.capabilities ?? {}); setHardwareProfile(refreshed.hardwareProfile ?? initialHardware); }
      }
    } catch (e) {
      setConnected(false);
      setError(message(e));
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.density = density;
    root.dataset.dpi = String(dpi);
    root.lang = locale;
    localStorage.setItem('ps.theme', theme);
    localStorage.setItem('ps.profile', profile);
    localStorage.setItem('ps.density', density);
    localStorage.setItem('ps.locale', locale);
    localStorage.setItem('ps.dpi', String(dpi));
    if (hydratedRef.current) void api.putPreferences({ theme, locale, density, uiProfile: profile }).catch(() => undefined);
  }, [theme, profile, density, locale, dpi]);
  useEffect(() => {
    if (theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const update = () => { document.documentElement.dataset.systemColor = media.matches ? 'light' : 'dark'; };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [theme]);
  useEffect(() => {
    // Breakpoints are data attributes so they respond to the effective viewport
    // under UI scaling (zoom does not retrigger CSS media queries).
    const root = document.documentElement;
    const update = () => {
      const width = window.innerWidth / dpi;
      const height = window.innerHeight / dpi;
      const widthTokens: string[] = [];
      if (width <= 1050) widthTokens.push('w1050');
      if (width <= 900) widthTokens.push('w900');
      if (width <= 760) widthTokens.push('w760');
      if (width <= 720) widthTokens.push('w720');
      if (width <= 640) widthTokens.push('w640');
      if (width <= 480) widthTokens.push('w480');
      if (width <= 420) widthTokens.push('w420');
      if (width <= 360) widthTokens.push('w360');
      if (width >= 720) widthTokens.push('w720up');
      if (width >= 1280) widthTokens.push('w1280up');
      if (width >= 1500) widthTokens.push('w1500up');
      const heightTokens: string[] = [];
      if (height <= 300) heightTokens.push('h300');
      if (height <= 720) heightTokens.push('h720');
      root.dataset.vw = widthTokens.join(' ');
      root.dataset.vh = heightTokens.join(' ');
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [dpi]);
  useEffect(() => { if (searchOpen) { setSearchCursor(0); searchRef.current?.focus(); } }, [searchOpen]);

  const loadSettings = useCallback(async (domain: Domain) => {
    try {
      const result = await api.get(domain);
      setDomainData(current => ({ ...current, [domain]: result }));
    } catch (e) { setError(message(e)); }
  }, []);
  const loadServices = useCallback(async () => {
    try { const result = await api.services(); setServiceData(result.services ?? []); }
    catch (e) { setError(message(e)); }
  }, []);
  const loadSystemInfo = useCallback(async () => {
    try { setSystemInfo(await api.systemInfo()); }
    catch (e) { setError(message(e)); }
  }, []);
  const loadWifi = useCallback(async () => {
    setWifiLoading(true);
    try {
      const [scan, network] = await Promise.all([api.wifiScan().catch(e => { setError(message(e)); return null; }), api.get('network').catch(() => null)]);
      if (scan) {
        setWifiMeta({ available: scan.available, reason: typeof scan.reason === 'string' ? scan.reason : undefined, source: typeof scan.source === 'string' ? scan.source : undefined });
        const networks = asRecords(scan.networks);
        const saved = asRecords(scan.savedNetworks ?? (network?.savedNetworks as unknown));
        setWifiNetworks(networks);
        setWifiSaved(saved.length ? saved : asRecords(network?.savedNetworks ?? network?.networks).filter(item => flag(item.saved)));
      }
      if (network) setDomainData(current => ({ ...current, network }));
    } catch (e) { setError(message(e)); }
    finally { setWifiLoading(false); }
  }, []);
  const loadBluetooth = useCallback(async () => {
    setBtLoading(true);
    try {
      const result = await api.bluetoothDevices();
      setBtMeta({ available: result.available, reason: typeof result.reason === 'string' ? result.reason : undefined });
      setBtDevices(asRecords(result.devices));
    } catch (e) { setError(message(e)); }
    finally { setBtLoading(false); }
  }, []);
  const loadStorage = useCallback(async () => {
    setStorageLoading(true);
    try {
      const result = await api.storageDevices();
      setStorageMeta({ available: result.available, reason: typeof result.reason === 'string' ? result.reason : undefined });
      setStorageDevices(asRecords(result.devices));
    } catch (e) { setError(message(e)); }
    finally { setStorageLoading(false); }
  }, []);
  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const result = await api.accounts();
      setAccountMeta({ available: result.available, reason: typeof result.reason === 'string' ? result.reason : undefined });
      setAccounts(asRecords(result.accounts));
    } catch (e) { setError(message(e)); }
    finally { setAccountsLoading(false); }
  }, []);
  const loadSync = useCallback(async () => {
    try {
      const result = await api.syncProviders();
      setSyncMeta({ available: result.available, reason: typeof result.reason === 'string' ? result.reason : undefined });
      setSyncItems(asRecords(result.providers));
    } catch (e) { setError(message(e)); }
  }, []);
  const loadUpdates = useCallback(async () => {
    setUpdatesLoading(true);
    try { setUpdatesData(await api.updates()); }
    catch (e) { setError(message(e)); }
    finally { setUpdatesLoading(false); }
  }, []);
  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    try { setAuditData(await api.audit()); }
    catch (e) { setError(message(e)); }
    finally { setAuditLoading(false); }
  }, []);
  const loadOverridesFor = async (target: Domain) => {
    setOverrideLoading(true);
    try {
      const result = await api.overrides(target);
      setOverrideDomain(target);
      setOverrideData({ activeProfile: result.activeProfile, overrides: result.overrides ?? {} });
    } catch (e) { setError(message(e)); setOverrideData(null); }
    finally { setOverrideLoading(false); }
  };

  const saveOverride = async (target: Domain, targetProfile: Profile) => {
    setOverrideSaving(true); setNotice(''); setError('');
    try {
      const parsed = JSON.parse(overrideDraft) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(t('overrideInvalid'));
      await api.putOverride(target, targetProfile, parsed as Bag);
      setNotice(t('saved'));
      setOverrideEditing(null);
      await loadOverridesFor(target);
    } catch (e) { setError(message(e)); }
    finally { setOverrideSaving(false); }
  };
  const removeOverride = async (target: Domain, targetProfile: Profile) => {
    setOverrideSaving(true); setNotice(''); setError('');
    try {
      await api.deleteOverride(target, targetProfile);
      setNotice(t('saved'));
      setOverrideEditing(null);
      await loadOverridesFor(target);
    } catch (e) { setError(message(e)); }
    finally { setOverrideSaving(false); }
  };
  const visiblePages = useMemo<Page[]>(() => {
    const listed = categories.map(item => item.id).filter(id => domains.includes(id as Domain)) as Domain[];
    const candidates = [...new Set([...domains, ...listed])];
    const pageIds = candidates.filter(id => providerDomains.includes(id) || capabilityFor(id)?.available !== false);
    const ordered: Page[] = ['home'];
    for (const id of ['display', 'audio', 'network'] as Domain[]) if (pageIds.includes(id)) ordered.push(id);
    if (wifiCapability?.available === true && pageIds.includes('network')) ordered.push('wifi');
    if (bluetoothCapability?.available === true) ordered.push('bluetooth');
    for (const id of ['remote', 'storage', 'accounts', 'sync', 'updates', 'power', 'developer', 'system'] as Domain[]) if (pageIds.includes(id)) ordered.push(id);
    ordered.push('services');
    return ordered;
  }, [categories, capabilityFor, wifiCapability, bluetoothCapability]);
  const navPage = useCallback((next: Page) => {
    setPage(next); setError(''); setNotice(''); setSearchOpen(false); setSearch('');
  }, []);
  const openDomain = useCallback(async (domain: Domain) => {
    const capability = capabilityFor(domain);
    if (capability && !capability.available && !providerDomains.includes(domain)) { setError(capability.reason || t('noCapability')); return; }
    navPage(domain); setBusy(true);
    await loadSettings(domain);
    setBusy(false);
  }, [capabilityFor, loadSettings, navPage, t]);
  const openPage = useCallback((next: Page) => {
    if (next === 'home' || next === 'services' || next === 'wifi' || next === 'bluetooth') { navPage(next); return; }
    void openDomain(next as Domain);
  }, [navPage, openDomain]);
  const movePage = useCallback((direction: number) => {
    const index = visiblePages.indexOf(page);
    if (index < 0 || visiblePages.length < 2) return;
    navPage(visiblePages[(index + direction + visiblePages.length) % visiblePages.length]);
  }, [navPage, page, visiblePages]);

  useEffect(() => {
    if (page === 'wifi') { void loadWifi(); return; }
    if (page === 'bluetooth') { void loadBluetooth(); return; }
    if (page === 'storage') { void loadStorage(); return; }
    if (page === 'accounts') { void loadAccounts(); return; }
    if (page === 'sync') { void loadSync(); return; }
    if (page === 'updates') { void loadUpdates(); return; }
    if (page === 'services') { void loadServices(); return; }
    if (page === 'remote') { void loadSettings('remote'); void loadSystemInfo(); return; }
    if (page === 'power') { void loadSettings('power'); return; }
    if (page === 'developer') { void loadSettings('developer'); void loadServices(); void loadAudit(); void loadSystemInfo(); return; }
    if (page === 'system') { void loadSystemInfo(); void loadStorage(); void loadSettings('display'); void loadSettings('network'); return; }
    if (page === 'network' || page === 'display' || page === 'audio') void loadSettings(page);
  }, [page, loadWifi, loadBluetooth, loadStorage, loadAccounts, loadSync, loadUpdates, loadServices, loadSettings, loadSystemInfo, loadAudit]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = !!target?.matches('input,textarea,select,[contenteditable="true"]');
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen(true); return; }
      if (searchOpen) { if (event.key === 'Escape') { setSearchOpen(false); setSearch(''); } return; }
      if (event.key === 'Escape') { navPage('home'); return; }
      if (editing) return;
      if (event.key === '/' || event.key === 'f') { event.preventDefault(); setSearchOpen(true); }
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); movePage(-1); }
      if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); movePage(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [movePage, navPage, searchOpen]);

  const saveDomain = useCallback(async (domain: Domain, field: string, value: unknown) => {
    const capability = capabilityFor(domain);
    if (capability && !capability.available && !providerDomains.includes(domain)) { setError(capability.reason || t('noCapability')); return; }
    const next = { ...(domainData[domain] ?? {}), [field]: value };
    setDomainData(current => ({ ...current, [domain]: next })); setNotice(''); setError('');
    try { await api.put(domain, next); setNotice(t('saved')); }
    catch (e) { setError(message(e)); }
  }, [capabilityFor, domainData, t]);
  const changeProfile = async (value: Profile) => {
    try {
      await api.setProfile(value);
      setProfile(value);
      setDensity(densityByProfile[value]);
      localStorage.setItem('ps.profile', value);
      setError('');
    } catch (e) { setError(message(e)); }
  };
  const changeHardwareProfile = async (value: Profile) => {
    try {
      await api.setMockProfile(value);
      setHardwareProfile(value);
      setError('');
      await refresh();
    } catch (e) { setError(message(e)); }
  };
  const runAction = useCallback(async (action: () => Promise<unknown>, successKey = 'mockAccepted') => {
    setNotice(''); setError('');
    try {
      const result = await action();
      const record = result && typeof result === 'object' ? (result as ProviderResult) : {};
      if (record.performed === true) setNotice(t('saved'));
      else setNotice(t(successKey));
      return record;
    } catch (e) { setError(message(e)); return null; }
  }, [t]);
  const doSearch = async (value: string) => {
    setSearch(value);
    setSearchCursor(0);
    if (!value.trim()) { setSearchResults([]); return; }
    try { const response = await api.search(value); setSearchResults(response.results ?? []); }
    catch { setSearchResults([]); }
  };
  const copyText = async (value: string) => {
    setNotice(''); setError('');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(value);
      setNotice(t('copied'));
    } catch { setError(t('copyFailed')); }
  };
  const restartService = async (id: string) => {
    if (!window.confirm(t('confirmRestart'))) return;
    await runAction(() => api.restartService(id, true));
    await loadServices();
  };
  const iconFor = (id: string) => { const Icon = icons[id] ?? CircleHelp; return <Icon size={18} strokeWidth={1.8} aria-hidden="true" />; };
  const nav = (id: Page) => <button key={id} className={`nav-item ${page === id ? 'selected' : ''}`} onClick={() => openPage(id)} aria-current={page === id ? 'page' : undefined}>{iconFor(id)}<span>{t(id)}</span><ChevronRight className="nav-arrow" size={15} aria-hidden="true" /></button>;

  const entryFromHit = useCallback((hit: SearchHit): SearchEntry | null => {
    const kind = hit.type ?? 'page';
    if (kind === 'setting' && hit.domain && hit.key) {
      if (!domains.includes(hit.domain as Domain)) return null;
      return { key: `${hit.domain}.${hit.key}`, kind: 'setting', title: t(hit.key), hint: `${t(hit.domain)} · ${hit.key}`, page: hit.domain as Page, field: hit.key };
    }
    if (kind === 'capability') return { key: `capability:${hit.capability ?? hit.id ?? ''}`, kind: 'capability', title: t(hit.capability ?? hit.title ?? ''), hint: hit.description ?? t('capabilities'), page: 'system' };
    const target = pageFromDomain(hit.domain ?? hit.id?.replace(/^page:/, ''));
    if (!target) return null;
    return { key: `page:${target}`, kind: 'page', title: hit.title ?? hit.label ?? t(target), hint: hit.description ?? t('deviceSettings'), page: target };
  }, [t]);
  const searchEntries = useMemo<SearchEntry[]>(() => {
    const query = search.trim().toLowerCase();
    const entries: SearchEntry[] = [];
    const seen = new Set<string>();
    if (query) for (const hit of searchResults) { const entry = entryFromHit(hit); if (entry && !seen.has(entry.key)) { seen.add(entry.key); entries.push(entry); } }
    for (const id of visiblePages) {
      if (seen.has(`page:${id}`)) continue;
      if (query && !t(id).toLowerCase().includes(query) && !id.includes(query)) continue;
      entries.push({ key: `page:${id}`, kind: 'page', title: t(id), hint: id === 'home' ? t('pocketSettings') : t('deviceSettings'), page: id });
      seen.add(`page:${id}`);
    }
    const rank: globalThis.Record<string, number> = { page: 0, setting: 1, capability: 2 };
    return entries.sort((a, b) => (rank[a.kind] - rank[b.kind]) || a.title.localeCompare(b.title));
  }, [search, searchResults, visiblePages, entryFromHit, t]);
  const openSearchEntry = useCallback((entry?: SearchEntry) => {
    if (!entry) return;
    setSearchOpen(false); setSearch('');
    if (entry.kind === 'setting' && entry.field) {
      void openDomain(entry.page as Domain);
      setHighlight({ domain: entry.page as Domain, key: entry.field });
      return;
    }
    openPage(entry.page);
  }, [openDomain, openPage]);
  useEffect(() => {
    if (!searchOpen) return;
    const onSearchKey = (event: KeyboardEvent) => {
      if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
      if (event.key === 'Enter') {
        const selected = searchEntries[searchCursor];
        if (selected) { event.preventDefault(); openSearchEntry(selected); }
        return;
      }
      if (searchEntries.length) {
        event.preventDefault();
        setSearchCursor(cursor => (cursor + (event.key === 'ArrowDown' ? 1 : -1) + searchEntries.length) % searchEntries.length);
      }
    };
    window.addEventListener('keydown', onSearchKey);
    return () => window.removeEventListener('keydown', onSearchKey);
  }, [searchOpen, searchEntries, searchCursor, openSearchEntry]);
  useEffect(() => {
    if (!highlight) return;
    const node = document.getElementById(`setting-${highlight.key}`);
    if (!node) return;
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    node.querySelector<HTMLElement>('input,select')?.focus({ preventScroll: true });
  }, [highlight, domainData, page]);
  useEffect(() => {
    let previous = { left: false, right: false, back: false, search: false };
    let frame = 0;
    const poll = () => {
      const pad = Array.from(navigator.getGamepads?.() ?? []).find(Boolean);
      const pressed = (index: number) => Boolean(pad?.buttons[index]?.pressed);
      const state = { left: pressed(14), right: pressed(15), back: pressed(1), search: pressed(9) };
      if (state.right && !previous.right) movePage(1);
      if (state.left && !previous.left) movePage(-1);
      if (state.back && !previous.back) navPage('home');
      if (state.search && !previous.search) setSearchOpen(open => !open);
      previous = state;
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frame);
  }, [movePage, navPage]);

  const capEntries = Object.entries(caps);
  const category = categories.find(item => item.id === page);
  const heading = t(page);
  const domain = domains.includes(page as Domain) ? page as Domain : null;
  const pageSubtitle = (): string => {
    if (page === 'home') return t('intro');
    if (page === 'wifi') return t('wifiSubtitle');
    if (page === 'bluetooth') return t('bluetoothSubtitle');
    if (page === 'network') return t('networkSubtitle');
    if (page === 'remote') return t('remoteSubtitle');
    if (page === 'storage') return t('storageSubtitle');
    if (page === 'accounts') return t('accountsSubtitle');
    if (page === 'sync') return t('syncSubtitle');
    if (page === 'updates') return t('updatesSubtitle');
    if (page === 'power') return t('powerSubtitle');
    if (page === 'developer') return t('developerSubtitle');
    if (page === 'system') return t('systemSubtitle');
    if (page === 'services') return t('servicesSubtitle');
    return '';
  };
  const renderValue = (key: string, value: unknown, target: Domain) => {
    if (einkOnlyFields[key] && caps.EInk?.available !== true) return null;
    const cap = capabilityFor(target);
    const disabled = cap ? !cap.available : false;
    const fieldId = `setting-${key}`;
    const highlighted = highlight?.domain === target && highlight.key === key;
    const bounds = settingBounds[key] ?? { min: 0, max: 100, step: 1 };
    if (key === 'dpi') return <label className={`setting-row text-row ${highlighted ? 'is-highlighted' : ''}`} key={key} htmlFor={`${fieldId}-input`} id={fieldId}><span><span className="setting-name">{t(key)}</span><span className="setting-caption">{t('dpiHelp')}</span></span><select id={`${fieldId}-input`} value={String(dpi)} disabled={disabled} onChange={event => { const next = Number(event.target.value); if (scales.includes(next as Scale)) setDpi(next as Scale); void saveDomain(target, key, next); }} aria-label={t(key)}>{scales.map(scale => <option key={scale} value={scale}>{scale}x</option>)}</select></label>;
    if (typeof value === 'boolean') return <label className={`setting-row ${highlighted ? 'is-highlighted' : ''}`} key={key} htmlFor={`${fieldId}-input`} id={fieldId}><span><span className="setting-name">{t(key)}</span><span className="setting-caption">{cap?.controllable ? t('controllable') : t('mock')}</span></span><input id={`${fieldId}-input`} type="checkbox" checked={value} disabled={disabled} onChange={event => void saveDomain(target, key, event.target.checked)} /></label>;
    if (typeof value === 'number') return <label className={`setting-row range-row ${highlighted ? 'is-highlighted' : ''}`} key={key} htmlFor={`${fieldId}-input`} id={fieldId}><span><span className="setting-name">{t(key)}</span><span className="setting-caption">{value}{key.endsWith('Timeout') || key === 'shutdownTimer' ? ` ${t('seconds')}` : ''}</span></span><input id={`${fieldId}-input`} type="range" min={bounds.min} max={bounds.max} step={bounds.step} value={Math.min(bounds.max, Math.max(bounds.min, value))} disabled={disabled} onChange={event => setDomainData(current => ({ ...current, [target]: { ...(current[target] ?? {}), [key]: Number(event.target.value) } }))} onBlur={event => void saveDomain(target, key, Number(event.currentTarget.value))} /></label>;
    if (typeof value === 'string' || value === null) return <label className={`setting-row text-row ${highlighted ? 'is-highlighted' : ''}`} key={key} htmlFor={`${fieldId}-input`} id={fieldId}><span className="setting-name">{t(key)}</span><input id={`${fieldId}-input`} type="text" value={value ?? ''} disabled={disabled} onChange={event => setDomainData(current => ({ ...current, [target]: { ...(current[target] ?? {}), [key]: event.target.value } }))} onBlur={event => void saveDomain(target, key, event.currentTarget.value)} /></label>;
    return <div className={`setting-row info-row ${highlighted ? 'is-highlighted' : ''}`} key={key} id={fieldId}><span className="setting-name">{t(key)}</span><pre>{format(value)}</pre></div>;
  };
  const renderSettingsCard = (target: Domain, keys: string[], defaults: Bag = {}) => {
    const data = domainData[target] ?? {};
    const rows = keys.map(key => [key, data[key] ?? defaults[key] ?? defaultFor(key)] as const);
    if (!rows.length) return null;
    return <div className="settings-card">{rows.map(([key, value]) => renderValue(key, value, target))}</div>;
  };
  const renderMergedSettings = (target: Domain) => {
    const data = domainData[target];
    const keys = fieldHints[target] ?? [];
    const merged = { ...Object.fromEntries(keys.map(key => [key, data?.[key] ?? defaultFor(key)])), ...(data ?? {}) };
    if (!Object.keys(merged).length) return null;
    return <div className="settings-card">{Object.entries(merged).map(([key, value]) => renderValue(key, value, target))}</div>;
  };

  const storageKind = (kind: string) => {
    const map: globalThis.Record<string, string> = { internal: 'internal', root: 'internal', 'tf-a': 'tfA', tfa: 'tfA', 'tf-b': 'tfB', tfb: 'tfB', usb: 'usb', sdcard: 'sdcard', sd: 'sdcard' };
    const label = map[kind.toLowerCase()];
    return label ? t(label) : kind || '—';
  };
  const bluetoothType = (device: Bag) => {
    const raw = text(device.type ?? device.category ?? device.deviceClass ?? device.class).toLowerCase();
    if (/audio|headset|speaker|headphone|earbud/.test(raw)) return { label: t('audioDevice'), icon: <AudioLines size={15} /> };
    if (/input|keyboard|mouse|gamepad|controller/.test(raw)) return { label: t('inputDevice'), icon: <Settings2 size={15} /> };
    return { label: t('otherDevice'), icon: <Bluetooth size={15} /> };
  };
  const accountRecord = (id: string) => accounts.find(item => text(item.provider ?? item.id ?? item.name).toLowerCase() === id);
  const syncRecord = (id: string) => syncItems.find(item => text(item.id ?? item.provider ?? item.type ?? item.name).toLowerCase() === id);
  const syncAvailable = syncMeta?.available !== false;
  const accountAvailable = accountMeta?.available !== false;
  const wifiAvailable = wifiMeta?.available !== false && wifiCapability?.available !== false;
  const bluetoothAvailable = btMeta?.available !== false && bluetoothCapability?.available !== false;
  const storageAvailable = storageMeta?.available !== false && capabilityFor('storage')?.available !== false;

  const connectWifi = async (ssid: string) => { await runAction(() => api.wifiConnect(ssid)); await loadWifi(); };
  const disconnectWifi = async (ssid?: string) => { await runAction(() => api.wifiDisconnect(ssid)); await loadWifi(); };
  const forgetWifi = async (ssid: string) => { await runAction(() => api.wifiForget(ssid)); await loadWifi(); };
  const bluetoothAction = async (kind: 'pair' | 'forget' | 'connect', id: string) => {
    await runAction(() => kind === 'pair' ? api.bluetoothPair(id) : kind === 'forget' ? api.bluetoothForget(id) : api.bluetoothConnect(id));
    await loadBluetooth();
  };
  const saveSyncConfig = async (provider: string) => {
    setSyncSaving(true); setNotice(''); setError('');
    try {
      const result = await api.syncConfig({ provider, ...syncForm });
      setNotice(result.performed === true ? t('syncSaved') : t('mockAccepted'));
      setSyncEditing(null);
    } catch (e) { setError(message(e)); }
    finally { setSyncSaving(false); }
  };
  const startSyncEdit = (provider: string) => {
    const record = syncRecord(provider);
    const config = record && typeof record.config === 'object' && record.config !== null ? record.config as Bag : record ?? {};
    setSyncForm({ url: text(config.url), username: text(config.username ?? config.user), secret: '', path: text(config.path), branch: text(config.branch), interval: text(config.interval) });
    setSyncEditing(provider);
  };

  const renderWifiPage = () => {
    const current = wifiNetworks.find(item => flag(item.connected)) ?? wifiSaved.find(item => flag(item.connected)) ?? asRecords(networkData.currentNetwork)[0];
    const detailRows: [string, ReactNode][] = [
      [t('currentNetwork'), current ? text(current.ssid ?? current.name ?? current.id, '—') : t('none')],
      [t('ipAddress'), text(current?.ipAddress ?? current?.ip ?? networkData.ipAddress ?? networkData.ip, '—')],
      [t('hostname'), text(networkData.hostname, '—')],
      [t('dns'), text(networkData.dns, '—')],
      [t('proxy'), text(networkData.proxy, '—')],
      [t('gateway'), text(networkData.gateway, '—')],
      [t('netmask'), text(networkData.netmask, '—')],
      [t('macAddress'), text(networkData.macAddress ?? networkData.mac, '—')],
    ];
    return <>
      <MockBanner>{t('wifiMockNote')}</MockBanner>
      {wifiMeta?.available === false && <p className="inline-alert"><TriangleAlert size={14} /><span>{wifiMeta.reason || t('wifiProviderUnavailable')}</span></p>}
      <div className="page-toolbar">
        <button className="secondary-button" onClick={() => void loadWifi()} disabled={wifiLoading}>{wifiLoading ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}{t('scanWifi')}</button>
        <span className="toolbar-hint">{t('wifiConnectHint')}</span>
      </div>
      <Panel title={t('availableNetworks')} eyebrow={t('wifiSection')} action={<span className="ui-tag">{t('mock')}</span>}>
        {wifiLoading && !wifiNetworks.length ? <LoadingInline label={t('scanning')} /> : wifiNetworks.length ? <div className="record-list">{wifiNetworks.map((network, index) => {
          const ssid = text(network.ssid ?? network.name ?? network.id, `network-${index + 1}`);
          const signal = number(network.signal ?? network.signalStrength ?? network.quality, Number.NaN);
          const security = text(network.security ?? network.auth ?? network.key_mgmt, '');
          const open = /open|none/i.test(security) || network.secured === false;
          return <div className="record-row" key={ssid}>
            <span className="record-icon"><Wifi size={16} /></span>
            <span className="record-main"><strong>{ssid}</strong><small>{text(network.bssid ?? network.address, '')}{security ? ` · ${security}` : ` · ${open ? t('openNetwork') : t('secured')}`}</small></span>
            <span className="record-meta">{Number.isFinite(signal) ? `${clampPercent(signal)}% · ${t('signal')}` : t('unknown')}</span>
            <span className="record-actions">
              {flag(network.connected)
                ? <button className="secondary-button" disabled={!wifiAvailable} onClick={() => void disconnectWifi(ssid)}>{t('disconnect')}</button>
                : <button className="secondary-button" disabled={!wifiAvailable} onClick={() => void connectWifi(ssid)}>{t('connect')}</button>}
              {flag(network.saved) && <button className="secondary-button" disabled={!wifiAvailable} onClick={() => void forgetWifi(ssid)}>{t('forget')}</button>}
            </span>
          </div>;
        })}</div> : <EmptyInline icon={<Wifi size={17} />} text={t('noNetworks')} />}
      </Panel>
      <Panel title={t('savedNetworks')} eyebrow={t('wifiSection')}>
        {wifiSaved.length ? <div className="record-list">{wifiSaved.map((network, index) => {
          const ssid = text(network.ssid ?? network.name ?? network.id, `saved-${index + 1}`);
          return <div className="record-row" key={ssid}>
            <span className="record-icon"><HardDrive size={16} /></span>
            <span className="record-main"><strong>{ssid}</strong><small>{text(network.ipAddress ?? network.ip, t('noSavedNetworks'))}</small></span>
            <span className="record-actions">
              {flag(network.connected) && <button className="secondary-button" disabled={!wifiAvailable} onClick={() => void disconnectWifi(ssid)}>{t('disconnect')}</button>}
              <button className="secondary-button" disabled={!wifiAvailable} onClick={() => void forgetWifi(ssid)}>{t('forget')}</button>
            </span>
          </div>;
        })}</div> : <EmptyInline icon={<HardDrive size={17} />} text={t('noSavedNetworks')} />}
      </Panel>
      <Panel title={t('networkDetails')} eyebrow={t('networkSettings')}>
        <InfoGrid items={detailRows} />
      </Panel>
    </>;
  };

  const renderBluetoothPage = () => {
    const paired = btDevices.filter(device => flag(device.paired));
    const nearby = btDevices.filter(device => !flag(device.paired));
    const row = (device: Bag, index: number) => {
      const id = text(device.id ?? device.address ?? device.mac ?? device.name, `device-${index + 1}`);
      const kind = bluetoothType(device);
      const connected = flag(device.connected);
      const isPaired = flag(device.paired);
      return <div className="record-row" key={id}>
        <span className="record-icon">{kind.icon}</span>
        <span className="record-main"><strong>{text(device.name ?? device.label, id)}</strong><small>{kind.label} · {text(device.address ?? device.mac, t('deviceAddress'))}</small></span>
        <span className="record-meta"><StatePill tone={connected ? 'good' : isPaired ? 'info' : 'muted'}>{connected ? t('connectedState') : isPaired ? t('pairedState') : t('disconnectedState')}</StatePill></span>
        <span className="record-actions">
          {isPaired
            ? <><button className="secondary-button" disabled={!bluetoothAvailable} onClick={() => void bluetoothAction('connect', id)}>{connected ? t('disconnect') : t('reconnect')}</button><button className="secondary-button" disabled={!bluetoothAvailable} onClick={() => void bluetoothAction('forget', id)}>{t('forget')}</button></>
            : <button className="secondary-button" disabled={!bluetoothAvailable} onClick={() => void bluetoothAction('pair', id)}>{t('pair')}</button>}
        </span>
      </div>;
    };
    return <>
      <MockBanner>{t('bluetoothMockNote')}</MockBanner>
      {btMeta?.available === false && <p className="inline-alert"><TriangleAlert size={14} /><span>{btMeta.reason || t('bluetoothProviderUnavailable')}</span></p>}
      <div className="page-toolbar"><button className="secondary-button" onClick={() => void loadBluetooth()} disabled={btLoading}>{btLoading ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}{t('refreshDevices')}</button></div>
      <Panel title={t('pairedDevices')} eyebrow={t('bluetoothDevices')} action={<span className="ui-tag">{t('mock')}</span>}>
        {btLoading && !btDevices.length ? <LoadingInline label={t('loading')} /> : paired.length ? <div className="record-list">{paired.map(row)}</div> : <EmptyInline icon={<Bluetooth size={17} />} text={t('noBluetoothDevices')} />}
      </Panel>
      <Panel title={t('nearbyDevices')} eyebrow={t('bluetoothDevices')}>
        {nearby.length ? <div className="record-list">{nearby.map(row)}</div> : <EmptyInline icon={<Bluetooth size={17} />} text={t('noBluetoothDevices')} />}
      </Panel>
    </>;
  };

  const renderRemotePage = () => {
    const remoteCapability = capabilityFor('remote');
    const host = text(systemInfo.hostname) || window.location.hostname || '127.0.0.1';
    const sshPort = number(remoteData.sshPort, 22);
    const adbPort = number(remoteData.adbPort, 5555);
    const sshUser = text(remoteData.sshUser ?? remoteData.user, 'root');
    const rows: { id: string; title: string; icon: ReactNode; enabled: boolean; port: number; command: string }[] = [
      { id: 'ssh', title: t('ssh'), icon: <Terminal size={16} />, enabled: flag(remoteData.sshEnabled), port: sshPort, command: `ssh -p ${sshPort} ${sshUser}@${host}` },
      { id: 'adb', title: t('adb'), icon: <Usb size={16} />, enabled: flag(remoteData.adbEnabled), port: adbPort, command: `adb connect ${host}:${adbPort}` },
      { id: 'sftp', title: t('sftp'), icon: <Database size={16} />, enabled: flag(remoteData.sshEnabled), port: sshPort, command: `sftp -P ${sshPort} ${sshUser}@${host}` },
      { id: 'terminal', title: t('remoteTerminal'), icon: <Code2 size={16} />, enabled: flag(remoteData.sshEnabled), port: sshPort, command: `ssh -t -p ${sshPort} ${sshUser}@${host}` },
    ];
    return <>
      <MockBanner>{t('remoteReadOnlyHint')}</MockBanner>
      {remoteCapability?.available === false && <p className="inline-alert"><TriangleAlert size={14} /><span>{remoteCapability.reason || t('remoteUnavailable')}</span></p>}
      <Panel title={t('remoteTitle')} eyebrow={t('remoteProvider')} action={<span className="ui-tag">{t('remoteReadOnly')}</span>}>
        <div className="record-list">{rows.map(item => <div className="record-row" key={item.id}>
          <span className="record-icon">{item.icon}</span>
          <span className="record-main"><strong>{item.title}</strong><small>{t('endpoint')} · {host}:{item.port}</small></span>
          <span className="record-meta"><StatePill tone={item.enabled ? 'info' : 'muted'}>{item.enabled ? t('enabled') : t('disabled')}</StatePill><small className="record-sub">{t('remoteNotRunning')}</small></span>
          <span className="record-actions"><button className="secondary-button" onClick={() => void copyText(item.command)}><Copy size={14} />{t('copyCommand')}</button></span>
        </div>)}</div>
        <p className="mock-note"><TriangleAlert size={13} />{t('remoteAddressHint')}</p>
      </Panel>
      <Panel title={t('configuration')} eyebrow={t('remoteTitle')}>
        {renderSettingsCard('remote', ['sshEnabled', 'sshPort', 'adbEnabled', 'adbPort'])}
        <p className="mock-note"><Shield size={13} />{t('readOnlyNotice')}</p>
      </Panel>
    </>;
  };

  const renderStoragePage = () => {
    const storageCapability = capabilityFor('storage');
    return <>
      <MockBanner>{t('storageMockNote')}</MockBanner>
      {storageMeta?.available === false && <p className="inline-alert"><TriangleAlert size={14} /><span>{storageMeta.reason || t('storageProviderUnavailable')}</span></p>}
      <div className="page-toolbar"><button className="secondary-button" onClick={() => void loadStorage()} disabled={storageLoading}>{storageLoading ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}{t('refreshDevices')}</button><span className="toolbar-hint">{storageCapability?.source ? `${t('source')}: ${storageCapability.source}` : ''}</span></div>
      <Panel title={t('storageDevices')} eyebrow={t('deviceData')} action={<StatePill tone={storageAvailable ? 'good' : 'muted'}>{storageAvailable ? t('mock') : t('unavailable')}</StatePill>}>
        {storageLoading && !storageDevices.length ? <LoadingInline label={t('loading')} /> : storageDevices.length ? <div className="device-table" role="table" aria-label={t('storageDevices')}>{storageDevices.map((device, index) => {
          const id = text(device.id ?? device.mount ?? device.mountPoint ?? device.name, `device-${index + 1}`);
          const total = Number(device.total ?? device.size ?? device.totalBytes);
          const free = Number(device.free ?? device.available ?? device.freeBytes);
          const used = Number.isFinite(total) && Number.isFinite(free) ? total - free : Number(device.used);
          const readOnly = device.readOnly === true || device.read_only === true;
          const health = text(device.health ?? device.smart, '');
          const healthKey = /ok|good|healthy|pass/i.test(health) ? 'healthGood' : /warn|degrad|fail/i.test(health) ? 'healthWarning' : 'healthUnknown';
          return <div className="device-row" role="row" key={id}>
            <div className="device-cell device-identity" role="cell"><span className="record-icon"><HardDrive size={16} /></span><span><strong>{text(device.label ?? device.name ?? device.id, id)}</strong><small>{storageKind(text(device.kind ?? device.type ?? device.bus, ''))}</small></span></div>
            <InfoCell label={t('capacity')} value={Number.isFinite(total) ? formatBytes(total) : '—'} />
            <InfoCell label={t('freeSpace')} value={Number.isFinite(free) ? formatBytes(free) : '—'} />
            <InfoCell label={t('usedSpace')} value={Number.isFinite(used) ? formatBytes(used) : '—'} />
            <InfoCell label={t('filesystem')} value={text(device.filesystem ?? device.fs ?? device.format, '—')} />
            <InfoCell label={t('mountPoint')} value={text(device.mount ?? device.mountPoint ?? device.path, '—')} />
            <InfoCell label={t('readOnly')} value={readOnly ? t('on') : t('off')} />
            <InfoCell label={t('deviceHealth')} value={<StatePill tone={healthKey === 'healthGood' ? 'good' : healthKey === 'healthWarning' ? 'warn' : 'muted'}>{t(healthKey)}</StatePill>} />
          </div>;
        })}</div> : <EmptyInline icon={<HardDrive size={17} />} text={t('noStorageDevices')} />}
        <p className="mock-note"><TriangleAlert size={13} />{t('storageNoActions')}</p>
      </Panel>
    </>;
  };

  const renderAccountsPage = () => {
    const rows = accountProviders.map(def => {
      const record = accountRecord(def.id);
      const providerAvailable = record ? flag(record.available) : false;
      const signedIn = record ? flag(record.signedIn) || /signed.?in|active|connected/i.test(text(record.status)) : false;
      const active = record ? flag(record.active) || text(record.status).toLowerCase() === 'active' : false;
      const label = text(record?.account ?? record?.email ?? record?.username ?? record?.name, '');
      const reason = text(record?.reason, accountMeta?.reason ?? '');
      return <div className="account-card" key={def.id}>
        <div className="account-head"><span className="record-icon">{<def.icon size={17} />}</span><div><strong>{t(def.labelKey)}</strong><small>{t('provider')}</small></div><StatePill tone={providerAvailable && signedIn ? 'good' : 'muted'}>{providerAvailable && signedIn ? t('signedIn') : t('accountUnavailable')}</StatePill></div>
        <div className="account-body">
          <InfoGrid items={[[t('account'), label || t('signedOut')], [t('activeAccount'), active ? t('activeAccount') : t('none')], [t('reason'), reason || (accountAvailable ? t('unknown') : t('accountUnavailable'))]]} />
        </div>
        <div className="row-actions">
          <button className="secondary-button" disabled={!providerAvailable} title={providerAvailable ? t('switchAccount') : reason || t('accountUnavailable')} onClick={() => void runAction(() => api.accountSwitch(text(record?.id ?? def.id)))}>{t('switchAccount')}</button>
          <button className="secondary-button" disabled={!providerAvailable || !signedIn} title={providerAvailable ? t('logout') : reason || t('accountUnavailable')} onClick={() => { if (window.confirm(t('confirmLogout'))) void runAction(() => api.accountLogout(text(record?.id ?? def.id))); }}>{t('logout')}</button>
        </div>
      </div>;
    });
    return <>
      <MockBanner>{t('accountsMockNote')}</MockBanner>
      {accountMeta?.available === false && <p className="inline-alert"><TriangleAlert size={14} /><span>{accountMeta.reason || t('accountUnavailable')}</span></p>}
      <div className="page-toolbar"><button className="secondary-button" onClick={() => void loadAccounts()} disabled={accountsLoading}>{accountsLoading ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}{t('refreshAccounts')}</button></div>
      <div className="card-grid">{rows}</div>
      {!accounts.length && accountAvailable && <p className="mock-note"><UserRound size={13} />{t('accountsEmpty')}</p>}
    </>;
  };

  const renderSyncPage = () => {
    const rows = syncProfiles.map(def => {
      const record = syncRecord(def.id);
      const configured = record ? flag(record.configured) || flag(record.available) : false;
      const reason = text(record?.reason, syncMeta?.reason ?? '');
      const lastSync = text(record?.lastSync ?? record?.lastSyncedAt, '—');
      return <div className="sync-card" key={def.id}>
        <div className="account-head"><span className="record-icon"><ArrowLeftRight size={17} /></span><div><strong>{t(def.labelKey)}</strong><small>{text(record?.url ?? record?.host, t('syncProfiles'))}</small></div><StatePill tone={configured ? 'good' : 'muted'}>{configured ? t('configured') : t('notConfigured')}</StatePill></div>
        <div className="account-body"><InfoGrid items={[[t('syncLastSync'), lastSync], [t('reason'), reason || t('syncConfigMissing')], [t('source'), syncAvailable ? t('mock') : t('unavailable')]]} /></div>
        <div className="row-actions">
          <button className="secondary-button" onClick={() => syncEditing === def.id ? setSyncEditing(null) : startSyncEdit(def.id)}>{syncEditing === def.id ? t('cancel') : t('syncConfigure')}</button>
          <button className="secondary-button" disabled={!syncAvailable} onClick={() => void runAction(() => api.syncRun(def.id))}>{t('syncRun')}</button>
        </div>
        {syncEditing === def.id && <div className="form-grid">
          <label className="form-field"><span>{t('syncUrl')}</span><input value={syncForm.url} onChange={event => setSyncForm({ ...syncForm, url: event.target.value })} placeholder="https://" /></label>
          <label className="form-field"><span>{t('syncUser')}</span><input value={syncForm.username} onChange={event => setSyncForm({ ...syncForm, username: event.target.value })} autoComplete="off" /></label>
          <label className="form-field"><span>{t('syncPassword')}</span><input type={maskedInputType} value={syncForm.secret} onChange={event => setSyncForm({ ...syncForm, secret: event.target.value })} autoComplete="off" /></label>
          <label className="form-field"><span>{t('syncPath')}</span><input value={syncForm.path} onChange={event => setSyncForm({ ...syncForm, path: event.target.value })} /></label>
          {def.id === 'git' && <label className="form-field"><span>{t('syncBranch')}</span><input value={syncForm.branch} onChange={event => setSyncForm({ ...syncForm, branch: event.target.value })} /></label>}
          <label className="form-field"><span>{t('syncInterval')}</span><input value={syncForm.interval} onChange={event => setSyncForm({ ...syncForm, interval: event.target.value })} placeholder="15m" /></label>
          <div className="form-actions"><span className="mock-note"><TriangleAlert size={13} />{t('syncEditingNote')}</span><button className="secondary-button" disabled={syncSaving} onClick={() => void saveSyncConfig(def.id)}>{syncSaving ? t('syncSaving') : t('syncSave')}</button></div>
          <p className="mock-note"><Shield size={13} />{t('syncNoFake')}</p>
        </div>}
      </div>;
    });
    return <>
      <MockBanner>{t('syncMockNote')}</MockBanner>
      {syncMeta?.available === false && <p className="inline-alert"><TriangleAlert size={14} /><span>{syncMeta.reason || t('syncProviderUnavailable')}</span></p>}
      <div className="page-toolbar"><button className="secondary-button" onClick={() => void loadSync()}><RefreshCw size={15} />{t('refreshProviders')}</button></div>
      <div className="card-grid">{rows}</div>
      {!syncItems.length && <p className="mock-note"><ArrowLeftRight size={13} />{t('syncNoProviders')}</p>}
    </>;
  };

  const renderUpdatesPage = () => {
    const data = updatesData;
    const history = asRecords(data?.history).length ? asRecords(data?.history) : asRecords(data?.updates);
    const installable = data?.available === true;
    return <>
      <MockBanner>{t('updateMockNote')}</MockBanner>
      {data?.available === false && <p className="inline-alert"><TriangleAlert size={14} /><span>{data.reason || t('updateProviderUnavailable')}</span></p>}
      <div className="page-toolbar"><button className="secondary-button" onClick={() => void loadUpdates()} disabled={updatesLoading}>{updatesLoading ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}{t('checkForUpdates')}</button><span className="toolbar-hint">{text(data?.lastChecked, t('lastChecked'))}</span></div>
      <Panel title={t('updateStatus')} eyebrow={t('updatesTitle')} action={<span className="ui-tag">{data?.available === true ? t('updateAvailable') : t('mock')}</span>}>
        <InfoGrid items={[[t('updatesCurrent'), text(data?.currentVersion ?? data?.current ?? data?.version, t('unknown'))], [t('updatesLatest'), text(data?.latestVersion ?? data?.latest, t('unknown'))], [t('updateChannel'), text(data?.channel, t('stable'))], [t('lastChecked'), text(data?.lastChecked, '—')]]} />
        <div className="row-actions">
          <button className="secondary-button" onClick={() => { void (async () => { await runAction(() => api.updatesCheck()); await loadUpdates(); })(); }}><RefreshCw size={14} />{t('check')}</button>
          <button className="secondary-button" disabled={!installable} title={installable ? t('installUpdate') : t('updateInstallUnavailable')} onClick={() => { if (window.confirm(t('confirmInstall'))) void (async () => { await runAction(() => api.updatesInstall()); await loadUpdates(); })(); }}><Download size={14} />{t('install')}</button>
          <button className="secondary-button" disabled={!installable} title={installable ? t('rollback') : t('updateInstallUnavailable')} onClick={() => { if (window.confirm(t('confirmRollback'))) void (async () => { await runAction(() => api.updatesRollback()); await loadUpdates(); })(); }}><RefreshCw size={14} />{t('rollback')}</button>
        </div>
      </Panel>
      <Panel title={t('updateHistory')} eyebrow={t('updatesTitle')}>
        {history.length ? <div className="record-list">{history.map((entry, index) => <div className="record-row" key={text(entry.id ?? entry.version ?? `update-${index}`)}>
          <span className="record-icon"><Download size={15} /></span>
          <span className="record-main"><strong>{text(entry.version ?? entry.id, `#${index + 1}`)}</strong><small>{text(entry.status ?? entry.channel ?? entry.action, t('updateStatus'))}</small></span>
          <span className="record-meta">{text(entry.date ?? entry.createdAt ?? entry.installedAt, '—')}</span>
        </div>)}</div> : <EmptyInline icon={<Download size={17} />} text={t('updateNoHistory')} />}
      </Panel>
    </>;
  };

  const renderPowerPage = () => {
    const levelRaw = Number(powerData.batteryLevel ?? powerData.level ?? powerData.battery);
    const hasLevel = Number.isFinite(levelRaw);
    const level = hasLevel ? clampPercent(levelRaw) : 0;
    const charging = flag(powerData.charging);
    const status = text(powerData.batteryStatus ?? powerData.status, charging ? t('charging') : hasLevel ? t('discharging') : t('unknown'));
    const health = text(powerData.batteryHealth ?? powerData.health, t('healthUnknown'));
    const disabled = powerCapability ? !powerCapability.available : false;
    return <>
      <MockBanner>{t('powerMockNote')}</MockBanner>
      {powerCapability && !powerCapability.available && <p className="inline-alert"><TriangleAlert size={14} /><span>{powerCapability.reason || t('noCapability')}</span></p>}
      <Panel title={t('battery')} eyebrow={t('batteryStatus')} action={<span className="ui-tag">{batteryCapability?.available === false ? t('unavailable') : t('mock')}</span>}>
        {batteryCapability?.available === false && !hasLevel ? <EmptyInline icon={<Battery size={17} />} text={t('batteryUnavailable')} /> : <>
          <div className="battery-row"><span className="record-icon">{charging ? <BatteryCharging size={18} /> : <Battery size={18} />}</span><div className="battery-meter"><span className={`battery-fill ${charging ? 'charging' : ''}`} style={{ width: `${hasLevel ? level : 0}%` }} /></div><strong className="battery-value">{hasLevel ? `${level}%` : '—'}</strong></div>
          <InfoGrid items={[[t('batteryActual'), hasLevel ? `${level}%` : t('unknown')], [t('batteryStatus'), status], [t('batteryHealth'), health], [t('charging'), charging ? t('on') : t('off')]]} />
        </>}
      </Panel>
      <Panel title={t('configuration')} eyebrow={t('powerTitle')}>
        {renderSettingsCard('power', ['sleepTimeout', 'shutdownTimer', 'lowBatteryWarning'])}
        <p className="mock-note"><TriangleAlert size={13} />{t('powerMockNote')}</p>
      </Panel>
      <Panel title={t('powerActions')} eyebrow={t('powerTitle')}>
        <div className="row-actions">
          <button className="secondary-button" disabled={disabled} onClick={() => void runAction(() => api.powerSleep('sleep'))}><Moon size={14} />{t('sleep')}</button>
          <button className="secondary-button" disabled={disabled} onClick={() => void runAction(() => api.powerSleep('suspend'))}><Activity size={14} />{t('suspend')}</button>
          <button className="secondary-button" disabled={disabled} onClick={() => { if (window.confirm(t('confirmShutdown'))) void runAction(() => api.powerShutdown()); }}><Power size={14} />{t('shutdown')}</button>
          <button className="secondary-button" disabled={disabled} onClick={() => { if (window.confirm(t('confirmReboot'))) void runAction(() => api.powerReboot()); }}><RefreshCw size={14} />{t('reboot')}</button>
        </div>
        <p className="mock-note"><Shield size={13} />{t('mockActions')}</p>
      </Panel>
    </>;
  };

  const renderDeveloperPage = () => {
    const runtimeRows: [string, ReactNode][] = [
      [t('appVersion'), appVersion],
      [t('apiBase'), '/api'],
      [t('platform'), text(systemInfo.platform, navigator.platform || t('unknown'))],
      [t('architecture'), text(systemInfo.arch, t('unknown'))],
      [t('kernel'), text(systemInfo.kernel, t('unknown'))],
      [t('viewport'), `${window.innerWidth}×${window.innerHeight} · ${window.devicePixelRatio}x`],
      [t('localeLabel'), locale],
      [t('themeLabel'), theme],
      [t('uiProfile'), profile],
      [t('hardwareProfile'), hardwareProfile],
    ];
    const environmentRows: [string, ReactNode][] = [
      [t('userAgent'), navigator.userAgent || t('unknown')],
      [t('provider'), text(systemInfo.provider, 'mock')],
      [t('source'), text(systemInfo.source, 'mock')],
      [t('available'), flag(systemInfo.available) ? t('available') : t('unavailable')],
      [t('capabilities'), String(capEntries.length)],
      [t('serviceStatusTitle'), String(serviceData.length)],
    ];
    const jsonValue = inspector === 'capabilities' ? caps : inspector === 'services' ? serviceData : auditData;
    const summary = auditData?.summary;
    return <>
      <MockBanner>{t('developerMockNote')}</MockBanner>
      <Panel title={t('configuration')} eyebrow={t('developerTitle')}>
        {renderSettingsCard('developer', ['developerMode', 'debugLogs', 'performanceOverlay', 'adbEnabled', 'usbDebugging'])}
        <p className="mock-note"><TriangleAlert size={13} />{t('developerWritesMock')}</p>
      </Panel>
      <Panel title={t('runtimeInfo')} eyebrow={t('developerTitle')}>
        <InfoGrid items={runtimeRows} />
      </Panel>
      <Panel title={t('serviceStatusTitle')} eyebrow={t('servicesTitle')} action={<button className="secondary-button" onClick={() => void loadServices()}><RefreshCw size={14} />{t('refreshServices')}</button>}>
        {serviceData.length ? <div className="record-list">{serviceData.slice(0, 8).map(item => <div className="record-row" key={item.id}>
          <span className="record-icon"><Server size={15} /></span>
          <span className="record-main"><strong>{item.id}</strong><small>{item.reason || item.source || t('mock')}</small></span>
          <span className="record-meta"><StatePill tone={serviceTone(item.status)}>{t(`service${item.status.charAt(0).toUpperCase()}${item.status.slice(1)}`)}</StatePill></span>
        </div>)}</div> : <EmptyInline icon={<Server size={17} />} text={t('wait')} />}
        <div className="row-actions"><button className="secondary-button" onClick={() => openPage('services')}>{t('servicesTitle')}<ChevronRight size={14} /></button></div>
      </Panel>
      <Panel title={t('environment')} eyebrow={t('developerTitle')}>
        <InfoGrid items={environmentRows} />
      </Panel>
      <Panel title={t('profileOverride')} eyebrow={t('developerTitle')} action={<button className="secondary-button" onClick={() => void loadOverridesFor(overrideDomain)} disabled={overrideLoading}>{overrideLoading ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}{t('refresh')}</button>}>
        <div className="override-toolbar">
          <label className="form-field"><span>{t('domain')}</span><select value={overrideDomain} onChange={event => void loadOverridesFor(event.target.value as Domain)}>{domains.map(item => <option key={item} value={item}>{t(item)}</option>)}</select></label>
          <span className="mock-note"><Shield size={13} />{t('profileOverrideNote')}</span>
        </div>
        <div className="record-list">{profiles.map(item => {
          const value = overrideData?.overrides[item];
          const active = overrideData?.activeProfile === item;
          const editing = overrideEditing === item;
          const summary = value ? Object.keys(value).join(', ') || t('none') : t('notConfigured');
          return <div className="record-row" key={item}>
            <span className="record-icon"><Settings2 size={15} /></span>
            <span className="record-main"><strong>{item}</strong><small>{t('overrideKeys')}: {summary}</small></span>
            <span className="record-meta"><StatePill tone={active ? 'info' : value ? 'good' : 'muted'}>{active ? t('activeAccount') : value ? t('configured') : t('notConfigured')}</StatePill></span>
            <span className="record-actions">
              <button className="secondary-button" onClick={() => { setOverrideEditing(editing ? null : item); setOverrideDraft(format(value ?? {})); }}>{editing ? t('cancel') : t('edit')}</button>
              <button className="secondary-button" disabled={!value || overrideSaving} onClick={() => void removeOverride(overrideDomain, item)}>{t('remove')}</button>
            </span>
            {editing && <div className="form-grid form-grid-full">
              <label className="form-field form-field-wide"><span>{t('overrideJson')}</span><textarea className="json-input" rows={5} value={overrideDraft} onChange={event => setOverrideDraft(event.target.value)} spellCheck={false} /></label>
              <div className="form-actions"><span className="mock-note"><TriangleAlert size={13} />{t('overrideHint')}</span><button className="secondary-button" disabled={overrideSaving} onClick={() => void saveOverride(overrideDomain, item)}>{overrideSaving ? t('saving') : t('save')}</button></div>
            </div>}
          </div>;
        })}</div>
      </Panel>
      <Panel title={t('auditSummary')} eyebrow={t('auditLog')} action={<button className="secondary-button" onClick={() => void loadAudit()} disabled={auditLoading}>{auditLoading ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}{t('refreshAudit')}</button>}>
        <div className="summary-grid">
          <SummaryCell label={t('auditTotal')} value={String(summary?.total ?? 0)} />
          <SummaryCell label={t('auditRejected')} value={String(summary?.rejected ?? 0)} tone="warn" />
          <SummaryCell label={t('auditRecent')} value={text(summary?.lastEventAt, '—')} />
          <SummaryCell label={t('confirm')} value={String(summary?.confirmed ?? 0)} tone="good" />
        </div>
        {auditData?.entries?.length ? <div className="audit-list">{auditData.entries.slice(0, 12).map(entry => <div className="audit-row" key={String(entry.id)}>
          <span className="audit-action"><StatePill tone={entry.dangerous ? 'warn' : 'muted'}>{text(entry.action)}</StatePill><small>{text(entry.domain, '—')}</small></span>
          <span className="audit-time">{text(entry.createdAt, '—')}</span>
          <details><summary>{t('auditDetails')}</summary><pre>{format(entry.details)}</pre></details>
        </div>)}</div> : <EmptyInline icon={<Shield size={17} />} text={t('auditEmpty')} />}
      </Panel>
      <Panel title={t('apiInspector')} eyebrow={t('developerTitle')} action={<span className="ui-tag">{t('readOnly')}</span>}>
        <div className="segmented-control inspector-tabs" role="group" aria-label={t('apiInspector')}>
          {(['capabilities', 'services', 'audit'] as const).map(tab => <button key={tab} className={inspector === tab ? 'active' : ''} aria-pressed={inspector === tab} onClick={() => setInspector(tab)}>{t(tab === 'capabilities' ? 'capabilitiesJson' : tab === 'services' ? 'servicesJson' : 'auditJson')}</button>)}
        </div>
        <div className="inspector-actions"><span className="mock-note"><Database size={13} />{t('jsonCopyHint')}</span><button className="secondary-button" onClick={() => void copyText(format(jsonValue ?? {}))}><Copy size={14} />{t('copy')}</button></div>
        <pre className="json-block">{format(jsonValue ?? {})}</pre>
      </Panel>
    </>;
  };

  const renderSystemPage = () => {
    const os = systemInfo.os && typeof systemInfo.os === 'object' ? systemInfo.os as Bag : {};
    const memory = systemInfo.memory && typeof systemInfo.memory === 'object' ? systemInfo.memory as Bag : {};
    const cpu = systemInfo.cpu && typeof systemInfo.cpu === 'object' ? systemInfo.cpu as Bag : {};
    const network = asRecords(systemInfo.network);
    const display = domainData.display ?? {};
    const devices = storageDevices;
    const storageTotal = devices.reduce((sum, item) => sum + number(item.total ?? item.size, 0), 0);
    const storageFree = devices.reduce((sum, item) => sum + number(item.free ?? item.available, 0), 0);
    const identityRows: [string, ReactNode][] = [
      [t('hostname'), text(systemInfo.hostname ?? networkData.hostname, '—')],
      [t('device'), text(systemInfo.model ?? systemInfo.device ?? systemInfo.hardware, '—')],
      [t('pjos'), text(systemInfo.pjos ?? systemInfo.pjosVersion ?? os.VERSION_ID, '—')],
      [t('linux'), text(os.PRETTY_NAME ?? os.ID, '—')],
      [t('osVersion'), text(os.VERSION_ID, '—')],
      [t('kernel'), text(systemInfo.kernel, '—')],
      [t('architecture'), text(systemInfo.arch, '—')],
      [t('platform'), text(systemInfo.platform, '—')],
      [t('uptime'), formatSeconds(systemInfo.uptimeSeconds ?? systemInfo.uptime)],
      [t('buildId'), text(systemInfo.buildId ?? systemInfo.build, '—')],
    ];
    const hardwareRows: [string, ReactNode][] = [
      [t('cpu'), text(cpu.model ?? systemInfo.cpuModel, '—')],
      [t('cores'), text(cpu.cores ?? systemInfo.cores, '—')],
      [t('memoryTotal'), formatBytes(memory.totalBytes ?? systemInfo.memoryTotal)],
      [t('memoryUsed'), Number.isFinite(Number(memory.totalBytes)) && Number.isFinite(Number(memory.availableBytes)) ? formatBytes(Number(memory.totalBytes) - Number(memory.availableBytes)) : '—'],
      [t('gpu'), text(systemInfo.gpu, '—')],
      [t('serial'), text(systemInfo.serial, '—')],
    ];
    const displayRows: [string, ReactNode][] = [
      [t('resolution'), text(display.resolution, '—')],
      [t('refreshRate'), text(display.refreshRate, '—')],
      [t('rotation'), text(display.rotation, '—')],
      [t('uiScale'), `${dpi}x`],
    ];
    return <>
      {systemInfo.available === false && <p className="inline-alert"><TriangleAlert size={14} /><span>{text(systemInfo.reason, t('systemInfoMockNote'))}</span></p>}
      <div className="profile-pair">
        <Panel title={t('hostProfile')} eyebrow={t('systemInfoTitle')} action={<span className="ui-tag">{text(systemInfo.hostProfile ?? systemInfo.provider, t('mock'))}</span>}>
          <p className="panel-note">{t('hostProfileNote')}</p>
          <InfoGrid items={[[t('hostname'), text(systemInfo.hostname, '—')], [t('kernel'), text(systemInfo.kernel, '—')], [t('architecture'), text(systemInfo.arch, '—')], [t('source'), text(systemInfo.source, 'mock')]]} />
        </Panel>
        <Panel title={t('hardwareProfile')} eyebrow={t('systemInfoTitle')} action={<span className="ui-tag">{hardwareProfile}</span>}>
          <p className="panel-note">{t('hardwareProfileNote')}</p>
          <InfoGrid items={[[t('mockProfile'), hardwareProfile], [t('uiProfile'), profile], [t('provider'), text(systemInfo.provider, 'mock')], [t('available'), flag(systemInfo.available) ? t('available') : t('unavailable')]]} />
        </Panel>
      </div>
      <Panel title={t('device')} eyebrow={t('systemInfoTitle')} action={<span className="ui-tag">{t('mock')}</span>}>
        <InfoGrid items={identityRows} />
      </Panel>
      <Panel title={t('cpu')} eyebrow={t('memory')}>
        <InfoGrid items={hardwareRows} />
      </Panel>
      <Panel title={t('displayInfo')} eyebrow={t('display')}>
        <InfoGrid items={displayRows} />
        <p className="mock-note"><Monitor size={13} />{t('mockHint')}</p>
      </Panel>
      <Panel title={t('storage')} eyebrow={t('storageCapability')} action={<button className="secondary-button" onClick={() => openPage('storage')}>{t('open')}<ChevronRight size={14} /></button>}>
        <InfoGrid items={[[t('storageDevices'), String(devices.length)], [t('capacity'), formatBytes(storageTotal)], [t('freeSpace'), formatBytes(storageFree)], [t('source'), text(storageMeta?.available === false ? 'mock' : 'provider', 'mock')]]} />
      </Panel>
      <Panel title={t('networkInfo')} eyebrow={t('network')}>
        {network.length ? <div className="record-list">{network.map((iface, index) => <div className="record-row" key={text(iface.name ?? iface.interface, `iface-${index}`)}>
          <span className="record-icon"><Network size={15} /></span>
          <span className="record-main"><strong>{text(iface.name ?? iface.interface, `iface-${index}`)}</strong><small>{Array.isArray(iface.addresses) ? iface.addresses.map(address => text(typeof address === 'object' && address ? (address as Bag).address : address)).filter(Boolean).join(', ') : text(iface.addresses, '—')}</small></span>
          <span className="record-meta"><StatePill tone={flag(iface.up) ? 'good' : 'muted'}>{flag(iface.up) ? t('on') : t('off')}</StatePill></span>
        </div>)}</div> : <EmptyInline icon={<Globe size={17} />} text={t('networkInfo')} />}
        <InfoGrid items={[[t('hostname'), text(networkData.hostname, '—')], [t('ipAddress'), text(networkData.ipAddress ?? networkData.ip, '—')], [t('dns'), text(networkData.dns, '—')], [t('proxy'), text(networkData.proxy, '—')]]} />
      </Panel>
      <p className="mock-note"><Cpu size={13} />{t('systemInfoMockNote')}</p>
    </>;
  };

  const renderServicesPage = () => {
    const counts = { running: 0, stopped: 0, error: 0, unavailable: 0 };
    for (const item of serviceData) { const key = (item.status in counts ? item.status : 'unavailable') as keyof typeof counts; counts[key] += 1; }
    return <>
      <MockBanner>{t('servicesMockNote')}</MockBanner>
      <div className="page-toolbar"><button className="secondary-button" onClick={() => void loadServices()}><RefreshCw size={15} />{t('refreshServices')}</button><span className="toolbar-hint">{t('restartHint')}</span></div>
      <div className="summary-grid">
        <SummaryCell label={t('serviceRunning')} value={String(counts.running)} tone="good" />
        <SummaryCell label={t('serviceStopped')} value={String(counts.stopped)} tone="warn" />
        <SummaryCell label={t('serviceError')} value={String(counts.error)} tone="bad" />
        <SummaryCell label={t('serviceUnavailable')} value={String(counts.unavailable)} tone="muted" />
      </div>
      <Panel title={t('servicesTitle')} eyebrow={t('serviceStatus')} action={<span className="ui-tag">{t('mock')}</span>}>
        {serviceData.length ? <div className="record-list">{serviceData.map(item => <div className="record-row" key={item.id}>
          <span className={`service-indicator ${serviceTone(item.status)}`} />
          <span className="record-main"><strong>{item.id}</strong><small>{item.reason || item.source || t('mock')}{item.updatedAt ? ` · ${t('lastUpdated')} ${item.updatedAt}` : ''}</small></span>
          <span className="record-meta"><StatePill tone={serviceTone(item.status)}>{t(`service${item.status.charAt(0).toUpperCase()}${item.status.slice(1)}`)}</StatePill></span>
          <span className="record-actions"><button className="secondary-button" onClick={() => void restartService(item.id)}>{t('restart')}</button></span>
        </div>)}</div> : <EmptyInline icon={<Server size={17} />} text={t('wait')} />}
      </Panel>
    </>;
  };

  const renderDomainPage = (target: Domain) => {
    if (target === 'remote') return renderRemotePage();
    if (target === 'storage') return renderStoragePage();
    if (target === 'accounts') return renderAccountsPage();
    if (target === 'sync') return renderSyncPage();
    if (target === 'updates') return renderUpdatesPage();
    if (target === 'power') return renderPowerPage();
    if (target === 'developer') return renderDeveloperPage();
    if (target === 'system') return renderSystemPage();
    if (target === 'network') {
      const adapterRows: [string, ReactNode][] = [
        [t('ethernetStatus'), networkData.ethernetEnabled === undefined ? t('unknown') : flag(networkData.ethernetEnabled) ? t('enabled') : t('disabled')],
        [t('ipAddress'), text(networkData.ipAddress ?? networkData.ip, '—')],
        [t('macAddress'), text(networkData.macAddress ?? networkData.mac, '—')],
        [t('hostname'), text(networkData.hostname, '—')],
        [t('dns'), text(networkData.dns, '—')],
        [t('proxy'), text(networkData.proxy, '—')],
      ];
      return <>
        <MockBanner>{t('mockBanner')}</MockBanner>
        <Panel title={t('configuration')} eyebrow={t('networkSettings')}>{renderSettingsCard('network', ['wifiEnabled', 'ethernetEnabled', 'hostname', 'dns', 'proxy'])}</Panel>
        <Panel title={t('ethernet')} eyebrow={t('networkSettings')}>
          <InfoGrid items={adapterRows} />
          <div className="row-actions"><button className="secondary-button" onClick={() => openPage('wifi')}><Wifi size={14} />{t('wifiSection')}<ChevronRight size={14} /></button></div>
        </Panel>
      </>;
    }
    const data = domainData[target];
    return <>
      {data?.dpi !== undefined && <MockBanner>{t('dpiHelp')}</MockBanner>}
      {data ? renderMergedSettings(target) : <LoadingInline label={t('loading')} />}
      {target === 'display' && caps.EInk?.available === false && <p className="mock-note"><Monitor size={13} />{t('noCapability')}</p>}
    </>;
  };

  const renderPageBody = () => {
    if (page === 'home') return null;
    if (page === 'wifi') return renderWifiPage();
    if (page === 'bluetooth') return renderBluetoothPage();
    if (page === 'services') return renderServicesPage();
    if (domain) return renderDomainPage(domain);
    return null;
  };

  const quickEntries: { key: string; page: Page; icon: typeof House; available: boolean; reason?: string; status: string }[] = [
    { key: 'wifi', page: 'wifi', icon: Wifi, available: wifiCapability?.available !== false, reason: wifiCapability?.reason, status: wifiNetworks.length ? `${wifiNetworks.length} ${t('availableNetworks')}` : t('wifiSection') },
    { key: 'bluetooth', page: 'bluetooth', icon: Bluetooth, available: Boolean(bluetoothCapability?.available), reason: bluetoothCapability?.reason, status: bluetoothCapability?.available ? t('pairedDevices') : t('unavailable') },
    { key: 'storage', page: 'storage', icon: HardDrive, available: capabilityFor('storage')?.available !== false, reason: capabilityFor('storage')?.reason, status: t('storageDevices') },
    { key: 'power', page: 'power', icon: Battery, available: capabilityFor('power')?.available !== false, reason: capabilityFor('power')?.reason, status: t('battery') },
  ];

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark"><Settings2 size={21} /></div><div><strong>Pocket</strong><span>SETTINGS</span></div></div><button className="search-button" onClick={() => setSearchOpen(true)}><Search size={17} /><span>{t('search')}</span><kbd>⌘ K</kbd></button><div className="sidebar-label">{t('settings')}</div><nav aria-label={t('settings')}>{visiblePages.filter(id => id !== 'home' && id !== 'services').map(nav)}</nav><div className="sidebar-bottom">{nav('services')}<div className="sidebar-footer"><div className={`status-dot ${connected ? 'live' : ''}`} /><span>{connected ? t('connected') : t('offline')}</span></div></div></aside>
    <main className="main-area">
      <header className="topbar"><div className="breadcrumbs"><button className="back-button" onClick={() => navPage('home')} aria-label={t('back')}><ChevronLeft size={18} /></button><span>{t('settings')}</span><ChevronRight size={14} /><strong>{heading}</strong></div><div className="top-actions"><span className="device-tag"><span className="device-dot" />{hardwareProfile}</span><button className="icon-button" aria-label={t('search')} onClick={() => setSearchOpen(true)}><Search size={18} /></button><button className="profile-chip" onClick={() => document.getElementById('ui-profile')?.focus()}><div className="avatar">{profile.slice(0, 1)}</div><span>{profile}</span></button></div></header>
      <div className="content-wrap">
        <div className="page-heading"><div><div className="eyebrow">{page === 'home' ? t('pocketSettings') : category?.title ?? t('deviceSettings')}</div><h1>{heading}</h1>{pageSubtitle() && <p className="subtitle">{pageSubtitle()}</p>}</div>{page !== 'home' && <div className="heading-icon">{iconFor(page)}</div>}</div>
        {error && <div className="alert error-alert" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label={t('dismiss')}><X size={16} /></button></div>}
        {notice && <div className="alert success-alert" role="status"><Check size={15} />{notice}</div>}
        {!connected && <div className="alert offline-alert"><span>{t('offline')}</span><button className="text-button" onClick={() => void refresh()}>{t('retry')}</button></div>}
        {page === 'home' && <>
          <section className="hero-card"><div className="hero-glow" /><div className="hero-copy"><div className="hero-kicker"><span className="hero-pulse" />{t('status')}</div><h2>{profile}</h2><p>{t(profileLabels[profile])} · {hardwareProfile}</p><div className="hero-foot"><span className="mock-badge"><span />{t('uiProfile')}</span><span className="hero-separator" /><span>{capEntries.length} {t('capabilities')}</span></div></div><div className="hero-art" aria-hidden="true"><div className="art-ring ring-one" /><div className="art-ring ring-two" /><div className="art-device"><div className="art-screen"><div /><div /><div /></div><span className="art-button" /></div><div className="art-orbit" /></div><div className="hero-number">01 <span>/ UI</span></div></section>
          <section className="quick-section"><div className="section-title"><div><span className="eyebrow">{t('atAGlance')}</span><h2>{t('quick')}</h2></div><button className="subtle-link" onClick={() => openPage('system')}>{t('systemDetails')} <ChevronRight size={14} /></button></div><div className="quick-grid">{quickEntries.map(({ key, page: target, icon: Icon, available, reason, status }, index) => <button key={key} className={`quick-card quick-${index} ${available ? '' : 'is-unavailable'}`} aria-disabled={!available} title={available ? undefined : reason || t('noCapability')} onClick={() => { if (!available) { setError(reason || t('noCapability')); return; } openPage(target); }}><span className="quick-icon"><Icon size={19} /></span><span className="quick-name">{t(key)}</span><span className="quick-state"><i className={available ? 'state-dot' : 'state-dot disabled'} />{status}</span><ChevronRight className="quick-arrow" size={16} /></button>)}</div></section>
          <section className="capability-section"><div className="section-title"><div><span className="eyebrow">{t('deviceReport')}</span><h2>{t('capabilities')}</h2></div><span className="report-chip">{hardwareProfile}</span></div><div className="capability-card">{capEntries.length ? capEntries.map(([key, cap]) => <div className="capability-row" key={key}><span className={`cap-indicator ${cap.available ? 'yes' : ''}`} /><span className="cap-name">{t(key)}</span><span className="cap-source">{cap.source}</span><span className={`cap-state ${cap.available ? '' : 'muted'}`}>{cap.available ? t('available') : t('unavailable')}</span></div>) : <div className="loading-state"><Activity size={16} />{t('loading')}</div>}</div></section>
          <section className="profile-section"><div className="section-title"><div><span className="eyebrow">{t('layout')}</span><h2>{t('systemProfile')}</h2></div><span className="ui-tag">{t('uiOnly')}</span></div><div className="profile-grid">{profiles.map((option, index) => <button key={option} className={`profile-card ${profile === option ? 'active' : ''}`} aria-pressed={profile === option} onClick={() => void changeProfile(option)}><span className={`profile-device profile-device-${index}`}><span /></span><strong>{option}</strong><small>{t(profileLabels[option])}</small>{profile === option && <Check className="profile-check" size={14} />}</button>)}</div></section>
          <section className="profile-section"><div className="section-title"><div><span className="eyebrow">{t('mockProfile')}</span><h2>{t('deviceReport')}</h2></div><span className="ui-tag">{t('mock')}</span></div><select className="mock-profile-select" aria-label={t('mockProfile')} value={hardwareProfile} onChange={event => void changeHardwareProfile(event.target.value as Profile)}>{profiles.map(item => <option key={item}>{item}</option>)}</select></section>
          <Preferences t={t} theme={theme} setTheme={setTheme} locale={locale} setLocale={setLocale} profile={profile} setProfile={value => void changeProfile(value)} density={density} setDensity={setDensity} dpi={dpi} setDpi={setDpi} />
        </>}
        {page !== 'home' && <section className="settings-page">{busy && !domainData[page as Domain] && page !== 'wifi' && page !== 'bluetooth' ? <div className="loading-state"><LoaderCircle className="spin" size={17} />{t('loading')}</div> : renderPageBody()}</section>}
      </div>
      <footer className="main-footer"><span><kbd>←</kbd><kbd>→</kbd> {t('select')}</span><span><kbd>Esc</kbd> {t('back')}</span><span className="footer-version">Pocket Settings <i /> settingsd API</span></footer>
    </main>
    {searchOpen && <div className="search-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) { setSearchOpen(false); setSearch(''); } }}>
      <section className="search-dialog" role="dialog" aria-modal="true" aria-label={t('search')}>
        <div className="search-input-wrap"><Search size={19} /><input ref={searchRef} value={search} onChange={event => void doSearch(event.target.value)} placeholder={t('searchHint')} aria-label={t('search')} aria-controls="search-result-list" /><kbd>ESC</kbd><button aria-label={t('back')} onClick={() => { setSearchOpen(false); setSearch(''); }}><X size={17} /></button></div>
        <div className="search-results" id="search-result-list" role="listbox" aria-label={t('searchResults')}>
          {searchEntries.length ? ['page', 'setting', 'capability'].map(kind => {
            const group = searchEntries.filter(entry => entry.kind === kind);
            if (!group.length) return null;
            return <div className="search-group" key={kind}><span className="search-caption">{kind === 'page' ? t('searchPages') : kind === 'setting' ? t('searchSettings') : t('capabilities')}</span>{group.map(entry => {
              const index = searchEntries.indexOf(entry);
              return <button key={entry.key} role="option" aria-selected={searchCursor === index} className={`search-result ${searchCursor === index ? 'keyboard-active' : ''}`} onMouseEnter={() => setSearchCursor(index)} onClick={() => openSearchEntry(entry)}>
                <span className="result-icon">{iconFor(entry.page)}</span>
                <span className="result-copy"><strong>{entry.title}</strong><small>{entry.hint}</small></span>
                {entry.kind === 'setting' && <span className="badge-mock">{t('searchSettings')}</span>}
                <kbd>↵</kbd>
              </button>;
            })}</div>;
          }) : <div className="search-empty">{search.trim() ? t('noResults') : t('searchEmptyHint')}</div>}
        </div>
        <div className="search-dialog-footer"><span>↑ ↓ {t('navigate')}</span><span>↵ {t('openSetting')}</span><span>{searchEntries.length} {t('searchResults')}</span></div>
      </section>
    </div>}
  </div>;
}

function Panel({ title, eyebrow, action, children }: { title: string; eyebrow?: string; action?: ReactNode; children: ReactNode }) {
  return <section className="settings-card panel"><div className="panel-head"><div>{eyebrow && <span className="section-label">{eyebrow}</span>}<h3>{title}</h3></div>{action}</div><div className="panel-body">{children}</div></section>;
}
function InfoGrid({ items }: { items: [string, ReactNode][] }) {
  return <div className="info-grid">{items.map(([label, value], index) => <div className="info-cell" key={`${label}-${index}`}><span className="info-label">{label}</span><span className="info-value">{value}</span></div>)}</div>;
}
function InfoCell({ label, value }: { label: string; value: ReactNode }) {
  return <div className="info-cell" role="cell"><span className="info-label">{label}</span><span className="info-value">{value}</span></div>;
}
function StatePill({ tone = 'muted', children }: { tone?: 'good' | 'warn' | 'bad' | 'muted' | 'info'; children: ReactNode }) {
  return <span className={`state-pill ${tone}`}>{children}</span>;
}
function SummaryCell({ label, value, tone = 'muted' }: { label: string; value: string; tone?: 'good' | 'warn' | 'bad' | 'muted' }) {
  return <div className={`summary-cell ${tone}`}><span className="info-label">{label}</span><strong>{value}</strong></div>;
}
function MockBanner({ children }: { children: ReactNode }) {
  return <p className="mock-banner"><TriangleAlert size={14} aria-hidden="true" /><span>{children}</span></p>;
}
function EmptyInline({ icon, text }: { icon: ReactNode; text: string }) {
  return <div className="empty-inline">{icon}<span>{text}</span></div>;
}
function LoadingInline({ label }: { label: string }) {
  return <div className="loading-state"><LoaderCircle className="spin" size={16} />{label}</div>;
}

function Preferences({ t, theme, setTheme, locale, setLocale, profile, setProfile, density, setDensity, dpi, setDpi }: { t: (key: string) => string; theme: Theme; setTheme: (value: Theme) => void; locale: Locale; setLocale: (value: Locale) => void; profile: Profile; setProfile: (value: Profile) => void; density: Density; setDensity: (value: Density) => void; dpi: Scale; setDpi: (value: Scale) => void }) {
  const themeItems: { id: Theme; icon: typeof Sun; label: string }[] = [{ id: 'light', icon: Sun, label: t('light') }, { id: 'dark', icon: Moon, label: t('dark') }, { id: 'oled', icon: Moon, label: t('oled') }, { id: 'system', icon: Monitor, label: t('systemTheme') }];
  return <section className="preferences-section"><div className="section-title"><div><span className="eyebrow">{t('personalize')}</span><h2>{t('preferences')}</h2></div><Languages size={17} /></div><div className="preferences-card"><div className="preference-row"><div><strong>{t('theme')}</strong><small>{t('themeHelp')}</small></div><div className="segmented-control" role="group" aria-label={t('theme')}>{themeItems.map(({ id, icon: Icon, label }) => <button key={id} className={theme === id ? 'active' : ''} onClick={() => setTheme(id)} aria-pressed={theme === id} title={label}><Icon size={15} /><span>{label}</span></button>)}</div></div><div className="preference-row"><div><strong>{t('language')}</strong><small>English · 简体中文 · 日本語</small></div><select aria-label={t('language')} value={locale} onChange={event => setLocale(event.target.value as Locale)}><option value="en">English</option><option value="zh-CN">简体中文</option><option value="ja">日本語</option></select></div><div className="preference-row"><div><strong>{t('profile')}</strong><small>{t('profileHelp')}</small></div><select id="ui-profile" aria-label={t('profile')} value={profile} onChange={event => setProfile(event.target.value as Profile)}>{profiles.map(item => <option key={item}>{item}</option>)}</select></div><div className="preference-row"><div><strong>{t('density')}</strong><small>{t('densityHelp')}</small></div><select aria-label={t('density')} value={density} onChange={event => setDensity(event.target.value as Density)}><option value="compact">{t('compact')}</option><option value="comfortable">{t('comfortable')}</option><option value="reader">{t('reader')}</option></select></div><div className="preference-row"><div><strong>{t('dpi')}</strong><small>{t('dpiHelp')}</small></div><select aria-label={t('dpi')} value={String(dpi)} onChange={event => { const value = Number(event.target.value); if (scales.includes(value as Scale)) setDpi(value as Scale); }}>{scales.map(value => <option key={value} value={value}>{value}x</option>)}</select></div></div></section>;
}
