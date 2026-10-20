/* Blend Battles — tournaments */
import { api, state } from '../core.js';
import { esc, toast, loadingBlock, fmtClock } from '../ui.js';
import { requireAuth } from './auth.js';
import { playNow } from './home.js';

export default async function tournaments(root) {
  root.innerHTML = loadingBlock('Loading tournaments…');
  const { tournaments } = await api('/api/tournaments');

  root.innerHTML = `
    <div class="page-head">
      <div class="crumbs"><a href="#/">Home</a> / <span>Tournaments</span></div>
      <h1>Tournaments</h1>
      <p>Bracketed events with bigger rewards. Registration is stored on the server; brackets open when the lobby goes live.</p>
    </div>
    <div class="grid grid--3" id="tourGrid">
      ${tournaments.map((t, i) => `
        <div class="card tour-card">
          <div class="row" style="justify-content:space-between">
            <span class="pill pill--purple">${esc(t.mode)}</span>
            <span class="pill pill--sm">${t.registered}/${t.slots} slots</span>
          </div>
          <h3 style="font-size:18px">${esc(t.name)}</h3>
          <div class="tour-card__time" data-countdown="${t.startsAt}">starts ${new Date(t.startsAt).toLocaleString()}</div>
          <p class="note">🏆 ${esc(t.prize)}</p>
          <div class="progress"><i style="width:${Math.min(100, (t.registered / t.slots) * 100)}%"></i></div>
          <div class="row" style="gap:8px;margin-top:6px">
            <button class="btn ${t.isRegistered ? 'btn--ghost' : 'btn--accent'} btn--block" data-register="${esc(t.id)}" data-i="${i}">
              ${t.isRegistered ? '✓ Registered — withdraw' : 'Register'}
            </button>
          </div>
        </div>`).join('')}
    </div>

    <div class="card" style="margin-top:20px">
      <b style="font-size:14px">How tournaments run</b>
      <ul class="reason-list" style="margin-top:10px">
        <li>Registration closes when slots fill or the bracket starts.</li>
        <li>Each round is a standard match with a fixed theme per round — all submissions still need a render + viewport proof.</li>
        <li>Draws are broken by vote count, then by earliest valid submission.</li>
        <li>Rounds run back-to-back; if you disconnect, your submission stays valid.</li>
      </ul>
    </div>`;

  root.querySelectorAll('[data-register]').forEach((b) => b.addEventListener('click', async () => {
    if (!requireAuth('Sign in to register for tournaments.')) return;
    b.classList.add('is-loading');
    try {
      const res = await api(`/api/tournaments/${b.dataset.register}/register`, { method: 'POST', body: {} });
      toast(res.registered ? 'You are registered. Bracket details appear in your profile.' : 'Registration withdrawn.', { type: 'success' });
      tournaments(root);
    } catch (err) {
      toast(err.message, { type: 'error' });
      b.classList.remove('is-loading');
    }
  }));

  const tick = setInterval(() => {
    root.querySelectorAll('[data-countdown]').forEach((el) => {
      const left = Number(el.dataset.countdown) - Date.now();
      el.innerHTML = left > 0 ? `starts in <b class="countdown-inline">${fmtClock(left)}</b>` : '<b>Bracket live</b>';
    });
  }, 1000);
  return () => clearInterval(tick);
}
