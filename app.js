// ══════════════════════════════════════════════════════════
//  InstaSunx — app.js v3 (CORREGIDO)
//  Fixes: auth sin Supabase Auth, RLS anónimo, queries, reacciones
// ══════════════════════════════════════════════════════════

const CFG = {
  SUPABASE_URL: 'https://aztadayxllkwrivwynoy.supabase.co',
  SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF6dGFkYXl4bGxrd3Jpdnd5bm95Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3MzQxODQsImV4cCI6MjA5MDMxMDE4NH0.7CJ71IFzxbe-eWpSv5KCVmxUx6b6IAMa-6YASPsZI4s',
};

// ── 3 API Keys YouTube — ~30.000 req/día total, rotación automática ──────
const _YT_KEYS_FIXED = [
  'AIzaSyAUCURAPpMFyUHgJY5TuQJ1L_tzvpWe5fI',
  'AIzaSyBI-z-J7pv1LZqNsz1RdeqTtSIQG30B6o0',
  'AIzaSyBol5kWufTpXR_pkRrofgCeXI9mDQi5Qo4',
];
let _ytKeyIdx = 0;
const _ytKeyFailed = [false, false, false];

function getYTKey() {
  for (let i = 0; i < 3; i++) {
    const idx = (_ytKeyIdx + i) % 3;
    if (!_ytKeyFailed[idx]) { _ytKeyIdx = idx; return _YT_KEYS_FIXED[idx]; }
  }
  _ytKeyFailed.fill(false); // todas agotadas → reset y reintentar
  return _YT_KEYS_FIXED[0];
}
function rotateYTKey() {
  _ytKeyFailed[_ytKeyIdx] = true;
  console.warn(`[YT] Key ${_ytKeyIdx} agotada, rotando...`);
  for (let i = 1; i <= 3; i++) {
    const next = (_ytKeyIdx + i) % 3;
    if (!_ytKeyFailed[next]) { _ytKeyIdx = next; return true; }
  }
  return false;
}
(function _scheduleReset() {
  const now = new Date(), next = new Date(now); next.setHours(24,0,5,0);
  setTimeout(() => { _ytKeyFailed.fill(false); _ytKeyIdx=0; _scheduleReset(); console.log('[YT] Cuotas reseteadas'); }, next-now);
})();

// ── ESTADO ────────────────────────────────────────────────
let ME = null;
let currentScreen = 'auth';
let prevScreen = 'main';
let currentChatFriend = null;
let feedTab = 'parati';
let feedVideos = [];
let feedLoading = false;
let feedDone = false;
let likedVideos = {};
let savedVideos = {};
let friends = [];
let friendRequests = [];
let reelToSend = null;
let selectedFriend = null;
let replyTo = null;
let emojiTargetMsgId = null;
let unreadConvs = new Set();
let pushTimer = null;
let toastTimer = null;
let nextPageToken = '';
let lastMsgCheck = new Date().toISOString();
let lastMsgIds = new Set();
let pollingIntervals = [];

// ── BÚSQUEDAS YOUTUBE ────────────────────────────────────
const YT_QUERIES = {
  parati: [
    'migajeros parejas memes shorts', 'memes de novios gracioso', 'amigos momentos graciosos shorts',
    'humor relaciones pareja español', 'memes argentina viral', 'fails divertidos amigos',
    'pareja momentos virales shorts', 'amistad momentos graciosos', 'memes de amor gracioso',
    'tiktok viral amigos argentina', 'humor cotidiano argentina shorts', 'novios chistosos shorts',
    'migajero meme viral español', 'videos graciosos parejas latinas', 'red flag pareja humor shorts',
    'celos gracioso meme', 'amigos humor argentino shorts', 'memes relacionables parejas',
  ],
  trending: [
    'viral argentina trending shorts', 'lo mas visto tiktok argentina', 'meme viral semana español',
    'trending challenge viral shorts', 'viral latinoamerica shorts 2025', 'lo mas viral instagram reels',
    'challenge viral tiktok español', 'tendencia argentina viral', 'shorts viral hoy español',
    'meme trend viral shorts', 'baile viral trend shorts', 'viral moments shorts español',
  ],
};

// ══════════════════════════════════════════════════════════
//  SUPABASE CLIENT
// ══════════════════════════════════════════════════════════
const sb = {
  h() {
    return {
      'apikey': CFG.SUPABASE_KEY,
      'Authorization': `Bearer ${CFG.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    };
  },
  async get(table, filter = '') {
    try {
      const r = await fetch(`${CFG.SUPABASE_URL}/rest/v1/${table}${filter}`, { headers: this.h() });
      if (!r.ok) { console.warn('SB GET', table, r.status); return []; }
      const d = await r.json();
      return Array.isArray(d) ? d : [];
    } catch (e) { console.error('SB GET', e); return []; }
  },
  async post(table, body) {
    const r = await fetch(`${CFG.SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST', headers: this.h(), body: JSON.stringify(body)
    });
    const d = await r.json();
    if (!r.ok) throw new Error(Array.isArray(d) ? d[0]?.message : d.message || JSON.stringify(d));
    return Array.isArray(d) ? d[0] : d;
  },
  async patch(table, filter, body) {
    const r = await fetch(`${CFG.SUPABASE_URL}/rest/v1/${table}${filter}`, {
      method: 'PATCH', headers: this.h(), body: JSON.stringify(body)
    });
    if (!r.ok) return null;
    const d = await r.json();
    return Array.isArray(d) ? d[0] : d;
  },
  async del(table, filter) {
    const r = await fetch(`${CFG.SUPABASE_URL}/rest/v1/${table}${filter}`, {
      method: 'DELETE', headers: { ...this.h(), 'Prefer': '' }
    });
    return r.ok;
  },
  async upsert(table, body, onConflict = '') {
    const h = { ...this.h(), 'Prefer': `resolution=merge-duplicates,return=representation` };
    const url = `${CFG.SUPABASE_URL}/rest/v1/${table}${onConflict ? '?on_conflict='+onConflict : ''}`;
    const r = await fetch(url, { method: 'POST', headers: h, body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) throw new Error(Array.isArray(d) ? d[0]?.message : d.message || 'Upsert error');
    return Array.isArray(d) ? d[0] : d;
  },
};

// ══════════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════════
function authTab(tab) {
  document.querySelectorAll('.auth-tab').forEach((t, i) =>
    t.classList.toggle('active', (i === 0) === (tab === 'login'))
  );
  document.getElementById('p-login').classList.toggle('active', tab === 'login');
  document.getElementById('p-register').classList.toggle('active', tab === 'register');
}

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join('');
}

async function doLogin() {
  const id = document.getElementById('l-user').value.trim().toLowerCase();
  const pass = document.getElementById('l-pass').value;
  const err = document.getElementById('l-err');
  err.classList.remove('show');
  if (!id || !pass) return showErr(err, 'Completá usuario y contraseña');
  try {
    let rows = await sb.get('profiles', `?username=eq.${encodeURIComponent(id)}&select=*`);
    if (!rows.length) rows = await sb.get('profiles', `?email=eq.${encodeURIComponent(id)}&select=*`);
    if (!rows.length) return showErr(err, 'Usuario no encontrado');
    const profile = rows[0];
    const hash = await sha256(pass);
    if (profile.password_hash !== hash) return showErr(err, 'Contraseña incorrecta');
    ME = { ...profile };
    localStorage.setItem('isx_session', JSON.stringify(ME));
    await onLogin();
  } catch (e) { showErr(err, 'Error de conexión. Revisá internet.'); console.error(e); }
}

async function doRegister() {
  const err = document.getElementById('r-err');
  err.classList.remove('show');
  try {
    const username = document.getElementById('r-user').value.trim().toLowerCase().replace(/[^a-z0-9_]/g,'');
    const pass = document.getElementById('r-pass').value;
    if (!username || !pass) return showErr(err, 'Completá usuario y contraseña');
    if (pass.length < 6) return showErr(err, 'La contraseña necesita al menos 6 caracteres');
    if (username.length < 3) return showErr(err, 'El usuario necesita al menos 3 caracteres');
    const existing = await sb.get('profiles', `?username=eq.${username}&select=id`);
    if (existing.length) return showErr(err, 'Ese usuario ya está tomado');
    const password_hash = await sha256(pass);
    const color = randomColor();
    const id = crypto.randomUUID();
    await sb.post('profiles', { id, name: username, username, color, password_hash, interests: ['humor'] });
    ME = { id, name: username, username, color, interests: ['humor'] };
    localStorage.setItem('isx_session', JSON.stringify(ME));
    await onLogin();
  } catch (e) { showErr(err, e.message || 'Error al crear cuenta'); console.error(e); }
}

function showErr(el, msg) { el.textContent = msg; el.classList.add('show'); }
function randomColor() {
  const c = ['#ff2d55','#7c3aed','#059669','#f59e0b','#0a84ff','#bf5af2','#30d158','#ff6b35'];
  return c[Math.floor(Math.random() * c.length)];
}

async function logout() {
  pollingIntervals.forEach(clearInterval); pollingIntervals = [];
  localStorage.removeItem('isx_session');
  ME = null; friends = []; feedVideos = []; lastMsgIds = new Set();
  document.getElementById('bottom-nav').classList.remove('show');
  showScreen('auth');
}

// ══════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════
async function onLogin() {
  document.getElementById('bottom-nav').classList.add('show');
  likedVideos = JSON.parse(localStorage.getItem('isx_likes_' + ME.id) || '{}');
  savedVideos = JSON.parse(localStorage.getItem('isx_saved_' + ME.id) || '{}');
  lastMsgCheck = new Date().toISOString();
  await Promise.all([loadFriends(), loadFriendRequests()]);
  startPolling();
  updateReelHeight();
  loadSavedTheme();
  registerSW().then(() => {
    if (canNotify()) subscribeToPush();
    // Dar tiempo al SW a activarse, luego sincronizar sesión
    setTimeout(syncSessionToSW, 1500);
  });
  maybeAskNotifPermission();
  navTo('main', document.getElementById('nav-main'));
  loadFeed('parati');
  // Listener botón enviar
  document.getElementById('chat-inp').addEventListener('input', () => {
    document.getElementById('send-msg-btn').disabled = !document.getElementById('chat-inp').value.trim();
  });
}

function startPolling() {
  pollingIntervals.forEach(clearInterval); pollingIntervals = [];
  pollingIntervals.push(setInterval(async () => {
    if (!currentChatFriend || currentScreen !== 'chat') return;
    await loadChatMessages(currentChatFriend.id, false);
  }, 3000));
  pollingIntervals.push(setInterval(checkNewMessages, 5000));
  pollingIntervals.push(setInterval(async () => {
    if (currentScreen === 'inbox') await renderInbox();
  }, 10000));
  pollingIntervals.push(setInterval(loadFriendRequests, 20000));
}

function hideSplash() {
  const splash = document.getElementById('splash');
  if (!splash) return;
  splash.classList.add('hide');
  setTimeout(() => splash.remove(), 350);
}

window.addEventListener('DOMContentLoaded', async () => {

  const session = JSON.parse(localStorage.getItem('isx_session') || 'null');
  if (session?.id) {
    try {
      const rows = await sb.get('profiles', `?id=eq.${session.id}&select=*`);
      if (rows.length) {
        ME = rows[0];
        localStorage.setItem('isx_session', JSON.stringify(ME));
        await onLogin();
        hideSplash();
        return;
      }
    } catch(e) { console.error('Session restore failed', e); }
  }
  // No hay sesión — mostrar login
  hideSplash();
  showScreen('auth');
});

// ══════════════════════════════════════════════════════════
//  NAVEGACIÓN
// ══════════════════════════════════════════════════════════
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('s-' + name).classList.add('active');
  currentScreen = name;
}
function navTo(name, btn) {
  if (currentScreen !== 'chat') prevScreen = currentScreen;
  showScreen(name);
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (name === 'inbox') renderInbox();
  if (name === 'amigos') renderAmigos();
  if (name === 'perfil') renderPerfil();
}
function goBack() {
  const t = prevScreen || 'main';
  showScreen(t);
  const map = { main:'nav-main', inbox:'nav-inbox', amigos:'nav-amigos', perfil:'nav-perfil' };
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(map[t])?.classList.add('active');
}
function showAmigos() {
  if (currentScreen !== 'chat') prevScreen = currentScreen;
  showScreen('amigos'); renderAmigos();
}

// ══════════════════════════════════════════════════════════
//  YOUTUBE API
// ══════════════════════════════════════════════════════════
// ── IDs ya mostrados (evita repetición) ──────────────────
// Persist seen video IDs across sessions (max 500 IDs)
const _SEEN_KEY = 'isx_seen_v2';
function _loadSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(_SEEN_KEY) || '[]')); } catch { return new Set(); }
}
function _saveSeen(set) {
  const arr = [...set];
  // Keep only last 500
  localStorage.setItem(_SEEN_KEY, JSON.stringify(arr.slice(-500)));
}
const seenVideoIds = _loadSeen();
function _addSeen(id) { seenVideoIds.add(id); _saveSeen(seenVideoIds); }

// ── Intereses aprendidos del usuario ─────────────────────
function getLikedChannels() {
  const likes = Object.values(likedVideos);
  const channels = likes.map(l => l.channel).filter(Boolean);
  const freq = {};
  channels.forEach(c => freq[c] = (freq[c]||0)+1);
  return Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([c])=>c);
}

