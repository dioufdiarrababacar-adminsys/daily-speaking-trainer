(function () {
  'use strict';
  const D = window.DST_DATA;
  const AV = window.Avatar;
  const I18N = window.DST_I18N;
  const $app = document.getElementById('app');
  const API_URL = (location.protocol === 'file:' ? 'http://localhost:3000' : '') + '/api/feedback';
  const MAX_TURNS = 3;

  // ============================================================ Stockage
  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };
  const settings = Object.assign({
    coach: 'lea', lang: 'fr', level: 'B2', duration: 2, interests: ['Voyage', 'Cuisine'], objective: 'free',
    theme: 'light', sendAudio: true, localMode: false, saveRecordings: true, topicHistory: [], reminder: null
  }, store.get('dst.settings', {}));
  let sessions = store.get('dst.sessions', []);
  let notebook = store.get('dst.notebook', []);
  const saveSettings = () => store.set('dst.settings', settings);
  // Le thème par défaut est passé de « système » à « clair » : on migre une fois les réglages déjà enregistrés.
  if (!settings.v2) { if (settings.theme === 'system') settings.theme = 'light'; settings.v2 = 1; saveSettings(); }

  // ============================================================ État
  const S = {
    screen: 'home', overlay: null, call: null, quiz: null, notebookFilter: 'all', aiAvailable: null, addingInterest: false, toast: null,
    recUsage: undefined, confirmingClear: false, confirmClearTimer: null, confirmDeleteSession: null, confirmDeleteTimer: null,
    // Lecture de l'historique audio (écran Progression) : au plus un <audio> détaché à la fois, jamais inséré dans le DOM
    // (donc jamais coupé par un re-render qui remplace $app.innerHTML), un `token` invalide les résolutions obsolètes
    // si l'utilisateur enchaîne les clics avant qu'un blob ait fini de se charger.
    playback: { token: 0, sessionId: null, idx: 0, audio: null, url: null }
  };

  // ============================================================ Utilitaires
  const T = () => I18N[settings.lang] || I18N.fr;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (sec) => Math.floor(sec / 60) + ':' + pad(Math.floor(sec % 60));
  const fmtLong = (sec) => { const m = Math.floor(sec / 60), s = Math.floor(sec % 60); return m ? m + ' min' + (s ? ' ' + pad(s) : '') : s + ' s'; };
  // Unités KB/MB volontairement non traduites : usage technique compris dans les 3 langues de l'app.
  const fmtBytes = (n) => n < 1024 ? n + ' B' : n < 1024 * 1024 ? Math.round(n / 1024) + ' KB' : (n / (1024 * 1024)).toFixed(1) + ' MB';
  const coach = () => AV.PEOPLE[settings.coach] || AV.PEOPLE.lea;
  const coachRole = (k) => (T().coach[k] || ['', ''])[0];
  const coachVoice = (k) => (T().coach[k] || ['', ''])[1];
  const lang = () => D.LANGS[settings.lang];
  const langName = (l) => T().langNames[l];
  const bucket = (lvl) => lvl[0] === 'A' ? 'A' : lvl[0] === 'B' ? 'B' : 'C';
  const isDesktop = () => matchMedia('(min-width: 1024px)').matches;
  const isDark = () => settings.theme === 'dark' || (settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  const dayKey = (d) => { d = new Date(d); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const today = () => dayKey(new Date());
  const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const avatar = (who, expr, cls, style) => '<div class="avatar-box ' + (cls || '') + '"' + (style ? ' style="' + style + '"' : '') + '>' + AV.render(who, expr) + '</div>';
  const ringSvg = (pct, cls) => {
    const off = Math.max(0, 276 * (1 - Math.min(1, pct)));
    return '<div class="ring ' + (cls || '') + '"><svg viewBox="0 0 100 100" width="100%" height="100%"><circle class="track" cx="50" cy="50" r="44" fill="none" stroke-width="10"/><circle class="fill" cx="50" cy="50" r="44" fill="none" stroke-width="10" stroke-linecap="round" stroke-dasharray="276" stroke-dashoffset="' + off + '" transform="rotate(-90 50 50)"/></svg><div class="time"></div></div>';
  };

  function applyTheme() {
    const root = document.documentElement;
    root.lang = settings.lang;
    if (settings.theme === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', settings.theme);
    const c = coach(), dark = isDark();
    root.style.setProperty('--accent', dark ? c.accentDark : c.accent);
    // En sombre, le pastel du coach devient une teinte sombre dérivée de son accent : plus de fond clair sous du texte clair.
    root.style.setProperty('--coach-bg', dark ? 'color-mix(in oklab, ' + c.accentDark + ' 18%, #15112B)' : c.bg);
    document.querySelector('meta[name=theme-color]').content = dark ? '#15112B' : '#FFF7EE';
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyTheme(); });

  function toast(msg, ms) {
    S.toast = msg; renderToast();
    clearTimeout(toast.t); toast.t = setTimeout(() => { S.toast = null; renderToast(); }, ms || 2200);
  }
  function renderToast() {
    let el = document.getElementById('toast');
    if (!S.toast) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = S.toast;
  }

  // ============================================================ Sujets
  function pickTopic() {
    const b = bucket(settings.level);
    let pool = D.TOPICS.map((t, i) => Object.assign({ id: t.lang + '-' + i }, t)).filter((t) => t.lang === settings.lang && t.bucket === b);
    const fresh = pool.filter((t) => !settings.topicHistory.includes(t.id));
    if (fresh.length) pool = fresh;
    const liked = pool.filter((t) => t.tags.some((tag) => settings.interests.includes(tag)));
    const t = rnd(liked.length ? liked : pool);
    settings.topicHistory = [t.id].concat(settings.topicHistory).slice(0, 30);
    saveSettings();
    return t;
  }

  // ============================================================ Statistiques
  function dayMinutes() {
    const m = {};
    sessions.forEach((s) => { const k = dayKey(s.date); m[k] = (m[k] || 0) + s.spokenSec / 60; });
    return m;
  }
  function streaks() {
    const days = Object.keys(dayMinutes()).sort();
    if (!days.length) return { current: 0, record: 0 };
    let record = 1, run = 1;
    for (let i = 1; i < days.length; i++) {
      const diff = (new Date(days[i]) - new Date(days[i - 1])) / 864e5;
      run = diff === 1 ? run + 1 : 1; record = Math.max(record, run);
    }
    const gap = (new Date(today()) - new Date(days[days.length - 1])) / 864e5;
    return { current: gap <= 1 ? run : 0, record };
  }
  function weekMinutes() {
    const since = Date.now() - 7 * 864e5;
    return Math.round(sessions.filter((s) => new Date(s.date) > since).reduce((a, s) => a + s.spokenSec, 0) / 60);
  }
  function errorTags() {
    const c = {};
    sessions.forEach((s) => (s.corrections || []).forEach((x) => { if (x.tag) c[x.tag] = (c[x.tag] || 0) + 1; }));
    return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }
  function langShare() {
    const t = {}; let total = 0;
    sessions.forEach((s) => { t[s.lang] = (t[s.lang] || 0) + s.spokenSec; total += s.spokenSec; });
    return ['fr', 'en', 'es'].map((l) => ({ l, pct: total ? Math.round(100 * (t[l] || 0) / total) : 0 }));
  }
  const relDay = (iso) => {
    const d = new Date(iso), diff = Math.round((new Date(today()) - new Date(dayKey(d))) / 864e5);
    if (diff === 0) return T().today; if (diff === 1) return T().yesterday;
    if (diff < 7) return d.toLocaleDateString(lang().bcp, { weekday: 'long' });
    return d.toLocaleDateString(lang().bcp, { day: 'numeric', month: 'short' });
  };

  // ============================================================ Moteur audio
  const audio = {
    stream: null, ctx: null, analyser: null, buf: null, rec: null, chunks: [], sr: null, srActive: false,
    async open() {
      if (this.stream) return true;
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 512; this.analyser.smoothingTimeConstant = 0.6;
      src.connect(this.analyser);
      this.buf = new Uint8Array(this.analyser.frequencyBinCount);
      return true;
    },
    level() {
      if (!this.analyser) return 0;
      this.analyser.getByteTimeDomainData(this.buf);
      let sum = 0;
      for (let i = 0; i < this.buf.length; i++) { const v = (this.buf[i] - 128) / 128; sum += v * v; }
      return Math.sqrt(sum / this.buf.length);
    },
    bands(n) {
      if (!this.analyser) return new Array(n).fill(0);
      const f = new Uint8Array(this.analyser.frequencyBinCount); this.analyser.getByteFrequencyData(f);
      const out = []; const span = Math.floor(f.length / 3 / n);
      for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < span; j++) s += f[i * span + j]; out.push(s / span / 255); }
      return out;
    },
    startRecording() {
      this.chunks = [];
      try { this.rec = new MediaRecorder(this.stream); } catch { this.rec = null; return; }
      this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
      this.rec.start(500);
    },
    stopRecording() {
      return new Promise((res) => {
        if (!this.rec || this.rec.state === 'inactive') return res(null);
        this.rec.onstop = () => res(new Blob(this.chunks, { type: this.rec.mimeType || 'audio/webm' }));
        this.rec.stop();
      });
    },
    startSR(bcp, onText) {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) return false;
      const sr = new SR(); sr.lang = bcp; sr.continuous = true; sr.interimResults = true; sr.maxAlternatives = 1;
      let finals = '';
      sr.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finals += r[0].transcript + ' '; else interim += r[0].transcript;
        }
        onText(finals, interim);
      };
      sr.onend = () => { if (this.srActive) { try { sr.start(); } catch {} } };
      sr.onerror = (e) => { if (e.error === 'not-allowed') this.srActive = false; };
      this.sr = sr; this.srActive = true;
      try { sr.start(); } catch {}
      return true;
    },
    stopSR() { this.srActive = false; if (this.sr) { try { this.sr.stop(); } catch {} this.sr = null; } },
    close() {
      this.stopSR();
      if (this.rec && this.rec.state !== 'inactive') { try { this.rec.stop(); } catch {} }
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      if (this.ctx) { try { this.ctx.close(); } catch {} }
      this.stream = this.ctx = this.analyser = this.rec = null;
    }
  };

  // ============================================================ Voix du coach
  // Choix d'une voix par coach : langue cible, genre du coach, voix « naturelles » en priorité, et une voix différente par coach quand c'est possible.
  const FEMALE = /female|femme|mujer|hortense|julie|denise|eloise|vivienne|coralie|zira|aria|jenny|michelle|ana|sonia|libby|emma|ava|helena|laura|elvira|abril|samantha|amelie|audrey|aurelie|monica|paulina|karen|moira|fiona|tessa|victoria|allison|susan|zoe|alba|lucia|triana|vera|ximena|dalia|marina|salome|charline|jacqueline|josephine|yvette|brigitte|celeste|elise|sara|maria|natasha|olivia|sonia/i;
  const MALE = /(^|[^e])male|homme|hombre|paul|henri|claude|maurice|david|mark|guy|christopher|eric|roger|steffan|ryan|thomas|nicolas|pablo|alvaro|jorge|diego|enrique|alex|fred|arthur|aaron|andrew|brian|jerry|lorenzo|mateo|sergio|tomas|dario|elias|gerardo|liberto|luciano|remy|jerome|yves|antoine|fabrice|gerard|daniel|rishi|oliver|ollie|tony|brandon/i;
  const tts = {
    u: null, mouthTimer: null, voices: [],
    load() { if ('speechSynthesis' in window) { this.voices = speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => { this.voices = speechSynthesis.getVoices(); }; } },
    voiceFor(bcp, who) {
      if (!this.voices.length && 'speechSynthesis' in window) this.voices = speechSynthesis.getVoices();
      const pre = bcp.slice(0, 2), c = AV.PEOPLE[who];
      const pool = this.voices.filter((v) => v.lang.replace('_', '-').slice(0, 2).toLowerCase() === pre);
      if (!pool.length) return null;
      const score = (v) => {
        let s = 0;
        const n = v.name;
        if (/natural|neural|online|premium|enhanced|google|siri/i.test(n)) s += 6;
        if (!v.localService) s += 2;
        if (v.lang.replace('_', '-') === bcp) s += 1;
        const f = FEMALE.test(n), m = MALE.test(n);
        if (c.gender === 'f' ? f && !m : m && !f) s += 4;
        else if (c.gender === 'f' ? m : f) s -= 4;
        return s;
      };
      const ranked = pool.slice().sort((a, b) => score(b) - score(a));
      const best = score(ranked[0]);
      const top = ranked.filter((v) => score(v) >= best - 1);
      // Deux coachs du même genre prennent des voix différentes quand plusieurs bonnes voix existent.
      const idx = Object.keys(AV.PEOPLE).filter((k) => AV.PEOPLE[k].gender === c.gender).indexOf(who);
      return top[idx % top.length] || ranked[0];
    },
    speak(text, opts) {
      opts = opts || {};
      this.stop();
      const c = coach(), L = lang();
      const stage = document.querySelector('.stage .avatar');
      const words = text.split(/\s+/).length;
      const estMs = Math.max(1200, words * 380 / c.rate);
      let revealed = 0, done = false;
      const reveal = (n) => { revealed = Math.max(revealed, n); if (opts.onReveal) opts.onReveal(Math.min(revealed, text.length)); };
      const finish = () => {
        if (done) return; done = true;
        clearInterval(this.mouthTimer); clearInterval(revealTimer);
        reveal(text.length);
        if (stage) AV.setExpression(stage, settings.coach, opts.after || 'neutral');
        if (opts.onEnd) opts.onEnd();
      };
      const t0 = Date.now();
      const revealTimer = setInterval(() => {
        const p = Math.min(1, (Date.now() - t0) / estMs);
        reveal(Math.floor(p * text.length));
        if (p >= 1 && !(this.u && 'speechSynthesis' in window && speechSynthesis.speaking)) finish();
      }, 60);
      if (stage) AV.setExpression(stage, settings.coach, 'speak');
      const visemes = ['open', 'small', 'ee', 'o', 'wide', 'small'];
      let vi = 0;
      this.mouthTimer = setInterval(() => { if (stage) AV.setMouth(stage, visemes[vi++ % visemes.length]); }, 110);
      if ('speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = L.bcp; const v = this.voiceFor(L.bcp, settings.coach); if (v) u.voice = v;
        u.pitch = c.pitch; u.rate = c.rate;
        u.onboundary = (e) => { if (e.charIndex != null) reveal(e.charIndex + (e.charLength || 0)); };
        u.onend = finish; u.onerror = finish;
        this.u = u;
        speechSynthesis.speak(u);
      }
    },
    stop() {
      clearInterval(this.mouthTimer);
      if ('speechSynthesis' in window) speechSynthesis.cancel();
      this.u = null;
    }
  };
  tts.load();

  (function blinkLoop() {
    setTimeout(() => {
      document.querySelectorAll('.avatar').forEach((a) => { a.classList.add('blink'); setTimeout(() => a.classList.remove('blink'), 120); });
      blinkLoop();
    }, 2600 + Math.random() * 2600);
  })();

  // ============================================================ Appel
  function newCall() {
    return {
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      topic: pickTopic(), turn: 1, phase: 'connecting', targetSec: settings.duration * 60,
      elapsed: 0, spokenSec: 0, started: false, transcript: '', interim: '', prompt: '',
      turns: [], corrections: [], feedback: null, feedbackError: null, loadingFeedback: false,
      wallStart: Date.now(), audioUrl: null, timer: null, raf: null, reactTimer: null, saved: false
    };
  }

  async function startCall() {
    S.call = newCall(); S.overlay = null;
    S.call.prompt = S.call.topic.text;
    go('connecting');
    setTimeout(() => { if (S.call && S.call.phase === 'connecting') showTopic(); }, 1400 + Math.random() * 600);
    if (S.aiAvailable === null && !settings.localMode) pingServer();
  }

  function showTopic() {
    const c = S.call; c.phase = 'topic'; c.revealed = 0;
    go('topic');
    tts.speak(c.prompt, {
      onReveal: (n) => { c.revealed = n; const p = document.getElementById('topic-text'); if (p) p.innerHTML = promptHtml(c.prompt, n); },
      after: 'neutral'
    });
  }
  const promptHtml = (text, n) => esc(text.slice(0, n)) + '<span class="dim">' + esc(text.slice(n)) + '</span>';

  async function startSpeaking() {
    const c = S.call;
    tts.stop();
    try { await audio.open(); }
    catch (e) { c.micError = e && e.name; go('micDenied'); return; }
    c.phase = 'speaking'; c.elapsed = 0; c.spokenSec = 0; c.started = false; c.transcript = ''; c.interim = '';
    audio.startRecording();
    c.srSupported = audio.startSR(lang().bcp, (finals, interim) => {
      c.transcript = finals; c.interim = interim;
      if (!c.started && (finals + interim).trim()) beginTimer();
    });
    go('speaking');
    let last = performance.now();
    const loop = (now) => {
      if (!S.call || c.phase !== 'speaking') return;
      const dt = (now - last) / 1000; last = now;
      const talking = audio.level() > 0.022;
      if (talking && !c.started) beginTimer();
      if (talking && c.started) c.spokenSec += dt;
      drawWave(talking ? audio.bands(11) : null);
      c.raf = requestAnimationFrame(loop);
    };
    c.raf = requestAnimationFrame(loop);
    scheduleReaction();
  }

  function beginTimer() {
    const c = S.call; if (c.started) return;
    c.started = true; c.timerStart = Date.now();
    const st = document.querySelector('.status'); if (st) st.innerHTML = '<i class="rec"></i>' + esc(T().youSpeak);
    c.timer = setInterval(() => {
      c.elapsed = (Date.now() - c.timerStart) / 1000;
      updateClock();
      if (c.elapsed >= c.targetSec) timeUp();
    }, 250);
  }

  function updateClock() {
    const c = S.call; if (!c) return;
    const t = fmt(Math.min(c.elapsed, c.targetSec));
    document.querySelectorAll('.ring .time').forEach((el) => el.textContent = t);
    document.querySelectorAll('.ring .fill').forEach((el) => el.setAttribute('stroke-dashoffset', Math.max(0, 276 * (1 - c.elapsed / c.targetSec))));
    document.querySelectorAll('.chrono').forEach((el) => el.textContent = t);
  }

  function drawWave(bands) {
    const w = document.querySelector('.wave'); if (!w) return;
    w.classList.toggle('idle', !bands);
    if (!bands) return;
    const bars = w.children;
    for (let i = 0; i < bars.length; i++) bars[i].style.transform = 'scaleY(' + Math.max(0.12, Math.min(1, bands[i] * 1.6 + 0.1)) + ')';
  }

  function scheduleReaction() {
    const c = S.call;
    clearTimeout(c.reactTimer);
    c.reactTimer = setTimeout(() => {
      if (!S.call || c.phase !== 'speaking') return;
      if (c.started) {
        const [expr, txt] = rnd(T().reactions);
        const stage = document.querySelector('.stage .avatar');
        const r = document.getElementById('reaction');
        if (stage) AV.setExpression(stage, settings.coach, expr);
        if (r) r.textContent = txt;
        setTimeout(() => { if (stage && S.call && c.phase === 'speaking') AV.setExpression(stage, settings.coach, 'listen'); if (r) r.textContent = T().listening; }, 2200);
      }
      scheduleReaction();
    }, 9000 + Math.random() * 9000);
  }

  async function endTurn() {
    const c = S.call;
    clearInterval(c.timer); cancelAnimationFrame(c.raf); clearTimeout(c.reactTimer);
    audio.stopSR();
    const blob = await audio.stopRecording();
    if (blob && blob.size) { if (c.audioUrl) URL.revokeObjectURL(c.audioUrl); c.audioUrl = URL.createObjectURL(blob); c.audioSec = c.elapsed; }
    // Sauvegarde durable (IndexedDB) du tour, sans attendre : l'écriture se termine en tâche de fond
    // pendant que l'utilisateur voit le feedback ; finishCall() attend cette promesse avant de clore l'appel.
    const recordingIdPromise = (settings.saveRecordings && blob && blob.size)
      ? DST_REC.save({ sessionId: c.id, turn: c.turn, blob, mimeType: blob.type, durationSec: c.elapsed })
      : Promise.resolve(null);
    recordingIdPromise.then((id) => console.info('[dst] tour ' + c.turn + ' : ' + (id ? 'enregistré (' + id + ', ' + (blob ? blob.size : 0) + ' o)' : blob && blob.size ? 'ÉCHEC de sauvegarde' : 'pas de blob ou saveRecordings désactivé')));
    const text = (c.transcript + ' ' + c.interim).trim();
    const words = text ? text.split(/\s+/).length : 0;
    const fillers = text ? (text.match(lang().fillers) || []).length : 0;
    const minutes = Math.max(c.spokenSec, 1) / 60;
    c.turns.push({ prompt: c.prompt, transcript: text, elapsed: c.elapsed, spokenSec: c.spokenSec, wpm: words ? Math.round(words / minutes) : 0, fillers, words, recordingIdPromise });
  }

  async function timeUp() {
    const c = S.call; if (c.phase !== 'speaking') return;
    c.phase = 'timeup';
    await endTurn();
    go('timeup');
    setTimeout(() => { if (S.call && c.phase === 'timeup') requestFeedback(); }, 2200);
  }

  async function stopEarly() {
    const c = S.call; if (c.phase !== 'speaking') return;
    c.phase = 'stopping';
    await endTurn();
    if (!c.started || c.elapsed < 5) { c.turns.pop(); showTopic(); toast(T().speakMore); return; }
    requestFeedback();
  }

  async function pingServer() {
    try { const r = await fetch(API_URL.replace('/feedback', '/health'), { cache: 'no-store' }); S.aiAvailable = r.ok; }
    catch { S.aiAvailable = false; }
  }

  async function requestFeedback(retry) {
    const c = S.call; c.phase = 'feedback'; c.feedback = null; c.feedbackError = null;
    const turn = c.turns[c.turns.length - 1];
    const wantAI = !settings.localMode && settings.sendAudio;
    if (!wantAI || !turn.transcript) { c.feedback = localFeedback(turn, wantAI); go('feedback'); return; }
    c.loadingFeedback = true; go('feedback');
    try {
      const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 95000);
      const r = await fetch(API_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
        body: JSON.stringify({ transcript: turn.transcript, language: settings.lang, level: settings.level, topic: turn.prompt, spokenSec: Math.round(turn.spokenSec), coach: { name: coach().name, role: coachRole(settings.coach) }, turn: c.turn })
      });
      clearTimeout(to);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const fb = await r.json();
      fb.corrections = (fb.corrections || []).slice(0, 6).map((x) => Object.assign({ lang: settings.lang }, x));
      fb.metrics = { wpm: turn.wpm, fillers: turn.fillers, spokenSec: turn.spokenSec };
      fb.ai = true;
      c.feedback = fb; c.corrections = c.corrections.concat(fb.corrections);
      S.aiAvailable = true;
    } catch (e) {
      if (!retry) { c.feedbackError = 'retrying'; renderIfScreen('feedback'); await new Promise((r) => setTimeout(r, 2500)); return requestFeedback(true); }
      S.aiAvailable = false;
      c.feedback = localFeedback(turn, true); c.feedback.networkError = true;
    }
    c.loadingFeedback = false;
    go('feedback');
  }

  function localFeedback(turn, wantedAI) {
    return { ai: false, wantedAI, corrections: [], strengths: null, further: null, followup: S.call.topic.followup, metrics: { wpm: turn.wpm, fillers: turn.fillers, spokenSec: turn.spokenSec } };
  }

  function nextTurn() {
    const c = S.call;
    c.turn += 1; c.elapsed = 0;
    c.prompt = (c.feedback && c.feedback.followup) || c.topic.followup;
    showTopic();
  }

  function hangUp() {
    const c = S.call; if (!c) { go('home'); return; }
    tts.stop();
    if (c.phase === 'speaking') { endTurn().then(finishCall); return; }
    finishCall();
  }
  async function finishCall() {
    const c = S.call;
    clearInterval(c.timer); cancelAnimationFrame(c.raf); clearTimeout(c.reactTimer);
    audio.close();
    if (!c.turns.length) { S.call = null; go('home'); return; }
    if (!c.saved) {
      c.saved = true;
      const recIds = await Promise.all(c.turns.map((t) => t.recordingIdPromise || Promise.resolve(null)));
      console.info('[dst] fin d\'appel : ' + recIds.filter(Boolean).length + '/' + c.turns.length + ' tour(s) avec enregistrement', recIds);
      sessions.push({
        id: c.id, date: new Date().toISOString(), coach: settings.coach, lang: settings.lang, level: settings.level,
        wallSec: Math.round((Date.now() - c.wallStart) / 1000), spokenSec: Math.round(c.turns.reduce((a, t) => a + t.spokenSec, 0)),
        turns: c.turns.length, corrections: c.corrections, topic: c.topic.text,
        metrics: { wpm: Math.round(c.turns.reduce((a, t) => a + t.wpm, 0) / c.turns.length), fillers: c.turns.reduce((a, t) => a + t.fillers, 0) },
        recordings: c.turns.map((t, i) => ({ id: recIds[i], turn: i + 1, sec: Math.round(t.spokenSec) })).filter((r) => r.id)
      });
      store.set('dst.sessions', sessions);
    }
    c.phase = 'recap';
    go('recap');
  }

  function saveToNotebook() {
    const c = S.call;
    if (!c.corrections.length) { toast(T().noCorrectionToSave); return; }
    const now = new Date().toISOString();
    c.corrections.forEach((x) => notebook.unshift(Object.assign({ date: now }, x)));
    store.set('dst.notebook', notebook);
    toast(T().addedToNotebook(c.corrections.length));
  }

  // ============================================================ Rendu
  function go(screen) { if (S.screen === 'progress' && screen !== 'progress' && S.playback.sessionId) stopPlayback(); S.screen = screen; render(); }
  function renderIfScreen(s) { if (S.screen === s) render(); }

  function render() {
    applyTheme();
    const R = { home, connecting, topic, speaking, timeup, feedback, followup, recap, micDenied, settings: settingsScreen, progress, notebook: notebookScreen }[S.screen];
    $app.innerHTML = R();
    if (S.screen !== render.last) { window.scrollTo(0, 0); $app.firstElementChild.classList.add('enter'); render.last = S.screen; }
    const c = S.call;
    if (c && (S.screen === 'speaking' || S.screen === 'timeup' || S.screen === 'topic')) updateClock();
    if (S.screen === 'speaking') drawWave(null);
    if (S.screen === 'topic' && c) { const p = document.getElementById('topic-text'); if (p) p.innerHTML = promptHtml(c.prompt, c.revealed || 0); }
  }

  // ---------- Accueil
  function home() {
    const t = T(), st = streaks();
    const reminder = settings.reminder && settings.reminder.date === today() ? settings.reminder : null;
    const coaches = Object.keys(AV.PEOPLE);
    const ordered = [settings.coach].concat(coaches.filter((k) => k !== settings.coach));
    const grid = (isDesktop() ? ordered : ordered.slice(0, 5)).map((k) => {
      const p = AV.PEOPLE[k], sel = k === settings.coach;
      return '<button class="coach' + (sel ? ' selected' : '') + '" data-action="coach" data-coach="' + k + '" aria-pressed="' + sel + '">' +
        avatar(k, sel ? 'encourage' : 'neutral') +
        '<div><div class="name">' + esc(p.name) + '<small>' + esc(coachRole(k)) + '</small></div>' + (sel ? '<div class="voice">' + esc(coachVoice(k)) + ' · ' + lang().label + '</div>' : '') + '</div></button>';
    }).join('');
    return '<div class="screen"><div class="page">' +
      '<div class="topbar"><div class="brand" aria-label="' + t.appNameLong + '"><i></i></div><div style="display:flex;gap:8px;align-items:center">' +
        '<span class="streak">🔥 ' + t.days(st.current) + '</span>' +
        '<button class="icon-btn" data-action="nav" data-to="progress" aria-label="' + t.progress + '" title="' + t.progress + '">📈</button>' +
        '<button class="icon-btn" data-action="nav" data-to="notebook" aria-label="' + t.notebook + '" title="' + t.notebook + '">📓</button>' +
        '<button class="icon-btn" data-action="nav" data-to="settings" aria-label="' + t.settings + '" title="' + t.settings + '">⚙</button></div></div>' +
      (reminder ? '<div class="warn">⏰ <div>' + esc(t.reminderToday(AV.PEOPLE[reminder.coach].name)) + '</div></div>' : '') +
      '<div class="home-layout"><div style="display:flex;flex-direction:column;gap:16px">' +
        '<div><div class="sub">' + t.goal + ' · <b>' + t.goalIn(settings.duration, langName(settings.lang)) + '</b></div>' +
        '<h1 class="title-xl" style="margin-top:8px">' + t.whoToday + '</h1></div>' +
        '<div class="coach-grid">' + grid + (isDesktop() ? '' : '<button class="btn btn-dashed" style="grid-column:span 2" data-action="random-coach">🎲 ' + t.pickCoach + '</button>') + '</div>' +
        (isDesktop() ? '<button class="btn btn-dashed newcoach" data-action="random-coach">🎲 ' + t.pickCoach + '</button>' : '') +
      '</div>' +
      '<div class="home-panel">' +
        (isDesktop() ? '<div style="display:flex;gap:14px;align-items:center">' + avatar(settings.coach, 'neutral', '', 'width:76px;height:76px;border-radius:22px;flex:none') + '<div><div style="font-size:22px;font-weight:800">' + esc(coach().name) + '</div><div class="sub">' + esc(coachVoice(settings.coach)) + ' · ' + lang().label + '</div></div></div>' : '') +
        '<div>' + (isDesktop() ? '<div class="label" style="margin-bottom:8px">' + t.language + '</div>' : '') + '<div class="seg" role="radiogroup" aria-label="' + t.language + '">' + ['fr', 'en', 'es'].map((l) => '<button data-action="lang" data-v="' + l + '" class="' + (settings.lang === l ? 'on' : '') + '" role="radio" aria-checked="' + (settings.lang === l) + '">' + D.LANGS[l].label + '</button>').join('') + '</div></div>' +
        '<div>' + (isDesktop() ? '<div class="label" style="margin-bottom:8px">' + t.level + '</div>' : '') + '<div class="seg tight" role="radiogroup" aria-label="' + t.level + '">' + D.LEVELS.map((l) => '<button data-action="level" data-v="' + l + '" class="' + (settings.level === l ? 'on-sun' : '') + '" role="radio" aria-checked="' + (settings.level === l) + '">' + l + (settings.level === l ? '<small>' + esc(t.levelHint[l]) + '</small>' : '') + '</button>').join('') + '</div></div>' +
        '<div>' + (isDesktop() ? '<div class="label" style="margin-bottom:8px">' + t.duration + '</div>' : '') + '<div class="seg tight mono" role="radiogroup" aria-label="' + t.duration + '">' + D.DURATIONS.map((d) => '<button data-action="duration" data-v="' + d + '" class="' + (settings.duration === d ? 'on-ink' : '') + '" role="radio" aria-checked="' + (settings.duration === d) + '">' + d + ' ' + t.min + '</button>').join('') + '</div></div>' +
        '<div class="sticky-cta"><button class="btn btn-primary btn-block" data-action="start">📞 ' + t.startCall + '</button></div>' +
      '</div></div></div></div>';
  }

  // ---------- Barre d'appel
  function callbar(main, opts) {
    opts = opts || {};
    const t = T(), c = S.call;
    const chrono = c ? fmt(Math.min(c.elapsed, c.targetSec)) : '0:00';
    const cb = (cls, icon, label, action, extra) => '<button class="cb ' + cls + '" data-action="' + action + '"' + (extra || '') + '><b>' + icon + '</b><span>' + label + '</span></button>';
    const dim = opts.dim ? ' dim' : '';
    return '<div class="callbar dark-zone">' +
      cb((S.overlay === 'hints' ? 'on' : '') + dim, '☰', t.hints, 'overlay', ' data-v="hints"' + (opts.dim ? ' disabled' : '')) +
      cb((S.overlay === 'vocab' ? 'on-cyan' : '') + dim, '◫', isDesktop() ? t.vocab : t.vocabShort, 'overlay', ' data-v="vocab"' + (opts.dim ? ' disabled' : '')) +
      '<button class="cb-main ' + main.cls + '" data-action="' + main.action + '"' + (main.disabled ? ' disabled' : '') + '><b>' + main.icon + '</b><span>' + main.label + '</span></button>' +
      '<div class="cb"><b class="mono chrono ' + (opts.chrono || '') + '">' + chrono + '</b><span>' + t.chrono + '</span></div>' +
      cb('hang', '⌁', t.hangup, 'hangup') +
      '</div>';
  }

  function callShell(inner) {
    const panel = isDesktop() && S.overlay ? sidePanel() : '';
    const sheet = !isDesktop() && S.overlay ? sheetHtml() : '';
    return '<div class="screen coach-bg"><div class="call' + (panel ? '' : ' no-panel') + '">' + inner + panel + sheet + '</div></div>';
  }
  const callHead = (status, ringCls, ringPct) => '<div class="call-head">' + status + ringSvg(ringPct, ringCls) + '</div>';

  // ---------- Connexion
  function connecting() {
    const t = T(), c = coach();
    return callShell(
      '<div class="call-head" style="justify-content:center"><div class="label" style="letter-spacing:.14em;color:var(--coach-muted)">' + t.calling + '</div></div>' +
      '<div class="call-body connecting">' +
        '<div class="stage sm" style="border-radius:44px">' + AV.render(settings.coach, 'think') + '</div>' +
        '<div class="who">' + esc(c.name) + '</div><div class="dots"><i></i><i></i><i></i></div>' +
        '<div class="serif">' + esc(t.thinking(c.name)) + '</div>' +
        '<div class="skeleton"><i style="width:70%"></i><i style="width:95%"></i><i style="width:45%"></i></div>' +
      '</div>' + callbar({ cls: 'wait', icon: '●', label: t.waiting, action: 'noop', disabled: true }, { dim: true, chrono: 'wait' }));
  }

  // ---------- Sujet posé
  function topic() {
    const t = T(), c = S.call, p = coach();
    return callShell(
      callHead('<div class="status"><i></i>' + esc(p.name) + ' <small>' + esc(t.speaks) + '</small></div>', 'accent', 0) +
      '<div class="call-body">' +
        '<div class="stage">' + AV.render(settings.coach, 'speak') + '</div>' +
        '<div class="bubble call-bubble"><div style="display:flex;gap:8px;align-items:center"><span class="pill pill-lang">' + lang().label + '</span><span class="pill pill-level">' + settings.level + '</span>' +
          (c.turn > 1 ? '<span class="pill" style="background:var(--ink-06)">' + t.turn(c.turn) + '</span>' : '') +
          '<button class="btn btn-secondary" style="margin-left:auto;min-height:36px;font-size:13px;padding:0 14px" data-action="repeat">↻ ' + t.repeat + '</button></div>' +
          '<p id="topic-text"></p></div>' +
        '<button class="btn btn-primary btn-block" style="max-width:335px" data-action="speak">🎙 ' + (c.turn > 1 ? t.answerTurn(c.turn) : t.takeFloor) + '</button>' +
      '</div>' + callbar({ cls: 'talk', icon: '●', label: t.talk, action: 'speak' }));
  }

  // ---------- L'utilisateur parle
  function speaking() {
    const t = T(), c = S.call, p = coach();
    const status = c.started ? '<div class="status"><i class="rec"></i>' + esc(t.youSpeak) + '</div>' : '<div class="status"><i></i>' + esc(p.name) + ' <small>' + esc(t.listenStart) + '</small></div>';
    return callShell(
      callHead(status, '', c.elapsed / c.targetSec) +
      '<div class="call-body">' +
        '<div class="stage">' + AV.render(settings.coach, 'listen') + '<div id="reaction" class="reaction">' + esc(t.listening) + '</div></div>' +
        '<div class="wave idle" aria-hidden="true">' + '<i></i>'.repeat(11) + '</div>' +
        '<div class="hint-text">' + esc(t.listens(p.name)) + (c.srSupported === false ? '<br><small>' + esc(t.noSR) + '</small>' : '') + '</div>' +
        '<div class="bubble call-bubble wide"><p>' + esc(c.prompt) + '</p></div>' +
      '</div>' + callbar({ cls: 'rec', icon: '', label: t.stop, action: 'stop' }, { chrono: 'rec' }));
  }

  // ---------- Temps écoulé
  function timeup() {
    const t = T(), c = S.call;
    const conf = ['top:18px;left:16px;width:14px;height:14px;background:var(--lime)', 'top:44px;right:26px;width:10px;height:18px;background:var(--sun)', 'bottom:40px;left:30px;width:12px;height:12px;border-radius:50%;background:var(--cyan)', 'bottom:64px;right:18px;width:16px;height:8px;background:var(--coral)']
      .map((s, i) => '<span class="confetti" style="' + s + ';animation-delay:' + (i * 0.15) + 's"></span>').join('');
    return callShell(
      callHead('<div class="status"><i class="done"></i>' + t.heldMinutes(settings.duration) + '</div>', 'done', 1) +
      '<div class="call-body"><div class="stage">' + AV.render(settings.coach, 'encourage') + conf + '</div>' +
        '<div class="fb fb-good call-bubble" style="padding:20px"><div style="font-size:20px;font-weight:800">' + t.timeUpTitle + '</div><p class="serif" style="font-size:20px;line-height:1.45;margin-top:6px">' + esc(t.timeup(fmtLong(c.targetSec))) + '</p></div>' +
      '</div>' + callbar({ cls: 'done', icon: '✓', label: t.done, action: 'noop', disabled: true }, { chrono: 'done' }));
  }

  // ---------- Feedback
  function feedback() {
    const t = T(), c = S.call, p = coach(), fb = c.feedback, turn = c.turns[c.turns.length - 1];
    const spoken = fmtLong(Math.round(turn.spokenSec));
    let cards;
    if (c.loadingFeedback) {
      cards = '<div class="skeleton" style="max-width:none"><i style="width:70%"></i><i style="width:95%"></i><i style="width:45%"></i></div>' +
        (c.feedbackError === 'retrying' ? '<div class="warn">⚠ <div>' + t.networkSlow + '</div></div>' : '');
    } else {
      const corr = fb.corrections.length ? fb.corrections.map((x) => '<div><s>' + esc(x.wrong) + '</s> → <strong>' + esc(x.right) + '</strong></div>').join('')
        : '<div style="color:var(--muted)">' + (fb.ai ? t.nothingToFix : fb.wantedAI ? (fb.networkError ? t.serverDown : t.noTranscript) : t.localMode) + '</div>';
      const wpmPct = Math.min(100, Math.round(fb.metrics.wpm / 170 * 100)), fillPct = Math.min(100, fb.metrics.fillers * 5), spokenPct = Math.round(100 * Math.min(1, turn.spokenSec / Math.max(1, turn.elapsed)));
      cards =
        (fb.strengths ? '<div class="fb fb-good"><h4>✅ ' + t.strengths + '</h4><div class="txt">' + esc(fb.strengths) + '</div></div>' : '') +
        '<div class="fb fb-fix"><h4>✏️ ' + t.corrections + '</h4><div class="txt">' + corr + '</div></div>' +
        (fb.further && fb.further.length ? '<div class="fb fb-more"><h4>💡 ' + t.further + '</h4><div class="txt">' + fb.further.map((s) => '« ' + esc(s) + ' »').join(' · ') + '</div></div>' : '') +
        '<div class="fb fb-stats"><h4 style="margin-bottom:10px">📊 ' + t.measures + '</h4><div class="stats">' +
          '<div class="stat"><div class="n">' + (fb.metrics.wpm || '–') + '</div><div class="l">' + t.wpm + '</div><div class="bar"><i style="width:' + wpmPct + '%"></i></div></div>' +
          '<div class="stat"><div class="n">' + fb.metrics.fillers + '</div><div class="l">' + t.fillers + '</div><div class="bar"><i style="width:' + fillPct + '%"></i></div></div>' +
          '<div class="stat"><div class="n">' + fmt(turn.spokenSec) + '</div><div class="l">' + t.realSpeech + '</div><div class="bar"><i style="width:' + spokenPct + '%"></i></div></div>' +
        '</div></div>' +
        '<div class="fb-note">' + (fb.ai ? t.noteAI : t.noteLocal) + '</div>' +
        (isDesktop() ? '<div class="fb-follow"><p>' + esc(fb.followup || c.topic.followup) + '</p>' + followBtns() + '</div>' : '');
    }
    return callShell(
      '<div class="call-body" style="padding-top:22px">' +
        '<div class="fb-head">' + avatar(settings.coach, c.loadingFeedback ? 'think' : 'speak') + '<div class="say"><p>' + (c.loadingFeedback ? esc(t.reading(p.name)) : esc(t.bravo('{T}')).replace('{T}', '<b>' + esc(spoken) + '</b>')) + '</p></div></div>' +
        '<div class="' + (isDesktop() && !c.loadingFeedback ? 'fb-layout' : 'fb-list') + '">' + cards + '</div>' +
        (!isDesktop() && !c.loadingFeedback ? '<div class="actions"><button class="btn btn-primary btn-block sm" data-action="followup">' + t.seeFollowup + '</button></div>' : '') +
      '</div>' + callbar({ cls: 'resume', icon: '●', label: t.resume, action: 'followup', disabled: c.loadingFeedback }));
  }
  const followBtns = () => (S.call.turn < MAX_TURNS ? '<button class="btn btn-primary" data-action="next-turn">🎙 ' + T().answer + '</button>' : '') + '<button class="btn btn-secondary" data-action="hangup">⌁ ' + T().finish + '</button>';

  // ---------- Relance
  function followup() {
    const t = T(), c = S.call, q = (c.feedback && c.feedback.followup) || c.topic.followup;
    const last = c.turn >= MAX_TURNS;
    return callShell(
      '<div class="call-body" style="padding-top:56px">' +
        '<div class="stage" style="width:min(280px,72vw);border-radius:44px">' + AV.render(settings.coach, 'listen') + '</div>' +
        '<div class="bubble call-bubble wide"><p>' + esc(last ? t.threeTurns : q) + '</p></div>' +
        '<div class="actions">' + (last ? '' : '<button class="btn btn-primary btn-block" style="min-height:58px;font-size:18px" data-action="next-turn">🎙 ' + t.answerTurn(c.turn + 1) + '</button>') +
        '<button class="btn ' + (last ? 'btn-primary' : 'btn-secondary') + ' btn-block sm" data-action="hangup">⌁ ' + t.endCall + '</button></div>' +
      '</div>' + callbar({ cls: last ? 'wait' : 'talk', icon: '●', label: t.talk, action: last ? 'noop' : 'next-turn', disabled: last }));
  }

  // ---------- Fin d'appel
  function recap() {
    const t = T(), c = S.call, s = sessions[sessions.length - 1];
    const bars = [12, 22, 30, 16, 26, 34, 14, 24, 18, 30, 12, 22].map((h, i) => '<i style="height:' + h + 'px" class="' + (i < 4 ? 'on' : '') + '"></i>').join('');
    return '<div class="screen dark-zone"><div class="page recap-wrap" style="align-items:center;min-height:100vh;min-height:100svh">' +
      '<div class="label" style="color:var(--bar-muted);letter-spacing:.14em">' + t.callEnded + '</div>' +
      '<div style="width:180px;height:180px;border-radius:40px;overflow:hidden">' + AV.render(settings.coach, 'encourage') + '</div>' +
      '<div class="serif" style="font-size:22px;text-align:center">' + esc(t.bye) + '</div>' +
      '<div class="recap-stats"><div><div class="n" style="color:#D6F95E">' + fmt(s.wallSec) + '</div><div class="l">' + t.durationL + '</div></div><div><div class="n" style="color:#8F63FF">' + s.turns + '</div><div class="l">' + t.turns(s.turns) + '</div></div><div><div class="n" style="color:#2ED3F0">' + lang().label + '</div><div class="l">' + t.langL + '</div></div><div><div class="n" style="color:#FFC533">' + settings.level + '</div><div class="l">' + t.levelL + '</div></div></div>' +
      '<div class="recap-card"><h4>' + t.toRemember + '</h4><div class="list">' + (c.corrections.length ? c.corrections.slice(0, 4).map((x) => '<div><s>' + esc(x.wrong) + '</s> → <strong>' + esc(x.right) + '</strong></div>').join('') : '<div style="color:#948AC0">' + esc(t.noCorrection(fmtLong(s.spokenSec))) + '</div>') + '</div></div>' +
      (c.audioUrl ? '<div class="recap-card player"><button class="play" data-action="play" aria-label="' + t.replay + '">▶</button><div class="bars">' + bars + '</div><div class="mono" style="font-size:12px;color:var(--bar-muted)">' + fmt(c.audioSec || 0) + '</div><a class="dl" href="' + c.audioUrl + '" download="daily-speaking-' + today() + '.webm" aria-label="' + t.download + '">⤓</a><audio id="player" src="' + c.audioUrl + '"></audio></div>' : '') +
      '<div class="actions" style="max-width:none;margin-top:auto"><button class="btn btn-primary btn-block sm" style="background:var(--violet);color:#FFF;min-height:56px;font-size:17px;font-weight:800" data-action="save-notebook">📓 ' + t.saveNotebook + '</button>' +
      '<button class="btn btn-outline-dark btn-block sm" data-action="remind">⏰ ' + esc(t.remind(coach().name)) + '</button>' +
      '<button class="btn btn-ghost" style="color:var(--bar-muted)" data-action="home">' + t.backHome + '</button></div>' +
      '</div></div>';
  }

  // ---------- Micro refusé
  function micDenied() {
    const t = T(), c = S.call;
    return callShell(
      '<div class="call-body" style="padding-top:60px">' +
        '<div class="stage sm">' + AV.render(settings.coach, 'think') + '</div>' +
        '<div class="bubble call-bubble wide"><p style="font-size:22px">' + t.micBlocked + '</p>' +
          '<div style="font-size:15px;line-height:1.5;color:var(--body)">' + t.micHelp + '</div>' +
          '<div class="actions" style="max-width:none"><button class="btn btn-primary btn-block sm" data-action="mic-help">⚙ ' + t.openSettings + '</button><button class="btn btn-secondary btn-block sm" data-action="speak">↻ ' + t.retry + '</button></div></div>' +
        (c && c.micError === 'NotFoundError' ? '<div class="warn">⚠ <div>' + t.noMic + '</div></div>' : '') +
      '</div>' + callbar({ cls: 'blocked', icon: '⃠', label: t.micBlockedShort, action: 'speak' }, { dim: true, chrono: 'wait' }));
  }

  // ---------- Overlays : pistes ou vocabulaire, jamais les deux
  function hintsHtml() {
    const t = T(), c = S.call;
    return '<div class="sh-head"><div class="t">' + t.nHints(c.topic.hints.length) + '</div><button class="icon-btn" data-action="overlay" data-v="close" aria-label="' + t.close + '">✕</button></div>' +
      c.topic.hints.map((h, i) => '<div class="hint"><b>' + (i + 1) + '</b><div>' + esc(h) + '</div></div>').join('');
  }
  function vocabHtml() {
    const t = T(), c = S.call;
    return '<div class="sh-head"><div class="t">' + t.nWords(c.topic.vocab.length) + '</div><button class="icon-btn" data-action="overlay" data-v="close" aria-label="' + t.close + '">✕</button></div>' +
      c.topic.vocab.map(([w, d]) => '<div class="vocab"><div><div class="w">' + esc(w) + '</div><div class="d">' + esc(d) + '</div></div></div>').join('');
  }
  function sheetHtml() {
    return '<div class="sheet" role="dialog" aria-label="' + (S.overlay === 'hints' ? T().hints : T().vocab) + '"><div class="grab"></div>' + (S.overlay === 'hints' ? hintsHtml() : vocabHtml()) + '</div>';
  }
  function sidePanel() {
    const t = T();
    return '<aside class="side-panel"><div style="display:flex;gap:8px"><button class="chip sm ' + (S.overlay === 'hints' ? 'ink' : '') + '" data-action="overlay" data-v="hints">' + t.hints + '</button><button class="chip sm ' + (S.overlay === 'vocab' ? 'ink' : '') + '" data-action="overlay" data-v="vocab">' + t.vocab + '</button></div>' +
      '<div class="sheet">' + (S.overlay === 'hints' ? hintsHtml() : vocabHtml()) + '</div></aside>';
  }

  // ---------- Personnaliser
  function settingsScreen() {
    const t = T();
    // Chargement paresseux de l'espace utilisé par les enregistrements, une fois par entrée dans l'écran.
    if (S.recUsage === undefined) {
      S.recUsage = null;
      DST_REC.usage().then((u) => { S.recUsage = u; renderIfScreen('settings'); });
    }
    const recUsageText = S.recUsage == null ? '…' : (S.recUsage.available ? t.recStorageUsed(fmtBytes(S.recUsage.bytes), S.recUsage.count) : t.recStorageUnknown);
    const chips = D.INTERESTS.concat(settings.interests.filter((i) => !D.INTERESTS.includes(i))).map((i) => {
      const on = settings.interests.includes(i);
      return '<button class="chip' + (on ? ' on' : '') + '" data-action="interest" data-v="' + esc(i) + '" aria-pressed="' + on + '">' + (on ? '✓ ' : '') + esc(t.interestLabels[i] || i) + '</button>';
    }).join('');
    return '<div class="screen"><div class="page" style="max-width:640px">' +
      '<div class="topbar"><div class="title-lg">' + t.settings + '</div><button class="icon-btn" style="width:44px;height:44px;border-radius:16px" data-action="home" aria-label="' + t.close + '">✕</button></div>' +
      '<div><div class="label" style="margin-bottom:10px">' + t.interests + '</div><div class="chips">' + chips +
        (S.addingInterest ? '<form class="form-row" style="width:100%" data-action="add-interest"><input name="v" placeholder="' + t.newInterest + '" maxlength="24" autofocus><button class="btn btn-primary" type="submit">' + t.add + '</button></form>' : '<button class="chip add" data-action="add-interest-open">' + t.addMore + '</button>') + '</div></div>' +
      '<div><div class="label" style="margin-bottom:10px">' + t.objective + '</div><div class="grid2">' + D.OBJECTIVES.map((o) => '<button class="opt' + (settings.objective === o ? ' on' : '') + '" data-action="objective" data-v="' + o + '"><div class="t">' + esc(t.objectives[o][0]) + '</div><div class="s">' + esc(t.objectives[o][1]) + '</div></button>').join('') + '</div></div>' +
      '<div><div class="label" style="margin-bottom:10px">' + t.theme + '</div><div class="seg">' + [['light', t.light], ['dark', t.dark], ['system', t.system]].map(([v, l]) => '<button data-action="theme" data-v="' + v + '" class="' + (settings.theme === v ? 'on-ink' : '') + '" style="min-height:46px;font-size:15px">' + l + '</button>').join('') + '</div></div>' +
      '<div class="card" style="display:flex;flex-direction:column;gap:12px"><div class="label">' + t.privacy + '</div>' +
        '<button class="toggle-row" data-action="toggle" data-v="sendAudio" aria-pressed="' + settings.sendAudio + '"><span class="toggle' + (settings.sendAudio ? ' on' : '') + '"><i></i></span><div class="txt"><strong>' + t.sendAudio + '</strong><small>' + t.sendAudioSub + '</small></div></button>' +
        '<button class="toggle-row" data-action="toggle" data-v="localMode" aria-pressed="' + settings.localMode + '"><span class="toggle' + (settings.localMode ? ' on' : '') + '"><i></i></span><div class="txt"><strong>' + t.localModeT + '</strong><small>' + t.localModeSub + '</small></div></button>' +
        '<button class="toggle-row" data-action="toggle" data-v="saveRecordings" aria-pressed="' + settings.saveRecordings + '"><span class="toggle' + (settings.saveRecordings ? ' on' : '') + '"><i></i></span><div class="txt"><strong>' + t.saveRecT + '</strong><small>' + t.saveRecSub + '</small></div></button>' +
        '<div class="sub" style="font-size:13px">' + t.server + ' : ' + (S.aiAvailable === true ? '<b style="color:var(--lime-ring)">' + t.connected + '</b>' : S.aiAvailable === false ? '<b style="color:var(--danger)">' + t.unreachable + '</b> (' + t.launch + ' <span class="mono">npm start</span>)' : t.untested) + ' · <button class="btn btn-ghost" style="min-height:0;padding:0;font-size:13px;text-decoration:underline" data-action="ping">' + t.test + '</button></div></div>' +
      '<div class="card" style="display:flex;flex-direction:column;gap:10px"><div class="label">' + t.recStorage + '</div>' +
        '<div class="sub" style="font-size:14px">' + recUsageText + '</div>' +
        '<button class="btn btn-danger-outline" data-action="clear-recordings">' + (S.confirmingClear ? t.confirmClear : t.clearRecordings) + '</button></div>' +
      '</div></div>';
  }

  // ---------- Historique audio (lecture depuis Progression)
  // Un seul <audio> vivant à la fois, jamais dans le DOM (donc jamais coupé par un re-render). `token`
  // ignore les résolutions IndexedDB devenues obsolètes (double-clic pendant un chargement en cours).
  function stopPlayback() {
    S.playback.token++;
    if (S.playback.audio) { try { S.playback.audio.pause(); } catch {} S.playback.audio.onended = null; }
    if (S.playback.url) URL.revokeObjectURL(S.playback.url);
    S.playback.sessionId = null; S.playback.idx = 0; S.playback.audio = null; S.playback.url = null;
  }
  function playHistory(sessionId) {
    if (S.playback.sessionId === sessionId && S.playback.audio) {
      if (S.playback.audio.paused) S.playback.audio.play(); else S.playback.audio.pause();
      render();
      return;
    }
    stopPlayback();
    const s = sessions.find((x) => x.id === sessionId);
    if (!s || !s.recordings || !s.recordings.length) return;
    const myToken = S.playback.token;
    S.playback.sessionId = sessionId; S.playback.idx = 0;
    render();
    playHistoryTurn(s, myToken);
  }
  async function playHistoryTurn(s, myToken) {
    if (myToken !== S.playback.token) return;
    const rec = s.recordings[S.playback.idx];
    if (!rec) { stopPlayback(); render(); return; }
    const blob = await DST_REC.getBlob(rec.id);
    if (myToken !== S.playback.token) return;
    if (!blob) { stopPlayback(); render(); return; }
    const url = URL.createObjectURL(blob);
    const el = new Audio(url);
    S.playback.audio = el; S.playback.url = url;
    el.onended = () => {
      if (myToken !== S.playback.token) return;
      URL.revokeObjectURL(url);
      S.playback.idx += 1;
      if (S.playback.idx < s.recordings.length) playHistoryTurn(s, myToken);
      else { stopPlayback(); render(); }
    };
    el.play();
    render();
  }
  const historyPlaying = (s) => S.playback.sessionId === s.id && S.playback.audio && !S.playback.audio.paused;

  // ---------- Progression
  function progress() {
    const t = T(), st = streaks(), dm = dayMinutes();
    const now = new Date(), y = now.getFullYear(), m = now.getMonth(), days = new Date(y, m + 1, 0).getDate();
    const heat = Array.from({ length: days }, (_, i) => {
      const k = y + '-' + pad(m + 1) + '-' + pad(i + 1), v = dm[k] || 0;
      const cls = v <= 0 ? '' : v < 2 ? 'h1' : v < 4 ? 'h2' : v < 6 ? 'h3' : 'h4';
      return '<i class="' + cls + (k === today() ? ' today' : '') + '" title="' + (i + 1) + ' : ' + Math.round(v) + ' min"></i>';
    }).join('');
    const practiced = Object.keys(dm).filter((k) => k.startsWith(y + '-' + pad(m + 1))).length;
    const share = langShare(), cols = { fr: 'var(--violet)', en: 'var(--cyan)', es: 'var(--sun)' };
    let acc = 0; const conic = share.map((s) => { const a = acc; acc += s.pct; return cols[s.l] + ' ' + a + '% ' + acc + '%'; }).join(',') + (acc < 100 ? ',var(--ink-06) ' + acc + '% 100%' : '');
    const errs = errorTags();
    const last = sessions.slice(-3).reverse();
    const monthName = now.toLocaleDateString(lang().bcp, { month: 'long', year: isDesktop() ? 'numeric' : undefined });
    const calendar = '<div class="card" style="border-radius:24px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div style="font-size:14px;font-weight:700;text-transform:capitalize">' + monthName + '</div><div class="mono" style="font-size:13px;color:var(--muted)">' + t.practiced(practiced) + '</div></div><div class="heat">' + heat + '</div></div>';
    const playBtn = (s) => (s.recordings && s.recordings.length)
      ? '<button class="rec-play' + (historyPlaying(s) ? ' on' : '') + '" data-action="play-history" data-session="' + s.id + '" aria-label="' + t.playCall + '">' + (historyPlaying(s) ? '❚❚' : '▶') + '</button>'
      : '';
    const delBtn = (s) => (s.recordings && s.recordings.length)
      ? '<button class="rec-del' + (S.confirmDeleteSession === s.id ? ' armed' : '') + '" data-action="delete-history" data-session="' + s.id + '" aria-label="' + (S.confirmDeleteSession === s.id ? t.confirmDeleteRecording : t.deleteRecording) + '">🗑</button>'
      : '';
    const calls = '<div style="display:flex;flex-direction:column;gap:8px">' + (last.length ? last.map((s) => '<div class="call-row">' + avatar(s.coach, 'neutral') + '<div class="m"><strong>' + esc(AV.PEOPLE[s.coach].name) + '</strong> · ' + D.LANGS[s.lang].label + ' · ' + s.level + '<small>' + relDay(s.date) + ' · ' + fmtLong(s.spokenSec) + '</small></div>' + playBtn(s) + delBtn(s) + '<div class="p mono" style="font-size:11px">' + (s.metrics.wpm || '–') + '</div></div>').join('') : '<div class="empty">' + t.noCalls + '</div>') + '</div>';
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    const donut = '<div class="card donut" style="border-radius:24px"><div class="ring-c" style="background:conic-gradient(' + conic + ')"><i></i></div><div class="legend">' + share.map((s) => '<div><i style="background:' + cols[s.l] + '"></i>' + esc(cap(langName(s.l))) + ' ' + s.pct + ' %</div>').join('') + '</div></div>';
    const errCard = '<div class="card" style="border-radius:24px"><div style="font-size:14px;font-weight:700;margin-bottom:8px">' + t.frequentErrors + '</div>' + (errs.length ? '<div class="err-list">' + errs.map((e, i) => '<div>' + (i + 1) + '. ' + esc(e[0]) + ' <span>×' + e[1] + '</span></div>').join('') + '</div>' : '<div class="sub">' + t.errorsSoon + '</div>') + (notebook.length ? '<button class="btn btn-primary btn-block sm" style="margin-top:14px" data-action="quiz">🎯 ' + t.testNotebook + '</button>' : '') + '</div>';
    return '<div class="screen"><div class="page">' +
      '<div class="topbar"><div class="brand"><i></i>' + t.progress + '</div><div style="display:flex;gap:8px;align-items:center"><span class="streak">🔥 ' + t.days(st.current) + (isDesktop() ? ' · ' + t.record + ' ' + st.record : '') + '</span><button class="icon-btn" data-action="home" aria-label="' + t.close + '">✕</button></div></div>' +
      (isDesktop()
        ? '<div class="progress-layout"><div style="display:flex;flex-direction:column;gap:18px">' + calendar + '<div class="card" style="border-radius:28px;padding:22px"><div style="font-size:18px;font-weight:800;margin-bottom:14px">' + t.lastCalls + '</div>' + calls + '</div></div>' +
          '<div style="display:flex;flex-direction:column;gap:18px"><div class="grid2"><div class="card" style="border-radius:24px;padding:18px"><div class="mono" style="font-size:28px;font-weight:700">' + weekMinutes() + '</div><div class="sub">' + t.minutesWeek + '</div></div><div class="card" style="border-radius:24px;padding:18px"><div class="mono" style="font-size:28px;font-weight:700">' + sessions.filter((s) => dayKey(s.date).startsWith(y + '-' + pad(m + 1))).length + '</div><div class="sub">' + t.callsMonth + '</div></div></div>' + donut + errCard + '</div></div>'
        : '<div class="stat3"><div><div class="n">' + st.current + '</div><div class="l">' + t.streak + '</div></div><div><div class="n">' + st.record + '</div><div class="l">' + t.record + '</div></div><div><div class="n">' + weekMinutes() + '</div><div class="l">' + t.minWeek + '</div></div></div>' + calendar + donut + errCard + calls) +
      '</div></div>';
  }

  // ---------- Carnet
  function notebookScreen() {
    if (S.quiz) return quizScreen();
    const t = T(), f = S.notebookFilter;
    const items = notebook.filter((n) => f === 'all' || n.lang === f);
    return '<div class="screen"><div class="page" style="max-width:640px">' +
      '<div class="topbar"><div class="title-lg">' + t.notebook + '</div><div style="display:flex;gap:8px;align-items:center"><div class="mono" style="font-size:13px;color:var(--muted)">' + t.nCorrections(notebook.length) + '</div><button class="icon-btn" data-action="home" aria-label="' + t.close + '">✕</button></div></div>' +
      '<div class="chips">' + [['all', t.all], ['fr', 'FR'], ['en', 'EN'], ['es', 'ES']].map(([v, l]) => '<button class="chip sm' + (f === v ? ' ink' : '') + '" data-action="nb-filter" data-v="' + v + '">' + l + '</button>').join('') + '</div>' +
      '<div style="display:flex;flex-direction:column;gap:9px">' + (items.length ? items.map((n) => '<div class="note"><div class="t"><s>' + esc(n.wrong) + '</s><br>→ <strong>' + esc(n.right) + '</strong></div><div class="meta">' + D.LANGS[n.lang].label + (n.tag ? ' · ' + esc(n.tag) : '') + ' · ' + relDay(n.date) + '</div></div>').join('') : '<div class="empty">' + t.emptyNotebook + '</div>') + '</div>' +
      (items.length ? '<div style="margin-top:auto;position:sticky;bottom:0;padding-top:12px;background:linear-gradient(to top,var(--bg) 70%,transparent)"><button class="btn btn-primary btn-block" data-action="quiz">🎯 ' + t.testMe + '</button></div>' : '') +
      '</div></div>';
  }
  function quizScreen() {
    const t = T(), q = S.quiz, n = q.items[q.i];
    return '<div class="screen"><div class="page" style="max-width:520px;justify-content:center;min-height:100vh;min-height:100svh">' +
      '<div class="topbar"><div class="label">' + t.question(q.i + 1, q.items.length) + '</div><button class="icon-btn" data-action="quiz-quit" aria-label="' + t.close + '">✕</button></div>' +
      '<div class="quiz"><div class="sub">' + t.howToFix + '</div><div class="q"><s>' + esc(n.wrong) + '</s></div>' +
        (q.show ? '<div class="a">→ ' + esc(n.right) + '</div>' + (n.tag ? '<div class="mono" style="font-size:12px;color:var(--muted)">' + esc(n.tag) + '</div>' : '') : '') + '</div>' +
      (q.show ? '<button class="btn btn-primary btn-block sm" data-action="quiz-next">' + (q.i + 1 < q.items.length ? t.next : t.finish) + '</button>' : '<button class="btn btn-secondary btn-block sm" data-action="quiz-show">' + t.showFix + '</button>') +
      '</div></div>';
  }

  // ============================================================ Événements
  $app.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]'); if (!b || b.disabled) return;
    const a = b.dataset.action, v = b.dataset.v;
    if (a === 'add-interest') return;
    switch (a) {
      case 'coach': settings.coach = b.dataset.coach; saveSettings(); render(); break;
      case 'random-coach': { const ks = Object.keys(AV.PEOPLE).filter((k) => k !== settings.coach); settings.coach = rnd(ks); saveSettings(); render(); break; }
      case 'lang': settings.lang = v; saveSettings(); render(); break;
      case 'level': settings.level = v; saveSettings(); render(); break;
      case 'duration': settings.duration = +v; saveSettings(); render(); break;
      case 'start': startCall(); break;
      case 'nav': go(b.dataset.to); break;
      case 'home': S.quiz = null; S.overlay = null; if (S.call && S.screen === 'recap') S.call = null; go('home'); break;
      case 'repeat': showTopic(); break;
      case 'speak': if (S.call.phase === 'topic' || S.screen === 'micDenied') startSpeaking(); break;
      case 'stop': stopEarly(); break;
      case 'hangup': hangUp(); break;
      case 'followup': if (!S.call.loadingFeedback) go('followup'); break;
      case 'next-turn': nextTurn(); break;
      case 'overlay': S.overlay = v === 'close' || S.overlay === v ? null : v; render(); break;
      case 'play': { const p = document.getElementById('player'); if (p) { if (p.paused) { p.play(); b.textContent = '❚❚'; p.onended = () => { b.textContent = '▶'; }; } else { p.pause(); b.textContent = '▶'; } } break; }
      case 'play-history': playHistory(b.dataset.session); break;
      case 'delete-history': {
        const sid = b.dataset.session;
        if (S.confirmDeleteSession !== sid) {
          S.confirmDeleteSession = sid; clearTimeout(S.confirmDeleteTimer);
          S.confirmDeleteTimer = setTimeout(() => { S.confirmDeleteSession = null; renderIfScreen('progress'); }, 4000);
          render(); break;
        }
        clearTimeout(S.confirmDeleteTimer); S.confirmDeleteSession = null;
        if (S.playback.sessionId === sid) stopPlayback();
        const s = sessions.find((x) => x.id === sid);
        const ids = s && s.recordings ? s.recordings.map((r) => r.id) : [];
        (ids.length ? DST_REC.deleteMany(ids) : Promise.resolve(true)).then((ok) => {
          if (ok && s) { delete s.recordings; store.set('dst.sessions', sessions); S.recUsage = undefined; toast(T().recordingDeleted); }
          else toast(T().recordingDeleteFailed);
          renderIfScreen('progress');
        });
        render();
        break;
      }
      case 'clear-recordings': {
        if (!S.confirmingClear) { S.confirmingClear = true; clearTimeout(S.confirmClearTimer); S.confirmClearTimer = setTimeout(() => { S.confirmingClear = false; renderIfScreen('settings'); }, 4000); render(); break; }
        clearTimeout(S.confirmClearTimer); S.confirmingClear = false;
        DST_REC.deleteAll().then((ok) => {
          if (ok) {
            sessions.forEach((s) => { delete s.recordings; });
            store.set('dst.sessions', sessions);
            S.recUsage = undefined;
            toast(T().recordingsCleared);
          } else toast(T().recordingsClearFailed);
          renderIfScreen('settings');
        });
        render();
        break;
      }
      case 'save-notebook': saveToNotebook(); break;
      case 'remind': { const d = new Date(); d.setDate(d.getDate() + 1); settings.reminder = { coach: settings.coach, date: dayKey(d) }; saveSettings(); toast(T().willWait(coach().name)); if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); break; }
      case 'mic-help': toast(T().micHelpToast, 4500); break;
      case 'interest': settings.interests = settings.interests.includes(v) ? settings.interests.filter((i) => i !== v) : settings.interests.concat(v); saveSettings(); render(); break;
      case 'add-interest-open': S.addingInterest = true; render(); break;
      case 'objective': settings.objective = v; saveSettings(); render(); break;
      case 'theme': settings.theme = v; saveSettings(); render(); break;
      case 'toggle': settings[v] = !settings[v]; if (v === 'localMode' && settings.localMode) settings.sendAudio = false; if (v === 'sendAudio' && settings.sendAudio) settings.localMode = false; saveSettings(); render(); break;
      case 'ping': S.aiAvailable = null; render(); pingServer().then(() => { renderIfScreen('settings'); toast(S.aiAvailable ? T().serverOk : T().serverKo); }); break;
      case 'nb-filter': S.notebookFilter = v; render(); break;
      case 'quiz': { const items = notebook.filter((n) => S.notebookFilter === 'all' || n.lang === S.notebookFilter).slice().sort(() => Math.random() - 0.5).slice(0, 10); if (!items.length) { toast(T().nothingToReview); break; } S.quiz = { items, i: 0, show: false }; go('notebook'); break; }
      case 'quiz-show': S.quiz.show = true; render(); break;
      case 'quiz-next': if (S.quiz.i + 1 < S.quiz.items.length) { S.quiz.i++; S.quiz.show = false; render(); } else { S.quiz = null; toast(T().quizDone); go('notebook'); } break;
      case 'quiz-quit': S.quiz = null; render(); break;
    }
  });
  $app.addEventListener('submit', (e) => {
    const f = e.target.closest('form[data-action=add-interest]'); if (!f) return;
    e.preventDefault();
    const v = f.elements.v.value.trim();
    if (v && !settings.interests.includes(v)) settings.interests.push(v);
    S.addingInterest = false; saveSettings(); render();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (S.overlay) { S.overlay = null; render(); } else if (S.quiz) { S.quiz = null; render(); } }
  });
  window.addEventListener('resize', () => { clearTimeout(window.__rz); window.__rz = setTimeout(render, 150); });
  window.addEventListener('beforeunload', () => { if (S.call && S.call.phase === 'speaking') audio.close(); });

  applyTheme();
  // L'écran de chargement (#boot, statique dans index.html) reste visible au moins BOOT_MIN_MS,
  // même si l'app est prête avant : performance.now() ici inclut déjà le temps de chargement de la
  // page et des scripts précédents, donc le délai restant est souvent très court, voire nul.
  const BOOT_MIN_MS = 4000;
  setTimeout(render, Math.max(0, BOOT_MIN_MS - performance.now()));
})();
