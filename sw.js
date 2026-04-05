// InstaSunx Service Worker v5
let _sess = null;
let _polling = null;

self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); _restoreAndPoll(); });
self.addEventListener('fetch', () => {});

self.addEventListener('message', e => {
  const d = e.data;
  if (!d) return;
  if (d.type === 'SYNC_SESSION') {
    const first = !_sess;
    _sess = { userId: d.userId, url: d.supabaseUrl, key: d.supabaseKey, last: d.lastCheck };
    _saveSession();
    if (first) _startPolling();
  }
  if (d.type === 'SHOW_NOTIF') {
    // App pidió mostrar notif — siempre mostrar (app está minimizada en este caso)
    _notify(d.title, d.body, d.tag || 'msg');
  }
  if (d.type === 'NUDGE') {
    _notify('📳 Zumbido!', `${d.senderName} te mandó un zumbido`, 'nudge');
  }
});

self.addEventListener('push', e => {
  if (!e.data) return;
  let p; try { p = e.data.json(); } catch { p = { title: 'InstaSunx', body: e.data.text() }; }
  e.waitUntil(_notify(p.title || 'InstaSunx', p.body || '', p.tag || 'msg'));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      for (const c of cs) if ('focus' in c) return c.focus();
      return self.clients.openWindow('/');
    })
  );
});

self.addEventListener('periodicsync', e => {
  if (e.tag === 'check-messages') e.waitUntil(_poll());
});

function _startPolling() {
  if (_polling) return;
  _poll();
  _polling = setInterval(_poll, 12000); // cada 12 segundos
}

async function _restoreAndPoll() {
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
    // App visible = al menos una ventana enfocada
    const appVisible = clients.some(c => c.visibilityState === 'visible');

    for (const msg of msgs) {
      const pr = await fetch(
        `${url}/rest/v1/profiles?id=eq.${msg.from_id}&select=name`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      const [prof] = await pr.json().catch(() => [{}]);
      const name = prof?.name || 'Alguien';

      if (msg.type === 'nudge') {
        // Zumbido: siempre notificar + animar en app
        _notify('📳 Zumbido!', `${name} te mandó un zumbido`, 'nudge');
        clients.forEach(c => c.postMessage({ type: 'NUDGE_RECEIVED', fromId: msg.from_id, senderName: name }));
      } else {
        // Mensaje normal: notificar siempre via OS si app NO está visible
        // Si app está visible, la app misma maneja la in-app notification
        if (!appVisible) {
          const body = msg.type === 'reel' ? `🎬 ${msg.reel_title || 'Te mandó un reel'}`
            : msg.type === 'sticker' ? `${msg.content || '😊'} Sticker`
            : msg.type === 'image' || msg.type === 'image_once' ? '🖼️ Imagen'
            : msg.type === 'audio' ? '🎤 Audio'
            : (msg.content || '').slice(0, 80);
          _notify(name, body, 'msg');
        }
        // Notificar a la app para que recargue (si está abierta)
        clients.forEach(c => c.postMessage({ type: 'NEW_MESSAGES', fromId: msg.from_id }));
      }
      break;
    }
  } catch(e) { console.error('[SW poll]', e); }
}

function _notify(title, body, tag) {
  return self.registration.showNotification(title, {
    body, icon: '/icon.svg', badge: '/icon.svg',
    tag, renotify: true, vibrate: [100, 50, 100, 50, 150],
    silent: false,
  });
}

// IndexedDB para persistir sesión
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
    const r = tx.objectStore('kv').get(key);
    r.onsuccess = e => res(e.target.result);
    r.onerror = rej;
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