// Track user interests from titles of liked/watched videos
function getUserInterests() {
  const stored = JSON.parse(localStorage.getItem('isx_interests_' + (ME?.id||'')) || '[]');
  return stored;
}
function addInterest(keyword) {
  if (!keyword || !ME) return;
  const key = 'isx_interests_' + ME.id;
  const arr = JSON.parse(localStorage.getItem(key) || '[]');
  if (!arr.includes(keyword)) arr.unshift(keyword);
  localStorage.setItem(key, JSON.stringify(arr.slice(0,30)));
}
// Extract keywords from video title
function extractKeywords(title) {
  if (!title) return [];
  // Remove common stopwords and short words
  const stop = new Set(['el','la','los','las','un','una','de','del','en','y','a','que','con','por','para','es','se','lo','le','te','me','mi','su','al']);
  return title.toLowerCase().replace(/[^a-záéíóúüñ\s]/gi,'').split(/\s+/)
    .filter(w => w.length > 3 && !stop.has(w)).slice(0,3);
}

// Custom search query set by user
let _feedCustomQuery = null;

function getPersonalizedQuery(tab) {
  if (_feedCustomQuery) return _feedCustomQuery;
  if (tab === 'parati') {
    const interests = getUserInterests();
    const channels = getLikedChannels();
    const rnd = Math.random();
    // 35% chance: use a learned interest keyword
    if (interests.length && rnd < 0.35) {
      const kw = interests[Math.floor(Math.random()*Math.min(interests.length,8))];
      return `${kw} shorts`;
    }
    // 25% chance: use a liked channel
    if (channels.length && rnd < 0.6) {
      const ch = channels[Math.floor(Math.random()*channels.length)];
      return `${ch} shorts`;
    }
  }
  const queries = YT_QUERIES[tab] || YT_QUERIES.parati;
  const prev = getPersonalizedQuery._last;
  let q;
  do { q = queries[Math.floor(Math.random()*queries.length)]; } while (q === prev && queries.length > 1);
  getPersonalizedQuery._last = q;
  return q;
}


function toggleFeedSearch() {
  const bar = document.getElementById('feed-search-bar');
  const inp = document.getElementById('feed-search-inp');
  const btn = document.getElementById('search-tab-btn');
  const visible = bar.style.display !== 'none';
  bar.style.display = visible ? 'none' : 'block';
  if (!visible) {
    inp.focus();
    btn.style.color = 'var(--acc)';
  } else {
    clearFeedSearch();
    btn.style.color = '';
  }
}

function clearFeedSearch() {
  document.getElementById('feed-search-inp').value = '';
  searchReels('');
}

function searchReels(query) {
  const q = query.trim();
  if (!q) {
    _feedCustomQuery = null;
    document.getElementById('reel-search-clear')?.style.setProperty('display', 'none');
  } else {
    _feedCustomQuery = q + ' shorts';
    document.getElementById('reel-search-clear')?.style.setProperty('display', 'flex');
  }
  loadFeed(feedTab);
}

async function ytSearch(query, pageToken = '') {
  const key = getYTKey();
  if (!key) {
    console.warn('[YT] Todas las keys agotadas, todas las keys agotadas temporalmente');
    return { items:[], nextPageToken:'' };
  }
  const p = new URLSearchParams({
    part:'snippet', q:query, type:'video', videoDuration:'short',
    videoEmbeddable:'true', maxResults:15, regionCode:'AR',
    relevanceLanguage:'es', key, ...(pageToken?{pageToken}:{})
  });
  try {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/search?${p}`);
    if (!r.ok) {
      const errBody = await r.json().catch(()=>({}));
      const reason = errBody?.error?.errors?.[0]?.reason || r.status;
      console.error('[YT Search] Error:', reason);
      if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
        const hasMore = rotateYTKey();
        if (hasMore) {
          console.log('[YT] Rotando a siguiente key...');
          return ytSearch(query, pageToken); // reintenta con la nueva key
        } else {
          console.warn('[YT] Todas las keys agotadas hoy, reintentando mañana');
        }
      }
      return { items:[], nextPageToken:'' };
    }
    return r.json();
  } catch(e) { console.error('[YT Search] fetch failed:', e); return { items:[], nextPageToken:'' }; }
}

async function ytDetails(ids) {
  if (!ids.length) return [];
  const p = new URLSearchParams({ part:'snippet,statistics,contentDetails', id:ids.join(','), key:getYTKey() });
  try {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?${p}`);
    if (!r.ok) return [];
    return (await r.json()).items || [];
  } catch { return []; }
}

function parseDur(d) {
  const m = (d||'').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 999;
  return (parseInt(m[1]||0)*3600)+(parseInt(m[2]||0)*60)+parseInt(m[3]||0);
}

async function fetchVideos(tab, pageToken='') {
  // ══ FUENTE 1: YouTube Shorts ══════════════════════════════
  const q = getPersonalizedQuery(tab);
  const sd = await ytSearch(q, pageToken);
  const ids = (sd.items||[]).map(i=>i.id?.videoId).filter(Boolean).filter(id=>!seenVideoIds.has(id));
  if (ids.length) {
    const details = await ytDetails(ids);
    const videos = details
      .filter(v => parseDur(v.contentDetails?.duration) <= 180)
      .map(v => {
        _addSeen(v.id);
        return {
          id: v.id,
          title: v.snippet.title,
          channel: v.snippet.channelTitle,
          thumb: v.snippet.thumbnails?.high?.url || v.snippet.thumbnails?.medium?.url || '',
          views: parseInt(v.statistics?.viewCount||0),
          source: 'youtube',
          watchUrl: `https://www.youtube.com/shorts/${v.id}`,
        };
      });
    if (videos.length) return { videos, nextPageToken: sd.nextPageToken||'' };
  }


  // ══ Sin fuentes disponibles ════════════════════════════════
  return { videos:[], nextPageToken: sd.nextPageToken||'' };
}

// ══════════════════════════════════════════════════════════
//  FEED
let prefetchedVideos = [];

// ── Mostrar error descriptivo en el feed ─────────────────
function showFeedError(msg) {
  const feed = document.getElementById('feed');
  if (!feed) return;
  feed.innerHTML = `<div class="reel"><div class="reel-loader">
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ff2d55" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    <p style="color:#ff2d55;font-weight:600;margin-top:8px">Error de YouTube API</p>
    <p style="font-size:12px;color:#8e8e9e;margin-top:4px;text-align:center;padding:0 20px">${msg}</p>
    <button onclick="loadFeed(feedTab)" style="margin-top:16px;padding:10px 24px;background:#ff2d55;color:#fff;border:none;border-radius:20px;font-size:14px;cursor:pointer">Reintentar</button>
  </div></div>`;
}

// ══════════════════════════════════════════════════════════
async function loadFeed(tab) {
  feedTab=tab; feedVideos=[]; feedLoading=false; feedDone=false; nextPageToken='';
  seenVideoIds.clear(); // keep persistent seen intact
  ytIframeMap.clear(); // Limpiar referencias a iframes viejos
  prefetchedVideos=[];
  const feed = document.getElementById('feed');
  feed.innerHTML = `<div class="reel"><div class="reel-loader"><div class="spinner"></div><p>Cargando...</p></div></div>`;
  await loadMoreVideos();
  // Prefetch silencioso del siguiente batch
  setTimeout(() => { if (!feedDone) prefetchNext(); }, 2000);
}

async function prefetchNext() {
  if (feedDone) return;
  try {
    const { videos, nextPageToken:npt } = await fetchVideos(feedTab, nextPageToken);
    prefetchedVideos = videos;
    if (npt) nextPageToken = npt;
  } catch {}
}

async function loadMoreVideos() {
  if (feedLoading||feedDone) return;
  feedLoading = true;
  try {
    let videos, npt;
    // Usar prefetch si está disponible
    if (prefetchedVideos.length) {
      videos = prefetchedVideos; prefetchedVideos = [];
      npt = nextPageToken;
      // Lanzar siguiente prefetch en background
      setTimeout(prefetchNext, 500);
    } else {
      ({ videos, nextPageToken:npt } = await fetchVideos(feedTab, nextPageToken));
      nextPageToken = npt;
    }
    if (!videos.length && !feedVideos.length) {
      document.getElementById('feed').innerHTML = `<div class="reel"><div class="reel-loader"><p>Sin videos.<br>Actualizá.</p></div></div>`;
      feedLoading=false; return;
    }
    if (!videos.length) { feedDone=true; feedLoading=false; return; }
    const isFirst = feedVideos.length===0;
    feedVideos.push(...videos);
    const feed = document.getElementById('feed');
    if (isFirst) feed.innerHTML='';
    videos.forEach(v => feed.appendChild(buildReelEl(v)));
    document.getElementById('feed-sentinel')?.remove();
    const s = document.createElement('div'); s.id='feed-sentinel'; s.style.height='1px';
    feed.appendChild(s);
    // Cargar más cuando faltan 2 reels
    new IntersectionObserver(en => { if(en[0].isIntersecting) loadMoreVideos(); }, {root:feed,threshold:0.1}).observe(s);
  } catch(e) { console.error(e); }
  feedLoading=false;
}

// ── Altura exacta del reel (sin que se vea el siguiente) ─
function updateReelHeight() {
  const nav    = document.getElementById('bottom-nav');
  const topbar = document.querySelector('#s-main .topbar');
  const tabs   = document.querySelector('#s-main .tabs');
  const navH   = nav?.offsetHeight    || 60;
  const topH   = topbar?.offsetHeight || 50;
  const tabH   = tabs?.offsetHeight   || 40;
  const h = window.innerHeight - topH - tabH - navH;
  document.documentElement.style.setProperty('--reel-h', h + 'px');
}
window.addEventListener('resize', updateReelHeight);

// ── YT POSTMESSAGE HELPERS ───────────────────────────────
function ytCmd(iframe, func, args) {
  try {
    iframe.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func, args: args !== undefined ? args : [] }), '*'
    );
  } catch(e) {}
}

// ── Global: reiniciar video cuando termina ───────────────
// Usamos un ID único por iframe para evitar que contentWindow cambie de referencia
const ytIframeMap = new Map(); // frameId → iframe element
let _ytFrameCounter = 0;
window.addEventListener('message', e => {
  if (!e.origin.includes('youtube.com')) return;
  try {
    const data = JSON.parse(e.data);
    // Buscar iframe que coincida con e.source
    let targetIframe = null;
    for (const [, iframeEl] of ytIframeMap) {
      if (iframeEl.contentWindow === e.source) { targetIframe = iframeEl; break; }
    }
    if (!targetIframe) return;
    if (data.event === 'onStateChange' && data.info === 0) {
      ytCmd(targetIframe, 'seekTo', [0, true]);
      ytCmd(targetIframe, 'playVideo');
    }
  } catch {}
});

// ── REEL REACTION STATE ──────────────────────────────────
let activeReelId = null;
function pickReelReact(emoji) { if (!activeReelId || !ME) return; toast(emoji); }

