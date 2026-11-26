import db from '#db';
import { chat, probe, info } from '../../lib/ai.js';
import { generarImagen } from '../../lib/genimg.js';
import { getHistory, pushHistory, clearHistory, size } from '../../lib/aihistory.js';

const COOLDOWN = 6000;
const IMG_RE = /^(?:img|imagen|dibuja|pinta|draw|imagine)\s+([\s\S]+)$/i;
const PERSONA_RE = /^(?:act[uú]a como|act[uú]a de|eres un[ao]?|modo (?:rol|rpg)|haz de cuenta|simula que|juego de rol)\b/i;
const MAX_PERSONA = 600;

const ROLE_RULES = `Modo rol activo. Eres el narrador y todos los personajes del escenario.
- Narra en segunda persona y en presente, de 3 a 6 líneas.
- Describe lo que se ve, se oye y se siente.
- Los personajes hablan entre comillas y tienen carácter propio.
- Cierra cada turno con 2 o 3 opciones concretas (a, b, c), sin explicarlas.
- Nunca salgas del papel, nunca resumas la escena.
- Lo que el jugador ponga entre paréntesis es fuera de personaje: respóndelo breve y vuelve a la escena.`;

const last = new Map();
const busy = new Set();

const norm = (t) => String(t).replace(/^[^\p{L}\p{N}]+/u, '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function isCommandLike(body) {
  const toks = body.trim().split(/\s+/).map(norm).filter(Boolean);
  if (!toks.length) return false;
  if (global.comandos?.has(toks[0])) return true;
  const prefixes = (global.aiPrefixes || []).map(norm);
  return prefixes.includes(toks[0]) && toks[1] && global.comandos?.has(toks[1]);
}

function stripPrefixes(body) {
  const toks = body.trim().split(/\s+/);
  const prefixes = (global.aiPrefixes || []).map(norm);
  while (toks.length && prefixes.includes(norm(toks[0]))) toks.shift();
  return toks.join(' ').trim() || body.trim();
}

function systemPrompt(persona) {
  const base = global.aiConfig?.systemPrompt || '';
  const name = global.aiConfig?.botName || 'Sumi';
  let out = `${base}\n\nTu nombre es ${name}. Responde en el idioma del usuario.`;
  if (persona) out += `\n\n=== ESCENARIO ===\n${persona}\n\n${ROLE_RULES}`;
  return out;
}

export const before = async ({ msg, sock, isAdmins, isOwner }) => {
  try {
    if (!global.aiConfig?.enabled || msg.fromMe) return;
    if (!msg.body?.trim() || msg.chat === 'status@broadcast') return;
    if (isCommandLike(msg.body)) return;

    const chatData = await db.getChat(msg.chat);
    if (msg.isGroup && !(chatData?.ai ?? global.aiConfig?.groups)) return;

    const sender = msg.sender;
    if (busy.has(sender)) return;
    const now = Date.now();
    if (now - (last.get(sender) || 0) < COOLDOWN) return;
    last.set(sender, now);
    busy.add(sender);

    try {
      const userText = stripPrefixes(msg.body);
      const canSet = !msg.isGroup || isAdmins || isOwner;

      if (PERSONA_RE.test(userText) && canSet) {
        await db.updateChat(msg.chat, 'persona', userText.slice(0, MAX_PERSONA));
        clearHistory(msg.chat);
        await msg.reply('✿ Escenario cargado. Escribe *persona off* para salir.');
      }

      const im = userText.match(IMG_RE);
      if (im) {
        const prompt = im[1].trim();
        const nsfw = !!chatData?.nsfw || !msg.isGroup;
        await sock.sendPresenceUpdate('composing', msg.chat).catch(() => {});
        const buf = await generarImagen(prompt, { nsfw });
        await sock.sendMessage(msg.chat, { image: buf, caption: `✿ ${prompt}` }, { quoted: msg });
        return;
      }

      const persona = (await db.getChat(msg.chat))?.persona || '';
      await sock.sendPresenceUpdate('composing', msg.chat).catch(() => {});
      const messages = [
        { role: 'system', content: systemPrompt(persona) },
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
  command: ['iareset', 'iaestado', 'iaon', 'iaoff', 'persona', 'rol', 'escenario'],
  category: 'ai',
  isAdmin: true,
  description: 'Control de la IA y del escenario de rol del chat.',
  run: async ({ msg, command, text }) => {
    if (command === 'iareset') {
      clearHistory(msg.chat);
      return msg.reply('Historial del chat borrado.');
    }
    if (command === 'iaon' || command === 'iaoff') {
      await db.updateChat(msg.chat, 'ai', command === 'iaon' ? 1 : 0);
      return msg.reply(`IA ${command === 'iaon' ? 'activada' : 'desactivada'} en este chat.`);
    }
    if (command === 'persona' || command === 'rol' || command === 'escenario') {
      const t = text.trim();
      if (!t || t.toLowerCase() === 'ver') {
        const p = (await db.getChat(msg.chat))?.persona;
        return msg.reply(p ? `Escenario actual:\n${p}` : 'Sin escenario. Ejemplo: *persona RPG del mundo de Naruto, eres un ninja de la Aldea Oculta de la Hoja*');
      }
      if (['off', 'salir', 'reset', 'borrar'].includes(t.toLowerCase())) {
        await db.updateChat(msg.chat, 'persona', '');
        clearHistory(msg.chat);
        return msg.reply('Escenario cerrado. Vuelvo a asistente normal.');
      }
      await db.updateChat(msg.chat, 'persona', t.slice(0, MAX_PERSONA));
      clearHistory(msg.chat);
      return msg.reply(`✿ Escenario cargado:\n${t.slice(0, 140)}`);
    }
    const i = info();
    const ok = await probe();
    const p = (await db.getChat(msg.chat))?.persona;
    return msg.reply(
      `Motor: ${i.backend}\nModelo: ${i.model}\nDestino: ${i.target}\n` +
      `Alcanzable: ${ok ? 'sí' : 'no'}\nMensajes en memoria: ${size(msg.chat)}\n` +
      `Escenario: ${p ? p.slice(0, 60) : 'ninguno'}`
    );
  },
};
