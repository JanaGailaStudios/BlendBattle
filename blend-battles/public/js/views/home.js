/* Blend Battles — homepage */
import { api, state } from '../core.js';
import { esc, toast, avatarHTML, fmtClock, timeAgo, loadingBlock, wireImageFallbacks, confetti } from '../ui.js';
import { openEntryLightbox } from '../entry.js';
import { openAuthModal, requireAuth } from './auth.js';

const MODE_ICONS = { build: '🧱', duo: '🤝', speed: '⚡', animation: '🎬', free: '🎨' };

export async function playNow(mode = 'build', btn = null) {
  if (!state.user) {
    openAuthModal({ reason: `Sign in (or continue as a guest) to enter a ${mode} lobby.` });
    return;
  }
  if (btn) btn.classList.add('is-loading');
  try {
    const { lobby } = await api('/api/quickplay', { method: 'POST', body: { mode } });
    try { await api(`/api/lobbies/${lobby.code}/ready`, { method: 'POST', body: { ready: true } }); } catch { /* host ready is optional */ }
    toast(lobby.status === 'waiting' ? `Room ${lobby.code} ready. Hit start when you are.` : 'Joined a live lobby.', { type: 'success', title: 'Lobby ready' });
    location.hash = `#/lobby/${lobby.code}`;
  } catch (err) {
    toast(err.message, { type: 'error', title: 'Could not start' });
  } finally {
    if (btn) btn.classList.remove('is-loading');
  }
}

