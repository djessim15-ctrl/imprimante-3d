/* Proxy /api/chat — fonction serverless Vercel (Node, sans dépendance).
   Réplique server.py : relais vers l'API Groq, limite de débit, validation. */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const LIMIT = 12;          // requêtes max...
const WINDOW_MS = 60_000;  // ...par IP et par minute
const MAX_BODY = 60_000;   // octets
const MAX_MESSAGES = 20;

/* Mémoire de l'instance : approximative sur Vercel (instances multiples,
   mises à froid). Suffisante comme garde-fou anti-abus basique. */
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMIT) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.delete(hits.keys().next().value);
  return false;
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  return null;
}

export default async function handler(req, res) {
  /* Test de santé : ne révèle jamais la clé, seulement sa présence. */
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      configured: Boolean(process.env.GROQ_API_KEY),
      env_keys: Object.keys(process.env)
        .filter((k) => k.startsWith('GROQ'))
        .sort(),
      model: 'openai/gpt-oss-120b',
      runtime: process.version,
    });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }

  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    (req.socket && req.socket.remoteAddress) ||
    'inconnu';

  if (rateLimited(ip)) {
    return res.status(429).json({ error: 'Trop de demandes, réessaie dans une minute.' });
  }

  let body;
  try {
    body = readBody(req);
  } catch {
    return res.status(400).json({ error: 'Requête invalide.' });
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Requête invalide.' });
  }

  const key = process.env.GROQ_API_KEY;
  if (!key) {
    return res.status(400).json({ error: 'Assistant non configuré : clé Groq absente côté serveur.' });
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return res.status(400).json({ error: 'Conversation trop longue.' });
  }

  const clean = [];
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'system')) {
      return res.status(400).json({ error: 'Requête invalide.' });
    }
    if (typeof m.content !== 'string' || !m.content.trim()) {
      return res.status(400).json({ error: 'Requête invalide.' });
    }
    clean.push({ role: m.role, content: m.content.slice(0, 20_000) });
  }

  const payload = JSON.stringify({
    model: 'openai/gpt-oss-120b',
    messages: clean,
    temperature: 0.2,
    reasoning_effort: 'low',
    max_tokens: 1600,
    response_format: { type: 'json_object' },
  });

  if (Buffer.byteLength(payload) > MAX_BODY) {
    return res.status(400).json({ error: 'Requête invalide.' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50_000);
  try {
    const r = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'User-Agent': 'curl/8.0',
      },
      body: payload,
      signal: controller.signal,
    });

    if (!r.ok) {
      // On ne relaie pas le corps d'erreur de Groq (il peut contenir des infos de compte).
      return res.status(502).json({
        error: `Groq a refusé la demande (HTTP ${r.status}). Vérifie la clé et les limites du compte.`,
      });
    }

    const result = await r.json();
    const content = result?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      return res.status(502).json({ error: 'Réponse inattendue de l’assistant.' });
    }
    return res.status(200).json({ content });
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    return res.status(aborted ? 504 : 500).json({
      error: aborted
        ? 'L’assistant a mis trop de temps à répondre. Réessaie.'
        : 'Impossible de joindre l’assistant.',
    });
  } finally {
    clearTimeout(timer);
  }
}