function buildReelEl(v) {
  const liked = !!likedVideos[v.id], saved = !!savedVideos[v.id];
  const views = v.views > 999999 ? (v.views/1e6).toFixed(1)+'M' : v.views > 999 ? Math.round(v.views/1000)+'k' : (v.views || '');

  const div = document.createElement('div');
  div.className = 'reel';
  div.dataset.id = v.id;

  const _origin = encodeURIComponent(location.origin || 'https://instasunx.app');
  const src = `https://www.youtube.com/embed/${v.id}?autoplay=0&mute=1&controls=0&loop=0&start=0&playsinline=1&rel=0&modestbranding=1&enablejsapi=1&fs=0&iv_load_policy=3&disablekb=1&origin=${_origin}`;

  div.innerHTML = `
    <div class="yt-wrap">
      <iframe src="${src}"
        frameborder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope"
        title="${v.title.replace(/[<>"]/g,'')}"></iframe>
    </div>
    <div class="reel-tap" id="tap-${v.id}"></div>
    <div class="play-ind" id="pind-${v.id}">
      <svg width="64" height="64" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r="32" fill="rgba(0,0,0,0.45)"/>
        <polygon points="26,20 26,44 46,32" fill="white"/>
      </svg>
    </div>
    <div class="like-burst" id="burst-${v.id}">❤️</div>
    <div class="reel-grad"></div>
    <div class="reel-info">
      <div class="reel-ch-name">${escHtml(v.channel)}</div>
      <div class="reel-title">${escHtml(v.title)}</div>
    </div>
    <div class="reel-actions">
      <div class="r-act ${liked?'liked':''}" id="like-${v.id}" onclick="toggleLike('${v.id}',this)">
        <div class="r-act-ico">${heartSvg(liked)}</div>
        <div class="r-act-lbl">${views}</div>
      </div>
      <div class="r-act" onclick="openSendReelSheet('${v.id}')">
        <div class="r-act-ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></div>
        <div class="r-act-lbl">Enviar</div>
      </div>
      <div class="r-act ${saved?'liked':''}" id="save-${v.id}" onclick="toggleSave('${v.id}',this)">
        <div class="r-act-ico">${bookmarkSvg(saved)}</div>
        <div class="r-act-lbl">Guardar</div>
      </div>
    </div>`;

  const iframe  = div.querySelector('iframe');
  const overlay = div.querySelector('.reel-tap');
  const playInd = div.querySelector('.play-ind');
  const burst   = div.querySelector('.like-burst');

  const _fid = ++_ytFrameCounter;
  iframe.dataset.ytFid = _fid;
  ytIframeMap.set(_fid, iframe);
  iframe.addEventListener('load', () => ytIframeMap.set(_fid, iframe));

  let paused = false, hasStarted = false;
  let tapTimer = null, tapCount = 0, touchStartY = 0, touchStartX = 0;

  function showPlayInd() {
    playInd.style.opacity = '1';
    clearTimeout(playInd._t);
    playInd._t = setTimeout(() => playInd.style.opacity = '0', 700);
  }
  function doLike() {
    const likeEl = document.getElementById(`like-${v.id}`);
    if (likeEl && !likedVideos[v.id]) toggleLike(v.id, likeEl);
    burst.classList.remove('pop'); void burst.offsetWidth; burst.classList.add('pop');
  }

  overlay.addEventListener('touchstart', e => {
    touchStartY = e.touches[0].clientY;
    touchStartX = e.touches[0].clientX;
  }, { passive: true });

  overlay.addEventListener('touchend', e => {
    const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);
    const dx = Math.abs(e.changedTouches[0].clientX - touchStartX);
    if (dy > 12 || dx > 12) { tapCount = 0; clearTimeout(tapTimer); return; }
    tapCount++;
    if (tapCount === 1) {
      tapTimer = setTimeout(() => {
        tapCount = 0;
        if (!hasStarted) return;
        if (paused) { ytCmd(iframe,'playVideo'); paused=false; playInd.style.opacity='0'; }
        else        { ytCmd(iframe,'pauseVideo'); paused=true; showPlayInd(); }
      }, 250);
    } else if (tapCount >= 2) {
      clearTimeout(tapTimer); tapCount = 0; doLike();
    }
  }, { passive: true });

  new IntersectionObserver(entries => {
    const vis = entries[0].isIntersecting && entries[0].intersectionRatio >= 0.8;
    if (vis) {
      if (!hasStarted) {
        hasStarted = true;
        const go = () => { ytCmd(iframe,'seekTo',[0,true]); ytCmd(iframe,'unMute'); ytCmd(iframe,'playVideo'); paused=false; };
        iframe.contentWindow ? setTimeout(go, 300) : iframe.addEventListener('load', () => setTimeout(go, 300), {once:true});
      } else if (!paused) {
        ytCmd(iframe,'unMute'); ytCmd(iframe,'playVideo');
      }
    } else {
      ytCmd(iframe,'mute');
      if (hasStarted && !paused) ytCmd(iframe,'pauseVideo');
    }
  }, { threshold: [0, 0.8] }).observe(div);

  return div;
}

let _currentView = 'feed'; // 'feed' | 'buscar'

function showFeedView() {
  _currentView = 'feed';
  document.getElementById('view-feed').style.display = 'flex';
  document.getElementById('view-buscar').style.display = 'none';
  document.getElementById('tab-feed').classList.add('active');
  document.getElementById('tab-buscar').classList.remove('active');
  if (!feedVideos.length) loadFeed('parati');
}

function showBuscarView() {
  _currentView = 'buscar';
  document.getElementById('view-feed').style.display = 'none';
  document.getElementById('view-buscar').style.display = 'flex';
  document.getElementById('tab-buscar').classList.add('active');
  document.getElementById('tab-feed').classList.remove('active');
  loadBuscarGrid(true);
}

// Legacy — keep parati working
function switchFeedTab(tab, btn) {
  loadFeed(tab);
}
function refreshFeed() { loadFeed(feedTab); }

async function toggleLike(videoId, el) {
  const isLiked = !!likedVideos[videoId];
  if (isLiked) {
    delete likedVideos[videoId]; el.classList.remove('liked');
    el.querySelector('.r-act-ico').innerHTML = heartSvg(false);
    sb.del('likes', `?user_id=eq.${ME.id}&video_id=eq.${videoId}`).catch(()=>{});
  } else {
    const v = feedVideos.find(v=>v.id===videoId);
    likedVideos[videoId] = { videoId, title:v?.title||'', thumb:v?.thumb||'', channel:v?.channel||'' };
    el.classList.add('liked'); el.querySelector('.r-act-ico').innerHTML = heartSvg(true);
    sb.upsert('likes', { user_id:ME.id, video_id:videoId, title:v?.title||'', thumb:v?.thumb||'', channel:v?.channel||'' }, 'user_id,video_id').catch(()=>{});
    // Learn interest from liked video
    extractKeywords(v?.title).forEach(addInterest);
    if (v?.channel) addInterest(v.channel.toLowerCase());
  }
  localStorage.setItem('isx_likes_'+ME.id, JSON.stringify(likedVideos));
}

function toggleSave(videoId, el) {
  const isSaved = !!savedVideos[videoId];
  if (isSaved) {
    delete savedVideos[videoId]; el.classList.remove('liked');
    el.querySelector('.r-act-ico').innerHTML = bookmarkSvg(false); toast('Quitado de guardados');
  } else {
    const v = feedVideos.find(v=>v.id===videoId);
    savedVideos[videoId] = { videoId, title:v?.title||'', thumb:v?.thumb||'', watchUrl:v?.watchUrl||'' };
    el.classList.add('liked'); el.querySelector('.r-act-ico').innerHTML = bookmarkSvg(true); toast('¡Guardado!');
  }
  localStorage.setItem('isx_saved_'+ME.id, JSON.stringify(savedVideos));
}

function heartSvg(f) {
  return `<svg width="24" height="24" viewBox="0 0 24 24" fill="${f?'#ff2d55':'none'}" stroke="${f?'#ff2d55':'#fff'}" stroke-width="2" stroke-linecap="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
}
function bookmarkSvg(f) {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="${f?'#ff9f0a':'none'}" stroke="${f?'#ff9f0a':'#fff'}" stroke-width="2" stroke-linecap="round"><polygon points="19 21 12 16 5 21 5 3 19 3 19 21"/></svg>`;
}

// ══════════════════════════════════════════════════════════
//  ENVIAR REEL
// ══════════════════════════════════════════════════════════
function openSendReelSheet(videoId) {
  if (!videoId) videoId = document.querySelector('.reel')?.dataset.id || feedVideos[0]?.id;
  reelToSend = feedVideos.find(v=>v.id===videoId)||null;
  selectedFriend = null;
  const list = document.getElementById('sheet-friends');
  if (!friends.length) {
    list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--muted);font-size:14px">Todavía no tenés amigos.<br><br>Andá a <b>Amigos</b> y buscalos 👥</div>`;
    document.getElementById('sheet-confirm').disabled = true;
  } else {
    list.innerHTML = friends.map(f=>`
      <div class="sf-item" onclick="selectSheetFriend('${f.id}',this)">
        <div class="sf-av" style="background:${f.color}33;color:${f.color}">${(f.name||'?')[0].toUpperCase()}</div>
        <div><div class="sf-name">${escHtml(f.name)}</div><div class="sf-user">@${escHtml(f.username)}</div></div>
      </div>`).join('');
    document.getElementById('sheet-confirm').disabled = true;
  }
  document.getElementById('sheet-bg').classList.add('show');
}
function selectSheetFriend(id, el) {
  document.querySelectorAll('.sf-item').forEach(i=>i.classList.remove('sel'));
  el.classList.add('sel');
  selectedFriend = friends.find(f=>f.id===id);
  document.getElementById('sheet-confirm').disabled = false;
}
function closeSheet() {
  document.getElementById('sheet-bg').classList.remove('show');
  reelToSend=null; selectedFriend=null;
}
async function confirmSend() {
  if (!selectedFriend||!reelToSend) return;
  const btn = document.getElementById('sheet-confirm');
  btn.textContent='Enviando...'; btn.disabled=true;
  await sendReelMsg(selectedFriend.id, reelToSend);
  closeSheet(); btn.textContent='Enviar'; btn.disabled=false;
  toast(`Reel enviado a ${selectedFriend.name} ✈️`);
}

// ══════════════════════════════════════════════════════════
//  AMIGOS
// ══════════════════════════════════════════════════════════
async function loadFriends() {
  const [asA, asB] = await Promise.all([
    sb.get('friendships', `?user_a=eq.${ME.id}&status=eq.accepted&select=user_b`),
    sb.get('friendships', `?user_b=eq.${ME.id}&status=eq.accepted&select=user_a`),
  ]);
  const ids = [...asA.map(r=>r.user_b), ...asB.map(r=>r.user_a)].filter(Boolean);
  if (!ids.length) { friends=[]; return; }
  friends = await sb.get('profiles', `?id=in.(${ids.join(',')})&select=id,name,username,color,avatar_url`);
}

async function loadFriendRequests() {
  const rows = await sb.get('friendships', `?user_b=eq.${ME.id}&status=eq.pending&select=id,user_a`);
  if (!rows.length) { friendRequests=[]; updateReqBadge(); return; }
  const ids = rows.map(r=>r.user_a).filter(Boolean);
  const profiles = await sb.get('profiles', `?id=in.(${ids.join(',')})&select=id,name,username,color`);
  friendRequests = rows.map(r=>({ friendshipId:r.id, ...profiles.find(p=>p.id===r.user_a) })).filter(r=>r.id);
  updateReqBadge();
}

function updateReqBadge() {
  const b=document.getElementById('req-badge');
  if (friendRequests.length) { b.style.display='flex'; b.textContent=friendRequests.length; } else b.style.display='none';
}

async function searchUsers(q) {
  const res = document.getElementById('search-results');
  if (!q||q.length<2) { res.classList.remove('show'); return; }
  const rows = await sb.get('profiles', `?username=ilike.*${encodeURIComponent(q)}*&select=id,name,username,color,avatar_url&limit=8`);
  const filtered = rows.filter(r=>r.id!==ME.id);
  if (!filtered.length) {
    res.innerHTML=`<div style="padding:14px;font-size:13px;color:var(--muted)">Sin resultados para "${escHtml(q)}"</div>`;
    res.classList.add('show'); return;
  }
  res.innerHTML = filtered.map(u=>{
    const isFriend = friends.some(f=>f.id===u.id);
    return `<div class="search-user-item" onclick="sendFriendRequest('${u.id}','${escHtml(u.name||u.username)}')">
      <div style="width:36px;height:36px;border-radius:50%;background:${u.color}33;color:${u.color};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;flex-shrink:0">${(u.name||'?')[0].toUpperCase()}</div>
      <div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:600">${escHtml(u.name||u.username)}</div><div style="font-size:12px;color:var(--muted)">@${escHtml(u.username)}</div></div>
      <div style="font-size:12px;font-weight:600;color:${isFriend?'var(--acc3)':'var(--acc)'}">${isFriend?'Amigos ✓':'+ Agregar'}</div>
    </div>`;
  }).join('');
  res.classList.add('show');
}

document.addEventListener('click', e => {
  if (!e.target.closest('.search-wrap')) document.getElementById('search-results')?.classList.remove('show');
});

async function sendFriendRequest(toId, toName) {
  document.getElementById('search-results').classList.remove('show');
  document.getElementById('search-inp').value='';
  if (friends.some(f=>f.id===toId)) { toast('Ya son amigos ✓'); return; }
  try { await sb.post('friendships', { user_a:ME.id, user_b:toId, status:'pending' }); toast(`Solicitud enviada a ${toName} ✓`); }
  catch { toast('Ya le enviaste una solicitud'); }
}

async function acceptRequest(friendshipId, userId) {
  await sb.patch('friendships', `?id=eq.${friendshipId}`, { status:'accepted' });
  await Promise.all([loadFriends(), loadFriendRequests()]);
  renderAmigos(); toast('¡Amigo agregado! 🎉');
}

async function rejectRequest(friendshipId) {
  await sb.del('friendships', `?id=eq.${friendshipId}`);
  await loadFriendRequests(); renderAmigos();
}

