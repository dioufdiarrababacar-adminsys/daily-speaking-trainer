// Serveur local : sert src/ et expose POST /api/feedback (transcription → corrections du coach via Gemini).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFeedback } from './lib/feedback.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, 'src');
const PORT = Number(process.env.PORT || 3000);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

const ai = createFeedback({
  apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
  models: process.env.DST_MODEL,
  callTimeoutMs: 25000,
  log: (m) => console.error(m)
});

function send(res, status, data, type) {
  res.writeHead(status, { 'Content-Type': type || 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });
  res.end(typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data));
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (url.pathname === '/api/health') return send(res, 200, { ok: true, ai: ai.enabled, models: ai.models });
  if (url.pathname === '/api/feedback' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 64000) req.destroy(); });
    req.on('end', async () => {
      try { send(res, 200, await ai.feedback(JSON.parse(raw || '{}'))); }
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
  console.log(ai.enabled ? `Feedback IA actif (Gemini · ${ai.models.join(' → ')})` : 'Feedback IA inactif : GEMINI_API_KEY absente, l\'app tourne en mode local.');
});