export default async function home(root) {
  root.innerHTML = loadingBlock('Loading the arena…');
  const [data, tours] = await Promise.all([api('/api/home'), api('/api/tournaments').catch(() => ({ tournaments: [] }))]);
  const u = state.user;

  const featured = data.featured.slice(0, 6);
  const tickerItems = [
    `${data.online} artists online right now`,
    `${data.stats.matches} matches scored`,
    `${data.stats.entries} entries in the gallery`,
    `${data.stats.votes.toLocaleString()} votes cast`,
    `Daily theme: ${data.dailyTheme.name}`,
    ...data.activity.map((a) => a.text),
  ];

  root.innerHTML = `
  <section class="hero">
    <div class="hero__grid">
      <div>
        <div class="hero__eyebrow"><span class="live-dot"></span> Blender-only competitive arena</div>
        <h1 class="hero__title"><span class="l1">BLEND</span><span class="l2">BATTLES</span></h1>
        <div class="hero__sub">Create. <b>Render.</b> Compete.</div>
        <p class="hero__desc">Get a random theme. Open Blender. Build something great before the clock runs out. Submit your final render <em>and</em> your viewport proof, then let the lobby decide who takes the podium.</p>
        <div class="hero__ctas">
          <button class="btn btn--accent btn--lg" id="heroPlay">▶ Play Now</button>
          <a class="btn btn--primary btn--lg" href="#/play">Browse Lobbies</a>
          <a class="btn btn--ghost btn--lg" href="#/leaderboard">🏆 Leaderboard</a>
        </div>
        <div class="hero__stats">
          <div class="hero__stat"><b>${data.online}</b><span>Artists online</span></div>
          <div class="hero__stat"><b>${data.openLobbies}</b><span>Open lobbies</span></div>
          <div class="hero__stat"><b>${data.stats.entries}</b><span>Gallery entries</span></div>
          <div class="hero__stat"><b>${data.stats.matches}</b><span>Matches scored</span></div>
        </div>
      </div>
      <div class="hero__art">
        <div class="hero__logo-wrap">
          <img class="hero__logo" src="/img/logo.png" alt="Blend Battles logo — a stylised 3D Blender-style mascot" />
          <div class="hero__badge hero__badge--1"><span class="live-dot"></span> ${data.activeMatches.length} match${data.activeMatches.length === 1 ? '' : 'es'} live</div>
          <div class="hero__badge hero__badge--2">🗳️ ${data.stats.votes.toLocaleString()} votes cast</div>
          <div class="hero__badge hero__badge--3">🎯 Theme: <b>${esc(data.dailyTheme.name)}</b></div>
        </div>
      </div>
    </div>

    <div class="ticker">
      <div class="ticker__track">
        ${[...tickerItems, ...tickerItems].map((t) => `<div class="ticker__item"><span class="live-dot"></span><b>${esc(t)}</b></div>`).join('')}
      </div>
    </div>
  </section>

  <section class="section">
    <div class="section__head">
      <div>
        <h2 class="section__title"><span class="dot"></span> Pick your battle</h2>
        <p class="section__sub">Five ways to compete. Every competitive mode requires a final render plus Blender viewport proof.</p>
      </div>
      <a class="section__link" href="#/play">All lobbies →</a>
    </div>
    <div class="grid grid--5" id="modeGrid">
      ${(state.config?.modes || []).map((m) => `
        <article class="card card--hover mode-card" data-mode="${m.key}" tabindex="0" role="button" aria-label="${esc(m.name)}">
          <div class="mode-card__icon">${MODE_ICONS[m.key] || '🧱'}</div>
          <h3>${esc(m.name)}</h3>
          <p>${esc(m.tagline)}</p>
          <div class="mode-card__meta">${m.practice ? 'No timer' : `${Math.round(m.buildSeconds / 60)} min build`} · ${m.minPlayers}–${m.maxPlayers} players</div>
          <div class="mode-card__cta">Enter →</div>
        </article>`).join('')}
    </div>
  </section>

  <section class="section">
    <div class="grid grid--3" style="align-items:start">
      <div class="card" style="grid-column: span 2">
        <div class="section__head" style="margin-bottom:14px">
          <div>
            <h2 class="section__title" style="font-size:19px"><span class="dot"></span> Live now</h2>
            <p class="section__sub">Matches in progress and rooms waiting for players.</p>
          </div>
          <a class="section__link" href="#/play">Join a room →</a>
        </div>
        <div id="liveList">
          ${data.activeMatches.length ? data.activeMatches.map((m) => `
            <div class="list-row">
              <div class="lobby-row__mode" style="width:36px;height:36px;font-size:16px">${MODE_ICONS[m.mode] || '🧱'}</div>
              <div class="list-row__main">
                <b>${esc(m.theme)}</b>
                <span>${esc(m.mode)} · ${m.players} players · ${m.submissions} submitted</span>
              </div>
              <div class="list-row__right">
                <span class="pill pill--${m.phase === 'voting' ? 'vote' : 'build'}">${m.phase}</span>
                <div class="countdown-inline" data-deadline="${m.phaseEndsAt || ''}" style="margin-top:4px">${fmtClock(m.phaseEndsAt ? m.phaseEndsAt - Date.now() : null)}</div>
              </div>
              <a class="btn btn--sm ${m.isParticipant ? 'btn--primary' : 'btn--ghost'}" href="#/match/${m.id}">${m.isParticipant ? 'Your match' : 'View'}</a>
            </div>`).join('') : `<div class="empty" style="padding:26px"><div class="empty__icon">🛰️</div><b>No live matches right now</b><div>Start one — it takes about ten seconds.</div><button class="btn btn--sm btn--primary" id="emptyPlay" style="margin-top:6px">Play Now</button></div>`}
          ${data.openLobbies ? `<div class="divider"></div><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:10px">
            <span class="note">${data.openLobbies} public ${data.openLobbies === 1 ? 'lobby is' : 'lobbies are'} waiting for players.</span>
            <a class="btn btn--sm btn--ghost" href="#/play">Browse lobbies</a>
          </div>` : ''}
        </div>
      </div>

      <div class="card daily-card">
        <span class="pill pill--warn">☀ Daily theme</span>
        <div class="daily-card__theme">${esc(data.dailyTheme.name)}</div>
        <p class="note">${esc(data.dailyTheme.blurb || '')}</p>
        <div class="row" style="margin-top:14px;gap:8px;flex-wrap:wrap">
          <span class="pill pill--sm">${esc(data.dailyTheme.difficulty)}</span>
          <span class="pill pill--sm">${esc(data.dailyTheme.date)}</span>
        </div>
        <button class="btn btn--accent btn--block" id="dailyPlay" style="margin-top:16px">Model this theme →</button>
        <div class="divider"></div>
        <h4 style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted-2);margin-bottom:10px">Upcoming tournaments</h4>
        <div class="stack" style="gap:8px">
          ${(tours.tournaments || []).slice(0, 2).map((t) => `
            <div class="row" style="justify-content:space-between;gap:10px">
              <div><b style="font-size:13px">${esc(t.name)}</b><div class="note">${esc(t.mode)} · ${t.registered}/${t.slots} slots</div></div>
              <a class="btn btn--sm btn--ghost" href="#/tournaments">Details</a>
            </div>`).join('')}
        </div>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="section__head">
      <div>
        <h2 class="section__title"><span class="dot"></span> Featured creations</h2>
        <p class="section__sub">Fresh podium finishers from recent battles. Hover an entry to inspect its viewport proof.</p>
      </div>
      <a class="section__link" href="#/gallery">Open gallery →</a>
    </div>
    <div class="featured-grid" id="featuredGrid">
      ${featured.map((f, i) => `
        <article class="creation-card" data-entry="${i}" tabindex="0" role="button" aria-label="${esc(f.title || f.theme)} by ${esc(f.username)}">
          <div class="creation-card__media">
            ${f.renderKind === 'video'
              ? `<video src="${esc(f.renderUrl)}" muted loop playsinline preload="metadata"></video>`
              : `<img src="${esc(f.renderUrl)}" alt="${esc(f.title || f.theme)}" loading="lazy" />`}
            <div class="creation-card__overlay"></div>
            ${f.place && f.place <= 3 ? `<div class="place-ribbon place-ribbon--${f.place}">${['🥇', '🥈', '🥉'][f.place - 1]} #${f.place}</div>` : ''}
            <div class="creation-card__title"><b>${esc(f.title || f.theme)}</b></div>
            <div class="creation-card__meta">
              <div class="creation-card__author">
                ${avatarHTML({ hue: 260, name: f.username, size: 'avatar--sm' })}
                <div><b>${esc(f.username)}</b><span>${esc(f.theme)}</span></div>
              </div>
              <div class="creation-card__score">★ ${Number(f.avgScore || 0).toFixed(1)}</div>
            </div>
            <button class="btn btn--sm btn--ghost creation-card__proof" data-proof="${i}">🔍 View proof</button>
          </div>
        </article>`).join('') || '<div class="empty" style="grid-column:1/-1"><div class="empty__icon">🖼️</div><b>No public entries yet</b><div>Play a match to seed the gallery.</div></div>'}
    </div>
  </section>

  <section class="section">
    <div class="grid grid--3" style="align-items:start">
      <div class="card">
        <h2 class="section__title" style="font-size:18px;margin-bottom:14px">🏅 Recent winners</h2>
        <div class="list" id="winnerList">
          ${data.winners.map((w) => `
            <div class="list-row" style="padding:8px 10px">
              <img class="mini-render" src="${esc(w.renderUrl || '')}" alt="" loading="lazy" />
              <div class="list-row__main"><b>${esc(w.username)}</b><span>${esc(w.theme)} · ${timeAgo(w.endedAt)}</span></div>
              <div class="list-row__right"><b>★ ${Number(w.score || 0).toFixed(1)}</b></div>
            </div>`).join('')}
        </div>
      </div>
      <div class="card">
        <div class="row" style="justify-content:space-between;margin-bottom:14px">
          <h2 class="section__title" style="font-size:18px">👑 Top ranked</h2>
          <a class="section__link" href="#/leaderboard">Full ladder →</a>
        </div>
        <div class="list">
          ${data.topPlayers.map((p, i) => `
            <a class="list-row" href="#/player/${p.id}" style="padding:8px 10px">
              <div class="list-row__pos ${['gold', 'silver', 'bronze'][i] || ''}">${i + 1}</div>
              ${avatarHTML({ hue: p.avatarHue, name: p.username, size: 'avatar--sm' })}
              <div class="list-row__main"><b>${esc(p.username)}</b><span style="color:${esc(p.rankColor)}">${esc(p.rank)} · Lv ${p.level}</span></div>
              <div class="list-row__right"><b>${p.xp.toLocaleString()}</b><div style="font-size:10px">XP</div></div>
            </a>`).join('')}
        </div>
      </div>
      <div class="card">
        <h2 class="section__title" style="font-size:18px;margin-bottom:14px">🛡️ How fair play works</h2>
        <div class="stack" style="gap:14px">
          <div class="row" style="align-items:flex-start"><span class="pill pill--purple">1</span><div><b style="font-size:13px">Two uploads, every time</b><p class="note">A final render plus a Blender viewport capture. The finalize button stays locked until both are processed.</p></div></div>
          <div class="row" style="align-items:flex-start"><span class="pill pill--purple">2</span><div><b style="font-size:13px">Proof stays inspectable</b><p class="note">Voters get a “View proof” button on every entry — the render is never the only thing on screen.</p></div></div>
          <div class="row" style="align-items:flex-start"><span class="pill pill--purple">3</span><div><b style="font-size:13px">Humans make the call</b><p class="note">Reports go to a moderator queue with both files attached. No automatic bans from AI detectors.</p></div></div>
        </div>
        <div class="callout callout--warn" style="margin-top:14px;font-size:12px">
          <b>Honest limitation:</b> viewport proof is supporting evidence, not absolute proof. Screenshots can be faked — moderation and reports are what actually hold the line.
        </div>
        <a class="btn btn--ghost btn--block" href="#/rules" style="margin-top:6px">Read the full rules</a>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="card" style="text-align:center;padding:42px 24px;background:radial-gradient(circle at 50% 0%,rgba(139,92,246,.18),var(--panel) 70%)">
      <h2 style="font-size:clamp(24px,4vw,36px);font-weight:900;letter-spacing:-.03em">Your creativity. Your model. Your battle.</h2>
      <p class="note" style="margin:12px auto 22px;max-width:560px">Free to play, no download required beyond Blender itself. Rank up from Beginner to Blender Legend.</p>
      <div class="row" style="justify-content:center;gap:10px;flex-wrap:wrap">
        <button class="btn btn--accent btn--lg" id="ctaPlay">▶ Enter the arena</button>
        <a class="btn btn--primary btn--lg" href="#/leaderboard">See the ladder</a>
      </div>
    </div>
  </section>`;

  wireImageFallbacks(root);

  /* ---------------------------------------------------------------- wiring */
  const startMode = (mode, btn) => playNow(mode, btn);
  root.querySelector('#heroPlay').addEventListener('click', (e) => startMode('build', e.currentTarget));
  root.querySelector('#ctaPlay').addEventListener('click', (e) => startMode('build', e.currentTarget));
  const empty = root.querySelector('#emptyPlay');
  if (empty) empty.addEventListener('click', (e) => startMode('build', e.currentTarget));
  root.querySelector('#dailyPlay').addEventListener('click', (e) => {
    if (!requireAuth('Sign in to host a match on today’s theme.')) return;
    startMode('build', e.currentTarget);
  });
  root.querySelectorAll('.mode-card').forEach((card) => {
    const go = () => { location.hash = `#/play?mode=${card.dataset.mode}`; };
    card.addEventListener('click', go);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    card.addEventListener('mousemove', (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${e.clientX - r.left}px`);
      card.style.setProperty('--my', `${e.clientY - r.top}px`);
    });
  });
  const openEntry = (i) => openEntryLightbox({
    ...featured[i], canReport: !!state.user, renderKind: featured[i].renderKind,
  });
  root.querySelectorAll('.creation-card').forEach((card) => {
    const i = Number(card.dataset.entry);
    card.addEventListener('click', () => openEntry(i));
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') openEntry(i); });
  });
  root.querySelectorAll('[data-proof]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const i = Number(b.dataset.proof);
    const entry = featured[i];
    openEntryLightbox({ ...entry, proofOnly: true });
    setTimeout(() => document.getElementById('elProof')?.click(), 80);
  }));

  /* countdowns on the live list */
  const tid = setInterval(() => {
    root.querySelectorAll('[data-deadline]').forEach((el) => {
      const dl = Number(el.dataset.deadline);
      if (!dl) { el.textContent = '—'; return; }
      const left = dl - Date.now();
      el.textContent = left > 0 ? fmtClock(left) : 'ending…';
    });
  }, 500);

  // maybe celebrate a fresh win that happened in this browser session
  if (state.user && (state.user.xp || 0) >= 12000) confetti({ duration: 2000, count: 60 });

  return () => clearInterval(tid);
}