async function renderAmigos() {
  const c = document.getElementById('amigos-scroll');
  let html = '';
  if (friendRequests.length) {
    html += `<div class="amigos-section-title">Solicitudes (${friendRequests.length})</div>`;
    html += friendRequests.map(r=>`
      <div class="req-item">
        <div style="width:40px;height:40px;border-radius:50%;background:${r.color||'#ff2d55'}33;color:${r.color||'#ff2d55'};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:17px;flex-shrink:0">${(r.name||'?')[0].toUpperCase()}</div>
        <div style="flex:1;min-width:0;margin:0 10px"><div style="font-size:15px;font-weight:600">${escHtml(r.name||'')}</div><div style="font-size:12px;color:var(--muted)">@${escHtml(r.username||'')}</div></div>
        <div class="req-actions">
          <button class="req-btn acc" onclick="acceptRequest('${r.friendshipId}','${r.id}')">Aceptar</button>
          <button class="req-btn rej" onclick="rejectRequest('${r.friendshipId}')">Ignorar</button>
        </div>
      </div>`).join('');
  }
  if (!friends.length) {
    html += `<div class="inbox-empty"><p>Todavía no tenés amigos.<br>Buscalos por usuario arriba ☝️</p></div>`;
  } else {
    html += `<div class="amigos-section-title">Mis amigos (${friends.length})</div>`;
    for (const f of friends) {
      const fLikes = await sb.get('likes', `?user_id=eq.${f.id}&select=video_id,title,thumb,channel&order=created_at.desc&limit=8`);
      html += `<div class="amigo-card">
        <div class="amigo-hdr">
          ${f.avatar_url ? `<img src="${escHtml(f.avatar_url)}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;flex-shrink:0">` : `<div class="amigo-av" style="background:${f.color}33;color:${f.color}">${(f.name||'?')[0].toUpperCase()}</div>`}
          <div><div class="amigo-name">${escHtml(f.name)}</div><div class="amigo-user">@${escHtml(f.username)}</div></div>
          <button style="margin-left:auto;background:var(--s2);border:1px solid var(--border);border-radius:20px;padding:7px 14px;font-size:13px;color:var(--text);cursor:pointer;font-family:'Outfit',sans-serif" onclick="openChat('${f.id}')">💬 Mensaje</button>
        </div>
        ${fLikes.length ? `
          <div style="padding:8px 14px 4px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;font-weight:600">Le gustó ❤️</div>
          <div class="amigo-likes">${fLikes.map(l=>`
            <div class="amigo-like-card" onclick="openYT('${l.video_id}')">
              <div class="amigo-like-thumb">${l.thumb?`<img src="${escHtml(l.thumb)}" alt="" loading="lazy">`:'🎬'}</div>
              <div class="amigo-like-title">${escHtml(l.title||'')}</div>
            </div>`).join('')}</div>` :
          `<div class="amigo-empty">Todavía no dio ningún like.</div>`}
      </div>`;
    }
  }
  c.innerHTML = html;
}

function openReelInApp(id, title, channel) {
  if (!id) return;
  const modal = document.getElementById('reel-modal');
  // Sin controles, sin título, sin timeline
  document.getElementById('reel-modal-iframe').src =
    `https://www.youtube.com/embed/${id}?autoplay=1&mute=0&controls=0&loop=1&playlist=${id}&playsinline=1&rel=0&modestbranding=1&enablejsapi=1&fs=0&iv_load_policy=3&disablekb=1`;
  modal.classList.add('show');
}
function closeReelModal() {
  const modal = document.getElementById('reel-modal');
  modal.classList.remove('show');
  document.getElementById('reel-modal-iframe').src = '';
}
function openYT(id) { openReelInApp(id, '', ''); }

// ══════════════════════════════════════════════════════════
//  INBOX
// ══════════════════════════════════════════════════════════
async function renderInbox() {
  const c = document.getElementById('inbox-list');
  if (!friends.length) {
    c.innerHTML=`<div class="inbox-empty"><p>Todavía no tenés amigos.<br>Andá a <b>Amigos</b> y buscalos por usuario.</p></div>`; return;
  }
  const convs = await Promise.all(friends.map(async f => {
    const msgs = await sb.get('messages',
      `?or=(and(from_id.eq.${ME.id},to_id.eq.${f.id}),and(from_id.eq.${f.id},to_id.eq.${ME.id}))&order=created_at.desc&limit=1&select=id,type,content,reel_title,from_id,created_at`
    );
    return { friend:f, last:msgs[0]||null };
  }));
  convs.sort((a,b) => {
    if (!a.last&&!b.last) return 0; if (!a.last) return 1; if (!b.last) return -1;
    return new Date(b.last.created_at)-new Date(a.last.created_at);
  });
  c.innerHTML = convs.map(({friend:f, last}) => {
    let preview='Sin mensajes aún', icon='';
    if (last) {
      if (last.type==='reel') { icon='🎬 '; preview=last.reel_title||'Reel'; }
      else preview=last.content||'';
      if (preview.length>45) preview=preview.slice(0,45)+'…';
    }
    const isUnread = last && last.from_id!==ME.id && unreadConvs.has(f.id);
    return `<div class="conv-item ${isUnread?'unread':''}" onclick="openChat('${f.id}')">
      ${f.avatar_url ? `<img src="${escHtml(f.avatar_url)}" style="width:46px;height:46px;border-radius:50%;object-fit:cover;flex-shrink:0;border:1.5px solid ${f.color}55">` : `<div class="conv-av" style="background:${f.color}33;color:${f.color};border-color:${f.color}55">${(f.name||'?')[0].toUpperCase()}</div>`}
      <div class="conv-body">
        <div class="conv-name">${escHtml(f.name)}</div>
        <div class="conv-preview">${icon}${escHtml(preview)}</div>
      </div>
      <div class="conv-time">${last?formatTime(last.created_at):''}</div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════
//  CHAT
// ══════════════════════════════════════════════════════════
async function openChat(friendId) {
  if (!friends.length) await loadFriends();
  const f = friends.find(x=>x.id===friendId);
  if (!f) { toast('No se encontró el contacto'); return; }
  currentChatFriend=f; unreadConvs.delete(friendId); updateMsgBadge();
  const av=document.getElementById('chat-hdr-av');
  if (f.avatar_url) {
    av.innerHTML=`<img src="${f.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    av.style.background=''; av.style.color='';
  } else {
    av.innerHTML=''; av.textContent=(f.name||'?')[0].toUpperCase();
    av.style.background=f.color+'33'; av.style.color=f.color;
  }
  document.getElementById('chat-hdr-name').textContent=f.name;
  document.getElementById('chat-hdr-status').textContent='● activo';
  if (currentScreen!=='chat') prevScreen=currentScreen;
  showScreen('chat'); cancelReply();
  lastMsgIds=new Set();
  await loadChatMessages(friendId, true);
}

async function loadChatMessages(friendId, scroll=false) {
  // JOIN con reactions en una sola query
  const msgs = await sb.get('messages',
    `?or=(and(from_id.eq.${ME.id},to_id.eq.${friendId}),and(from_id.eq.${friendId},to_id.eq.${ME.id}))&order=created_at.asc&select=*,reactions(id,user_id,emoji)`
  );
  const idStr = msgs.map(m=>m.id+(m.reactions?.length||0)).join(',');
  if (idStr===[...lastMsgIds].join(',') && !scroll) return;
  lastMsgIds=new Set([idStr]);
  const c=document.getElementById('chat-msgs');
  const wasBottom=c.scrollHeight-c.scrollTop-c.clientHeight<80;
  c.innerHTML=msgs.map((m,i)=>buildMsgBubble(m,msgs[i-1])).join('');
  if (scroll||wasBottom) c.scrollTop=c.scrollHeight;
}


// ══════════════════════════════════════════════════════════
//  IMÁGENES EN CHAT
// ══════════════════════════════════════════════════════════

let _pendingImgFile = null;
let _pendingImgDataUrl = null;

function onImgSelected(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = ''; // reset para poder seleccionar la misma imagen de nuevo
  _pendingImgFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    _pendingImgDataUrl = e.target.result;
    // Mostrar sheet de view-once
    document.getElementById('vo-preview-img').src = _pendingImgDataUrl;
    const sheet = document.getElementById('view-once-sheet');
    sheet.style.display = 'flex';
    sheet.style.alignItems = 'flex-end';
  };
  reader.readAsDataURL(file);
}

function cancelViewOnce() {
  _pendingImgFile = null;
  _pendingImgDataUrl = null;
  document.getElementById('view-once-sheet').style.display = 'none';
  if (currentScreen === 'chat') setTimeout(() => document.getElementById('chat-inp').focus(), 50);
}

async function confirmSendImg(viewOnce) {
  if (!_pendingImgFile || !currentChatFriend) return;
  const sheet = document.getElementById('view-once-sheet');
  sheet.style.display = 'none';

  const file = _pendingImgFile;
  const dataUrl = _pendingImgDataUrl;
  _pendingImgFile = null; _pendingImgDataUrl = null;
  if (file.size > 10 * 1024 * 1024) { toast('Imagen muy grande (máx 10MB)'); return; }

  // Subir imagen a Supabase Storage
  toast('Subiendo imagen...');
  try {
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `chat/${ME.id}/${Date.now()}.${ext}`;
    const uploadRes = await fetch(
      `${CFG.SUPABASE_URL}/storage/v1/object/chat-media/${path}`,
      {
        method: 'POST',
        headers: {
          'apikey': CFG.SUPABASE_KEY,
          'Authorization': `Bearer ${CFG.SUPABASE_KEY}`,
          'Content-Type': file.type,
          'x-upsert': 'true',
        },
        body: file,
      }
    );

    let imageUrl = dataUrl; // fallback: base64 si falla el upload
    if (uploadRes.ok) {
      imageUrl = `${CFG.SUPABASE_URL}/storage/v1/object/public/chat-media/${path}`;
    }

    await sb.post('messages', {
      from_id: ME.id,
      to_id: currentChatFriend.id,
      type: viewOnce ? 'image_once' : 'image',
      content: imageUrl,
    });
    await loadChatMessages(currentChatFriend.id, true);
  } catch(e) {
    console.error('sendImg', e);
    toast('Error al enviar imagen');
  }
}

// Abrir imagen al tocarla (y marcar view-once como vista)
// Track view-once images already opened this session
const _openedOnce = new Set();

async function openChatImage(msgId, url, isOnce) {
  if (isOnce) {
    // If already opened this session, block it
    if (_openedOnce.has(msgId)) {
      toast('Esta imagen ya fue vista y no puede verse de nuevo');
      return;
    }
    _openedOnce.add(msgId);
    await sb.patch('messages', `?id=eq.${msgId}`, { type: 'image_seen' }).catch(() => {});
  }

  // Push state for back button support
  history.pushState({ imgOverlay: true }, '');

  const overlay = document.createElement('div');
  overlay.id = 'img-overlay';
  overlay.style.cssText = `position:fixed;inset:0;z-index:999;background:rgba(0,0,0,.97);
    display:flex;align-items:center;justify-content:center;touch-action:none;`;

  overlay.innerHTML = `
    <button onclick="closeImgOverlay()" style="position:absolute;top:16px;right:16px;z-index:10;
      background:rgba(255,255,255,.12);border:none;color:#fff;width:40px;height:40px;
      border-radius:50%;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center">✕</button>
    <img id="overlay-img" src="${url}" style="max-width:95vw;max-height:90vh;object-fit:contain;
      border-radius:8px;transform-origin:center;transition:transform 0.1s;user-select:none;touch-action:none">
  `;
  document.body.appendChild(overlay);

  // Pinch-to-zoom
  const img = overlay.querySelector('#overlay-img');
  let scale = 1, startDist = 0, startScale = 1;
  let panX = 0, panY = 0, startPanX = 0, startPanY = 0;
  let lastTap = 0;

  function applyTransform() {
    img.style.transform = `translate(${panX}px,${panY}px) scale(${scale})`;
  }

  overlay.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      startDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      startScale = scale;
    } else if (e.touches.length === 1 && scale > 1) {
      startPanX = e.touches[0].clientX - panX;
      startPanY = e.touches[0].clientY - panY;
    }
    // Double tap to zoom
    const now = Date.now();
    if (now - lastTap < 300 && e.touches.length === 1) {
      scale = scale > 1 ? 1 : 2.5;
      panX = 0; panY = 0;
      img.style.transition = 'transform .25s';
      applyTransform();
      setTimeout(() => img.style.transition = 'transform .1s', 260);
    }
    lastTap = now;
  }, { passive: true });

  overlay.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      scale = Math.max(1, Math.min(5, startScale * (dist / startDist)));
      applyTransform();
    } else if (e.touches.length === 1 && scale > 1) {
      panX = e.touches[0].clientX - startPanX;
      panY = e.touches[0].clientY - startPanY;
      applyTransform();
    }
  }, { passive: false });

  // Single tap to close (only when not zoomed)
  overlay.addEventListener('click', e => {
    if (e.target === overlay && scale <= 1) closeImgOverlay();
  });

  window._imgOverlayOnce = isOnce;
}

function closeImgOverlay() {
  const overlay = document.getElementById('img-overlay');
  if (!overlay) return;
  overlay.remove();
  if (window._imgOverlayOnce && currentChatFriend)
    loadChatMessages(currentChatFriend.id, false);
  window._imgOverlayOnce = false;
  // Pop state si fue abierto con pushState
  if (history.state?.imgOverlay) history.back();
}

// Interceptar botón atrás del celular
window.addEventListener('popstate', e => {
  // Image overlay
  const imgOverlay = document.getElementById('img-overlay');
  if (imgOverlay) {
    imgOverlay.remove();
    if (window._imgOverlayOnce && currentChatFriend) loadChatMessages(currentChatFriend.id, false);
    window._imgOverlayOnce = false;
    return;
  }
  // Buscar overlay
  const buscarOverlay = document.getElementById('buscar-overlay');
  if (buscarOverlay && buscarOverlay.style.display !== 'none') {
    buscarOverlay.style.display = 'none';
    document.getElementById('buscar-feed').innerHTML = '';
    return;
  }
  // Default: go back one screen in the app
  if (currentScreen !== 'main' && currentScreen !== 'auth') {
    history.pushState(null, ''); // prevent leaving app
    goBack();
  }
});

// ══════════════════════════════════════════════════════════
//  AUDIO EN CHAT
// ══════════════════════════════════════════════════════════

let _mediaRecorder = null;
let _audioChunks = [];
let _audioBlob = null;
let _recTimer = null;
let _recSeconds = 0;

let _micLocked = false;
let _micStartY = 0;

