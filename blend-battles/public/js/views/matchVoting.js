/* Blend Battles — voting phase */
import { api, state } from '../core.js';
import { esc, toast, avatarHTML, mountCountdown, sfx, mediaSrcKind, wireImageFallbacks } from '../ui.js';
import { openEntryLightbox } from '../entry.js';

export default function renderVoting(root, ctx) {
  let match = ctx.match;
  const cleanups = [];

  root.innerHTML = `
    <div class="match-head" style="margin-bottom:16px">
      <div class="match-head__top">
        <span class="pill pill--vote">Voting open</span>
        <span class="pill">${esc(match.modeName)}</span>
        <span class="pill">${esc(match.theme)}</span>
        <span class="spacer"></span>
        <div class="timer"><div>
          <div class="timer__value countdown-inline" id="voteClock">--:--</div>
          <div class="timer__label">voting closes</div>
        </div></div>
      </div>
      <div class="row row--wrap" style="justify-content:space-between;gap:14px">
        <div style="max-width:520px">
          <h2 style="font-size:clamp(20px,3vw,27px);font-weight:900;letter-spacing:-.02em">Judge the work, not the hype</h2>
          <p class="note" style="margin-top:6px">Score each entry 1–5 stars. The final render is the primary entry — but every card has a <b>View proof</b> button so you can check the Blender viewport capture before you score it. Results stay hidden until voting closes.</p>
        </div>
        <div class="panel" style="min-width:210px;padding:14px">
          <div class="row" style="justify-content:space-between"><span class="note">Your progress</span><b id="voteProgress">0/0</b></div>
          <div class="progress" style="margin-top:8px"><i id="voteProgressBar" style="width:0%"></i></div>
          <div class="note" style="margin-top:8px" id="voteHint">Score every other entry to finish early.</div>
        </div>
      </div>
    </div>

    <div class="stage-banner stage-banner--vote">🔒 <span>Results are hidden until the timer ends. Votes are validated server-side: no self-voting, no duplicates, one score per entry.</span></div>

    <div class="vote-grid" id="voteGrid"></div>

    <div class="card" style="margin-top:20px">
      <div class="row row--wrap" style="justify-content:space-between;gap:10px">
        <div>
          <b style="font-size:14px">Spot something off?</b>
          <p class="note" style="margin-top:4px">Open any entry and hit <b>Report</b> — a moderator can review both files, request more evidence, invalidate votes or disqualify the entry.</p>
        </div>
        <a class="btn btn--sm btn--ghost" href="#/rules">Fair-play rules</a>
      </div>
    </div>`;

  function paintGrid() {
    const entries = match.entries || [];
    root.querySelector('#voteGrid').innerHTML = entries.map((e, i) => `
      <article class="card vote-card ${e.isSelf ? 'is-self' : ''}" data-entry="${i}">
        <div class="vote-card__media">
          ${e.renderKind === 'video'
            ? `<video src="${esc(e.renderUrl)}" controls playsinline muted loop preload="metadata"></video>`
            : `<img src="${esc(e.renderUrl)}" alt="${esc(e.title || 'Entry')}" loading="lazy" />`}
          <div class="vote-card__badge">
            ${e.isSelf ? '<span class="pill pill--sm pill--purple">your entry</span>' : ''}
            ${e.disqualified ? '<span class="pill pill--sm pill--bad">disqualified</span>' : ''}
            ${e.reviewStatus === 'reported' ? '<span class="pill pill--sm pill--warn">under review</span>' : ''}
          </div>
        </div>
        <div class="vote-card__body">
          <div class="vote-card__author">
            ${avatarHTML({ hue: e.avatarHue, name: e.displayName || e.username, size: 'avatar--sm' })}
            <div>
              <b>${esc(e.displayName || e.username)}</b>
              <div style="color:${esc(e.rankColor)};font-size:11px">${esc(e.rank)}</div>
            </div>
          </div>
          ${e.title ? `<div class="note" style="color:var(--text-dim);font-size:12.5px">“${esc(e.title)}”</div>` : ''}
          <div class="row" style="justify-content:space-between;gap:8px">
            <div class="stars" data-stars="${i}" role="group" aria-label="Score this entry">
              ${[1, 2, 3, 4, 5].map((n) => `<button class="star ${n <= (e.myVote || 0) ? 'is-on' : ''}" data-score="${n}" data-entry="${i}" ${(!e.canVote) ? 'disabled' : ''} aria-label="${n} star${n > 1 ? 's' : ''}">★</button>`).join('')}
            </div>
            <span class="note" data-votelabel="${i}">${e.isSelf ? 'no self-voting' : e.myVote ? `you gave ${e.myVote}★` : 'not scored'}</span>
          </div>
          <div class="vote-card__actions">
            <button class="btn btn--sm btn--outline" data-proof="${i}">🔍 View proof</button>
            ${!e.isSelf ? `<button class="btn btn--sm btn--ghost" data-report="${i}">⚑</button>` : ''}
          </div>
        </div>
      </article>`).join('') || '<div class="empty" style="grid-column:1/-1"><div class="empty__icon">📭</div><b>No valid entries</b><div>Nobody submitted both required files in time.</div></div>';

    wireGrid();
    paintProgress();
    wireImageFallbacks(root);
  }

  function paintProgress() {
    const entries = match.entries || [];
    const votable = entries.filter((e) => e.canVote);
    const voted = votable.filter((e) => e.myVote > 0).length;
    const pct = votable.length ? Math.round((voted / votable.length) * 100) : 0;
    const p = root.querySelector('#voteProgress');
    const bar = root.querySelector('#voteProgressBar');
    if (p) p.textContent = `${voted}/${votable.length}`;
    if (bar) bar.style.width = `${pct}%`;
    const hint = root.querySelector('#voteHint');
    if (hint) hint.textContent = votable.length === 0
      ? 'Nothing for you to score in this round.'
      : voted === votable.length
        ? 'All scored — waiting for the round to close.'
        : `${votable.length - voted} entr${votable.length - voted === 1 ? 'y' : 'ies'} left to score.`;
  }

  function wireGrid() {
    root.querySelectorAll('.vote-card').forEach((card) => {
      const i = Number(card.dataset.entry);
      const entry = (match.entries || [])[i];
      card.querySelector('.vote-card__media')?.addEventListener('click', () => openEntryLightbox({ ...entry, canReport: !!state.user }));
    });
    root.querySelectorAll('[data-score]').forEach((btn) => btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const i = Number(btn.dataset.entry);
      const score = Number(btn.dataset.score);
      const entry = match.entries[i];
      if (!entry.canVote) return;
      await castVote(i, score);
    }));
    root.querySelectorAll('[data-proof]').forEach((b) => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const e = match.entries[Number(b.dataset.proof)];
      openEntryLightbox({ ...e, canReport: !!state.user });
      setTimeout(() => document.getElementById('elProof')?.click(), 90);
    }));
    root.querySelectorAll('[data-report]').forEach((b) => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const e = match.entries[Number(b.dataset.report)];
      openEntryLightbox({ ...e, canReport: !!state.user });
      setTimeout(() => document.getElementById('elReport')?.click(), 90);
    }));
  }

  async function castVote(index, score) {
    const entry = match.entries[index];
    const prev = entry.myVote;
    entry.myVote = score; // optimistic
    paintStars(index);
    paintProgress();
    try {
      await api(`/api/matches/${match.id}/vote`, {
        method: 'POST',
        body: { submissionId: entry.submissionId, score, change: prev > 0 },
      });
      sfx.vote();
      toast(`${score}★ for ${entry.displayName || entry.username}${prev ? ' (updated)' : ''}`, { type: 'success', ttl: 2200 });
      ctx.refreshSoon(400);
    } catch (err) {
      entry.myVote = prev;
      paintStars(index);
      paintProgress();
      toast(err.message, { type: 'error', title: 'Vote rejected' });
    }
  }

  function paintStars(index) {
    const e = match.entries[index];
    const group = root.querySelector(`[data-stars="${index}"]`);
    if (group) group.querySelectorAll('[data-score]').forEach((s) => s.classList.toggle('is-on', Number(s.dataset.score) <= (e.myVote || 0)));
    const label = root.querySelector(`[data-votelabel="${index}"]`);
    if (label) label.textContent = e.myVote ? `you gave ${e.myVote}★` : 'not scored';
  }

  paintGrid();
  const clock = root.querySelector('#voteClock');
  if (clock) cleanups.push(mountCountdown(clock, match.phaseEndsAt, { onZero: () => ctx.refreshSoon(500) }));

  return {
    update(next) {
      const phaseChanged = next.phase !== match.phase;
      const votesChanged = JSON.stringify((next.entries || []).map((e) => e.myVote)) !== JSON.stringify((match.entries || []).map((e) => e.myVote));
      const countChanged = next.counts.votesCast !== match.counts.votesCast;
      match = next;
      if (phaseChanged) return ctx.repaint();
      if (votesChanged || countChanged) paintGrid();
    },
    destroy() { cleanups.forEach((f) => f()); },
  };
}
