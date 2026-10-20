/* Blend Battles — UI kit: toasts, dialogs, sound, confetti, formatters */
import { state, now, LS } from './core.js';

/* ------------------------------------------------------------------ escape */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------------------------------------------------------- formatters */
export function fmtClock(ms) {
  if (ms == null) return '--:--';
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
export function fmtSize(bytes) {
  if (!bytes) return '0 KB';
  if (bytes > 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
export function timeAgo(ts) {
  if (!ts) return '—';
  const d = Date.now() - ts;
  if (d < 60000) return 'just now';
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
  if (d < 604800000) return `${Math.floor(d / 86400000)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
export function fmtDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
export function initials(name = '?') { return name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?'; }

/* ------------------------------------------------------------------- avatar */
export function avatarHTML({ hue = 260, name = '?', size = '', cls = '' } = {}) {
  const light = 62;
  return `<span class="avatar ${size} ${cls}" style="background:linear-gradient(135deg,hsl(${hue} 85% ${light}%),hsl(${(hue + 46) % 360} 80% 46%))" title="${esc(name)}">${esc(initials(name))}</span>`;
}

/* -------------------------------------------------------------------- sound */
let ctx = null;
function audio() {
  if (!state.soundOn) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
function blip(freq, dur = 0.08, type = 'sine', gain = 0.05, slideTo = null, delay = 0) {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}
export const sfx = {
  click: () => blip(520, 0.05, 'triangle', 0.035),
  hover: () => blip(720, 0.03, 'sine', 0.012),
  success: () => { blip(523, 0.1, 'sine', 0.05); blip(659, 0.1, 'sine', 0.045, null, 0.08); blip(784, 0.16, 'sine', 0.04, null, 0.16); },
  error: () => { blip(220, 0.16, 'sawtooth', 0.035, 140); },
  vote: () => blip(880, 0.07, 'triangle', 0.04, 1180),
  ready: () => { blip(600, 0.07, 'square', 0.025); blip(900, 0.1, 'square', 0.02, null, 0.07); },
  start: () => { [440, 554, 659, 880].forEach((f, i) => blip(f, 0.12, 'triangle', 0.045, null, i * 0.09)); },
  tick: () => blip(1200, 0.03, 'sine', 0.02),
  win: () => { [523, 659, 784, 1046, 1318].forEach((f, i) => blip(f, 0.22, 'triangle', 0.05, null, i * 0.12)); },
  upload: () => blip(660, 0.06, 'sine', 0.03),
};
export function setSound(on) {
  state.soundOn = !!on;
  LS.set('sfx', state.soundOn);
  const btn = document.getElementById('soundToggle');
  if (btn) {
    btn.classList.toggle('is-muted', !state.soundOn);
    btn.innerHTML = `<span class="icon-btn__on">${state.soundOn ? '🔊' : '🔇'}</span>`;
    btn.setAttribute('aria-pressed', String(state.soundOn));
  }
}

/* ------------------------------------------------------------------- toasts */
export function toast(message, { type = 'info', title = '', ttl = 4200 } = {}) {
  const root = document.getElementById('toasts');
  if (!root) return;
  const icons = { success: '✓', error: '⚠', info: 'ℹ', warn: '⚠' };
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.innerHTML = `<span class="toast__icon">${icons[type] || 'ℹ'}</span><div>${title ? `<b>${esc(title)}</b>` : ''}${esc(message)}</div>`;
  root.appendChild(el);
  const kill = () => { el.classList.add('is-out'); setTimeout(() => el.remove(), 260); };
  setTimeout(kill, ttl);
  el.addEventListener('click', kill);
  return el;
}

/* -------------------------------------------------------------------- modal */
let modalClose = null;
export function closeModal() {
  const root = document.getElementById('modalRoot');
  if (!root) return;
  root.hidden = true;
  root.innerHTML = '';
  document.body.classList.remove('no-scroll');
  modalClose = null;
}
export function openModal({ title, sub = '', body = '', actions = [], wide = false, onMount = null, dismissable = true }) {
  const root = document.getElementById('modalRoot');
  if (!root) return null;
  root.hidden = false;
  root.innerHTML = `
    <div class="modal ${wide ? 'modal--wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal__head">
        <div>
          <div class="modal__title">${esc(title)}</div>
          ${sub ? `<div class="modal__sub">${sub}</div>` : ''}
        </div>
        <button class="modal__x" data-close aria-label="Close">×</button>
      </div>
      <div class="modal__body">${body}</div>
      ${actions.length ? `<div class="modal__foot">${actions.map((a, i) => `<button class="btn ${a.variant || 'btn--ghost'}" data-action="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}
    </div>`;
  document.body.classList.add('no-scroll');
  root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeModal));
  root.addEventListener('click', (e) => { if (e.target === root && dismissable) closeModal(); }, { once: true });
  if (actions.length) {
    root.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const action = actions[Number(btn.dataset.action)];
        sfx.click();
        if (action.onClick) {
          const keep = await action.onClick({ close: closeModal, btn, root });
          if (keep !== true) closeModal();
        } else closeModal();
      });
    });
  }
  modalClose = closeModal;
  if (onMount) onMount(root);
  const focusable = root.querySelector('input, button');
  if (focusable) setTimeout(() => focusable.focus(), 60);
  return { root, close: closeModal };
}

export function confirmDialog({ title, message, confirmText = 'Confirm', cancelText = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    openModal({
      title,
      body: `<p>${message}</p>`,
      actions: [
        { label: cancelText, variant: 'btn--ghost', onClick: () => { settled = true; resolve(false); } },
        { label: confirmText, variant: danger ? 'btn--danger' : 'btn--primary', onClick: () => { settled = true; resolve(true); } },
      ],
    });
    const root = document.getElementById('modalRoot');
    const obs = new MutationObserver(() => {
      if (root.hidden && !settled) { settled = true; resolve(false); obs.disconnect(); }
    });
    obs.observe(root, { attributes: true, attributeFilter: ['hidden'] });
  });
}

export function promptDialog({ title, message, placeholder = '', value = '', confirmText = 'Submit', multiline = false, required = true }) {
  return new Promise((resolve) => {
    let settled = false;
    const field = multiline
      ? `<textarea class="textarea" id="promptInput" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
      : `<input class="input" id="promptInput" placeholder="${esc(placeholder)}" value="${esc(value)}" />`;
    const inst = openModal({
      title,
      body: `<p style="margin-bottom:10px">${message}</p>${field}<div class="field__error" id="promptErr" style="display:none;color:#ff9d9d;font-size:12px;margin-top:8px"></div>`,
      actions: [
        { label: 'Cancel', variant: 'btn--ghost', onClick: () => { settled = true; resolve(null); } },
        {
          label: confirmText, variant: 'btn--primary', onClick: ({ root }) => {
            const val = root.querySelector('#promptInput').value.trim();
            if (required && !val) {
              const err = root.querySelector('#promptErr');
              err.textContent = 'This field is required.';
              err.style.display = 'block';
              return true;
            }
            settled = true; resolve(val);
          },
        },
      ],
      onMount: (root) => {
        const input = root.querySelector('#promptInput');
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !multiline) root.querySelector('[data-action="1"]').click(); });
      },
    });
    const root = document.getElementById('modalRoot');
    const obs = new MutationObserver(() => {
      if (root.hidden && !settled) { settled = true; resolve(null); obs.disconnect(); }
    });
    obs.observe(root, { attributes: true, attributeFilter: ['hidden'] });
    return inst;
  });
}