async function micStart(e) {
  e.preventDefault();
  if (_mediaRecorder) return;
  _micLocked = false;
  _micStartY = (e.touches?.[0] || e).clientY;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    _audioChunks = [];
    _mediaRecorder = new MediaRecorder(stream);
    _mediaRecorder.ondataavailable = ev => { if (ev.data.size > 0) _audioChunks.push(ev.data); };
    _mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      if (_audioChunks.length) {
        _audioBlob = new Blob(_audioChunks, { type: 'audio/webm' });
        _showAudioPreview();
      }
    };
    _mediaRecorder.start();
    document.getElementById('mic-btn').classList.add('recording');
    document.getElementById('recording-bar').classList.add('show');
    _recSeconds = 0;
    _recTimer = setInterval(() => {
      _recSeconds++;
      const m = Math.floor(_recSeconds / 60), s = _recSeconds % 60;
      document.getElementById('rec-timer').textContent = `${m}:${s.toString().padStart(2,'0')}`;
      if (_recSeconds >= 120) _stopRecording(); // max 2 min
    }, 1000);
  } catch(e) {
    toast('Necesitás dar permiso al micrófono');
  }
}

function micMove(e) {
  if (!_mediaRecorder || _micLocked) return;
  const y = (e.touches?.[0] || e).clientY;
  const dy = _micStartY - y; // positivo = deslizó arriba
  const btn = document.getElementById('mic-btn');
  const bar = document.getElementById('recording-bar');
  if (dy > 50) {
    // Bloquear grabación
    _micLocked = true;
    btn.classList.remove('recording');
    btn.style.opacity = '0.3';
    // Cambiar bar a modo bloqueado con botón detener
    bar.innerHTML = `<div class="rec-dot"></div>
      <span style="flex:1">🔒 Grabando — tocá para detener</span>
      <span id="rec-timer">${document.getElementById('rec-timer')?.textContent || '0:00'}</span>
      <button onclick="_stopRecording()" style="background:rgba(255,255,255,.2);border:none;color:#fff;border-radius:20px;padding:6px 14px;font-size:13px;font-weight:700;cursor:pointer;margin-left:8px;font-family:'Outfit',sans-serif">■ Detener</button>`;
    if (navigator.vibrate) navigator.vibrate(40);
  } else if (dy < -30) {
    // Deslizó hacia abajo → cancelar
    _cancelRecording();
  } else {
    // Mostrar hint visual de cuánto falta para bloquear
    const pct = Math.max(0, Math.min(1, dy / 50));
    btn.style.transform = `translateY(-${dy > 0 ? dy * 0.4 : 0}px) scale(${1 + pct * 0.15})`;
  }
}

function micEnd(e) {
  if (!_mediaRecorder) return;
  e?.preventDefault?.();
  const btn = document.getElementById('mic-btn');
  btn.style.transform = '';
  if (_micLocked) return; // bloqueado → el usuario toca "Detener"
  // Soltó sin bloquear
  if (_recSeconds < 1) { _cancelRecording(); return; }
  _stopRecording();
}

function _stopRecording() {
  if (!_mediaRecorder || _mediaRecorder.state === 'inactive') return;
  clearInterval(_recTimer);
  const btn = document.getElementById('mic-btn');
  btn.classList.remove('recording');
  btn.style.opacity = '';
  btn.style.transform = '';
  document.getElementById('recording-bar').classList.remove('show');
  _mediaRecorder.stop();
  _mediaRecorder = null;
  _micLocked = false;
}

function _cancelRecording() {
  if (!_mediaRecorder) return;
  clearInterval(_recTimer);
  _audioChunks = []; // vaciar para que onstop no muestre preview
  const btn = document.getElementById('mic-btn');
  btn.classList.remove('recording');
  btn.style.opacity = '';
  btn.style.transform = '';
  document.getElementById('recording-bar').classList.remove('show');
  _mediaRecorder.stop();
  _mediaRecorder = null;
  _micLocked = false;
  toast('Audio cancelado');
}

function _showAudioPreview() {
  if (!_audioBlob) return;
  const url = URL.createObjectURL(_audioBlob);
  document.getElementById('audio-playback').src = url;
  const preview = document.getElementById('audio-preview');
  preview.style.display = 'flex';
  preview.style.alignItems = 'flex-end';
  const dur = _recSeconds;
  const durLabel = document.getElementById('audio-dur-label');
  if (durLabel) durLabel.textContent = `${dur}s grabado`;
}

function cancelAudio() {
  _audioBlob = null;
  _audioChunks = [];
  document.getElementById('audio-preview').style.display = 'none';
  const audio = document.getElementById('audio-playback');
  audio.pause(); audio.src = '';
  if (currentScreen === 'chat') setTimeout(() => document.getElementById('chat-inp').focus(), 50);
}

async function confirmSendAudio() {
  if (!_audioBlob || !currentChatFriend) return;
  // Ocultar preview inmediatamente para liberar la UI
  const preview = document.getElementById('audio-preview');
  preview.style.display = 'none';
  document.getElementById('audio-playback').pause();
  const blob = _audioBlob;
  const durSec = _recSeconds || 1;
  _audioBlob = null; _audioChunks = [];
  toast('Enviando audio...');
  try {
    // Subir a Supabase Storage
    const path = `audio/${ME.id}/${Date.now()}.webm`;
    const uploadRes = await fetch(
      `${CFG.SUPABASE_URL}/storage/v1/object/chat-media/${path}`,
      {
        method: 'POST',
        headers: {
          'apikey': CFG.SUPABASE_KEY,
          'Authorization': `Bearer ${CFG.SUPABASE_KEY}`,
          'Content-Type': 'audio/webm',
          'x-upsert': 'true',
        },
        body: blob,
      }
    );
    let audioUrl = '';
    if (uploadRes.ok) {
      audioUrl = `${CFG.SUPABASE_URL}/storage/v1/object/public/chat-media/${path}`;
    } else {
      // Fallback: convertir a base64 (límite ~5MB)
      audioUrl = await new Promise(res => {
        const r = new FileReader();
        r.onload = e => res(e.target.result);
        r.readAsDataURL(blob);
      });
    }
    // durSec ya capturado arriba
    await sb.post('messages', {
      from_id: ME.id,
      to_id: currentChatFriend.id,
      type: 'audio',
      content: audioUrl,
      reel_title: `${durSec}s`,  // duración capturada antes de reset
    });
    await loadChatMessages(currentChatFriend.id, true);
  } catch(e) {
    console.error('sendAudio', e);
    toast('Error al enviar audio');
  }
}

// Reproducir audio en burbuja
let _playingAudio = null;
function playBubAudio(msgId, url, btn) {
  if (_playingAudio && !_playingAudio.paused) {
    _playingAudio.pause();
    document.querySelectorAll('.bub-audio-btn').forEach(b => {
      b.innerHTML = playIcon();
    });
    if (_playingAudio.src.includes(msgId) || _playingAudio._msgId === msgId) {
      _playingAudio = null; return;
    }
  }
  const audio = new Audio(url);
  audio._msgId = msgId;
  _playingAudio = audio;
  btn.innerHTML = pauseIcon();
  audio.play().catch(() => { btn.innerHTML = playIcon(); });
  audio.onended = () => { btn.innerHTML = playIcon(); _playingAudio = null; };
}
function playIcon() { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><polygon points="5 3 19 12 5 21 5 3"/></svg>'; }
function pauseIcon() { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'; }

function buildMsgBubble(m, prev) {
  const isMe=m.from_id===ME.id, f=currentChatFriend;
  const side=isMe?'me':'them';
  const showName=!isMe&&(!prev||prev.from_id!==m.from_id);
  const safeText=(m.content||m.reel_title||'').slice(0,60).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,' ');
  let content='';
  if (m.type==='nudge') {
    const nudgeIsMe = isMe;
    content = `<div style="text-align:center;padding:8px 0;font-size:13px;color:var(--muted)">
      📳 ${nudgeIsMe ? 'Enviaste un zumbido' : escHtml(f.name) + ' te mandó un zumbido'}
    </div>`;
  } else if (m.type==='sticker') {
    content = `<div style="font-size:64px;line-height:1;padding:4px 0;user-select:none" title="${escHtml(m.reel_title||'')}">${escHtml(m.content||'')}</div>`;
  } else if (m.type==='image' || m.type==='image_once' || m.type==='image_seen') {
    const isOnce = m.type === 'image_once';
    const isSeen = m.type === 'image_seen';
    if (isOnce && !isMe) {
      content = `<div class="bub-img" style="position:relative;max-width:200px;height:160px;background:var(--s3);border-radius:14px;overflow:hidden">
        <img src="${escHtml(m.content||'')}" style="width:100%;height:100%;object-fit:cover;filter:blur(20px);transform:scale(1.1)" alt="">
        <div class="bub-img-once-overlay" onclick="openChatImage('${m.id}','${escHtml(m.content||'')}',true)">
          🔥<span style="font-size:13px;font-weight:700">Ver una vez</span>
        </div>
      </div>`;
    } else if (isSeen && !isMe) {
      content = `<div style="padding:10px 14px;background:var(--s2);border-radius:14px;font-size:12px;color:var(--muted)">🔥 Imagen vista</div>`;
    } else if (isOnce && isMe) {
      // Sender sees their own view-once as blurred too
      content = `<div class="bub-img" style="position:relative;max-width:200px;height:160px;background:var(--s3);border-radius:14px;overflow:hidden">
        <img src="${escHtml(m.content||'')}" style="width:100%;height:100%;object-fit:cover;filter:blur(20px);transform:scale(1.1)" alt="">
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:4px">
          <span style="font-size:22px">🔥</span>
          <span style="font-size:12px;font-weight:700;color:#fff">Enviaste: ver una vez</span>
        </div>
      </div>`;
    } else {
      content = `<div class="bub-img" onclick="openChatImage('${m.id}','${escHtml(m.content||'')}',false)" style="${isSeen&&isMe?'opacity:.5':''}">
        <img src="${escHtml(m.content||'')}" alt="imagen" loading="lazy" style="max-width:220px;max-height:300px;border-radius:14px;display:block">
      </div>`;
    }
  } else if (m.type==='audio') {
    const dur = m.reel_title || '';
    const safeUrl = escHtml(m.content||'');
    content = `<div class="bub-audio">
      <button class="bub-audio-btn" onpointerdown="event.preventDefault()" onclick="playBubAudio('${m.id}','${safeUrl}',this)">${playIcon()}</button>
      <div class="bub-audio-wave">
        <span></span><span></span><span></span><span></span><span></span><span></span>
      </div>
      <span class="bub-audio-time">${escHtml(dur)}</span>
    </div>`;
  } else if (m.type==='reel') {
    content=`<div class="bub-reel" onclick="openReelInApp('${m.reel_video_id||''}','${escHtml(m.reel_title||'').replace(/'/g,"\\'")}','${escHtml(m.reel_channel||'').replace(/'/g,"\\'")}')">
      <div class="bub-reel-thumb">
        ${m.reel_thumb?`<img src="${escHtml(m.reel_thumb)}" alt="" loading="lazy">`:'<div style="font-size:36px;display:flex;align-items:center;justify-content:center;height:100%">🎬</div>'}
        <div class="play-badge"><svg width="32" height="32" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="rgba(0,0,0,0.55)"/><polygon points="9.5 7 18 12 9.5 17" fill="#fff"/></svg></div>
      </div>
      <div class="bub-reel-body">
        <div class="bub-reel-title">${escHtml(m.reel_title||'Reel')}</div>
        <div class="bub-reel-ch">▶ ${escHtml(m.reel_channel||'')}</div>
      </div>
    </div>`;
  } else {
    // Fallback: detectar si el content es una URL de storage (audio/imagen enviada con tipo incorrecto)
    const c = m.content || '';
    const isStorageAudio = c.includes('/chat-media/audio/') || c.includes('/chat-media/audio%2F');
    const isStorageImg   = c.includes('/chat-media/chat/') || c.includes('/chat-media/chat%2F');
    if (isStorageAudio) {
      const safeUrl = escHtml(c);
      content = `<div class="bub-audio">
        <button class="bub-audio-btn" onpointerdown="event.preventDefault()" onclick="playBubAudio('${m.id}','${safeUrl}',this)">${playIcon()}</button>
        <div class="bub-audio-wave"><span></span><span></span><span></span><span></span><span></span><span></span></div>
        <span class="bub-audio-time">audio</span>
      </div>`;
    } else if (isStorageImg) {
      const safeUrl = escHtml(c);
      content = `<div class="bub-img" onclick="openChatImage('${m.id}','${safeUrl}',false)">
        <img src="${safeUrl}" alt="imagen" loading="lazy" style="max-width:220px;max-height:300px;border-radius:14px;display:block">
      </div>`;
    } else {
      const repl=m.reply_to_text?`<div class="reply-preview">↩ ${escHtml(m.reply_to_text)}</div>`:'';
      content=`${repl}<div class="bub">${escHtml(m.content||'')}</div>`;
    }
  }
  const reactions=m.reactions||[];
  let reactHtml='';
  if (reactions.length) {
    const g={};
    reactions.forEach(r=>{g[r.emoji]=(g[r.emoji]||[]).concat(r.user_id);});
    reactHtml=`<div class="reactions">${Object.entries(g).map(([emoji,users])=>{
      const mine=users.includes(ME.id);
      return `<div class="reaction-pill ${mine?'mine':''}" onclick="reactToMsg('${m.id}','${emoji}')">${emoji}${users.length>1?' '+users.length:''}</div>`;
    }).join('')}</div>`;
  }
  return `<div class="bubble-row ${side}" data-msg-id="${m.id}">
    ${!isMe?(f.avatar_url?`<img src="${escHtml(f.avatar_url)}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;flex-shrink:0;align-self:flex-end">`:`<div class="bubble-av" style="background:${f.color}33;color:${f.color}">${(f.name||'?')[0].toUpperCase()}</div>`):''}
    <div class="bubble-col">
      ${showName?`<div class="bubble-name">${escHtml(f.name)}</div>`:''}
      <div class="msg-swipe-wrap"
           data-mid="${m.id}" data-txt="${safeText}"
           ontouchstart="swipeStart(event,this)"
           ontouchmove="swipeMove(event,this)"
           ontouchend="swipeEnd(event,this)">${content}</div>
      ${reactHtml}
      <div class="bub-time">${formatTime(m.created_at)}</div>
    </div>
  </div>`;
}

async function sendMsg() {
  const inp = document.getElementById('chat-inp');
  const text = inp.value.trim();
  if (!text || !currentChatFriend) return;
  inp.value = ''; inp.style.height = 'auto';
  document.getElementById('send-msg-btn').disabled = true;
  await sb.post('messages', {
    from_id: ME.id, to_id: currentChatFriend.id,
    type: 'text', content: text,
    reply_to_id: replyTo?.msgId || null,
    reply_to_text: replyTo?.text || null
  }).catch(e => console.error(e));
  cancelReply();
  await loadChatMessages(currentChatFriend.id, true);
  // Re-enfocar sin parpadeo usando rAF
  requestAnimationFrame(() => inp.focus());
}

async function sendReelMsg(toId, video) {
  await sb.post('messages',{ from_id:ME.id, to_id:toId, type:'reel', content:null, reel_video_id:video.id, reel_title:video.title, reel_thumb:video.thumb, reel_channel:video.channel, reel_embed_url:video.embedUrl }).catch(e=>console.error(e));
  if (currentChatFriend?.id===toId) await loadChatMessages(toId, true);
}

function chatKeydown(e) { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMsg();} }
function autoResize(el) { el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,120)+'px'; }

