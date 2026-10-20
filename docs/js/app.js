/* Blend Battles — app shell: router, nav, boot */
import {
  api, state, loadConfig, refreshMe, on, connectLive, logout, LS,
} from './core.js';
import {
  esc, toast, avatarHTML, setSound, wireGlobalFeedback, openModal, confirmDialog, sfx, loadingBlock,
} from './ui.js';
import { openAuthModal } from './views/auth.js';
import home from './views/home.js';
import play from './views/play.js';
import lobby from './views/lobby.js';
import matchView from './views/match.js';
import gallery from './views/gallery.js';
import leaderboard from './views/leaderboard.js';
import profile from './views/profile.js';
import mod from './views/mod.js';
import rules from './views/rules.js';
import tournaments from './views/tournaments.js';

/* Static (GitHub Pages) build: there is no Node server — a browser-local API stands in. */
const STATIC_BUILD = typeof window !== 'undefined' && !!window.BB_STATIC;

const ROUTES = [
  { re: /^\/$/, view: home },
  { re: /^\/play$/, view: play },
  { re: /^\/lobby\/([A-Za-z0-9]+)$/, view: lobby, keys: ['code'] },
  { re: /^\/match\/([\w-]+)$/, view: matchView, keys: ['id'] },
  { re: /^\/gallery$/, view: gallery },
  { re: /^\/leaderboard$/, view: leaderboard },
  { re: /^\/profile$/, view: profile },
  { re: /^\/player\/([\w-]+)$/, view: profile, keys: ['id'] },
  { re: /^\/mod$/, view: mod },
  { re: /^\/rules$/, view: rules },
  { re: /^\/tournaments$/, view: tournaments },
];

let cleanup = null;
let renderToken = 0;

function parseRoute() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart] = raw.split('?');
  const anchor = pathPart.includes('#') ? pathPart.split('#')[1] : null;
  const path = pathPart.split('#')[0] || '/';
  const params = Object.fromEntries(new URLSearchParams(queryPart || ''));
  return { path, params, anchor };
}

