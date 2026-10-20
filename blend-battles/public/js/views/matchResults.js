/* Blend Battles — results phase: podium, XP, standings */
import { api, state } from '../core.js';
import { esc, toast, avatarHTML, starsStatic, confetti, sfx, wireImageFallbacks, fmtDate } from '../ui.js';
import { openEntryLightbox } from '../entry.js';
import { playNow } from './home.js';

export default function renderResults(root, ctx) {
  const match = ctx.match;
  const res = match.results || { entries: [], podium: [], awards: [], stats: {} };
  const me = state.user;
  const myAward = res.yourXp || (res.awards || []).find((a) => me && a.userId === me.id);
  const myEntry = (res.entries || []).find((e) => e.userId === me?.id) || (match.yourSubmission ? res.entries.find((e) => e.submissionId === match.yourSubmission.id) : null);
  const won = myEntry && myEntry.place === 1;
  const top3 = myEntry && myEntry.place <= 3;

  if (won || top3) {
    setTimeout(() => { confetti({ duration: 3800, count: 180 }); sfx.win(); }, 350);
  }

  const podiumOrder = [res.podium?.[1], res.podium?.[0], res.podium?.[2]].filter(Boolean);
  const medals = ['🥇', '🥈', '🥉'];

  root.innerHTML = `
    <div class="crumbs"><a href="#/">Home</a> / <a href="#/gallery">Gallery</a> / <span>Results</span></div>

    <div class="match-head" style="text-align:center;padding:30px 22px;background:radial-gradient(circle at 50% 0%,rgba(255,209,102,.16),rgba(139,92,246,.12) 45%,var(--panel) 100%)">
      <span class="pill pill--results">Results published</span>
      <h1 style="font-size:clamp(26px,5vw,44px);font-weight:900;letter-spacing:-.035em;margin-top:14px">${esc(match.theme)}</h1>
      <p class="note" style="margin-top:8px">${esc(match.modeName)} · ${res.abandoned ? 'match ended without ranked entries' : `${res.entries.length} entries · ${res.stats?.votes || 0} votes · ${res.stats?.durationSeconds ? Math.round(res.stats.durationSeconds / 60) + ' min' : ''}`}</p>
      ${myAward ? `<div class="row" style="justify-content:center;margin-top:16px"><span class="xp-burst">+${myAward.xpAwarded} XP · finished #${myAward.place}</span></div>` : ''}
    </div>

    ${res.abandoned ? `
      <div class="empty" style="margin-top:22px">
        <div class="empty__icon">🚫</div><b>No valid entries</b>
        <div>${esc(res.reason || 'Nobody submitted both required files before the deadline.')}</div>
        <div class="row" style="gap:8px;margin-top:12px">
          <button class="btn btn--accent" id="playAgain">↻ Play again</button>
          <a class="btn btn--ghost" href="#/play">Back to lobbies</a>
        </div>
      </div>` : `
      <div class="podium">
        ${podiumOrder.map((p) => `
          <div class="podium__slot podium__slot--${p.place}">
            <div class="podium__media">
              ${p.renderKind === 'video'
                ? `<video src="${esc(p.renderUrl)}" controls playsinline muted loop preload="metadata"></video>`
                : `<img src="${esc(p.renderUrl)}" alt="${esc(p.displayName)} entry" />`}
              ${p.place === 1 ? '<div class="podium__crown">👑</div>' : ''}
              <div class="podium__place">${medals[p.place - 1]} #${p.place}</div>
            </div>
            <div class="podium__body">
              <div class="podium__name">${esc(p.displayName || p.username)} ${me && p.userId === me.id ? '<span class="pill pill--sm pill--purple">you</span>' : ''}</div>
              <div class="podium__score"><b>${Number(p.avgScore).toFixed(1)}</b> ★ average · ${p.voteCount} votes</div>
              <div class="row" style="gap:6px;flex-wrap:wrap">
                ${p.xpAwarded ? `<span class="pill pill--good pill--sm">+${p.xpAwarded} XP</span>` : ''}
                ${p.title ? `<span class="pill pill--sm">${esc(p.title)}</span>` : ''}
              </div>
              <div class="podium__actions">
                <button class="btn btn--sm btn--outline" data-proof="${esc(p.submissionId)}">🔍 View proof</button>
                <button class="btn btn--sm btn--ghost" data-entry="${esc(p.submissionId)}">Full entry</button>
              </div>
            </div>
          </div>`).join('')}
      </div>

      ${myEntry ? `
        <div class="card" style="margin-top:18px">
          <div class="row row--wrap" style="justify-content:space-between;gap:14px">
            <div>
              <b style="font-size:15px">Your result: #${myEntry.place} of ${res.entries.length}</b>
              <p class="note" style="margin-top:5px">${Number(myEntry.avgScore).toFixed(2)} ★ average across ${myEntry.voteCount} vote(s)${myAward ? ` · +${myAward.xpAwarded} XP earned` : ''}</p>
            </div>
            <div class="row" style="gap:8px">
              <button class="btn btn--sm btn--outline" data-proof="${esc(myEntry.submissionId)}">View my proof</button>
              <a class="btn btn--sm btn--ghost" href="#/profile">Profile</a>
            </div>
          </div>
          ${me ? `<div class="rank-bar" style="margin-top:14px;max-width:none">
            <div class="rank-bar__labels"><span>${esc(me.rank)} · Level ${me.level}</span><span>${me.xp.toLocaleString()} XP${me.xpToNextRank ? ` · ${me.xpToNextRank} to ${esc(me.nextRank)}` : ' · max rank'}</span></div>
            <div class="progress"><i style="width:${me.rankPct}%"></i></div>
          </div>` : ''}
        </div>` : ''}

      <div class="results-stats">
        <div class="stat-tile"><b>${res.entries.length}</b><span>Entries</span></div>
        <div class="stat-tile"><b>${res.stats?.votes || 0}</b><span>Votes counted</span></div>
        <div class="stat-tile"><b>${res.entries.length ? Number(res.entries[0].avgScore).toFixed(1) : '0'}</b><span>Top average</span></div>
        <div class="stat-tile"><b>${res.stats?.durationSeconds ? Math.round(res.stats.durationSeconds / 60) : 0}m</b><span>Match length</span></div>
      </div>

      <div class="card" style="margin-top:18px">
        <div class="row" style="justify-content:space-between;margin-bottom:12px">
          <b style="font-size:15px">Full standings</b>
          <span class="note">Scores are vote averages; ties break on vote count.</span>
        </div>
        <div class="stack" style="gap:7px">
          ${(res.entries || []).map((e) => `
            <div class="scored-row ${me && e.userId === me.id ? 'is-you' : ''}">
              <div class="place-chip place-chip--${e.place <= 3 ? e.place : 'n'}">${e.place <= 3 ? medals[e.place - 1] : '#' + e.place}</div>
              ${avatarHTML({ hue: 250, name: e.displayName || e.username, size: 'avatar--sm' })}
              <div style="flex:1;min-width:0">
                <b style="font-size:13px">${esc(e.displayName || e.username)}</b>
                <div class="note">${esc(e.title || 'Untitled entry')} ${e.disqualified ? '· <span style="color:#ff9d9d">disqualified</span>' : ''}</div>
              </div>
              <div style="text-align:right">
                <b style="color:#ffd08a">${Number(e.avgScore).toFixed(1)} ★</b>
                <div class="note">${e.voteCount} votes</div>
              </div>
              <button class="btn btn--sm btn--ghost" data-proof="${esc(e.submissionId)}">Proof</button>
            </div>`).join('')}
        </div>
      </div>
    `}

    <div class="row" style="justify-content:center;gap:10px;margin-top:24px;flex-wrap:wrap">
      <button class="btn btn--accent btn--lg" id="playAgain">↻ Play Again</button>
      <a class="btn btn--primary btn--lg" href="#/lobby/${esc(match.code || '')}" id="backLobby">Return to Lobby</a>
      <a class="btn btn--ghost btn--lg" href="#/gallery">View Gallery</a>
    </div>
    <p class="note center" style="margin-top:12px">Match ended ${esc(fmtDate(match.endedAt || Date.now()))}${res.computedAt ? '' : ''} · rewards already applied to your profile.</p>`;

  wireImageFallbacks(root);

  const entriesById = Object.fromEntries((res.entries || []).map((e) => [e.submissionId, e]));
  root.querySelectorAll('[data-proof]').forEach((b) => b.addEventListener('click', () => {
    const e = entriesById[b.dataset.proof];
    if (!e) return;
    openEntryLightbox({ ...e, canReport: false });
    setTimeout(() => document.getElementById('elProof')?.click(), 90);
  }));
  root.querySelectorAll('[data-entry]').forEach((b) => b.addEventListener('click', () => {
    const e = entriesById[b.dataset.entry];
    if (e) openEntryLightbox({ ...e, canReport: false });
  }));
  root.querySelectorAll('#playAgain').forEach((b) => b.addEventListener('click', (ev) => playNow(match.mode, ev.currentTarget)));
  const bl = root.querySelector('#backLobby');
  if (bl) {
    bl.addEventListener('click', async (e) => {
      try {
        const { lobby } = await api(`/api/lobbies/${match.code}`);
        if (!lobby) throw new Error('Lobby closed');
      } catch {
        e.preventDefault();
        toast('That lobby has closed. Start a fresh one instead.', { type: 'info' });
        location.hash = '#/play';
      }
    });
  }

  return {
    update(next) { if (next.phase !== 'results') ctx.repaint(); },
    destroy() {},
  };
}