// ── Swipe-to-reply + Long-press reactions ─────────────────────────────
let _lpTimer = null, _swipeStartX = 0, _swipeStartY = 0;
let _swipeSwiping = false, _swipeTriggered = false;
const SWIPE_THRESHOLD = 55; // px hacia la derecha para activar reply

function swipeStart(e, el) {
  const t = e.touches[0];
  _swipeStartX = t.clientX;
  _swipeStartY = t.clientY;
  _swipeSwiping = false;
  _swipeTriggered = false;
  el.style.transition = 'none';
  // Long press
  const mid = el.dataset.mid, txt = el.dataset.txt;
  _lpTimer = setTimeout(() => {
    _swipeTriggered = true;
    openMsgMenu(mid, txt);
  }, 500);
}

function swipeMove(e, el) {
  const t = e.touches[0];
  const dx = t.clientX - _swipeStartX;
  const dy = Math.abs(t.clientY - _swipeStartY);
  if (dy > 15) { clearTimeout(_lpTimer); return; } // vertical scroll → cancel
  if (Math.abs(dx) > 8) { clearTimeout(_lpTimer); _swipeSwiping = true; }
  if (_swipeSwiping && dx > 0 && dx <= SWIPE_THRESHOLD + 10) {
    el.style.transform = `translateX(${Math.min(dx, SWIPE_THRESHOLD + 10)}px)`;
  }
  if (dx >= SWIPE_THRESHOLD && !_swipeTriggered) {
    _swipeTriggered = true;
    if (navigator.vibrate) navigator.vibrate(30);
    const mid = el.dataset.mid, txt = el.dataset.txt;
    openMsgMenu(mid, txt, true); // true = es reply, no abrir emoji
  }
}

function swipeEnd(e, el) {
  clearTimeout(_lpTimer);
  el.style.transition = 'transform 0.25s ease';
  el.style.transform = 'translateX(0)';
}
function openMsgMenu(mid, txt) {
  emojiTargetMsgId = mid;
  replyTo = { msgId:mid, text:txt };
  document.getElementById('reply-bar-text').textContent = txt || 'Mensaje';
  document.getElementById('reply-bar').classList.add('show');
  document.getElementById('emoji-picker').classList.add('show');
  document.getElementById('emoji-backdrop').style.display = 'block';
}
function cancelReply(){
  replyTo=null; emojiTargetMsgId=null;
  document.getElementById('reply-bar').classList.remove('show');
  document.getElementById('emoji-picker').classList.remove('show');
  document.getElementById('emoji-backdrop').style.display = 'none';
}

async function reactToMsg(msgId, emoji) {
  cancelReply(); // cierra picker + backdrop + reply-bar
  if (!msgId || !ME) return;
  try {
    // Intentar insertar; si ya existe (duplicate), borrar (toggle)
    await sb.post('reactions', { message_id:msgId, user_id:ME.id, emoji });
  } catch(e) {
    // Duplicate → toggle off
    await sb.del('reactions', `?message_id=eq.${msgId}&user_id=eq.${ME.id}&emoji=eq.${encodeURIComponent(emoji)}`).catch(()=>{});
  }
  if (currentChatFriend) await loadChatMessages(currentChatFriend.id, false);
}

async function pickEmoji(emoji) {
  const mid = emojiTargetMsgId;
  cancelReply(); // limpia estado antes de async
  if (!mid) return;
  await reactToMsg(mid, emoji);
}

// Cerrar picker al tocar fuera — solo con touch/click real, no sintético
let pickerJustOpened = false;
const origOpenMsgMenu = openMsgMenu;
function openMsgMenu(mid, txt, replyOnly=false) {
  emojiTargetMsgId = mid;
  replyTo = { msgId:mid, text:txt };
  document.getElementById('reply-bar-text').textContent = txt || 'Mensaje';
  document.getElementById('reply-bar').classList.add('show');
  if (!replyOnly) {
    document.getElementById('emoji-picker').classList.add('show');
    document.getElementById('emoji-backdrop').style.display = 'block';
    pickerJustOpened = true;
    setTimeout(() => { pickerJustOpened = false; }, 400);
  }
}

// ══════════════════════════════════════════════════════════
//  PERFIL
// ══════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════
//  BUSCAR — grid de descubrimiento infinito
// ══════════════════════════════════════════════════════════

// Pool amplio de etiquetas/temas variados
const BUSCAR_POOL = [
  'humor parejas', 'migajeros meme', 'red flags pareja', 'novios chistosos',
  'gym workout', 'ejercicio motivacion', 'rutina fitness', 'crossfit shorts',
  'memes argentina', 'viral tiktok argentina', 'humor rioplatense', 'cringe viral',
  'cocina rapida', 'recetas faciles', 'comida viral', 'foodie shorts',
  'baile challenge', 'coreografia viral', 'dance shorts', 'perreo viral',
  'futbol goles', 'highlights futbol', 'neymar skills', 'messi moments',
  'tecnologia gadgets', 'iphone tips', 'android trucos', 'tech review shorts',
  'viajes aventura', 'lugares increibles', 'travel viral', 'paisajes hermosos',
  'animales graciosos', 'perros chistosos', 'gatos virales', 'mascotas tiernas',
  'musica viral', 'covers increibles', 'cantantes virales', 'hits 2025',
  'motivacion frases', 'reflexion vida', 'consejos autoayuda', 'mindset exitoso',
  'deporte extremo', 'adrenalina deportes', 'skate tricks', 'bmx shorts',
  'maquillaje tutorial', 'beauty tips', 'transformacion makeup', 'skincare rutina',
  'chistes humor negro', 'standout comedy', 'fails compilation', 'prank viral',
  'lali esposito', 'bizarrap music sessions', 'tini stoessel', 'bad bunny shorts',
  'boxeo highlights', 'ufc knockouts', 'wrestling viral', 'deporte combate',
  'fotos transformacion', 'glow up viral', 'antes despues viral', 'cambio extremo',
];

let _buscarQuery = '';
let _buscarVideos = [];
let _buscarLoading = false;
let _buscarPageToken = '';
let _buscarDone = false;
let _buscarSeenIds = new Set();

async function onBuscarInput(val) {
  _buscarQuery = val.trim();
  document.getElementById('buscar-clear').style.display = val ? 'block' : 'none';
  clearTimeout(onBuscarInput._t);
  onBuscarInput._t = setTimeout(() => loadBuscarGrid(true), 500);
}

function clearBuscar() {
  document.getElementById('buscar-inp').value = '';
  _buscarQuery = '';
  document.getElementById('buscar-clear').style.display = 'none';
  loadBuscarGrid();
}

// Build an ordered queue of queries: interests first, then shuffled pool
function _buildBuscarQueue() {
  const interests = getUserInterests().slice(0,8);
  const shuffled = [...BUSCAR_POOL].sort(() => Math.random() - 0.5);
  // Interleave interests with pool so we get variety
  const mixed = [];
  let pi = 0;
  for (let i = 0; i < Math.max(interests.length * 2, shuffled.length); i++) {
    if (i % 3 === 0 && interests[Math.floor(i/3)]) mixed.push(interests[Math.floor(i/3)] + ' shorts');
    else if (pi < shuffled.length) mixed.push(shuffled[pi++] + ' shorts');
  }
  while (pi < shuffled.length) mixed.push(shuffled[pi++] + ' shorts');
  return mixed;
}

let _buscarQueue = [];
let _buscarQueueIdx = 0;

async function loadBuscarGrid(reset=false) {
  if (_buscarLoading) return;
  if (reset) {
    _buscarVideos = []; _buscarSeenIds = new Set();
    _buscarDone = false; _buscarQueue = [];  _buscarQueueIdx = 0;
    const grid = document.getElementById('buscar-grid');
    if (grid) grid.innerHTML = '';
  }
  if (_buscarDone) return;
  _buscarLoading = true;

  const grid = document.getElementById('buscar-grid');
  if (!grid) { _buscarLoading = false; return; }

  // Show loader at bottom (or full screen if empty)
  let loader = document.getElementById('buscar-loader');
  if (!loader) {
    loader = document.createElement('div');
    loader.id = 'buscar-loader';
    loader.style.cssText = 'padding:20px;text-align:center;grid-column:1/-1';
    loader.innerHTML = '<div class="spinner" style="margin:0 auto;width:24px;height:24px"></div>';
    grid.querySelector('.buscar-inner')?.appendChild(loader) || grid.appendChild(loader);
  }

  try {
    // Build queries if not built yet
    if (!_buscarQueue.length) {
      _buscarQueue = _buscarQuery ? [_buscarQuery + ' shorts'] : _buildBuscarQueue();
    }

    // Fetch a batch of ~10 videos
    const batchSize = 10;
    const newVideos = [];
    while (newVideos.length < batchSize && _buscarQueueIdx < _buscarQueue.length) {
      const q = _buscarQueue[_buscarQueueIdx++];
      const vids = await _buscarFetchBatch(q, 3);
      newVideos.push(...vids);
      if (newVideos.length >= batchSize) break;
    }

    if (!newVideos.length) { _buscarDone = true; loader.remove(); _buscarLoading = false; return; }

    const startIdx = _buscarVideos.length;
    _buscarVideos.push(...newVideos);

    // Ensure grid container exists
    let inner = grid.querySelector('.buscar-inner');
    if (!inner) {
      inner = document.createElement('div');
      inner.className = 'buscar-inner';
      inner.style.cssText = 'display:grid;grid-template-columns:repeat(2,1fr);gap:6px;padding:4px';
      grid.innerHTML = '';
      grid.appendChild(inner);
    }

    loader.remove();

    // Append new cards
    newVideos.forEach((v, i) => {
      const idx = startIdx + i;
      const card = document.createElement('div');
      card.style.cssText = 'position:relative;aspect-ratio:9/16;border-radius:12px;overflow:hidden;background:var(--s2);cursor:pointer';
      card.innerHTML = `
        <img src="${escHtml(v.thumb)}" alt="" style="width:100%;height:100%;object-fit:cover" loading="lazy">
        <div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.8) 0%,transparent 55%)"></div>
        <div style="position:absolute;bottom:0;left:0;right:0;padding:8px">
          <div style="font-size:11px;font-weight:600;color:#fff;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${escHtml(v.title)}</div>
          <div style="font-size:10px;color:rgba(255,255,255,.55);margin-top:2px">${escHtml(v.channel)}</div>
        </div>`;
      card.addEventListener('click', () => openBuscarVideo(idx));
      inner.appendChild(card);
    });

    // Sentinel for infinite scroll
    const sentinel = document.createElement('div');
    sentinel.id = 'buscar-sentinel';
    sentinel.style.height = '1px';
    inner.appendChild(sentinel);
    new IntersectionObserver(([e]) => { if(e.isIntersecting) loadBuscarGrid(); }, {root:grid,threshold:0.1}).observe(sentinel);

  } catch(e) { console.error('buscar', e); }
  _buscarLoading = false;
}