async function renderRoute() {
  const { path, params, anchor } = parseRoute();
  const view = document.getElementById('view');
  const token = ++renderToken;
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  document.body.classList.remove('no-scroll');

  const route = ROUTES.find((r) => r.re.test(path));
  if (!route) {
    view.innerHTML = `<div class="empty" style="margin-top:60px"><div class="empty__icon">🧭</div><b>Page not found</b>
      <div>The link <code>${esc(path)}</code> does not exist.</div>
      <a class="btn btn--primary" href="#/" style="margin-top:12px">Back home</a></div>`;
    updateNav(path);
    return;
  }

  const match = route.re.exec(path);
  const named = {};
  (route.keys || []).forEach((k, i) => { named[k] = match[i + 1]; });
  const allParams = { ...params, ...named };

  updateNav(path);
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });

  try {
    const result = await route.view(view, allParams);
    if (token !== renderToken) { if (typeof result === 'function') result(); return; }
    cleanup = typeof result === 'function' ? result : null;
    if (anchor) {
      setTimeout(() => {
        const el = document.getElementById(anchor);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 220);
    }
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="empty" style="margin-top:60px"><div class="empty__icon">⚠</div><b>Something broke</b>
      <div>${esc(err.message || 'Unknown error')}</div>
      <div class="row" style="gap:8px;margin-top:12px"><button class="btn btn--primary" onclick="location.reload()">Reload</button><a class="btn btn--ghost" href="#/">Home</a></div></div>`;
  }
}

function updateNav(path) {
  const base = '/' + (path.split('/')[1] || '');
  document.querySelectorAll('#navLinks a').forEach((a) => {
    const nav = a.dataset.nav;
    const isActive = (nav === 'home' && base === '/') || base === '/' + nav || (nav === 'profile' && base === '/player');
    a.classList.toggle('is-active', isActive);
  });
}

function renderAuthSlot() {
  const slot = document.getElementById('authSlot');
  const u = state.user;
  if (!u) {
    slot.innerHTML = `
      <button class="btn btn--ghost btn--sm" id="navSignIn">Sign in</button>
      <button class="btn btn--accent btn--sm" id="navPlay">▶ Play</button>`;
    slot.querySelector('#navSignIn').addEventListener('click', () => openAuthModal({}));
    slot.querySelector('#navPlay').addEventListener('click', () => {
      if (!state.user) return openAuthModal({ reason: 'Sign in (or continue as a guest) to enter a lobby.' });
      location.hash = '#/play';
    });
    return;
  }
  slot.innerHTML = `
    <div class="user-menu">
      <button class="user-menu__btn" id="userMenuBtn" aria-haspopup="true" aria-expanded="false">
        ${avatarHTML({ hue: u.avatarHue, name: u.username })}
        <div style="text-align:left">
          <div class="user-menu__name">${esc(u.username)}</div>
          <div class="user-menu__rank" style="color:${esc(u.rankColor)}">${esc(u.rank)}</div>
        </div>
      </button>
      <div class="user-menu__panel" id="userMenuPanel" hidden>
        <div class="user-menu__head">
          <b>${esc(u.username)}</b>
          <span>${esc(u.rank)} · Level ${u.level} · ${u.xp.toLocaleString()} XP</span>
          <div class="xp-mini"><i style="width:${u.rankPct}%"></i></div>
        </div>
        <a class="user-menu__item" href="#/profile">👤 My profile</a>
        <a class="user-menu__item" href="#/gallery?mine=1">🖼️ My creations</a>
        <a class="user-menu__item" href="#/leaderboard">🏆 Leaderboard</a>
        ${u.isMod ? '<a class="user-menu__item" href="#/mod">🛡️ Moderation</a>' : ''}
        <a class="user-menu__item" href="#/rules">📜 Rules</a>
        <button class="user-menu__item user-menu__item--danger" id="menuLogout">⎋ Sign out</button>
      </div>
    </div>`;
  const btn = slot.querySelector('#userMenuBtn');
  const panel = slot.querySelector('#userMenuPanel');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
    btn.setAttribute('aria-expanded', String(!panel.hidden));
  });
  document.addEventListener('click', () => { panel.hidden = true; }, { once: true });
  slot.querySelector('#menuLogout').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Sign out?', message: 'Your progress is saved on the server for registered accounts.', confirmText: 'Sign out' });
    if (!ok) return;
    await logout();
    toast('Signed out.', { type: 'info' });
    location.hash = '#/';
    renderRoute();
  });
}

function bailOutDemoBanner() {
  const banner = document.getElementById('demoBanner');
  if (!banner) return;
  if (LS.get('bannerDismissed', false)) { banner.hidden = true; return; }
  banner.hidden = !state.demoMode;
  if (STATIC_BUILD) {
    const text = document.getElementById('demoBannerText');
    if (text) text.innerHTML = '<strong>Static demo on GitHub Pages.</strong> Accounts, lobbies, uploads, votes and moderation all run inside your browser (no server). Timers are compressed about 10× so a full match takes roughly a minute, and uploaded files live only until you close or reload the tab.';
  }
  document.getElementById('demoBannerClose').addEventListener('click', () => {
    banner.hidden = true;
    LS.set('bannerDismissed', true);
  });
  document.getElementById('demoBannerMore').addEventListener('click', () => {
    openModal({
      title: 'What is real, what is simulated?',
      sub: STATIC_BUILD ? 'Blend Battles is running as a fully browser-local demo.' : 'Blend Battles is running in demo mode on a local Node server.',
      wide: true,
      body: `
        ${STATIC_BUILD ? `<div class="callout callout--warn" style="margin-bottom:14px">
          <b>This is the static GitHub Pages build.</b> The real project ships with a Node server (accounts, JSON database, SSE, file storage). Here that server is replaced by <code>js/static-backend.js</code>, which implements the same API in your browser with <code>localStorage</code>. Everything is playable; nothing leaves your device. Uploads are kept in memory only, so a reload clears them.
        </div>` : ''}
        <div class="grid grid--2">
          <div class="card card--flat">
            <b style="font-size:13.5px;color:#9df5d3">✓ Real, working features</b>
            <ul class="reason-list" style="margin-top:10px">
              <li>Registration, login, guest sessions, scrypt password hashing, httpOnly cookies</li>
              <li>Server-side validation of every vote, submission, upload and moderation action</li>
              <li>Two-file submission system with magic-byte file sniffing and size limits</li>
              <li>Server-driven match state machine: build → submission → voting → results</li>
              <li>Live lobby/match updates over Server-Sent Events + polling fallback</li>
              <li>XP, levels, ranks, badges, daily/weekly challenges, tournaments registration</li>
              <li>Moderation queue: reports, evidence requests, disqualification, vote invalidation, audit log</li>
              <li>Persistence in <code>data/db.json</code> + uploaded files in <code>data/uploads/</code></li>
            </ul>
          </div>
          <div class="card card--flat">
            <b style="font-size:13.5px;color:#ffd7a8">◐ Simulated in this demo</b>
            <ul class="reason-list" style="margin-top:10px">
              <li><b>Practice bots</b> — Quick Play fills your room with labelled bots. Their renders are generated demo artwork and their viewport proof is a stylised Blender-UI mock.</li>
              <li><b>Seeded history</b> — the featured gallery, ladder and match history come from seeded demo accounts with AI-generated showcase renders. They are labelled “demo account”.</li>
              <li><b>No cloud backend</b> — no Supabase/Firebase, no email verification, no cross-device sync, no CDN storage. One local JSON file instead.</li>
              <li><b>No anti-cheat automation</b> — no AI-image detector scores are used, deliberately.</li>
              <li><b>Online counts</b> reflect sessions on this server, not a global player base.</li>
            </ul>
            <div class="callout callout--info" style="font-size:12px">Everything above is enforced by the local server, so you can open a second browser window, register a second account and play a real 2-player match against yourself.</div>
          </div>
        </div>
        <p class="note" style="margin-top:14px">Demo accounts: <code>NovaKite</code> / <code>modvex</code> — password <code>blendbattles</code>.</p>`,
      actions: [{ label: 'Got it', variant: 'btn--primary' }],
    });
  });
}

function wireChrome() {
  document.getElementById('year').textContent = new Date().getFullYear();
  const burger = document.getElementById('burger');
  const links = document.getElementById('navLinks');
  burger.addEventListener('click', () => {
    const open = links.classList.toggle('is-open');
    burger.setAttribute('aria-expanded', String(open));
  });
  links.addEventListener('click', (e) => {
    if (e.target.tagName === 'A') {
      links.classList.remove('is-open');
      burger.setAttribute('aria-expanded', 'false');
    }
  });
  const soundBtn = document.getElementById('soundToggle');
  soundBtn.addEventListener('click', () => {
    setSound(!state.soundOn);
    if (state.soundOn) sfx.click();
    toast(state.soundOn ? 'Sound effects on.' : 'Sound effects muted.', { type: 'info', ttl: 1600 });
    if (state.user) api('/api/me', { method: 'PATCH', body: { settings: { sfx: state.soundOn } } }).catch(() => {});
  });
  setSound(state.soundOn);
  wireGlobalFeedback();
}

function updateOnline() {
  const el = document.getElementById('onlineCount');
  if (el) el.textContent = String(state.online || 0);
}

async function boot() {
  try {
    await loadConfig().catch(() => {});
    await refreshMe().catch(() => {});
  } catch { /* offline-tolerant */ }
  setSound(state.user?.settings ? state.user.settings.sfx !== false : LS.get('sfx', true));
  updateOnline();
  renderAuthSlot();
  bailOutDemoBanner();
  wireChrome();

  on('me', () => {
    renderAuthSlot();
    updateOnline();
    if (state.user) connectLive();
  });
  on('rerender', () => renderRoute());
  on('notice', (d) => toast(d.text || 'New notification', { type: 'warn', title: 'Moderator notice', ttl: 7000 }));

  window.addEventListener('hashchange', renderRoute);
  if (!location.hash) history.replaceState(null, '', '#/');
  await renderRoute();

  // periodic online refresh
  setInterval(async () => {
    try {
      const m = await api('/api/me');
      state.online = m.online;
      updateOnline();
    } catch { /* ignore */ }
  }, 45000);

  const bootEl = document.getElementById('boot');
  bootEl.classList.add('is-done');
  setTimeout(() => bootEl.remove(), 700);
  state.booted = true;
}

boot();
