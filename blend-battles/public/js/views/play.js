/* Blend Battles — lobby browser + room creation */
import { api, state, requestRerender, on } from '../core.js';
import { esc, toast, avatarHTML, loadingBlock, openModal, closeModal, emptyBlock } from '../ui.js';
import { requireAuth, openAuthModal } from './auth.js';
import { playNow } from './home.js';

const MODE_ICONS = { build: '🧱', duo: '🤝', speed: '⚡', animation: '🎬', free: '🎨' };

function modeChip(key, current) {
  const label = key === 'all' ? 'All modes' : (state.config?.modes || []).find((m) => m.key === key)?.name || key;
  return `<button class="chip ${current === key ? 'is-active' : ''}" data-mode="${key}">${key === 'all' ? '' : MODE_ICONS[key] + ' '}${esc(label)}</button>`;
}

export default async function play(root, params) {
  const initialMode = params?.mode || 'all';
  root.innerHTML = loadingBlock('Loading lobbies…');

  const cleanup = [];

  async function draw(mode) {
    const { lobbies } = await api('/api/lobbies');
    const filtered = mode === 'all' ? lobbies : lobbies.filter((l) => l.mode === mode);
    root.innerHTML = `
      <div class="page-head">
        <div class="crumbs"><a href="#/">Home</a> / <span>Play</span></div>
        <h1>Find your battle</h1>
        <p>Join a public room, spin up a private one for your friends, or jump straight into quick play. Every competitive match needs a final render <b>and</b> a Blender viewport proof before the timer ends.</p>
      </div>

      <div class="grid grid--3" style="margin-bottom:22px">
        <div class="card card--flat" style="grid-column:span 2">
          <div class="row row--wrap" style="justify-content:space-between">
            <div>
              <h3 style="font-size:16px">⚡ Quick play</h3>
              <p class="note" style="margin-top:4px">Instant lobby with practice bots so you can run a full match solo in ~2 minutes. Bots are clearly labelled in the lobby and on the results screen.</p>
            </div>
            <div class="row row--wrap" style="gap:8px">
              ${(state.config?.modes || []).filter((m) => m.key !== 'free').map((m) => `<button class="btn btn--sm btn--ghost" data-quick="${m.key}">${MODE_ICONS[m.key]} ${esc(m.name)}</button>`).join('')}
            </div>
          </div>
        </div>
        <div class="card card--flat">
          <h3 style="font-size:16px;margin-bottom:6px">🔑 Join with a code</h3>
          <div class="row" style="gap:8px">
            <input class="input" id="joinCode" placeholder="ABC123" maxlength="6" style="text-transform:uppercase;letter-spacing:.2em;font-family:var(--mono)" />
            <button class="btn btn--primary" id="joinBtn">Join</button>
          </div>
          <p class="note" style="margin-top:8px">Private rooms only show up here if you have the 6-character code or a share link.</p>
        </div>
      </div>

      <div class="row row--wrap" style="justify-content:space-between;margin-bottom:14px">
        <div class="filters">${['all', 'build', 'duo', 'speed', 'animation', 'free'].map((k) => modeChip(k, mode)).join('')}</div>
        <div class="row" style="gap:8px">
          <button class="btn btn--ghost btn--sm" id="refreshBtn">↻ Refresh</button>
          <button class="btn btn--accent" id="createBtn">+ Create lobby</button>
        </div>
      </div>

      <div class="card" style="padding:8px">
        ${filtered.length ? filtered.map(lobbyRow).join('') : emptyBlock({ icon: '🛰️', title: 'No open lobbies in this mode', text: 'Create one — or use quick play to start instantly with practice bots.', action: '<button class="btn btn--sm btn--accent" id="emptyCreate" style="margin-top:8px">+ Create lobby</button>' })}
      </div>

      <div class="section section--tight">
        <div class="section__head">
          <div>
            <h2 class="section__title"><span class="dot"></span> How a match runs</h2>
            <p class="section__sub">Same sequence every mode: build → submission window → voting → results. The server owns the clock, so refreshing the page never buys extra time.</p>
          </div>
        </div>
        <div class="grid grid--4">
          ${[
            ['1 · Lobby', 'Everyone readies up. Host picks a difficulty or a custom theme.'],
            ['2 · Build', 'Theme + countdown. Model in Blender on your own machine.'],
            ['3 · Submit', 'Two required uploads: final render + viewport proof.'],
            ['4 · Vote & results', '1–5 stars per entry, then podium, XP and rank.'],
          ].map(([t, d]) => `<div class="card card--flat"><b style="font-size:14px">${t}</b><p class="note" style="margin-top:6px">${d}</p></div>`).join('')}
        </div>
      </div>`;

    /* wiring */
    root.querySelectorAll('[data-mode]').forEach((c) => c.addEventListener('click', () => {
      const m = c.dataset.mode;
      history.replaceState(null, '', `#/play${m === 'all' ? '' : '?mode=' + m}`);
      draw(m);
    }));
    root.querySelectorAll('[data-quick]').forEach((b) => b.addEventListener('click', () => playNow(b.dataset.quick, b)));
    root.querySelectorAll('[data-join]').forEach((b) => b.addEventListener('click', () => joinLobby(b.dataset.join)));
    root.querySelector('#refreshBtn').addEventListener('click', () => draw(mode));
    root.querySelector('#createBtn').addEventListener('click', openCreateModal);
    const ec = root.querySelector('#emptyCreate');
    if (ec) ec.addEventListener('click', openCreateModal);
    root.querySelector('#joinBtn').addEventListener('click', () => {
      const code = root.querySelector('#joinCode').value.trim().toUpperCase();
      if (!/^[A-Z0-9]{4,8}$/.test(code)) return toast('Room codes are 6 letters/numbers.', { type: 'warn' });
      joinLobby(code);
    });
    root.querySelector('#joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') root.querySelector('#joinBtn').click(); });
  }

  function lobbyRow(l) {
    return `<div class="lobby-row" style="border-bottom:1px solid var(--line-soft)">
      <div class="lobby-row__mode">${MODE_ICONS[l.mode] || '🧱'}</div>
      <div class="lobby-row__main">
        <b>${esc(l.name)} ${l.isPrivate ? '<span class="pill pill--sm">🔒 private</span>' : ''}</b>
        <div class="lobby-row__meta">
          <span>${esc(l.modeName)}</span>
          <span>· ${esc(l.difficulty)} themes</span>
          <span>· ${Math.round(l.buildSeconds / 60) || 0} min build</span>
          <span>· code <b class="mono">${esc(l.code)}</b></span>
          ${l.status === 'starting' ? '<span class="pill pill--live pill--sm">starting</span>' : ''}
        </div>
      </div>
      <div class="avatars-stack">
        ${l.players.slice(0, 5).map((p) => avatarHTML({ hue: p.avatarHue, name: p.name, size: 'avatar--sm' })).join('')}
        ${l.players.length > 5 ? `<span class="avatar avatar--sm" style="background:#22222f;color:#9aa2b8">+${l.players.length - 5}</span>` : ''}
      </div>
      <div class="list-row__right" style="min-width:70px">${l.players.length}/${l.maxPlayers}<div class="note">players</div></div>
      <button class="btn btn--sm ${l.isMember ? 'btn--primary' : 'btn--ghost'}" data-join="${esc(l.code)}">${l.isMember ? 'Rejoin' : 'Join'}</button>
    </div>`;
  }

  async function joinLobby(code) {
    if (!requireAuth('Sign in to join a lobby.')) return;
    try {
      const { lobby } = await api(`/api/lobbies/${code}/join`, { method: 'POST', body: {} });
      toast(`Joined ${lobby.name}.`, { type: 'success' });
      location.hash = `#/lobby/${lobby.code}`;
    } catch (err) {
      toast(err.message, { type: 'error', title: 'Could not join' });
    }
  }

  async function openCreateModal() {
    if (!requireAuth('Sign in to create a lobby.')) return;
    const modes = state.config?.modes || [];
    openModal({
      title: 'Create a lobby',
      sub: 'You will be the host. Public rooms appear in the browser; private rooms are joinable by code or share link only.',
      body: `
        <div class="stack">
          <div class="field"><label for="lbName">Lobby name</label>
            <input class="input" id="lbName" placeholder="Friday night speed round" maxlength="40" />
            <span class="field__error"></span>
          </div>
          <div class="form-grid">
            <div class="field"><label for="lbMode">Mode</label>
              <select class="select" id="lbMode">
                ${modes.map((m) => `<option value="${m.key}">${esc(m.name)} — ${esc(m.tagline)}</option>`).join('')}
              </select>
            </div>
            <div class="field"><label for="lbPlayers">Max players</label>
              <select class="select" id="lbPlayers">${[2, 3, 4, 6, 8, 10, 12].map((n) => `<option value="${n}" ${n === 6 ? 'selected' : ''}>${n} players</option>`).join('')}</select>
            </div>
            <div class="field"><label for="lbDiff">Theme difficulty</label>
              <select class="select" id="lbDiff">
                <option value="any">Any difficulty</option>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>
            <div class="field"><label for="lbTime">Build time</label>
              <select class="select" id="lbTime">
                <option value="120">2 minutes (speed)</option>
                <option value="300" selected>5 minutes</option>
                <option value="600">10 minutes</option>
                <option value="900">15 minutes</option>
                <option value="1200">20 minutes</option>
              </select>
            </div>
          </div>
          <div class="field"><label for="lbTheme">Custom theme (optional)</label>
            <input class="input" id="lbTheme" placeholder="Leave blank for a random theme" maxlength="40" />
            <span class="field__hint">Custom themes bypass the random pool — handy for scrims and club events.</span>
          </div>
          <label class="checkbox"><input type="checkbox" id="lbPrivate" /> <span><b>Private room</b> — hidden from the browser, joinable by 6-character code or share link.</span></label>
          <div class="field__error" id="createErr" style="display:none"></div>
        </div>`,
      actions: [
        { label: 'Cancel', variant: 'btn--ghost' },
        {
          label: 'Create lobby', variant: 'btn--accent', onClick: async ({ root: mroot, btn }) => {
            const name = mroot.querySelector('#lbName').value.trim();
            const mode = mroot.querySelector('#lbMode').value;
            const err = mroot.querySelector('#createErr');
            err.style.display = 'none';
            if (name.length > 40) { err.textContent = 'Name is too long.'; err.style.display = 'block'; return true; }
            btn.classList.add('is-loading');
            try {
              const { lobby } = await api('/api/lobbies', {
                method: 'POST',
                body: {
                  name: name || undefined,
                  mode,
                  maxPlayers: Number(mroot.querySelector('#lbPlayers').value),
                  difficulty: mroot.querySelector('#lbDiff').value,
                  buildSeconds: Number(mroot.querySelector('#lbTime').value),
                  customTheme: mroot.querySelector('#lbTheme').value.trim() || null,
                  isPrivate: mroot.querySelector('#lbPrivate').checked,
                },
              });
              closeModal();
              toast(`Room ${lobby.code} created. Invite friends with the code.`, { type: 'success', title: 'Lobby ready' });
              location.hash = `#/lobby/${lobby.code}`;
            } catch (e2) {
              err.textContent = e2.message;
              err.style.display = 'block';
              btn.classList.remove('is-loading');
              return true;
            }
          },
        },
      ],
    });
  }

  await draw(initialMode);
  return () => cleanup.forEach((f) => f());
}