async function _buscarFetchBatch(query, count=3) {
  try {
    const key = getYTKey();
    const p = new URLSearchParams({ part:'snippet', q:query, type:'video',
      videoDuration:'short', videoEmbeddable:'true', maxResults: count + 2,
      regionCode:'AR', relevanceLanguage:'es', key });
    const r = await fetch(`https://www.googleapis.com/youtube/v3/search?${p}`);
    if (!r.ok) { if(r.status===403) rotateYTKey(); return []; }
    const data = await r.json();
    return (data.items||[])
      .map(i => i.id?.videoId).filter(id => id && !_buscarSeenIds.has(id))
      .slice(0, count)
      .map(id => {
        _buscarSeenIds.add(id);
        const item = data.items.find(i => i.id?.videoId === id);
        return {
          id, query,
          title: item?.snippet?.title || '',
          channel: item?.snippet?.channelTitle || '',
          thumb: item?.snippet?.thumbnails?.high?.url || item?.snippet?.thumbnails?.medium?.url || '',
        };
      });
  } catch { return []; }
}

async function openBuscarVideo(idx) {
  const v = _buscarVideos[idx];
  if (!v) return;

  history.pushState({ buscarOverlay: true }, '');

  const overlay = document.getElementById('buscar-overlay');
  overlay.style.display = 'flex';
  document.getElementById('buscar-overlay-title').textContent =
    (v.query||'').replace(/ shorts$/i,'').replace(/\w/g, c=>c.toUpperCase()) || v.title;

  const feed = document.getElementById('buscar-feed');
  feed.innerHTML = '<div class="reel"><div class="reel-loader"><div class="spinner"></div><p>Cargando...</p></div></div>';

  try {
    const key = getYTKey();
    const q = v.query || v.title + ' shorts';
    const p = new URLSearchParams({ part:'snippet', q, type:'video',
      videoDuration:'short', videoEmbeddable:'true', maxResults:15,
      regionCode:'AR', relevanceLanguage:'es', key });
    const r = await fetch(`https://www.googleapis.com/youtube/v3/search?${p}`);
    if (!r.ok) throw new Error('YT error');
    const data = await r.json();
    const seenB = new Set();
    const ids = (data.items||[]).map(i=>i.id?.videoId).filter(id=>id&&!seenB.has(id));
    if (!ids.length) { feed.innerHTML = '<p style="padding:40px;text-align:center;color:var(--muted)">Sin videos</p>'; return; }
    const det = await ytDetails(ids);
    const videos = det.filter(x=>parseDur(x.contentDetails?.duration)<=180).map(x=>{
      seenB.add(x.id);
      return { id:x.id, title:x.snippet.title, channel:x.snippet.channelTitle,
        thumb:x.snippet.thumbnails?.high?.url||'', views:parseInt(x.statistics?.viewCount||0), source:'youtube' };
    });
    feed.innerHTML = '';
    videos.forEach(vid => feed.appendChild(buildReelEl(vid)));
    feed.scrollTop = 0;
  } catch(e) { console.error('buscar open', e); }
}

function closeBuscarOverlay() {
  const overlay = document.getElementById('buscar-overlay');
  if (!overlay || overlay.style.display === 'none') return;
  overlay.style.display = 'none';
  document.getElementById('buscar-feed').innerHTML = '';
  if (history.state?.buscarOverlay) history.back();
}

// ══════════════════════════════════════════════════════════
//  FOTO DE PERFIL
// ══════════════════════════════════════════════════════════

async function uploadProfilePhoto(file) {
  if (!file || !ME) return;
  if (file.size > 5 * 1024 * 1024) { toast('Imagen muy grande (máx 5MB)'); return; }
  toast('Subiendo foto...');
  try {
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `avatars/${ME.id}.${ext}`;
    const res = await fetch(
      `${CFG.SUPABASE_URL}/storage/v1/object/chat-media/${path}`,
      { method:'POST', headers:{ 'apikey':CFG.SUPABASE_KEY, 'Authorization':`Bearer ${CFG.SUPABASE_KEY}`, 'Content-Type':file.type, 'x-upsert':'true' }, body:file }
    );
    if (!res.ok) throw new Error('Upload failed');
    const avatarUrl = `${CFG.SUPABASE_URL}/storage/v1/object/public/chat-media/${path}?t=${Date.now()}`;
    await sb.patch('profiles', `?id=eq.${ME.id}`, { avatar_url: avatarUrl });
    ME.avatar_url = avatarUrl;
    localStorage.setItem('isx_session', JSON.stringify(ME));
    toast('✓ Foto actualizada');
    renderPerfil();
    // Update chat header if open
    _updateAvatarInUI();
  } catch(e) { console.error('avatar upload', e); toast('Error al subir la foto'); }
}

function _updateAvatarInUI() {
  // Update chat header avatar
  const av = document.getElementById('chat-hdr-av');
  if (av && ME.avatar_url) {
    av.innerHTML = `<img src="${ME.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  }
}

// Helper to render any user avatar (with photo or initials)
function renderAvatar(user, size=38) {
  if (user?.avatar_url) {
    return `<img src="${escHtml(user.avatar_url)}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;flex-shrink:0;border:1.5px solid ${user.color||'#ff2d55'}55">`;
  }
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${user?.color||'#ff2d55'}33;color:${user?.color||'#ff2d55'};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:${Math.round(size*0.45)}px;flex-shrink:0">${(user?.name||'?')[0].toUpperCase()}</div>`;
}


// ══════════════════════════════════════════════════════════
//  STICKERS
// ══════════════════════════════════════════════════════════

const STICKERS = [
  {id:'s1',e:'😂',l:'jajaja'},{id:'s2',e:'🥹',l:'ay dios'},{id:'s3',e:'💀',l:'me mataste'},
  {id:'s4',e:'🔥',l:'fuego'},{id:'s5',e:'😭',l:'llorando'},{id:'s6',e:'🤌',l:'perfecto'},
  {id:'s7',e:'👀',l:'ojooo'},{id:'s8',e:'🫠',l:'derretido'},{id:'s9',e:'🤡',l:'payaso'},
  {id:'s10',e:'😤',l:'serio'},{id:'s11',e:'🥵',l:'caliente'},{id:'s12',e:'🤣',l:'rotfl'},
  {id:'s13',e:'😍',l:'enamorado'},{id:'s14',e:'🫶',l:'te quiero'},{id:'s15',e:'💅',l:'please'},
  {id:'s16',e:'🙄',l:'obvio'},{id:'s17',e:'😌',l:'tranqui'},{id:'s18',e:'🤯',l:'mente rota'},
  {id:'s19',e:'💔',l:'me rompiste'},{id:'s20',e:'✨',l:'brillante'},{id:'s21',e:'😈',l:'diablito'},
  {id:'s22',e:'🥳',l:'a festejar'},{id:'s23',e:'🙈',l:'no vi nada'},{id:'s24',e:'🫡',l:'a sus ordenes'},
];

let _stickerPanelOpen = false;

function toggleStickerPanel() {
  _stickerPanelOpen = !_stickerPanelOpen;
  const panel = document.getElementById('sticker-panel');
  const btn = document.getElementById('sticker-btn');
  if (_stickerPanelOpen) {
    // Populate grid here (STICKERS is guaranteed defined at this point)
    const grid = document.getElementById('sticker-grid');
    if (grid && !grid.children.length) {
      grid.innerHTML = STICKERS.map(s =>
        `<button class="stk-item" onpointerdown="event.preventDefault()" onclick="sendSticker('${s.id}')">
          <span class="stk-emoji">${s.e}</span>
          <span class="stk-label">${s.l}</span>
        </button>`
      ).join('');
    }
    panel.classList.add('show');
    if (btn) btn.style.color = 'var(--acc)';
    setTimeout(() => {
      document.addEventListener('touchstart', _closeStickerOutside, {once:true, passive:true});
    }, 100);
  } else {
    closeStickerPanel();
  }
}

function _closeStickerOutside(e) {
  const panel = document.getElementById('sticker-panel');
  const btn = document.getElementById('sticker-btn');
  if (panel && !panel.contains(e.target) && e.target !== btn) closeStickerPanel();
}

function closeStickerPanel() {
  _stickerPanelOpen = false;
  document.getElementById('sticker-panel')?.classList.remove('show');
  const btn = document.getElementById('sticker-btn');
  if (btn) btn.style.color = '';
}

async function sendSticker(sid) {
  if (!currentChatFriend || !ME) return;
  const sticker = STICKERS.find(s => s.id === sid);
  if (!sticker) return;
  closeStickerPanel();
  try {
    await sb.post('messages', {
      from_id: ME.id, to_id: currentChatFriend.id,
      type: 'sticker', content: sticker.e, reel_title: sticker.l,
    });
    await loadChatMessages(currentChatFriend.id, true);
    requestAnimationFrame(() => document.getElementById('chat-inp')?.focus());
  } catch(e) { console.error('sticker', e); }
}

// ══════════════════════════════════════════════════════════
//  TEMAS DE COLOR
// ══════════════════════════════════════════════════════════
const THEMES = {
  dark:   { name:'Oscuro',    icon:'⬛', desc:'Clásico',     bg:'#050507', s1:'#0e0e12', s2:'#17171d', s3:'#202028', s4:'#2a2a35', acc:'#ff2d55', text:'#f0f0f5', muted:'#8e8e9e', border:'rgba(255,255,255,0.08)' },
  pink:   { name:'Rosa',      icon:'🌸', desc:'Femenino',    bg:'#120010', s1:'#1e0018', s2:'#2a0022', s3:'#36002e', s4:'#44003c', acc:'#ff4da6', text:'#ffe6f4', muted:'#bf6090', border:'rgba(255,77,166,0.18)' },
  ocean:  { name:'Océano',    icon:'🌊', desc:'Profundo',    bg:'#00060f', s1:'#001020', s2:'#001830', s3:'#002040', s4:'#003050', acc:'#00b4ff', text:'#d0eeff', muted:'#4488aa', border:'rgba(0,180,255,0.15)' },
  forest: { name:'Bosque',    icon:'🌿', desc:'Natural',     bg:'#010a03', s1:'#031508', s2:'#051e0c', s3:'#082811', s4:'#0c3416', acc:'#1fd860', text:'#d0ffd8', muted:'#40996a', border:'rgba(31,216,96,0.14)' },
  sunset: { name:'Atardecer', icon:'🌅', desc:'Cálido',      bg:'#0d0300', s1:'#1a0800', s2:'#260f00', s3:'#321600', s4:'#401e00', acc:'#ff7700', text:'#fff0d8', muted:'#bb7744', border:'rgba(255,119,0,0.15)' },
  matrix: { name:'Matrix',    icon:'💚', desc:'Hacker',      bg:'#000000', s1:'#001200', s2:'#001a00', s3:'#002500', s4:'#003000', acc:'#00ff41', text:'#bbffcc', muted:'#339944', border:'rgba(0,255,65,0.14)' },
};

function applyTheme(key) {
  const t = THEMES[key] || THEMES.dark;
  const r = document.documentElement.style;
  r.setProperty('--bg', t.bg); r.setProperty('--s1', t.s1); r.setProperty('--s2', t.s2);
  r.setProperty('--s3', t.s3); r.setProperty('--s4', t.s4); r.setProperty('--acc', t.acc);
  r.setProperty('--text', t.text); r.setProperty('--muted', t.muted); r.setProperty('--border', t.border);
  localStorage.setItem('isx_theme_' + (ME?.id||'guest'), key);
  document.getElementById('meta-theme')?.setAttribute('content', t.bg);
}

function loadSavedTheme() {
  const saved = localStorage.getItem('isx_theme_' + (ME?.id||'guest'));
  if (saved && THEMES[saved]) applyTheme(saved);
}


function renderPerfil() {
  if (!ME) return;
  const c = document.getElementById('perfil-scroll');
  const saved = Object.values(savedVideos);
  const currentTheme = localStorage.getItem('isx_theme_' + ME.id) || 'dark';

  const themeButtons = Object.entries(THEMES).map(([key, t]) => {
    const active = key === currentTheme;
    return `<button onclick="applyTheme('${key}');renderPerfil()" style="
      position:relative;flex:none;width:calc(33.3% - 6px);aspect-ratio:1;border-radius:16px;
      background:${t.bg};border:2px solid ${active ? t.acc : 'rgba(255,255,255,0.06)'};
      cursor:pointer;font-family:'Outfit',sans-serif;overflow:hidden;
      box-shadow:${active ? `0 0 16px ${t.acc}55` : 'none'};transition:all .2s;
    ">
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:8px">
        <span style="font-size:24px">${t.icon}</span>
        <span style="font-size:11px;font-weight:700;color:${t.text}">${t.name}</span>
        <span style="font-size:10px;color:${t.muted}">${t.desc}</span>
      </div>
      <div style="position:absolute;bottom:0;left:0;right:0;height:3px;background:${t.acc};opacity:${active?1:.3}"></div>
      ${active ? `<div style="position:absolute;top:6px;right:6px;width:8px;height:8px;border-radius:50%;background:${t.acc};box-shadow:0 0 6px ${t.acc}"></div>` : ''}
    </button>`;
  }).join('');

  const avatarHtml = ME.avatar_url
    ? `<img src="${escHtml(ME.avatar_url)}" style="width:70px;height:70px;border-radius:50%;object-fit:cover;border:2px solid ${ME.color||'#ff2d55'}55">`
    : `<div class="perfil-av-big" style="background:${ME.color||'#ff2d55'}33;color:${ME.color||'#ff2d55'}">${(ME.name||'U')[0].toUpperCase()}</div>`;

  c.innerHTML = `
    <div class="perfil-hdr">
      <div style="position:relative;cursor:pointer" onclick="document.getElementById('avatar-input').click()">
        ${avatarHtml}
        <div style="position:absolute;bottom:0;right:0;width:22px;height:22px;border-radius:50%;background:var(--acc);display:flex;align-items:center;justify-content:center;font-size:12px;border:2px solid var(--bg)">📷</div>
      </div>
      <input type="file" id="avatar-input" accept="image/*" style="display:none" onchange="uploadProfilePhoto(this.files[0]);this.value=''">
      <div>
        <div class="perfil-name">${escHtml(ME.name)}</div>
        <div class="perfil-username">@${escHtml(ME.username)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">Tocá la foto para cambiarla</div>
      </div>
    </div>
    <div class="perfil-stats">
      <div class="pstat"><div class="pstat-n">${Object.keys(likedVideos).length}</div><div class="pstat-l">Likes</div></div>
      <div class="pstat"><div class="pstat-n">${saved.length}</div><div class="pstat-l">Guardados</div></div>
      <div class="pstat"><div class="pstat-n">${friends.length}</div><div class="pstat-l">Amigos</div></div>
    </div>
    ${saved.length ? `<div class="section-lbl">Guardados</div><div class="perfil-saved">${saved.slice(0,9).map(v=>`<div class="saved-th" onclick="openYT('${v.videoId}')">${v.thumb?`<img src="${escHtml(v.thumb)}" alt="" loading="lazy">`:'🎬'}</div>`).join('')}</div>` : ''}
    <div class="section-lbl" style="margin-top:20px">🎨 Tema de color</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px">${themeButtons}</div>
    <button class="perfil-out-btn" onclick="logout()">Cerrar sesión</button>
  `;
}


// ══════════════════════════════════════════════════════════
//  PUSH NOTIFICATIONS

// ══════════════════════════════════════════════════════════
//  ZUMBIDO MSN
// ══════════════════════════════════════════════════════════

// Sonido del zumbido generado con Web Audio API (sin archivos externos)
function playNudgeSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;
    // Doble pulso tipo "nudge" clásico de MSN
    [0, 0.12, 0.24].forEach((delay, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(220 + i * 60, t + delay);
      osc.frequency.exponentialRampToValueAtTime(110 + i * 30, t + delay + 0.08);
      gain.gain.setValueAtTime(0.35, t + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.1);
      osc.start(t + delay); osc.stop(t + delay + 0.12);
    });
  } catch(e) {}
}

