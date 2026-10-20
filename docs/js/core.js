/* Blend Battles — client core: API, state, live events */

export const state = {
  user: null,
  config: null,
  demoMode: true,
  online: 0,
  challenges: { daily: [], weekly: [] },
  timeOffset: 0,          // serverNow - Date.now()
  liveConnected: false,
  soundOn: true,
  booted: false,
};

const bus = new EventTarget();
export function emit(name, detail) { bus.dispatchEvent(new CustomEvent(name, { detail })); }
export function on(name, fn) { const h = (e) => fn(e.detail); bus.addEventListener(name, h); return () => bus.removeEventListener(name, h); }

export const now = () => Date.now() + state.timeOffset;

export async function api(path, opts = {}) {
  const { method = 'GET', body, signal } = opts;
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    signal,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = { error: text }; } }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  if (data && typeof data.serverNow === 'number') state.timeOffset = data.serverNow - Date.now();
  if (data && data.match && typeof data.match.serverNow === 'number') state.timeOffset = data.match.serverNow - Date.now();
  return data;
}

/** Upload a File with real progress events (fetch cannot report upload progress). */
export function uploadFile(path, file, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path, true);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      const err = new Error((data && data.error) || `Upload failed (${xhr.status})`);
      err.status = xhr.status;
      reject(err);
    };
    xhr.onerror = () => reject(new Error('Network error during upload — check your connection and retry.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    xhr.send(file);
  });
}

/* ------------------------------------------------------------------- live */
let es = null;
let retries = 0;
export function connectLive() {
  if (!state.user || es) return;
  try {
    es = new EventSource('/api/events');
  } catch { return; }
  es.addEventListener('open', () => { state.liveConnected = true; retries = 0; emit('live', { connected: true }); });
  const relay = (eventName, out) => es.addEventListener(eventName, (e) => {
    let data = {};
    try { data = JSON.parse(e.data); } catch { /* ignore */ }
    emit(out, data);
  });
  relay('lobby', 'lobby:update');
  relay('match', 'match:update');
  relay('notice', 'notice');
  relay('kicked', 'kicked');
  relay('ping', 'ping');
  es.addEventListener('error', () => {
    state.liveConnected = false;
    emit('live', { connected: false });
    if (es && es.readyState === EventSource.CLOSED) {
      es = null;
      clearInterval(es._t);
      if (state.user && retries < 5) {
        retries += 1;
        setTimeout(connectLive, 1500 * retries);
      }
    }
  });
}
export function disconnectLive() {
  if (es) { es.close(); es = null; }
  state.liveConnected = false;
}

/* ------------------------------------------------------------------- auth */
export async function refreshMe() {
  const data = await api('/api/me');
  state.user = data.user;
  state.demoMode = data.demoMode;
  state.online = data.online;
  if (data.challenges) state.challenges = data.challenges;
  if (state.user && state.user.settings) state.soundOn = state.user.settings.sfx !== false;
  emit('me', state.user);
  return state.user;
}
export async function login(username, password) {
  const d = await api('/api/auth/login', { method: 'POST', body: { username, password } });
  state.user = d.user; emit('me', d.user); connectLive(); return d.user;
}
export async function register(payload) {
  const d = await api('/api/auth/register', { method: 'POST', body: payload });
  state.user = d.user; emit('me', d.user); connectLive(); return d.user;
}
export async function guest() {
  const d = await api('/api/auth/guest', { method: 'POST', body: {} });
  state.user = d.user; emit('me', d.user); connectLive(); return d.user;
}
export async function logout() {
  await api('/api/auth/logout', { method: 'POST', body: {} });
  state.user = null; disconnectLive(); emit('me', null);
}
export async function loadConfig() {
  state.config = await api('/api/config');
  state.demoMode = state.config.demoMode;
  state.online = state.config.online;
  return state.config;
}

/* set a value in localStorage safely */
export const LS = {
  get(k, d = null) { try { const v = localStorage.getItem('bb_' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('bb_' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

/* re-render the current route (used after auth changes / destructive actions) */
export function requestRerender() { emit('rerender'); }
