// Stockage local des enregistrements audio (IndexedDB) : un enregistrement par tour de parole,
// gardé indéfiniment (pas de purge automatique) pour que l'utilisateur puisse réécouter sa progression.
// Toute méthode se dégrade en silence (résout une valeur "vide") si IndexedDB est indisponible
// (navigation privée sur certains navigateurs, stockage désactivé) : ne jamais faire planter un appel
// en cours pour un problème de stockage audio.
window.DST_REC = (function () {
  const DB_NAME = 'dst-recordings';
  const DB_VERSION = 1;
  const STORE = 'recordings';
  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      if (!window.indexedDB) return resolve(null);
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { return resolve(null); }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
    return dbPromise;
  }

  async function store(mode) {
    const db = await openDb();
    return db ? db.transaction(STORE, mode).objectStore(STORE) : null;
  }

  const uid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2, 8);

  async function isAvailable() { return !!(await openDb()); }

  // { sessionId, turn, blob, mimeType, durationSec } -> id du nouvel enregistrement, ou null si non sauvegardé.
  async function save({ sessionId, turn, blob, mimeType, durationSec }) {
    const s = await store('readwrite');
    if (!s || !blob) return null;
    const rec = { id: uid(), sessionId, turn, blob, mimeType: mimeType || blob.type, durationSec: Math.round(durationSec || 0), size: blob.size, createdAt: Date.now() };
    return new Promise((resolve) => {
      const req = s.add(rec);
      req.onsuccess = () => resolve(rec.id);
      req.onerror = () => resolve(null);
    });
  }

  async function getBlob(id) {
    const s = await store('readonly');
    if (!s) return null;
    return new Promise((resolve) => {
      const req = s.get(id);
      req.onsuccess = () => resolve(req.result ? req.result.blob : null);
      req.onerror = () => resolve(null);
    });
  }

  async function deleteAll() {
    const s = await store('readwrite');
    if (!s) return false;
    return new Promise((resolve) => {
      const req = s.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
  }

  // Supprime uniquement les ids donnés (ex. tous les tours d'un seul appel), le reste de l'historique reste intact.
  async function deleteMany(ids) {
    const s = await store('readwrite');
    if (!s || !ids || !ids.length) return false;
    return new Promise((resolve) => {
      let done = 0, ok = true;
      ids.forEach((id) => {
        const req = s.delete(id);
        const tick = () => { done++; if (done === ids.length) resolve(ok); };
        req.onsuccess = tick;
        req.onerror = () => { ok = false; tick(); };
      });
    });
  }

  // Somme exacte calculée sur nos propres enregistrements (pas navigator.storage.estimate(),
  // qui couvre tout le stockage de l'origine et est peu fiable selon les navigateurs).
  async function usage() {
    const s = await store('readonly');
    if (!s) return { available: false, bytes: 0, count: 0 };
    return new Promise((resolve) => {
      let bytes = 0, count = 0;
      const req = s.openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve({ available: true, bytes, count });
        bytes += cur.value.size || 0; count += 1;
        cur.continue();
      };
      req.onerror = () => resolve({ available: true, bytes, count });
    });
  }

  return { isAvailable, save, getBlob, deleteAll, deleteMany, usage };
})();
