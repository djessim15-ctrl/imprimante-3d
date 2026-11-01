/* Proxy /api/chat — fonction serverless Vercel (Node, sans dépendance).
   Réplique server.py : relais vers l'API Groq, limite de débit, validation. */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const LIMIT = 30;          // requêtes max...
const WINDOW_MS = 60_000;  // ...par IP et par minute

/* Le modèle fort est utilisé pour les demandes qui touchent aux données ; le
   modèle rapide suffit pour une question courte (et il répond plus vite). */
const MODEL_SMART = 'openai/gpt-oss-120b';
const MODEL_FAST = 'openai/gpt-oss-20b';

/* Réparation d'un JSON tronqué : on coupe au dernier objet complet et on
   ferme les crochets. Sans cela, un max_tokens atteint perd toute la réponse. */
function repairJson(raw) {
  const s = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf('{');
  if (a < 0) return null;
  const body = s.slice(a);
  /* on essaie de fermer progressivement en retirant la fin */
  for (let cut = body.length; cut > 1; cut--) {
    const head = body.slice(0, cut).replace(/[,:\s]+$/, '');
    const opens = [];
    let inStr = false, esc2 = false, ok = true;
    for (let i = 0; i < head.length; i++) {
      const ch = head[i];
      if (inStr) {
        if (esc2) esc2 = false;
        else if (ch === '\\') esc2 = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{' || ch === '[') opens.push(ch);
      else if (ch === '}' || ch === ']') {
        const need = ch === '}' ? '{' : '[';
        if (opens.pop() !== need) { ok = false; break; }
      }
    }
    if (!ok || inStr) continue;
    const closed = head + opens.reverse().map(o => (o === '{' ? '}' : ']')).join('');
    try { const o = JSON.parse(closed); if (o && typeof o === 'object') return o; } catch {}
  }
  return null;
}
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
  /* CORS : la page peut être servie depuis l'aperçu local et appeler l'API déployée. */
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();

  /* Test de santé : ne révèle jamais la clé, seulement sa présence. */
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      configured: Boolean(process.env.GROQ_API_KEY),
      key_length: (process.env.GROQ_API_KEY || '').length,
      model: MODEL_SMART,
      models: [MODEL_SMART, MODEL_FAST],
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

  /* Le petit modèle suffit pour une question courte ; toute demande qui
     ressemble à une action (verbe à l'impératif, chiffres, ids) part sur le
     gros modèle, plus fiable pour produire un JSON complet. */
  const lastUser = [...clean].reverse().find((m) => m.role === 'user')?.content || '';
  const questionOnly = lastUser.length < 60 &&
    /^(quoi|combien|pourquoi|quel|quelle|quels|quelles|qui|ou est|où est|est-ce|comment|ca vaut|ça vaut|analyse|un point|resume|résume)/i.test(lastUser) &&
    !/(ajoute|crée|cree|creer|créer|supprime|modifie|change|mets|met |passe|fixe|enregistre|corrige|supprimer|appliquer|applique)/i.test(lastUser);
  const model = body.model === 'fast' || (questionOnly && body.force !== 'smart') ? MODEL_FAST : MODEL_SMART;

  const payload = JSON.stringify({
    model,
    messages: clean,
    temperature: 0.2,
    reasoning_effort: 'low',
    max_tokens: 2400,
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
    let content = result?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      return res.status(502).json({ error: 'Réponse inattendue de l’assistant.' });
    }
    /* Le JSON est réparé côté serveur : le client reçoit toujours du JSON
       exploitable, même si la réponse a été coupée par la limite de tokens. */
    content = content.trim();
    if (!content.startsWith('{')) {
      const parsed = repairJson(content);
      if (parsed) content = JSON.stringify(parsed);
    } else {
      try { JSON.parse(content); } catch { const parsed = repairJson(content); if (parsed) content = JSON.stringify(parsed); }
    }
    return res.status(200).json({ content, model });
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
