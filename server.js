// Serveur local : sert src/ et expose POST /api/feedback (transcription → corrections du coach via Gemini).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, 'src');
const PORT = Number(process.env.PORT || 3000);
// Liste ordonnée : le premier modèle est tenté en priorité, les suivants servent de secours en cas de saturation.
const MODELS = (process.env.DST_MODEL || 'gemini-3.5-flash-lite,gemini-3.6-flash,gemini-3.1-flash-lite').split(',').map((s) => s.trim()).filter(Boolean);
const API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const endpoint = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const LANG_NAME = { fr: 'français', en: 'anglais', es: 'espagnol' };

// Schéma de réponse (sous-ensemble OpenAPI accepté par Gemini).
const FEEDBACK_SCHEMA = {
  type: 'OBJECT',
  properties: {
    strengths: { type: 'STRING', description: 'Deux phrases max, en français, sur ce qui a bien marché (structure, temps verbaux, vocabulaire).' },
    corrections: {
      type: 'ARRAY',
      description: 'Au plus 6 corrections, les plus utiles d\'abord.',
      items: {
        type: 'OBJECT',
        properties: {
          wrong: { type: 'STRING', description: 'Le fragment exact tel que dit par l\'apprenant, dans la langue cible.' },
          right: { type: 'STRING', description: 'La version corrigée, naturelle, dans la langue cible.' },
          tag: { type: 'STRING', description: 'Catégorie courte en français : auxiliaire, accord du participe, genre des noms, préposition, lexique, calque, subjonctif, répétition, ordre des mots…' }
        },
        required: ['wrong', 'right', 'tag']
      }
    },
    further: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Deux ou trois tournures idiomatiques du niveau visé, dans la langue cible, que l\'apprenant aurait pu utiliser.' },
    followup: { type: 'STRING', description: 'Une question de relance dans la langue cible, qui reprend un détail précis de ce que l\'apprenant a dit.' }
  },
  required: ['strengths', 'corrections', 'further', 'followup']
};

function systemPrompt({ language, level, coach }) {
  return [
    `Tu es ${coach.name}, ${coach.role}, coach de conversation en ${LANG_NAME[language] || language}. Tu viens d'écouter un apprenant de niveau ${level} parler pendant une à cinq minutes.`,
    'Tu reçois une transcription automatique : ignore les erreurs évidentes de reconnaissance vocale (mots absurdes, ponctuation absente) et concentre-toi sur la grammaire, le lexique et la structure du propos. Tu ne juges pas la prononciation.',
    `Tous les champs de ta réponse ("strengths", "wrong", "right", "tag", "further", "followup") sont rédigés dans la langue cible : ${LANG_NAME[language] || language}. "strengths" et "tag" restent brefs et concrets. Cite le fragment fautif tel quel, propose la version la plus naturelle, pas la plus scolaire.`,
    `Adapte l'exigence au niveau ${level} : à A1-A2, ne relève que ce qui gêne la compréhension ; à B1-B2, les erreurs récurrentes et les calques ; à C1-C2, les nuances, le registre et les tournures figées.`,
    'Si rien n\'est à corriger, renvoie un tableau "corrections" vide et dis-le dans "strengths". Réponds uniquement avec le JSON demandé.'
  ].join('\n');
}

async function feedback(body) {
  const { transcript, language, level, topic, spokenSec, coach, turn } = body;
  if (!transcript || typeof transcript !== 'string' || transcript.length > 12000) throw Object.assign(new Error('transcript manquant ou trop long'), { status: 400 });
  if (!API_KEY) throw Object.assign(new Error('GEMINI_API_KEY absente : ajoute-la dans le .env à la racine du workspace puis relance `npm start`'), { status: 503 });

  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt({ language, level, coach: coach || { name: 'Léa', role: 'examinatrice patiente' } }) }] },
    contents: [{ role: 'user', parts: [{ text: `Sujet posé (tour ${turn || 1}) : « ${topic} »\nTemps de parole réel : ${spokenSec || 0} s\n\nTranscription :\n${transcript}` }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: FEEDBACK_SCHEMA, temperature: 0.4 }
  });

  let lastErr = null;
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const out = await callGemini(model, payload);
        out.model = model;
        return out;
      } catch (e) {
        lastErr = e;
        console.error(`[feedback] ${model}${attempt ? ' (2e essai)' : ''} : ${e.message}`);
        if (!e.transient || e.timeout) break;
        if (attempt === 0) await sleep(2000);
      }
    }
  }
  throw lastErr;
}

const CALL_TIMEOUT_MS = 25000;

async function callGemini(model, payload) {
  let r;
  try {
    r = await fetch(endpoint(model), { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY }, body: payload, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
  } catch (e) {
    const timeout = e.name === 'TimeoutError' || e.name === 'AbortError';
    throw Object.assign(new Error(timeout ? `pas de réponse en ${CALL_TIMEOUT_MS / 1000} s` : e.message), { status: 502, transient: true, timeout });
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (data.error && data.error.message) || ('HTTP ' + r.status);
    const transient = r.status === 503 || r.status === 429 || r.status === 500 || /high demand|overloaded|no longer available/i.test(msg);
    throw Object.assign(new Error(msg), { status: r.status === 429 ? 429 : r.status === 400 || r.status === 403 ? 401 : 502, transient });
  }
  const cand = data.candidates && data.candidates[0];
  if (!cand || !cand.content) throw Object.assign(new Error('Réponse vide (' + ((cand && cand.finishReason) || (data.promptFeedback && data.promptFeedback.blockReason) || 'inconnu') + ')'), { status: 502, transient: true });
  const text = cand.content.parts.map((p) => p.text || '').join('');
  const out = JSON.parse(text);
  out.corrections = (out.corrections || []).slice(0, 6);
  out.further = (out.further || []).slice(0, 3);
  return out;
}

function send(res, status, data, type) {
  res.writeHead(status, { 'Content-Type': type || 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });
  res.end(typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data));
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (url.pathname === '/api/health') return send(res, 200, { ok: true, ai: !!API_KEY, models: MODELS });
  if (url.pathname === '/api/feedback' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 64000) req.destroy(); });
    req.on('end', async () => {
      try { send(res, 200, await feedback(JSON.parse(raw || '{}'))); }
      catch (e) { send(res, e.status || 500, { error: e.message }); }
    });
    return;
  }
  const rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const file = path.normalize(path.join(SRC, rel));
  if (!file.startsWith(SRC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Not found', 'text/plain');
  send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
}).listen(PORT, () => {
  console.log(`Daily Speaking Trainer → http://localhost:${PORT}`);
  console.log(API_KEY ? `Feedback IA actif (Gemini · ${MODELS.join(' → ')})` : 'Feedback IA inactif : GEMINI_API_KEY absente, l\'app tourne en mode local.');
});
