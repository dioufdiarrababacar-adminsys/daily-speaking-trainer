// Logique de feedback (transcription → corrections du coach via Gemini), partagée entre server.js et la Netlify Function.
const LANG_NAME = { fr: 'français', en: 'anglais', es: 'espagnol' };
const DEFAULT_MODELS = 'gemini-3.5-flash-lite,gemini-3.6-flash,gemini-3.1-flash-lite';

// Schéma de réponse (sous-ensemble OpenAPI accepté par Gemini).
const FEEDBACK_SCHEMA = {
  type: 'OBJECT',
  properties: {
    strengths: { type: 'STRING', description: 'Deux phrases max sur ce qui a bien marché (structure, temps verbaux, vocabulaire).' },
    corrections: {
      type: 'ARRAY',
      description: 'Au plus 6 corrections, les plus utiles d\'abord.',
      items: {
        type: 'OBJECT',
        properties: {
          wrong: { type: 'STRING', description: 'Le fragment exact tel que dit par l\'apprenant.' },
          right: { type: 'STRING', description: 'La version corrigée, naturelle.' },
          tag: { type: 'STRING', description: 'Catégorie courte : auxiliaire, accord du participe, genre des noms, préposition, lexique, calque, subjonctif, répétition, ordre des mots…' }
        },
        required: ['wrong', 'right', 'tag']
      }
    },
    further: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Deux ou trois tournures idiomatiques du niveau visé que l\'apprenant aurait pu utiliser.' },
    followup: { type: 'STRING', description: 'Une question de relance qui reprend un détail précis de ce que l\'apprenant a dit.' }
  },
  required: ['strengths', 'corrections', 'further', 'followup']
};

function systemPrompt({ language, level, coach }) {
  const L = LANG_NAME[language] || language;
  return [
    `Tu es ${coach.name}, ${coach.role}, coach de conversation en ${L}. Tu viens d'écouter un apprenant de niveau ${level} parler pendant une à cinq minutes.`,
    'Tu reçois une transcription automatique : ignore les erreurs évidentes de reconnaissance vocale (mots absurdes, ponctuation absente) et concentre-toi sur la grammaire, le lexique et la structure du propos. Tu ne juges pas la prononciation.',
    `Tous les champs de ta réponse ("strengths", "wrong", "right", "tag", "further", "followup") sont rédigés dans la langue cible : ${L}. "strengths" et "tag" restent brefs et concrets. Cite le fragment fautif tel quel, propose la version la plus naturelle, pas la plus scolaire.`,
    `Adapte l'exigence au niveau ${level} : à A1-A2, ne relève que ce qui gêne la compréhension ; à B1-B2, les erreurs récurrentes et les calques ; à C1-C2, les nuances, le registre et les tournures figées.`,
    'Si rien n\'est à corriger, renvoie un tableau "corrections" vide et dis-le dans "strengths". Réponds uniquement avec le JSON demandé.'
  ].join('\n');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createFeedback(opts) {
  const apiKey = opts.apiKey || '';
  const models = (opts.models || DEFAULT_MODELS).split(',').map((s) => s.trim()).filter(Boolean);
  const callTimeoutMs = opts.callTimeoutMs || 25000;
  const budgetMs = opts.budgetMs || Infinity;
  const log = opts.log || (() => {});

  async function callGemini(model, payload, timeoutMs) {
    let r;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: payload, signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (e) {
      const timeout = e.name === 'TimeoutError' || e.name === 'AbortError';
      throw Object.assign(new Error(timeout ? `pas de réponse en ${Math.round(timeoutMs / 1000)} s` : e.message), { status: 502, transient: true, timeout });
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (data.error && data.error.message) || ('HTTP ' + r.status);
      const transient = r.status === 503 || r.status === 429 || r.status === 500 || /high demand|overloaded|no longer available/i.test(msg);
      throw Object.assign(new Error(msg), { status: r.status === 429 ? 429 : r.status === 400 || r.status === 403 ? 401 : 502, transient });
    }
    const cand = data.candidates && data.candidates[0];
    if (!cand || !cand.content) throw Object.assign(new Error('Réponse vide (' + ((cand && cand.finishReason) || (data.promptFeedback && data.promptFeedback.blockReason) || 'inconnu') + ')'), { status: 502, transient: true });
    const out = JSON.parse(cand.content.parts.map((p) => p.text || '').join(''));
    out.corrections = (out.corrections || []).slice(0, 6);
    out.further = (out.further || []).slice(0, 3);
    return out;
  }

  return {
    models,
    enabled: !!apiKey,
    async feedback(body) {
      const { transcript, language, level, topic, spokenSec, coach, turn } = body || {};
      if (!transcript || typeof transcript !== 'string' || transcript.length > 12000) throw Object.assign(new Error('transcript manquant ou trop long'), { status: 400 });
      if (!apiKey) throw Object.assign(new Error('GEMINI_API_KEY absente'), { status: 503 });

      const payload = JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt({ language, level, coach: coach || { name: 'Léa', role: 'examinatrice patiente' } }) }] },
        contents: [{ role: 'user', parts: [{ text: `Sujet posé (tour ${turn || 1}) : « ${topic} »\nTemps de parole réel : ${spokenSec || 0} s\n\nTranscription :\n${transcript}` }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: FEEDBACK_SCHEMA, temperature: 0.4 }
      });

      const t0 = Date.now();
      let lastErr = null;
      for (const model of models) {
        for (let attempt = 0; attempt < 2; attempt++) {
          const left = budgetMs - (Date.now() - t0);
          if (left < 1500) break;
          try {
            const out = await callGemini(model, payload, Math.min(callTimeoutMs, left));
            out.model = model;
            return out;
          } catch (e) {
            lastErr = e;
            log(`[feedback] ${model}${attempt ? ' (2e essai)' : ''} : ${e.message}`);
            if (!e.transient || e.timeout) break;
            if (attempt === 0) await sleep(Math.min(2000, Math.max(0, budgetMs - (Date.now() - t0) - 1500)));
          }
        }
      }
      throw lastErr || Object.assign(new Error('délai dépassé'), { status: 504 });
    }
  };
}