/* ---------------------------------------------------------------- countdown */
const timers = new Set();
export function mountCountdown(el, deadline, { onZero = null, urgentUnder = 30000, prefix = null } = {}) {
  if (!el) return () => {};
  const obj = { el, deadline, onZero, urgentUnder, fired: false, prefix };
  timers.add(obj);
  paint(obj);
  return () => timers.delete(obj);
}
function paint(t) {
  if (!t.el.isConnected) { timers.delete(t); return; }
  const left = t.deadline == null ? null : t.deadline - now();
  t.el.textContent = (t.prefix ? t.prefix + ' ' : '') + fmtClock(left);
  const wrap = t.el.closest('.timer');
  if (wrap) wrap.classList.toggle('is-urgent', left != null && left <= t.urgentUnder && left > 0);
  if (left != null && left <= 0 && !t.fired) {
    t.fired = true;
    if (t.onZero) t.onZero();
  }
}
setInterval(() => timers.forEach(paint), 250);

/* ----------------------------------------------------------------- confetti */
export function confetti({ duration = 3200, count = 150, colors = ['#a78bfa', '#38bdf8', '#ff8a3d', '#ffd166', '#34d399'] } = {}) {
  if (document.body.classList.contains('reduced-motion')) return;
  const canvas = document.getElementById('confetti');
  if (!canvas) return;
  const ctx2d = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const resize = () => { canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr; ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0); };
  resize();
  const parts = Array.from({ length: count }, () => ({
    x: Math.random() * innerWidth,
    y: -20 - Math.random() * innerHeight * 0.5,
    w: 4 + Math.random() * 7,
    h: 6 + Math.random() * 9,
    vx: (Math.random() - 0.5) * 1.7,
    vy: 1.8 + Math.random() * 3.4,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.22,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  const start = performance.now();
  let raf = 0;
  const tick = (t) => {
    const elapsed = t - start;
    ctx2d.clearRect(0, 0, innerWidth, innerHeight);
    parts.forEach((p) => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.028; p.rot += p.vr;
      ctx2d.save();
      ctx2d.translate(p.x, p.y);
      ctx2d.rotate(p.rot);
      ctx2d.globalAlpha = Math.max(0, 1 - elapsed / duration);
      ctx2d.fillStyle = p.color;
      ctx2d.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx2d.restore();
    });
    if (elapsed < duration) raf = requestAnimationFrame(tick);
    else ctx2d.clearRect(0, 0, innerWidth, innerHeight);
  };
  raf = requestAnimationFrame(tick);
  window.addEventListener('resize', resize, { once: true });
  setTimeout(() => cancelAnimationFrame(raf), duration + 100);
}

/* -------------------------------------------------------------- misc helpers */
export function mediaTag(file, { className = '', controls = true, alt = '' } = {}) {
  if (!file || !file.url) return '';
  const isVideo = (file.mime || '').startsWith('video') || /\.(mp4|webm)$/i.test(file.url);
  if (isVideo) return `<video class="${className}" src="${file.url}" ${controls ? 'controls playsinline preload="metadata"' : 'muted loop autoplay playsinline'}></video>`;
  return `<img class="${className}" src="${file.url}" alt="${esc(alt)}" loading="lazy" />`;
}
export function mediaSrcKind(url = '', mime = '') {
  if ((mime || '').startsWith('video')) return 'video';
  if (/\.(mp4|webm)(\?|$)/i.test(url)) return 'video';
  return 'image';
}
export function starsStatic(score = 0) {
  const rounded = Math.round(score);
  let html = '<span class="stars is-static" aria-hidden="true">';
  for (let i = 1; i <= 5; i++) html += `<span class="star ${i <= rounded ? 'is-on' : ''}">★</span>`;
  return html + '</span>';
}
export function rankColorStyle(color) { return `color:${esc(color)}`; }

export function loadingBlock(text = 'Loading…') {
  return `<div class="loading-block"><div class="spinner"></div><div>${esc(text)}</div></div>`;
}
export function emptyBlock({ icon = '◇', title = 'Nothing here yet', text = '', action = '' }) {
  return `<div class="empty"><div class="empty__icon">${icon}</div><b>${esc(title)}</b>${text ? `<div>${esc(text)}</div>` : ''}${action}</div>`;
}

/* delegated global click sound + ripple feedback */
export function wireGlobalFeedback() {
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, .btn, .chip, .tab, a[href^="#/"]');
    if (!t || t.disabled) return;
    sfx.click();
  }, true);
  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest('.mode-card, .creation-card');
    if (t) sfx.hover();
  });
}

/* images that fail to load get a graceful placeholder */
export function wireImageFallbacks(scope = document) {
  scope.querySelectorAll('img').forEach((img) => {
    img.addEventListener('error', () => {
      img.style.background = 'linear-gradient(135deg,#1b1b28,#101018)';
      img.style.objectFit = 'cover';
      if (!img.dataset.failed) {
        img.dataset.failed = '1';
        img.alt = img.alt || 'Artwork unavailable';
      }
    }, { once: true });
  });
}
