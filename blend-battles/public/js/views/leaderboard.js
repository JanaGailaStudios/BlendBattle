/* Blend Battles — global / regional / friends leaderboards */
import { api, state } from '../core.js';
import { esc, avatarHTML, loadingBlock, emptyBlock, wireImageFallbacks } from '../ui.js';
import { openAuthModal } from './auth.js';

const SCOPES = [
  { key: 'global', label: '🌍 Global', hint: 'Every ranked artist on this server.' },
  { key: 'regional', label: '📍 Regional', hint: 'Artists in your region.' },
  { key: 'friends', label: '👥 Friends', hint: 'Just you and the people you added.' },
];

export default async function leaderboard(root) {
  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  const scope = SCOPES.some((s) => s.key === query.get('scope')) ? query.get('scope') : 'global';
  root.innerHTML = loadingBlock('Reading the ladder…');

  let data;
  try {
    data = await api(`/api/leaderboard?scope=${scope}`);
  } catch (err) {
    if (err.status === 401) {
      root.innerHTML = `<div class="empty"><div class="empty__icon">👥</div><b>Friends ladder is private</b>
        <div>Sign in to compare yourself with the artists you follow.</div>
        <button class="btn btn--primary" id="signIn" style="margin-top:10px">Sign in</button></div>`;
      root.querySelector('#signIn').addEventListener('click', () => openAuthModal({}));
      return;
    }
    throw err;
  }

  const entries = data.entries;
  const you = data.you;

  root.innerHTML = `
    <div class="page-head">
      <div class="crumbs"><a href="#/">Home</a> / <span>Leaderboard</span></div>
      <h1>The ladder</h1>
      <p>XP comes from placements, vote averages and challenge claims — not from wins alone. Every finished match pays out something, even when the model fights back.</p>
    </div>

    <div class="row row--wrap" style="justify-content:space-between;gap:12px;margin-bottom:16px">
      <div class="filters">
        ${SCOPES.map((s) => `<button class="chip ${scope === s.key ? 'is-active' : ''}" data-scope="${s.key}">${s.label}</button>`).join('')}
      </div>
      ${you ? `<div class="pill pill--purple">Your position: #${you.position} · ${you.xp.toLocaleString()} XP</div>` : ''}
    </div>

    ${you && scope === 'global' ? `<div class="card" style="margin-bottom:16px;background:linear-gradient(120deg,rgba(139,92,246,.16),var(--panel))">
      <div class="row row--wrap" style="justify-content:space-between;gap:14px">
        <div class="row">${avatarHTML({ hue: you.avatarHue, name: you.username, size: 'avatar--lg' })}
          <div>
            <b style="font-size:17px">${esc(you.username)}</b>
            <div class="note">${esc(you.rank)} · Level ${you.level} · ${you.stats.wins} wins in ${you.stats.matches} matches</div>
            <div class="rank-bar" style="margin-top:8px;max-width:320px">
              <div class="progress"><i style="width:${you.rankPct}%"></i></div>
            </div>
          </div>
        </div>
        <div class="row" style="gap:20px">
          <div style="text-align:right"><b style="font-size:19px">${you.xp.toLocaleString()}</b><div class="note">XP</div></div>
          <div style="text-align:right"><b style="font-size:19px">#${you.position}</b><div class="note">Position</div></div>
          <a class="btn btn--sm btn--primary" href="#/profile">Your profile</a>
        </div>
      </div>
    </div>` : ''}

    <div class="lb-table">
      <div class="lb-row lb-row--head">
        <div>#</div><div>Artist</div><div>Rank</div><div>Level</div><div>Wins</div><div style="text-align:right">XP</div>
      </div>
      ${entries.length ? entries.map((e) => `
        <a class="lb-row ${e.isYou ? 'lb-row--you' : ''} ${e.position === 1 ? 'lb-row--1' : ''}" href="#/player/${e.id}">
          <div class="lb-pos">${e.position === 1 ? '👑' : e.position}</div>
          <div class="lb-user">
            ${avatarHTML({ hue: e.avatarHue, name: e.username })}
            <div style="min-width:0">
              <b>${esc(e.username)} ${e.isYou ? '<span class="pill pill--sm pill--purple">you</span>' : ''} ${e.isMod ? '<span class="tag tag--mod">MOD</span>' : ''}</b>
              <span>${e.stats.wins}W · ${e.stats.matches} matches · ${e.stats.avgScore ? e.stats.avgScore.toFixed(1) + '★ avg' : 'no votes yet'}</span>
            </div>
          </div>
          <div><span class="rank-badge" style="color:${esc(e.rankColor)}">${esc(e.rank)}</span></div>
          <div class="lb-num">Lv <b>${e.level}</b></div>
          <div class="lb-num"><b>${e.stats.wins}</b></div>
          <div class="lb-xp" style="text-align:right">${e.xp.toLocaleString()}</div>
        </a>`).join('') : emptyBlock({ icon: '🏅', title: 'Nobody here yet', text: 'Play a match to put yourself on the board.' })}
    </div>

    <div class="section section--tight">
      <div class="section__head">
        <div><h2 class="section__title"><span class="dot"></span> Rank thresholds</h2>
        <p class="section__sub">Ranks are permanent milestones; XP never decays. Placement points, vote averages and challenge claims all feed the same bar.</p></div>
      </div>
      <div class="grid grid--4" id="rankGrid"></div>
    </div>`;

  wireImageFallbacks(root);
  const ranks = (state.config && state.config.ranks) || [];
  root.querySelector('#rankGrid').innerHTML = ranks.map((r, i) => `
    <div class="card card--flat">
      <div class="row" style="justify-content:space-between">
        <span class="rank-badge" style="color:${r.color}">${r.icon} ${esc(r.name)}</span>
        <span class="note">${r.min.toLocaleString()} XP</span>
      </div>
      ${i === ranks.length - 1 ? '<div class="note" style="margin-top:8px">Top of the ladder — the only rank that requires everything.</div>' : ''}
    </div>`).join('');

  root.querySelectorAll('[data-scope]').forEach((b) => b.addEventListener('click', () => {
    history.replaceState(null, '', `#/leaderboard?scope=${b.dataset.scope}`);
    leaderboard(root);
  }));
  return () => {};
}
