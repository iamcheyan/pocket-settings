// Verifies English, Simplified Chinese, and Japanese expose identical keys.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(join(here, '..', 'src', 'i18n.ts'), 'utf8');
const labels = {};

for (const [name, marker] of [['en', 'const en = {'], ['zh-CN', 'const zhCN = {'], ['ja', 'const ja = {']]) {
  const start = source.indexOf(marker);
  const end = source.indexOf('\n};', start);
  if (start < 0 || end < 0) throw new Error(`missing locale block ${name}`);
  const block = source.slice(start, end);
  const keys = [...block.matchAll(/(?:^|,)\s*([A-Za-z][A-Za-z0-9_]*)\s*:/g)].map(match => match[1]);
  if (!keys.length) throw new Error(`no keys found for ${name}`);
  if (new Set(keys).size !== keys.length) throw new Error(`duplicate keys in ${name}`);
  labels[name] = keys;
}

const all = new Set(Object.values(labels).flat());
for (const [name, keys] of Object.entries(labels)) {
  const missing = [...all].filter(key => !keys.includes(key));
  if (missing.length) throw new Error(`${name} is missing: ${missing.join(', ')}`);
}
console.log(`i18n parity ok: ${Object.keys(labels).length} locales, ${all.size} keys`);
