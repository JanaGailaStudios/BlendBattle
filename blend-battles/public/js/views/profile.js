/* Blend Battles — player profile, history, settings */
import { api, state, refreshMe, requestRerender, logout } from '../core.js';
import { esc, toast, avatarHTML, loadingBlock, confirmDialog, fmtDate, timeAgo, sfx, wireImageFallbacks, setSound } from '../ui.js';
import { openEntryLightbox } from '../entry.js';
import { openAuthModal } from './auth.js';

const BADGE_INFO = {
  'first-blood': ['🥇', 'First Victory'],
  regular: ['🔁', 'Regular'],
  'podium-hunter': ['🏆', 'Podium Hunter'],
  'legend-track': ['♛', 'Legend Track'],
  moderator: ['🛡️', 'Moderator'],
};

const TABS = ['Overview', 'Match history', 'Creations', 'Settings'];

export default async function profile(root, params) {
  const id = params?.id || state.user?.id;
  if (!id) {
    root.innerHTML = `<div class="empty" style="margin-top:40px">
      <div class="empty__icon">👤</div>
      <b>No profile loaded</b>
      <div>Sign in with an account to keep your rank, or try guest mode to look around.</div>
      <div class="row" style="gap:8px;margin-top:12px">
        <button class="btn btn--primary" id="pSignIn">Sign in</button>
        <a class="btn btn--ghost" href="#/play">Browse lobbies</a>
      </div></div>`;
    root.querySelector('#pSignIn').addEventListener('click', () => openAuthModal({}));
    return;
  }

  root.innerHTML = loadingBlock('Loading profile…');
  let data;
  try {
    data = await api(`/api/users/${id}`);
  } catch (err) {
    root.innerHTML = `<div class="empty" style="margin-top:40px"><div class="empty__icon">⚠</div><b>Profile unavailable</b><div>${esc(err.message)}</div><a class="btn btn--ghost" href="#/leaderboard" style="margin-top:10px">Back to ladder</a></div>`;
    return;
  }

  const u = data.user;
  const isSelf = state.user && state.user.id === u.id;
  const [challenges, friendProfiles] = await Promise.all([
    isSelf ? api('/api/challenges').catch(() => ({ daily: [], weekly: [] })) : Promise.resolve({ daily: [], weekly: [] }),
    (async () => {
      const ids = (state.user && isSelf ? state.user.friends : []) || [];
      return (await Promise.all(ids.slice(0, 8).map((fid) => api(`/api/users/${fid}`).catch(() => null)))).filter(Boolean);
    })(),
  ]);

  const winRate = u.stats.matches ? Math.round((u.stats.wins / u.stats.matches) * 100) : 0;

  root.innerHTML = `
    <div class="crumbs"><a href="#/">Home</a> / <a href="#/leaderboard">Leaderboard</a> / <span>${esc(u.username)}</span></div>

    <div class="card" style="padding:24px;background:radial-gradient(circle at 12% 0%,hsla(${u.avatarHue},80%,60%,.16),var(--panel) 60%)">
      <div class="profile-head">
        ${avatarHTML({ hue: u.avatarHue, name: u.username, size: 'avatar--xl' })}
        <div class="profile-head__id">
          <div class="profile-head__name">
            ${esc(u.username)}
            ${u.isMod ? '<span class="tag tag--mod">MODERATOR</span>' : ''}
            ${u.isGuest ? '<span class="tag tag--guest">GUEST</span>' : ''}
            ${u.isDemo ? '<span class="tag">demo account</span>' : ''}
          </div>
          <div class="profile-head__meta">
            <span class="rank-badge" style="color:${esc(u.rankColor)}">${esc(u.rank)}</span>
            <span>Level ${u.level}</span>
            <span>${u.location || u.region}</span>
            <span>joined ${fmtDate(u.createdAt)}</span>
            <span>${u.friends} friend${u.friends === 1 ? '' : 's'}</span>
          </div>
          ${u.bio ? `<p class="note" style="margin-top:10px;max-width:600px">${esc(u.bio)}</p>` : ''}
          <div class="rank-bar">
            <div class="rank-bar__labels">
              <span>${esc(u.rank)} · ${u.xp.toLocaleString()} XP</span>
              <span>${u.nextRank ? `${u.xpToNextRank.toLocaleString()} XP → ${esc(u.nextRank)}` : 'Maximum rank reached'}</span>
            </div>
            <div class="progress"><i style="width:${u.rankPct}%"></i></div>
          </div>
          <div class="row row--wrap" style="gap:8px;margin-top:14px">
            ${isSelf
              ? '<button class="btn btn--sm btn--accent" id="quickPlay">▶ Play a match</button><button class="btn btn--sm btn--ghost" id="toSettings">Edit profile</button>'
              : `<button class="btn btn--sm btn--ghost" id="addFriend">${u.isFriend ? '✓ Friend' : '+ Add friend'}</button>`}
            ${u.isMod ? '<a class="btn btn--sm btn--outline" href="#/mod">Moderation tools</a>' : ''}
            <a class="btn btn--sm btn--ghost" href="#/gallery${isSelf ? '?mine=1' : ''}">Gallery</a>
          </div>
        </div>
        <div class="stat-grid" style="min-width:250px;flex:1">
          <div class="stat-tile"><b>${u.stats.matches}</b><span>Matches</span></div>
          <div class="stat-tile"><b>${u.stats.wins}</b><span>Wins</span></div>
          <div class="stat-tile"><b>${winRate}%</b><span>Win rate</span></div>
          <div class="stat-tile"><b>${u.stats.avgScore ? Number(u.stats.avgScore).toFixed(1) : '—'}</b><span>Avg score</span></div>
        </div>
      </div>
      ${u.badges.length ? `<div class="badge-list" style="margin-top:18px">
        ${u.badges.map((b) => {
          const info = BADGE_INFO[b] || ['✦', b];
          return `<span class="badge-chip">${info[0]} ${esc(info[1])}</span>`;
        }).join('')}
      </div>` : '<div class="note" style="margin-top:16px">No badges yet — finish a match to earn the first one.</div>'}
    </div>

    <div class="tabs" style="margin-top:22px">
      ${TABS.filter((t) => t !== 'Settings' || isSelf).map((t, i) => `<button class="tab ${i === 0 ? 'is-active' : ''}" data-tab="${t}">${t}</button>`).join('')}
    </div>
    <div id="tabBody"></div>`;

  wireImageFallbacks(root);

  const body = root.querySelector('#tabBody');

  function overviewTab() {
    const found = [...challenges.daily, ...challenges.weekly];
    return `
      <div class="grid grid--3" style="align-items:start">
        <div class="card" style="grid-column:span 2">
          <div class="row" style="justify-content:space-between;margin-bottom:12px">
            <b style="font-size:15px">Recent matches</b>
            <button class="section__link" data-goto="Match history">All matches →</button>
          </div>
          ${(data.matches || []).slice(0, 5).map(historyRow).join('') || '<div class="note">No matches played yet.</div>'}
        </div>
        <div class="card">
          <b style="font-size:15px">Progress</b>
          <div class="stack" style="gap:12px;margin-top:12px">
            <div>
              <div class="row" style="justify-content:space-between"><span class="note">Level ${u.level}</span><span class="note">${u.levelPct}%</span></div>
              <div class="progress" style="margin-top:6px"><i style="width:${u.levelPct}%"></i></div>
            </div>
            <div class="row" style="justify-content:space-between"><span class="note">Votes received</span><b>${u.stats.votes || 0}</b></div>
            <div class="row" style="justify-content:space-between"><span class="note">Podium finishes</span><b>${u.stats.podiums || 0}</b></div>
            <div class="row" style="justify-content:space-between"><span class="note">Best average</span><b>${u.stats.avgScore ? Number(u.stats.avgScore).toFixed(1) + ' ★' : '—'}</b></div>
          </div>
          ${isSelf ? `<div class="divider"></div>
            <b style="font-size:13px">Friends</b>
            <div class="stack" style="gap:7px;margin-top:8px">
              ${friendProfiles.length ? friendProfiles.map((f) => `
                <a class="row" href="#/player/${f.user.id}" style="gap:8px">
                  ${avatarHTML({ hue: f.user.avatarHue, name: f.user.username, size: 'avatar--sm' })}
                  <span style="font-size:12.5px">${esc(f.user.username)}</span>
                  <span class="spacer"></span>
                  <span class="note">${esc(f.user.rank)}</span>
                </a>`).join('') : '<div class="note">No friends yet — add artists from the ladder.</div>'}
            </div>` : ''}
        </div>
      </div>
      ${isSelf ? `
      <div class="section section--tight">
        <div class="section__head">
          <div><h2 class="section__title" style="font-size:19px"><span class="dot"></span> Challenges</h2>
          <p class="section__sub">Daily challenges reset at midnight; weekly ones roll every seven days. Claiming is validated server-side.</p></div>
        </div>
        <div class="grid grid--2">
          <div class="card"><b style="font-size:14px">☀ Daily</b>
            <div class="stack" style="gap:10px;margin-top:12px">${challenges.daily.map(challengeRow).join('')}</div>
          </div>
          <div class="card"><b style="font-size:14px">🗓 Weekly</b>
            <div class="stack" style="gap:10px;margin-top:12px">${challenges.weekly.map(challengeRow).join('')}</div>
          </div>
        </div>
      </div>` : ''}
      ${found.length === 0 ? '' : ''}`;
  }

  function challengeRow(c) {
    return `<div class="row" style="gap:10px;align-items:flex-start">
      <div style="flex:1;min-width:0">
        <div class="row" style="justify-content:space-between;gap:8px">
          <b style="font-size:12.5px">${esc(c.title)}</b>
          <span class="note">+${c.xp} XP</span>
        </div>
        <div class="note">${esc(c.desc)}</div>
        <div class="progress" style="margin-top:6px;height:4px"><i style="width:${Math.round((c.progress / c.target) * 100)}%"></i></div>
      </div>
      ${c.claimed
        ? '<span class="pill pill--sm pill--good">claimed</span>'
        : c.complete
          ? `<button class="btn btn--sm btn--accent" data-claim="${c.id}">Claim</button>`
          : `<span class="pill pill--sm">${c.progress}/${c.target}</span>`}
    </div>`;
  }

  function historyRow(m) {
    return `<div class="history-row">
      <div class="place-chip ${m.place && m.place <= 3 ? 'place-chip--' + m.place : ''}">${m.place ? '#' + m.place : '—'}</div>
      <img class="mini-render" src="${esc(m.renderUrl || '/img/logo.png')}" alt="" loading="lazy" />
      <div style="flex:1;min-width:0">
        <b style="font-size:13px">${esc(m.theme)}</b>
        <div class="note">${esc(m.modeName)} · ${timeAgo(m.endedAt)} · ${m.players} players</div>
      </div>
      <div style="text-align:right">
        <b style="color:#ffd08a;font-size:13px">${m.score != null ? Number(m.score).toFixed(1) + ' ★' : '—'}</b>
        <div class="note">${m.practice ? 'practice' : m.place === 1 ? 'won' : m.place ? 'placed' : ''}</div>
      </div>
      ${m.submissionId ? `<button class="btn btn--sm btn--ghost" data-proofsub="${m.submissionId}">Proof</button>` : ''}
    </div>`;
  }

  function historyTab() {
    if (!data.canSeeHistory) {
      return `<div class="empty"><div class="empty__icon">🔒</div><b>Match history is private</b><div>This player keeps their match history hidden in privacy settings.</div></div>`;
    }
    return `
      <div class="card">
        <div class="row" style="justify-content:space-between;margin-bottom:12px">
          <b style="font-size:15px">Match history</b>
          <span class="note">${(data.matches || []).length} shown · ${data.matchCount} total</span>
        </div>
        <div class="history-list">
          ${(data.matches || []).map(historyRow).join('') || '<div class="note">No completed matches yet.</div>'}
        </div>
      </div>`;
  }

  function creationsTab() {
    return `
      <div class="gallery-grid">
        ${(data.creations || []).map((c, i) => `
          <article class="gcard" data-creation="${i}" tabindex="0" role="button">
            <div class="gcard__media">
              ${c.renderKind === 'video'
                ? `<video src="${esc(c.renderUrl)}" muted loop playsinline preload="metadata"></video>`
                : `<img src="${esc(c.renderUrl)}" alt="${esc(c.theme)}" loading="lazy" />`}
              <div class="gcard__badges">${c.place && c.place <= 3 ? `<span class="pill pill--sm" style="background:rgba(8,8,13,.8)">${['🥇', '🥈', '🥉'][c.place - 1]} #${c.place}</span>` : ''}</div>
            </div>
            <div class="gcard__info"><b>${esc(c.theme)}</b><div class="gcard__sub">${esc(c.mode)} · ${c.score ? Number(c.score).toFixed(1) + ' ★' : 'unscored'}</div></div>
          </article>`).join('') || `<div class="empty" style="grid-column:1/-1"><div class="empty__icon">🎨</div><b>No creations yet</b><div>Every finalized entry shows up here with its render and proof.</div><a class="btn btn--sm btn--accent" href="#/play" style="margin-top:8px">Play a match</a></div>`}
      </div>`;
  }

  function settingsTab() {
    return `
      <div class="grid grid--2" style="align-items:start">
        <div class="card">
          <b style="font-size:15px">Profile settings</b>
          <div class="stack" style="gap:14px;margin-top:14px">
            <div class="field"><label for="sUsername">Username</label>
              <input class="input" id="sUsername" value="${esc(u.username)}" maxlength="18" />
              <span class="field__hint">3–18 characters. Letters, numbers, underscore.</span>
              <span class="field__error"></span>
            </div>
            <div class="field"><label for="sBio">Bio</label>
              <textarea class="textarea" id="sBio" maxlength="240" placeholder="What do you model?">${esc(u.bio || '')}</textarea>
            </div>
            <div class="field"><label for="sHue">Avatar colour</label>
              <input type="range" id="sHue" min="0" max="359" value="${u.avatarHue}" style="width:100%" />
              <div class="row" style="gap:10px;margin-top:6px" id="huePreview">${avatarHTML({ hue: u.avatarHue, name: u.username })}<span class="note">Preview</span></div>
            </div>
            <div class="form-grid">
              <div class="field"><label for="sRegion">Region</label>
                <select class="select" id="sRegion">${['EU', 'NA', 'APAC', 'SA', 'AF'].map((r) => `<option ${u.region === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
              </div>
              <div class="field"><label for="sLocation">Location</label>
                <input class="input" id="sLocation" value="${esc(u.location || '')}" maxlength="60" placeholder="City, Country" />
              </div>
            </div>
            <div class="field"><label>Privacy</label>
              <label class="checkbox"><input type="checkbox" id="sHistory" ${u.privacy?.showHistory !== false ? 'checked' : ''} /> <span>Show my match history and gallery to other players</span></label>
              <label class="checkbox" style="margin-top:8px"><input type="checkbox" id="sFriendsLb" ${u.privacy?.friendsOnlyLeaderboard ? 'checked' : ''} /> <span>Prefer friends-only leaderboard by default</span></label>
            </div>
            <div class="field"><label>Sound</label>
              <label class="checkbox"><input type="checkbox" id="sSfx" ${state.soundOn ? 'checked' : ''} /> <span>UI sound effects (synthesised, no downloads)</span></label>
            </div>
            <button class="btn btn--primary" id="saveProfile">Save changes</button>
          </div>
        </div>
        <div class="stack" style="gap:16px">
          <div class="card">
            <b style="font-size:15px">Account</b>
            <div class="stack" style="gap:10px;margin-top:12px">
              <div class="row" style="justify-content:space-between"><span class="note">Signed in as</span><b>${esc(u.username)}</b></div>
              <div class="row" style="justify-content:space-between"><span class="note">XP</span><b>${u.xp.toLocaleString()}</b></div>
              <div class="row" style="justify-content:space-between"><span class="note">Rank</span><b style="color:${esc(u.rankColor)}">${esc(u.rank)}</b></div>
              <div class="row" style="justify-content:space-between"><span class="note">Account type</span><b>${u.isGuest ? 'Guest session' : 'Registered'}</b></div>
              <div class="divider"></div>
              <button class="btn btn--ghost btn--block" id="settingsLogout">Sign out</button>
            </div>
          </div>
          <div class="card">
            <b style="font-size:15px">Friends</b>
            <div class="stack" style="gap:8px;margin-top:12px">
              ${friendProfiles.length ? friendProfiles.map((f) => `
                <div class="row" style="gap:8px">
                  ${avatarHTML({ hue: f.user.avatarHue, name: f.user.username, size: 'avatar--sm' })}
                  <span style="font-size:12.5px">${esc(f.user.username)}</span>
                  <span class="spacer"></span>
                  <button class="btn btn--sm btn--danger" data-unfriend="${f.user.id}">Remove</button>
                </div>`).join('') : '<div class="note">Add friends from the ladder or a lobby to build private rooms together.</div>'}
            </div>
            <div class="divider"></div>
            <div class="row" style="gap:8px">
              <input class="input" id="friendName" placeholder="Search a username" />
              <button class="btn btn--sm btn--ghost" id="findFriend">Find</button>
            </div>
            <div id="friendResult" class="note" style="margin-top:8px"></div>
          </div>
          <div class="card card--flat">
            <b style="font-size:13px">Danger zone</b>
            <p class="note" style="margin:8px 0">Deleting an account is not exposed in this demo. Data lives in a local JSON file on this machine — remove <code>data/</code> to reset everything.</p>
          </div>
        </div>
      </div>`;
  }

  function mountTab(name) {
    body.innerHTML = name === 'Match history' ? historyTab() : name === 'Creations' ? creationsTab() : name === 'Settings' ? settingsTab() : overviewTab();
    root.querySelectorAll('[data-tab]').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === name));
    wireImageFallbacks(body);
    wireTab(name);
  }

  function wireTab(name) {
    body.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => mountTab(b.dataset.goto)));
    body.querySelectorAll('[data-claim]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const res = await api(`/api/challenges/${b.dataset.claim}/claim`, { method: 'POST', body: {} });
        sfx.success();
        toast(`+${res.awarded} XP claimed.`, { type: 'success', title: 'Challenge complete' });
        await refreshMe();
        requestRerender();
      } catch (err) { toast(err.message, { type: 'error' }); }
    }));
    body.querySelectorAll('[data-proofsub]').forEach((b) => b.addEventListener('click', () => {
      openEntryLightbox({
        submissionId: b.dataset.proofsub,
        proofUrl: `/api/media/${b.dataset.proofsub}/proof`,
        renderUrl: `/api/media/${b.dataset.proofsub}/render`,
        username: u.username, rank: u.rank, avatarHue: u.avatarHue,
        title: 'Match entry', canReport: false,
      }, {});
      setTimeout(() => document.getElementById('elProof')?.click(), 90);
    }));
    body.querySelectorAll('[data-creation]').forEach((card) => card.addEventListener('click', () => {
      const c = data.creations[Number(card.dataset.creation)];
      openEntryLightbox({
        ...c, username: u.username, rank: u.rank, avatarHue: u.avatarHue, canReport: false,
      });
    }));

    if (name === 'Settings') {
      const hue = body.querySelector('#sHue');
      hue?.addEventListener('input', () => {
        const prev = body.querySelector('#huePreview');
        prev.innerHTML = `${avatarHTML({ hue: Number(hue.value), name: body.querySelector('#sUsername').value || u.username })}<span class="note">Preview</span>`;
      });
      body.querySelector('#saveProfile')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const username = body.querySelector('#sUsername').value.trim();
        if (!/^[A-Za-z0-9_]{3,18}$/.test(username)) return toast('Username must be 3–18 characters.', { type: 'error' });
        btn.classList.add('is-loading');
        try {
          await api('/api/me', {
            method: 'PATCH',
            body: {
              username,
              bio: body.querySelector('#sBio').value,
              avatarHue: Number(hue.value),
              region: body.querySelector('#sRegion').value,
              location: body.querySelector('#sLocation').value,
              privacy: {
                showHistory: body.querySelector('#sHistory').checked,
                friendsOnlyLeaderboard: body.querySelector('#sFriendsLb').checked,
              },
              settings: { sfx: body.querySelector('#sSfx').checked, reducedMotion: false },
            },
          });
          setSound(body.querySelector('#sSfx').checked);
          await refreshMe();
          toast('Profile updated.', { type: 'success' });
          requestRerender();
        } catch (err) {
          toast(err.message, { type: 'error' });
          btn.classList.remove('is-loading');
        }
      });
      body.querySelector('#settingsLogout')?.addEventListener('click', async () => {
        const ok = await confirmDialog({ title: 'Sign out?', message: 'Your progress is stored on the server, so you can sign back in later.', confirmText: 'Sign out' });
        if (!ok) return;
        await logout();
        location.hash = '#/';
        requestRerender();
      });
      body.querySelectorAll('[data-unfriend]').forEach((b) => b.addEventListener('click', async () => {
        try {
          await api('/api/me/friends', { method: 'POST', body: { action: 'remove', userId: b.dataset.unfriend } });
          await refreshMe();
          mountTab('Settings');
          toast('Friend removed.', { type: 'info' });
        } catch (err) { toast(err.message, { type: 'error' }); }
      }));
      body.querySelector('#findFriend')?.addEventListener('click', async () => {
        const term = body.querySelector('#friendName').value.trim();
        const out = body.querySelector('#friendResult');
        if (!term) { out.textContent = 'Type a username first.'; return; }
        out.textContent = 'Searching…';
        try {
          const lb = await api('/api/leaderboard?scope=global');
          const found = lb.entries.find((x) => x.username.toLowerCase() === term.toLowerCase());
          if (!found) { out.textContent = 'No player with that exact username.'; return; }
          out.innerHTML = `Found <b>${esc(found.username)}</b> — <a href="#/player/${found.id}">view profile</a>`;
          const btn = document.createElement('button');
          btn.className = 'btn btn--sm btn--primary';
          btn.style.marginLeft = '8px';
          btn.textContent = state.user.friendsList?.includes?.(found.id) ? 'Already friends' : 'Add friend';
          btn.addEventListener('click', async () => {
            try {
              await api('/api/me/friends', { method: 'POST', body: { action: 'add', userId: found.id } });
              await refreshMe();
              toast(`${found.username} added to your friends.`, { type: 'success' });
              mountTab('Settings');
            } catch (err) { toast(err.message, { type: 'error' }); }
          });
          out.appendChild(btn);
        } catch (err) { out.textContent = err.message; }
      });
    }
  }

  root.querySelectorAll('[data-tab]').forEach((t) => t.addEventListener('click', () => mountTab(t.dataset.tab)));
  mountTab('Overview');
  root.querySelector('#quickPlay')?.addEventListener('click', () => { location.hash = '#/play'; });
  root.querySelector('#toSettings')?.addEventListener('click', () => mountTab('Settings'));
  root.querySelector('#addFriend')?.addEventListener('click', async () => {
    if (!state.user) return openAuthModal({ reason: 'Sign in to add friends.' });
    try {
      const action = u.isFriend ? 'remove' : 'add';
      await api('/api/me/friends', { method: 'POST', body: { action, userId: u.id } });
      toast(action === 'add' ? `${u.username} added to your friends.` : `${u.username} removed.`, { type: 'success' });
      requestRerender();
    } catch (err) { toast(err.message, { type: 'error' }); }
  });

  return () => {};
}
