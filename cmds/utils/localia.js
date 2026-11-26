import { chat, probe, info } from '../../lib/ai.js';
import { getHistory, pushHistory, clearHistory, size } from '../../lib/aihistory.js';

const COOLDOWN = 4000;
const last = new Map();
const busy = new Set();

function norm(t) {
  return String(t).replace(/^[^\p{L}\p{N}]+/u, '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function isCommandLike(body) {
  const toks = body.trim().split(/\s+/).map(norm).filter(Boolean);
  if (!toks.length) return false;
  if (global.comandos?.has(toks[0])) return true;
  const prefixes = (global.aiPrefixes || []).map(norm);
  if (prefixes.includes(toks[0]) && toks[1] && global.comandos?.has(toks[1])) return true;
  return false;
}

function stripPrefixes(body) {
  const toks = body.trim().split(/\s+/);
  const prefixes = (global.aiPrefixes || []).map(norm);
  while (toks.length && prefixes.includes(norm(toks[0]))) toks.shift();
  return toks.join(' ').trim() || body.trim();
}

function systemPrompt() {
  const base = global.aiConfig?.systemPrompt || '';
  const name = global.aiConfig?.botName || 'Sumi';
  return `${base}\n\nTu nombre es ${name}. Responde en el idioma del usuario.`;
}

export const before = async ({ msg, sock }) => {
  try {
    if (!global.aiConfig?.enabled) return;
    if (msg.fromMe) return;
    if (!msg.body || !msg.body.trim()) return;
    if (msg.chat === 'status@broadcast') return;
    if (msg.isGroup && !global.aiConfig?.groups) return;
    if (isCommandLike(msg.body)) return;

    const sender = msg.sender;
    if (busy.has(sender)) return;
    const now = Date.now();
    if (now - (last.get(sender) || 0) < COOLDOWN) return;
    last.set(sender, now);
    busy.add(sender);

    try {
      await sock.sendPresenceUpdate('composing', msg.chat).catch(() => {});
      const userText = stripPrefixes(msg.body);
      const messages = [
        { role: 'system', content: systemPrompt() },
        ...getHistory(msg.chat),
        { role: 'user', content: userText },
      ];
      const reply = await chat(messages);
      pushHistory(msg.chat, 'user', userText);
      pushHistory(msg.chat, 'assistant', reply);
      await msg.reply(reply);
    } catch (e) {
      await msg.reply(`⚠️ ${String(e.message || e).slice(0, 140)}`);
    } finally {
      busy.delete(sender);
    }
  } catch (e) {
    console.error('[localia]', e.message);
  }
};

export default {
  command: ['iareset', 'iaestado'],
  category: 'ai',
  description: 'Limpia el historial del chat o muestra el estado del motor local.',
  run: async ({ msg, command }) => {
    if (command === 'iareset') {
      clearHistory(msg.chat);
      return msg.reply('Historial del chat borrado.');
    }
    const i = info();
    const ok = await probe();
    return msg.reply(
      `Motor: ${i.backend}\nModelo: ${i.model}\nDestino: ${i.target}\n` +
      `Alcanzable: ${ok ? 'sí' : 'no'}\nMensajes en memoria: ${size(msg.chat)}\n` +
      `Grupos: ${global.aiConfig?.groups ? 'activo' : 'desactivado'}`
    );
  },
};
