// InstaSunx Service Worker v4 — polling independiente real
const VAPID_KEY = 'BDM_QhO9JkK2CuDeJCAsWQ3bhg1N1uz-KgtCt1iATny_CR1HSgt3-bMv8fVAkYB5dKx8jZuzi1-swcc_d6dvF8M';

// Estado de sesión (persiste mientras el SW está vivo en background)
let _sess = null;
let _polling = null;

self.addEventListener('install', e => { self.skipWaiting(); });

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
  // Arrancar polling si teníamos sesión guardada
  _restoreAndPoll();
});

self.addEventListener('fetch', () => {});

// ── Mensajes desde la app ────────────────────────────────
self.addEventListener('message', e => {
  const d = e.data;
  if (!d) return;

  if (d.type === 'SYNC_SESSION') {
    const wasPolling = !!_sess;
    _sess = { userId: d.userId, url: d.supabaseUrl, key: d.supabaseKey, last: d.lastCheck };
    _saveSession();
    // Arrancar polling si no estaba corriendo
    if (!wasPolling) _startPolling();
  }

  if (d.type === 'SHOW_NOTIF') {
    _notify(d.title, d.body, d.tag || 'msg');
  }

  if (d.type === 'NUDGE') {
    _notify('📳 Zumbido!', `${d.senderName} te mandó un zumbido`, 'nudge');
  }
});

// ── Push real (cuando esté configurado el Edge Function) ─
self.addEventListener('push', e => {
  if (!e.data) return;
  let p; try { p = e.data.json(); } catch { p = { title: 'InstaSunx', body: e.data.text() }; }
  e.waitUntil(_notify(p.title || 'InstaSunx', p.body || '', p.tag || 'msg'));
});

// ── Click en notificación ─────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      for (const c of cs) if ('focus' in c) return c.focus();
      return self.clients.openWindow('/');
    })
  );
});

// ── Periodic Sync (Chrome Android PWA) ───────────────────
self.addEventListener('periodicsync', e => {
  if (e.tag === 'check-messages') e.waitUntil(_poll());
});

// ── Polling independiente ─────────────────────────────────
function _startPolling() {
  if (_polling) return;
  // Hacer polling cada 15 segundos mientras el SW esté vivo
  _poll(); // inmediato
  _polling = setInterval(_poll, 15000);
}

async function _restoreAndPoll() {
  // Restaurar sesión desde IndexedDB si existe
  try {
    const stored = await _idbGet('session');
    if (stored) { _sess = stored; _startPolling(); }
  } catch(e) {}
}

async function _poll() {
  if (!_sess?.userId) return;
  try {
    const { userId, url, key, last } = _sess;
    const r = await fetch(
      `${url}/rest/v1/messages?to_id=eq.${userId}&created_at=gt.${encodeURIComponent(last)}&select=id,from_id,type,content,reel_title&order=created_at.asc&limit=5`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!r.ok) return;
    const msgs = await r.json();
    if (!msgs.length) return;

    _sess.last = new Date().toISOString();
    _saveSession();

    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const appVisible = clients.some(c => c.visibilityState === 'visible');

    for (const msg of msgs) {
      // Obtener nombre del sender
      const pr = await fetch(
        `${url}/rest/v1/profiles?id=eq.${msg.from_id}&select=name`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      const [prof] = await pr.json().catch(() => [{}]);
      const name = prof?.name || 'Alguien';

      if (msg.type === 'nudge') {
        _notify('📳 Zumbido!', `${name} te mandó un zumbido`, 'nudge');
        clients.forEach(c => c.postMessage({ type: 'NUDGE_RECEIVED', fromId: msg.from_id, senderName: name }));
      } else {
        // Notificar siempre — la app decide si ya está viendo ese chat
        const body = msg.type === 'reel'
          ? `🎬 ${msg.reel_title || 'Te mandó un reel'}`
          : (msg.content || '').slice(0, 80);
        _notify(name, body, 'msg');
        clients.forEach(c => c.postMessage({ type: 'NEW_MESSAGES', fromId: msg.from_id }));
      }
      break; // una por ciclo
    }
  } catch(e) { console.error('[SW poll]', e); }
}

function _notify(title, body, tag) {
  return self.registration.showNotification(title, {
    body, icon: '/icon.svg', badge: '/icon.svg',
    tag, renotify: true, vibrate: [100, 50, 100, 50, 150],
  });
}

// ── IndexedDB helpers para persistir sesión entre reinicios del SW ────────
function _idbOpen() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('instasunx_sw', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('kv');
    req.onsuccess = e => res(e.target.result);
    req.onerror = e => rej(e);
  });
}
async function _idbGet(key) {
  const db = await _idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readonly');
    const req = tx.objectStore('kv').get(key);
    req.onsuccess = e => res(e.target.result);
    req.onerror = rej;
  });
}
async function _idbSet(key, val) {
  const db = await _idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(val, key);
    tx.oncomplete = res; tx.onerror = rej;
  });
}
function _saveSession() {
  if (_sess) _idbSet('session', _sess).catch(() => {});
}