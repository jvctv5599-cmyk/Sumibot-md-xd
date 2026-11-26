import fs from 'fs';
import path from 'path';

const FILE = path.resolve('./lib/system/data/ai-history.json');
const LIMIT = 12;
let store = null;
let timer = null;

function load() {
  if (store) return store;
  try { store = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { store = {}; }
  return store;
}

function persist() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(store));
    } catch {}
  }, 1500);
}

export function getHistory(id) {
  return load()[id] ?? [];
}

export function pushHistory(id, role, content) {
  const s = load();
  const arr = s[id] ?? [];
  arr.push({ role, content: String(content).slice(0, 4000) });
  while (arr.length > LIMIT) arr.shift();
  s[id] = arr;
  persist();
}

export function clearHistory(id) {
  const s = load();
  delete s[id];
  persist();
}

export function size(id) {
  return getHistory(id).length;
}