// Agitar toda la pantalla
function shakeScreen() {
  const app = document.body;
  app.classList.remove('msn-shake');
  void app.offsetWidth; // reflow
  app.classList.add('msn-shake');
  app.addEventListener('animationend', () => app.classList.remove('msn-shake'), { once: true });
}

// Cooldown para no spamear el zumbido (5 segundos)
let _nudgeCooldown = false;

async function sendNudge() {
  if (!currentChatFriend || !ME) return;
  if (_nudgeCooldown) { toast('Esperá un momento antes de volver a zumbar 😄'); return; }
  _nudgeCooldown = true;
  setTimeout(() => { _nudgeCooldown = false; }, 5000);

  // Animar botón
  const btn = document.getElementById('nudge-btn');
  if (btn) { btn.classList.add('fired'); setTimeout(() => btn.classList.remove('fired'), 600); }

  // Guardar nudge como mensaje especial en la DB
  try {
    await sb.post('messages', {
      from_id: ME.id,
      to_id: currentChatFriend.id,
      type: 'nudge',
      content: '📳 zumbido',
    });
    await loadChatMessages(currentChatFriend.id, true);
    // El Edge Function se encarga de notificar al receptor
    // Pero también notificar al SW local por si está minimizada
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'NUDGE', senderName: ME.name
      });
    }
  } catch(e) { console.error('nudge', e); }
}

// Recibir zumbido — se llama desde checkNewMessages
function receiveNudge(sender) {
  shakeScreen();
  playNudgeSound();
  if (navigator.vibrate) navigator.vibrate([80, 40, 80, 40, 120]);
  toast(`📳 ${sender.name} te mandó un zumbido!`);
}

// ══════════════════════════════════════════════════════════
//  NOTIFICACIONES DEL BROWSER
// ══════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════
//  WEB PUSH — notificaciones reales incluso con app cerrada
// ══════════════════════════════════════════════════════════
const VAPID_PUBLIC_KEY = 'BDM_QhO9JkK2CuDeJCAsWQ3bhg1N1uz-KgtCt1iATny_CR1HSgt3-bMv8fVAkYB5dKx8jZuzi1-swcc_d6dvF8M';

function canNotify() {
  return 'Notification' in window && Notification.permission === 'granted';
}

// Notificar inmediatamente via SW (funciona con app minimizada/cerrada)
function showBrowserNotif(title, body, fromId, tag='msg') {
  if (!canNotify()) return;
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'SHOW_NOTIF', title, body, tag, fromId
    });
  }
}

// Registrar SW y suscribirse a Web Push
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
  } catch(e) { console.warn('[SW]', e); }
}

// Suscribir al usuario a Web Push y guardar suscripción en Supabase
async function subscribeToPush() {
  if (!ME || !canNotify()) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    // Verificar si ya existe suscripción
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      // Crear nueva suscripción
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    // Guardar/actualizar en Supabase
    await sb.post('push_subscriptions', {
      user_id: ME.id,
      subscription: JSON.stringify(sub.toJSON()),
    }).catch(async () => {
      // Si ya existe, actualizar
      await sb.patch('push_subscriptions', `?user_id=eq.${ME.id}`, {
        subscription: JSON.stringify(sub.toJSON())
      });
    });
    console.log('[Push] Suscripción guardada ✓');
  } catch(e) { console.warn('[Push] Error al suscribir:', e); }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// Sincronizar sesión al SW para que pueda hacer polling con app cerrada
function syncSessionToSW() {
  if (!ME || !('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return;
  navigator.serviceWorker.controller.postMessage({
    type: 'SYNC_SESSION',
    userId: ME.id,
    supabaseUrl: CFG.SUPABASE_URL,
    supabaseKey: CFG.SUPABASE_KEY,
    lastCheck: lastMsgCheck,
  });
}
// ── Escuchar mensajes del Service Worker ─────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', e => {
    const data = e.data;
    if (!data) return;
    // SW detectó zumbido cuando la app estaba en background
    if (data.type === 'NUDGE_RECEIVED') {
      const sender = friends.find(f => f.id === data.fromId);
      if (sender) receiveNudge(sender);
      else { shakeScreen(); playNudgeSound(); toast('📳 Zumbido!'); }
    }
    // SW detectó mensajes nuevos — refrescar si corresponde
    if (data.type === 'NEW_MESSAGES' && ME) {
      if (currentScreen === 'chat' && currentChatFriend) {
        loadChatMessages(currentChatFriend.id, false);
      } else {
        checkNewMessages();
      }
    }
  });
}



async function requestNotifPermission() {
  dismissNotifBanner();
  if (!('Notification' in window)) {
    toast('Tu browser no soporta notificaciones');
    return;
  }
  try {
    const perm = await new Promise(resolve => {
      const result = Notification.requestPermission(resolve);
      if (result && typeof result.then === 'function') result.then(resolve);
    });
    if (perm === 'granted') {
      toast('🔔 Notificaciones activadas ✓');
      await subscribeToPush(); // Suscribir a Web Push para notifs con app cerrada
    } else if (perm === 'denied') {
      toast('Notificaciones bloqueadas en el browser');
    } else {
      toast('Podés activarlas desde la configuración del browser');
    }
  } catch(e) {
    console.warn('Notif permission error:', e);
    toast('No se pudo solicitar permiso');
  }
}

function dismissNotifBanner() {
  const banner = document.getElementById('notif-banner');
  if (!banner) return;
  banner.classList.remove('show');
  // Guardar decisión para no volver a preguntar
  localStorage.setItem('isx_notif_asked', '1');
}

function maybeAskNotifPermission() {
  // Solo mostrar si: el browser soporta notifs, no preguntó antes, y el permiso es default
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'default') return;
  if (localStorage.getItem('isx_notif_asked')) return;
  // Mostrar banner a los 4 segundos — suave, no invasivo
  setTimeout(() => {
    const banner = document.getElementById('notif-banner');
    if (banner) banner.classList.add('show');
  }, 4000);
}

// ══════════════════════════════════════════════════════════
async function checkNewMessages() {
  if (!ME) return;
  try {
    const msgs = await sb.get('messages', `?to_id=eq.${ME.id}&created_at=gt.${encodeURIComponent(lastMsgCheck)}&select=id,from_id,type,content,reel_title,reel_thumb&order=created_at.asc&limit=10`);
    if (!msgs.length) return;
    lastMsgCheck = new Date().toISOString();

    for (const msg of msgs) {
      const sender = friends.find(f => f.id === msg.from_id);
      if (!sender) continue;

      if (msg.type === 'nudge') {
        // Zumbido: agitar pantalla + sonido, solo si no estamos ya en ese chat
        const inChat = currentScreen === 'chat' && currentChatFriend?.id === msg.from_id;
        receiveNudge(sender);
        if (inChat) await loadChatMessages(sender.id, true);
        // Notif browser
        showBrowserNotif(`📳 ${sender.name}`, '¡Te mandó un zumbido!', sender.id, 'nudge');
      } else {
        // Mensaje normal
        const inThisChat = currentScreen === 'chat' && currentChatFriend?.id === msg.from_id;
        if (inThisChat) {
          // Estamos en ese chat — solo recargar mensajes
          await loadChatMessages(sender.id, true);
        } else {
          // No estamos en ese chat — notificar siempre
          unreadConvs.add(msg.from_id);
          showPush(sender, msg);
          updateMsgBadge();
          const notifText = msg.type === 'reel'
            ? `🎬 ${msg.reel_title || 'Te mandó un reel'}`
            : (msg.content || '').slice(0, 80);
          showBrowserNotif(sender.name, notifText, sender.id, 'msg');
        }
      }
      break;
    }
  } catch(e) { console.error('checkNewMessages', e); }
  syncSessionToSW(); // mantener SW actualizado para polling con app cerrada
}

function showPush(sender, msg) {
  const push=document.getElementById('push');
  const av=document.getElementById('push-av');
  Object.assign(av.style,{background:sender.color+'33',color:sender.color,fontSize:'18px',fontWeight:'700',width:'38px',height:'38px',borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:'0'});
  av.textContent=(sender.name||'?')[0].toUpperCase();
  document.getElementById('push-from').textContent=sender.name;
  const text=msg.type==='reel'?`🎬 ${(msg.reel_title||'Te mandó un reel').slice(0,50)}`:(msg.content||'').slice(0,60);
  document.getElementById('push-text').textContent=text;
  const thumb=document.getElementById('push-thumb');
  thumb.innerHTML=msg.reel_thumb?`<img src="${msg.reel_thumb}" alt="">`:msg.type==='reel'?'🎬':'💬';
  push._friendId=sender.id; push.classList.add('show');
  clearTimeout(pushTimer); pushTimer=setTimeout(()=>push.classList.remove('show'),6000);
}

function clickPush(){
  const push=document.getElementById('push'), fid=push._friendId;
  push.classList.remove('show');
  if (fid) { navTo('inbox',document.getElementById('nav-inbox')); setTimeout(()=>openChat(fid),150); }
}

function updateMsgBadge(){
  const b=document.getElementById('msg-badge'), n=unreadConvs.size;
  if(n){b.style.display='flex';b.textContent=n;}else b.style.display='none';
}

// ══════════════════════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════════════════════
function escHtml(s){
  if(!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function formatTime(iso){
  if(!iso) return '';
  const d=new Date(iso),now=new Date(),diff=now-d;
  if(diff<60000) return 'ahora';
  if(diff<3600000) return Math.floor(diff/60000)+'m';
  if(diff<86400000) return Math.floor(diff/3600000)+'h';
  const days=Math.floor(diff/86400000);
  if(days<7) return days+'d';
  return d.toLocaleDateString('es-AR',{day:'numeric',month:'short'});
}
function toast(msg,ms=2500){
  const el=document.getElementById('toast');
  el.textContent=msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('show'),ms);
}
// ── MATRIX RAIN ──────────────────────────────────────────
(function() {
  const canvas = document.getElementById('matrix-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン01';
  let drops = [];
  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    drops = Array.from({length: Math.floor(canvas.width/14)}, () => Math.random() * -50);
  }
  function draw() {
    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#00c850';
    ctx.font = '13px monospace';
    drops.forEach((y, i) => {
      const char = chars[Math.floor(Math.random() * chars.length)];
      ctx.fillText(char, i * 14, y * 14);
      if (y * 14 > canvas.height && Math.random() > 0.975) drops[i] = 0;
      drops[i]++;
    });
  }
  resize();
  window.addEventListener('resize', resize);
  // Solo animar cuando el auth está visible
  let raf;
  function start() { raf = setInterval(draw, 50); }
  function stop() { clearInterval(raf); }
  start();
  // Parar cuando el usuario se loguea para no gastar CPU
  const orig = window.onLogin;
  window.onLogin = function(...a) { stop(); return orig?.(...a); };
})();
