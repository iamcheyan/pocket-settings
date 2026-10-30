// Headless Chromium screenshot harness using the DevTools protocol directly.
// Playwright is intentionally not required: this only needs Node's built-in
// WebSocket and the system Chromium binary.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const ORIGIN = process.env.POCKET_SETTINGS_URL ?? 'http://127.0.0.1:15173';
const OUT = resolve(process.env.POCKET_SETTINGS_SCREENSHOTS ?? 'apps/pocket-settings/docs/screenshots');
const CHROME = process.env.CHROMIUM ?? 'chromium';
const PORT = Number(process.env.CDP_PORT ?? 9333);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function json(path) {
  const response = await fetch(`http://127.0.0.1:${PORT}${path}`);
  if (!response.ok) throw new Error(`${path} -> ${response.status}`);
  return response.json();
}

async function waitForDebugger() {
  for (let i = 0; i < 100; i++) {
    try { return await json('/json/version'); } catch { await sleep(100); }
  }
  throw new Error('Chromium DevTools endpoint did not start');
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const cdp = new CDP(ws);
    ws.onmessage = event => {
      const msg = JSON.parse(event.data);
      if (msg.id && cdp.pending.has(msg.id)) {
        const { resolve, reject } = cdp.pending.get(msg.id);
        cdp.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) cdp.events.push(msg);
    };
    return cdp;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  close() { this.ws.close(); }
}

async function main() {
  const profileDir = await mkdtemp(join(tmpdir(), 'pocket-settings-chrome-'));
  await mkdir(OUT, { recursive: true });
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profileDir}`,
    '--window-size=1280,720', 'about:blank',
  ], { stdio: 'ignore' });

  const manifest = [];
  let cdp;
  try {
    await waitForDebugger();
    const targets = await json('/json/list');
    const pageTarget = targets.find(t => t.type === 'page');
    cdp = await CDP.connect(pageTarget.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

    const capture = async (name, url, width = 1280, height = 720) => {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await cdp.send('Page.navigate', { url });
      await sleep(900);
      const png = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const bytes = Buffer.from(png.data, 'base64');
      const file = join(OUT, `${name}.png`);
      await writeFile(file, bytes);
      manifest.push({ name, width, height, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
      console.log(`${name}: ${width}x${height} sha256=${manifest.at(-1).sha256.slice(0, 16)} bytes=${bytes.length}`);
    };

    const desktopPages = ['home', 'display', 'audio', 'network', 'wifi', 'bluetooth', 'remote', 'storage', 'accounts', 'sync', 'updates', 'power', 'developer', 'system', 'services'];
    for (const page of desktopPages) {
      await capture(`${page}-Desktop-dark-en`, `${ORIGIN}/?page=${page}&hardware=Desktop&theme=dark&locale=en`);
    }
    await capture('home-handheld-RG34XX', `${ORIGIN}/?page=home&hardware=RG34XX&theme=dark&locale=en`);
    await capture('home-light-en-Desktop', `${ORIGIN}/?page=home&hardware=Desktop&theme=light&locale=en`);
    await capture('home-light-zh-CN-Desktop', `${ORIGIN}/?page=home&hardware=Desktop&theme=light&locale=zh-CN`);
    await capture('home-oled-ja-Desktop', `${ORIGIN}/?page=home&hardware=Desktop&theme=oled&locale=ja`);
    await capture('display-light-en-Desktop', `${ORIGIN}/?page=display&hardware=Desktop&theme=light&locale=en`);
    await capture('display-oled-ja-Desktop', `${ORIGIN}/?page=display&hardware=Desktop&theme=oled&locale=ja`);
    await capture('display-Leaf3C-eink', `${ORIGIN}/?page=display&hardware=Leaf3C&theme=dark&locale=en`);
    await capture('wifi-Leaf3C-dark-en', `${ORIGIN}/?page=wifi&hardware=Leaf3C&theme=dark&locale=en`);
    await capture('home-320x240', `${ORIGIN}/?page=home&hardware=RG34XX&theme=dark&locale=en`, 320, 240);
    await capture('home-480x320', `${ORIGIN}/?page=home&hardware=RG40XX&theme=dark&locale=en`, 480, 320);
    await capture('home-640x480', `${ORIGIN}/?page=home&hardware=RG40XX&theme=dark&locale=en`, 640, 480);
    await capture('home-720x720', `${ORIGIN}/?page=home&hardware=Desktop&theme=light&locale=en`, 720, 720);
    await capture('home-1920x1080', `${ORIGIN}/?page=home&hardware=Desktop&theme=dark&locale=en`, 1920, 1080);

    await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`captured ${manifest.length} screenshots to ${OUT}`);
  } finally {
    cdp?.close();
    chrome.kill('SIGTERM');
    await sleep(300);
    await rm(profileDir, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exit(1); });
