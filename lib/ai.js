import fetch from 'node-fetch';

function cfg() {
  const g = global.aiConfig || {};
  return {
    backend: process.env.AI_BACKEND || g.backend || 'ollama',
    ollamaUrl: (process.env.OLLAMA_URL || g.url || 'http://127.0.0.1:11434').replace(/\/+$/, ''),
    model: process.env.AI_MODEL || g.model || 'dolphin3:8b',
    apiUrl: (process.env.AI_URL || g.apiUrl || '').replace(/\/+$/, ''),
    apiKey: process.env.AI_KEY || g.apiKey || '',
  };
}

export function info() {
  const c = cfg();
  return { backend: c.backend, model: c.model, target: c.backend === 'openai' ? c.apiUrl : c.ollamaUrl };
}

export async function probe() {
  const c = cfg();
  try {
    const r = c.backend === 'openai'
      ? await fetch(`${c.apiUrl}/models`, { headers: { authorization: `Bearer ${c.apiKey}` }, timeout: 6000 })
      : await fetch(`${c.ollamaUrl}/api/tags`, { timeout: 6000 });
    return r.ok;
  } catch {
    return false;
  }
}

export async function chat(messages, opts = {}) {
  const c = cfg();
  const timeout = opts.timeout ?? 180000;

  if (c.backend === 'openai') {
    if (!c.apiUrl || !c.apiKey) throw new Error('Configura apiUrl y apiKey en global.aiConfig');
    const r = await fetch(`${c.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${c.apiKey}` },
      body: JSON.stringify({
        model: opts.model || c.model,
        messages,
        temperature: 0.85,
        max_tokens: 900,
      }),
      timeout,
    });
    if (!r.ok) throw new Error(`API ${r.status}: ${(await r.text()).slice(0, 160)}`);
    const j = await r.json();
    const t = j?.choices?.[0]?.message?.content;
    if (!t) throw new Error('Respuesta vacía del proveedor');
    return t.trim();
  }

  const r = await fetch(`${c.ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: opts.model || c.model,
      messages,
      stream: false,
      keep_alive: '30m',
      options: { temperature: 0.85, num_predict: 700, repeat_penalty: 1.1 },
    }),
    timeout,
  });
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const j = await r.json();
  const t = j?.message?.content;
  if (!t) throw new Error('Respuesta vacía del modelo');
  return t.trim();
}
