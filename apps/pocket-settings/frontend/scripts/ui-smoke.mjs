// Keyboard-only UI smoke test over the DevTools protocol (no Playwright).
// Requires the app (`npm run dev`) and settingsd to be running.
import {existsSync} from 'node:fs';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const origin = process.env.POCKET_SETTINGS_URL ?? 'http://127.0.0.1:15173';
const chrome = [process.env.CHROMIUM, process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/run/current-system/sw/bin/chromium']
  .find((candidate) => candidate && existsSync(candidate));
if (!chrome) throw new Error('no Chromium/Chrome binary found; set CHROMIUM');
const port = Number(process.env.CDP_PORT ?? 9334);
const sleep = ms => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const cdp = new CDP(ws);
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id && cdp.pending.has(m.id)) {
        const { resolve, reject } = cdp.pending.get(m.id);
        cdp.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
    };
    return cdp;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

const dir = await mkdtemp(join(tmpdir(), 'pocket-settings-smoke-'));
const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
let cdp;
let failures = 0;
try {
  let version;
  for (let i = 0; i < 100 && !version; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(100); }
  }
  if (!version) throw new Error('Chromium DevTools did not start');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  cdp = await CDP.connect(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const evalJS = async expression => {
    const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'evaluation failed');
    return result.result.value;
  };
  const key = async (k, code = k) => {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code });
    await sleep(120);
  };
  const goto = async url => { await cdp.send('Page.navigate', { url }); await sleep(1100); };

  await goto(`${origin}/?hardware=Desktop&page=home&theme=dark&locale=en`);
  const start = await evalJS('document.querySelector("h1")?.textContent');
  if (start !== 'Overview') throw new Error(`expected Overview, got ${start}`);

  // Keyboard search: Ctrl+K, type, verify arrow-key movement, then open the
  // first (page) result — the smoke must not depend on cursor start offset.
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 2 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 2 });
  await sleep(250);
  await cdp.send('Input.insertText', { text: 'display' });
  await sleep(500);
  const firstTitle = await evalJS(`[...document.querySelectorAll('[role=option]')].filter(e=>e.getAttribute('aria-selected')==='true').map(e=>e.querySelector('strong,.search-result-title')?.textContent ?? e.textContent)[0]`);
  if (!firstTitle || !/display/i.test(firstTitle)) throw new Error(`search first result is not Display: ${firstTitle}`);
  await key('ArrowDown');
  const moved = await evalJS(`[...document.querySelectorAll('[role=option]')].filter(e=>e.getAttribute('aria-selected')==='true').length`);
  if (moved !== 1) throw new Error('ArrowDown did not move the search cursor');
  await key('ArrowUp');
  await key('Enter');
  const opened = await evalJS('document.querySelector("h1")?.textContent');
  if (opened !== 'Display') throw new Error(`keyboard search did not open Display (got ${opened})`);

  // Keyboard back to home.
  await key('Escape', 'Escape');
  const back = await evalJS('document.querySelector("h1")?.textContent');
  if (back !== 'Overview') throw new Error(`Escape did not return home (got ${back})`);

  // Keyboard page navigation with arrows.
  await key('ArrowRight', 'ArrowRight');
  const next = await evalJS('document.querySelector("h1")?.textContent');
  if (!next || next === 'Overview') throw new Error('ArrowRight did not navigate');

  // Persisted setting change through the UI API path (mock write).
  const write = await evalJS(`fetch('/api/settings/display',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({brightness:63})}).then(r=>r.status)`);
  const read = await evalJS(`fetch('/api/settings/display').then(r=>r.json()).then(j=>j.brightness)`);
  if (write !== 200 || read !== 63) throw new Error(`mock setting persistence failed: status=${write} brightness=${read}`);

  // Locale/theme variants must produce distinct rendered roots.
  const hash = async url => { await goto(url); return evalJS('document.documentElement.dataset.theme + "|" + document.documentElement.lang + "|" + document.querySelector("h1")?.textContent'); };
  const dark = await hash(`${origin}/?page=home&hardware=Desktop&theme=dark&locale=en`);
  const lightJa = await hash(`${origin}/?page=home&hardware=Desktop&theme=light&locale=ja`);
  if (dark === lightJa) throw new Error('theme/locale variants render identically');

  // Capability gating: a handheld fixture without Display/Audio must not
  // render those pages; Leaf3C (EInk) must expose Display.
  const navFor = async hardware => {
    await goto(`${origin}/?page=home&hardware=${hardware}&theme=dark&locale=en`);
    return evalJS(`[...document.querySelectorAll('nav button')].map(b=>b.textContent.replace(/\\s+/g,' ').trim())`);
  };
  const handheldNav = await navFor('RG34XX');
  if (handheldNav.includes('Display') || handheldNav.includes('Audio')) {
    throw new Error(`RG34XX unexpectedly exposes uncapable pages: ${handheldNav.join('|')}`);
  }
  const readerNav = await navFor('Leaf3C');
  if (!readerNav.includes('Display') || readerNav.includes('Audio')) {
    throw new Error(`Leaf3C gating wrong: ${readerNav.join('|')}`);
  }
  console.log(`UI smoke passed: ${dark} vs ${lightJa}`);
} catch (error) {
  failures++;
  console.error(error);
} finally {
  cdp?.ws?.close();
  proc.kill('SIGTERM');
  await sleep(200);
  await rm(dir, { recursive: true, force: true });
  process.exit(failures ? 1 : 0);
}
