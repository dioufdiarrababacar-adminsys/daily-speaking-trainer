// Netlify Function : remplace server.js en production pour /api/health et /api/feedback.
import { createFeedback } from '../../lib/feedback.js';

// Les fonctions synchrones Netlify ont un plafond de 10 s : chaque appel Gemini est borné à 8 s et l'enchaînement à 9 s.
const ai = createFeedback({
  apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
  models: process.env.DST_MODEL,
  callTimeoutMs: 8000,
  budgetMs: 9000,
  log: (m) => console.error(m)
});

const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

export default async (req) => {
  const { pathname } = new URL(req.url);
  if (pathname === '/api/health') return json(200, { ok: true, ai: ai.enabled, models: ai.models });
  if (pathname === '/api/feedback') {
    if (req.method !== 'POST') return json(405, { error: 'POST attendu' });
    try {
      const body = await req.json().catch(() => ({}));
      return json(200, await ai.feedback(body));
    } catch (e) {
      return json(e.status || 500, { error: e.message });
    }
  }
  return json(404, { error: 'Not found' });
};

export const config = { path: ['/api/health', '/api/feedback'] };
