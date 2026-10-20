/* Blend Battles — lobby room: ready-up, host controls, countdown */
import { api, state, on, now } from '../core.js';
import { esc, toast, avatarHTML, loadingBlock, confirmDialog, sfx, fmtClock } from '../ui.js';
import { requireAuth } from './auth.js';

const MODE_ICONS = { build: '🧱', duo: '🤝', speed: '⚡', animation: '🎬', free: '🎨' };

export default async function lobby(root, params) {
  const code = String(params.code || '').toUpperCase();
  root.innerHTML = loadingBlock('Opening room…');
  let lobby = null;
  let lastSig = '';
  let timer = null;
  let overlayShown = false;
  let disposed = false;

  const cleanups = [];
  cleanups.push(on('lobby:update', (d) => { if (d.code === code) refresh(); }));
  cleanups.push(on('kicked', (d) => {
    if (d.code !== code) return;
    toast('You were removed from that lobby by the host.', { type: 'warn' });
    location.hash = '#/play';
  }));

  async function refresh(force = false) {
    if (disposed) return;
    try {
      const res = await api(`/api/lobbies/${code}`);
      const prev = lobby;
      lobby = res.lobby;
      if (lobby.matchId) { location.hash = `#/match/${lobby.matchId}`; return; }
      const sig = JSON.stringify({ ...lobby, serverNow: 0 });
      // only re-render when something actually changed (keeps clicks and inputs stable)
      if (force || sig !== lastSig || !prev) {
        lastSig = sig;
        draw();
      }
    } catch (err) {
      if (err.status === 404) {
        root.innerHTML = `<div class="empty"><div class="empty__icon">🚪</div><b>That room is gone</b><div>${esc(err.message)}</div><a class="btn btn--primary" href="#/play" style="margin-top:10px">Back to lobbies</a></div>`;
        clearInterval(timer);
      } else if (!lobby) {
        root.innerHTML = `<div class="empty"><div class="empty__icon">⚠</div><b>Could not open room</b><div>${esc(err.message)}</div><a class="btn btn--ghost" href="#/play" style="margin-top:10px">Back to lobbies</a></div>`;
      }
    }
  }

  function draw() {
    const l = lobby;
    const me = l.players.find((p) => state.user && p.userId === state.user.id);
    const humans = l.players.filter((p) => !p.isBot);
    const allReady = humans.every((p) => p.ready);
    const canStart = l.isHost && l.status === 'waiting';
    const shareLink = `${location.origin}${location.pathname}#/lobby/${l.code}`;

    root.innerHTML = `
      <div class="crumbs"><a href="#/">Home</a> / <a href="#/play">Play</a> / <span>Room ${esc(l.code)}</span></div>

      <div class="lobby__head">
        <div class="lobby-row__mode" style="width:52px;height:52px;font-size:24px">${MODE_ICONS[l.mode] || '🧱'}</div>
        <div style="flex:1;min-width:220px">
          <h1 style="font-size:clamp(22px,3.4vw,32px);font-weight:900;letter-spacing:-.03em">${esc(l.name)}</h1>
          <div class="row row--wrap" style="gap:8px;margin-top:7px">
            <span class="pill pill--purple">${esc(l.modeName)}</span>
            <span class="pill">${esc(l.difficulty)} themes</span>
            <span class="pill">${Math.round(l.buildSeconds / 60) || 0} min build</span>
            ${l.isPrivate ? '<span class="pill">🔒 private</span>' : '<span class="pill pill--good">public</span>'}
            ${l.customTheme ? `<span class="pill pill--warn">theme: ${esc(l.customTheme)}</span>` : ''}
            <span class="pill">${l.players.length}/${l.maxPlayers} players</span>
          </div>
        </div>
        <div class="room-code">${esc(l.code)} <button id="copyCode" title="Copy room code" aria-label="Copy room code">copy</button></div>
      </div>

      <div class="lobby-grid">
        <div class="stack" style="gap:16px">
          <div class="card" style="padding:16px">
            <div class="row" style="justify-content:space-between;margin-bottom:12px">
              <b style="font-size:14px">Contestants</b>
              <span class="note">${humans.filter((p) => p.ready).length}/${humans.length} humans ready</span>
            </div>
            <div class="stack" style="gap:8px" id="memberList">
              ${l.players.map((p) => `
                <div class="member-row ${p.ready ? 'is-ready' : ''}">
                  ${avatarHTML({ hue: p.avatarHue, name: p.name })}
                  <div style="flex:1;min-width:0">
                    <div class="member-row__name">
                      ${esc(p.name)}
                      ${p.isHost ? '<span class="pill pill--sm pill--purple">host</span>' : ''}
                      ${p.isBot ? '<span class="tag tag--bot">SIMULATED BOT</span>' : ''}
                      ${p.isGuest ? '<span class="tag tag--guest">guest</span>' : ''}
                      ${state.user && p.userId === state.user.id ? '<span class="tag">you</span>' : ''}
                    </div>
                    <div class="member-row__rank" style="color:${esc(p.rankColor)}">${esc(p.rank)} · Lv ${p.level}</div>
                  </div>
                  ${l.isHost && !p.isBot && p.userId !== l.hostId ? `<button class="btn btn--sm btn--danger" data-kick="${p.userId}">Remove</button>` : ''}
                  <div class="ready-tick" title="${p.ready ? 'Ready' : 'Not ready'}">${p.ready ? '✓' : '…'}</div>
                </div>`).join('')}
            </div>
            ${l.isHost && l.players.length < l.maxPlayers ? `
              <div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap">
                <button class="btn btn--sm btn--ghost" id="addBots">+ Add practice bots</button>
                <button class="btn btn--sm btn--ghost" id="fillBots">Fill to 4 with bots</button>
                <span class="note" style="margin-left:auto">Bots are simulated opponents for demo play.</span>
              </div>` : ''}
          </div>

          <div class="card lobby-start" style="padding:18px">
            ${l.status === 'starting' ? `
              <div class="center">
                <div class="row" style="justify-content:center;gap:8px"><span class="live-dot"></span><b>Match starting…</b></div>
                <div class="timer" style="justify-content:center;margin-top:10px"><div><div class="timer__value" id="startClock">--</div><div class="timer__label">Theme revealed at zero</div></div></div>
              </div>` : `
              <div class="row row--wrap" style="justify-content:space-between;gap:12px">
                <div>
                  <b style="font-size:15px">${me ? (me.ready ? 'You are ready' : 'Ready up when you are set') : 'Join this room to play'}</b>
                  <p class="note" style="margin-top:5px">${l.isHost ? 'As host you can start as soon as every human is ready.' : 'The host starts the match once everyone is ready.'}</p>
                </div>
                <div class="row" style="gap:8px;flex-wrap:wrap">
                  ${me ? `<button class="btn ${me.ready ? 'btn--ghost' : 'btn--accent'}" id="readyBtn">${me.ready ? 'Not ready' : '✓ Ready up'}</button>` : `<button class="btn btn--primary" id="joinBtn">Join room</button>`}
                  ${l.isHost ? `<button class="btn btn--primary" id="startBtn" ${(!allReady || l.players.length < 2) && l.mode !== 'free' ? 'disabled aria-disabled="true"' : ''}>▶ Start match</button>` : ''}
                </div>
              </div>
              ${l.isHost && (!allReady || l.players.length < 2) && l.mode !== 'free' ? `<p class="note" style="margin-top:10px;color:#ffc79b">${l.players.length < 2 ? 'Add at least one practice bot (or invite a friend) to start.' : 'Waiting for every human player to ready up.'}</p>` : ''}`}
            ${l.mode === 'duo' ? `<div class="callout callout--info" style="margin-top:14px;font-size:12.5px"><b>Duo mode:</b> contestants are paired in teams of two when the match starts. Either teammate can upload — the newest successful pair of files becomes the team entry.</div>` : ''}
          </div>

          <div class="card card--flat">
            <b style="font-size:14px">Before you start — competition rules</b>
            <ul class="reason-list" style="margin-top:10px">
              <li>✅ Every competitive entry needs <b>two uploads</b>: a final render and a Blender viewport proof.</li>
              <li>🎥 Animations require a video final render (MP4 / WebM).</li>
              <li>🚫 No AI-generated imagery, no bought/downloaded models presented as your own.</li>
              <li>🕵️ Moderators can request extra evidence and disqualify entries. Votes can be invalidated.</li>
              <li>⚠️ Viewport proof is supporting evidence — not absolute proof. Be honest, it's more fun.</li>
            </ul>
            <a class="section__link" href="#/rules" style="margin-top:12px;display:inline-flex">Read the full rules →</a>
          </div>
        </div>

        <div class="stack" style="gap:16px">
          <div class="card">
            <b style="font-size:14px">Invite friends</b>
            <p class="note" style="margin:6px 0 10px">Share this link — anyone with an account lands straight in this room.</p>
            <div class="row" style="gap:8px">
              <input class="input mono" id="shareLink" value="${esc(shareLink)}" readonly style="font-size:11.5px" />
              <button class="btn btn--sm btn--ghost" id="copyLink">Copy</button>
            </div>
            <div class="divider"></div>
            <div class="row" style="justify-content:space-between">
              <span class="note">Room code</span><b class="mono" style="letter-spacing:.18em">${esc(l.code)}</b>
            </div>
            <div class="row" style="justify-content:space-between;margin-top:8px">
              <span class="note">Host</span><b style="font-size:12.5px">${esc(l.players.find((p) => p.userId === l.hostId)?.name || '—')}</b>
            </div>
          </div>

          ${l.isHost ? `
          <div class="card">
            <b style="font-size:14px">Host settings</b>
            <div class="stack" style="gap:12px;margin-top:12px">
              <div class="field"><label for="hostTheme">Custom theme</label>
                <input class="input" id="hostTheme" value="${esc(l.customTheme || '')}" placeholder="Random theme" maxlength="40" />
              </div>
              <div class="form-grid">
                <div class="field"><label for="hostDiff">Difficulty</label>
                  <select class="select" id="hostDiff">
                    ${['any', 'easy', 'medium', 'hard'].map((d) => `<option value="${d}" ${l.difficulty === d ? 'selected' : ''}>${d}</option>`).join('')}
                  </select>
                </div>
                <div class="field"><label for="hostTime">Build time</label>
                  <select class="select" id="hostTime">
                    ${[120, 300, 600, 900, 1200].map((s) => `<option value="${s}" ${Number(l.buildSeconds) === s ? 'selected' : ''}>${Math.round(s / 60)} min</option>`).join('')}
                  </select>
                </div>
              </div>
              <button class="btn btn--ghost btn--block" id="saveSettings">Save settings</button>
            </div>
          </div>` : ''}

          <div class="card card--flat">
            <b style="font-size:14px">Match flow</b>
            <div class="stack" style="gap:9px;margin-top:10px">
              ${['Theme revealed at start', `${Math.round(l.buildSeconds / 60) || 0} min build timer`, 'Submission window opens for late uploads', 'Voting — 1–5 stars per entry', 'Podium + XP rewards'].map((s, i) => `<div class="row" style="gap:9px"><span class="pill pill--sm pill--purple">${i + 1}</span><span class="note">${esc(s)}</span></div>`).join('')}
            </div>
          </div>

          <button class="btn btn--danger btn--block" id="leaveBtn">Leave lobby</button>
        </div>
      </div>`;

    wire();
  }

  function wire() {
    const l = lobby;
    const me = l.players.find((p) => state.user && p.userId === state.user.id);
    const $ = (sel) => root.querySelector(sel);

    $('#copyCode')?.addEventListener('click', () => copy(l.code, 'Room code copied'));
    $('#copyLink')?.addEventListener('click', () => copy(`${location.origin}${location.pathname}#/lobby/${l.code}`, 'Invite link copied'));

    const doReady = async (ready) => {
      try {
        await api(`/api/lobbies/${l.code}/ready`, { method: 'POST', body: { ready } });
        sfx.ready();
        refresh(true);
      } catch (err) { toast(err.message, { type: 'error' }); }
    };
    $('#readyBtn')?.addEventListener('click', () => doReady(!me.ready));
    $('#joinBtn')?.addEventListener('click', async () => {
      if (!requireAuth('Sign in to join this room.')) return;
      try {
        await api(`/api/lobbies/${l.code}/join`, { method: 'POST', body: {} });
        refresh(true);
      } catch (err) { toast(err.message, { type: 'error' }); }
    });

    $('#startBtn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.classList.add('is-loading');
      try {
        await api(`/api/lobbies/${l.code}/start`, { method: 'POST', body: {} });
        sfx.start();
      } catch (err) {
        toast(err.message, { type: 'error', title: 'Cannot start yet' });
        btn.classList.remove('is-loading');
      }
    });

    $('#addBots')?.addEventListener('click', async () => {
      try { await api(`/api/lobbies/${l.code}/bots`, { method: 'POST', body: { count: 3 } }); refresh(true); }
      catch (err) { toast(err.message, { type: 'error' }); }
    });
    $('#fillBots')?.addEventListener('click', async () => {
      try { await api(`/api/lobbies/${l.code}/bots`, { method: 'POST', body: { count: 3, fill: true } }); refresh(true); }
      catch (err) { toast(err.message, { type: 'error' }); }
    });
    root.querySelectorAll('[data-kick]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Remove player?', message: 'They will be sent back to the lobby browser.', confirmText: 'Remove', danger: true });
      if (!ok) return;
      try { await api(`/api/lobbies/${l.code}/kick`, { method: 'POST', body: { userId: b.dataset.kick } }); refresh(true); }
      catch (err) { toast(err.message, { type: 'error' }); }
    }));

    $('#saveSettings')?.addEventListener('click', async () => {
      try {
        await api(`/api/lobbies/${l.code}/theme`, {
          method: 'POST',
          body: {
            customTheme: root.querySelector('#hostTheme').value.trim() || null,
            difficulty: root.querySelector('#hostDiff').value,
            buildSeconds: Number(root.querySelector('#hostTime').value),
          },
        });
        toast('Lobby settings saved.', { type: 'success' });
        refresh(true);
      } catch (err) { toast(err.message, { type: 'error' }); }
    });

    $('#leaveBtn')?.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Leave this lobby?', message: 'You can rejoin with the room code while the match has not started.', confirmText: 'Leave', danger: true });
      if (!ok) return;
      try {
        await api(`/api/lobbies/${l.code}/leave`, { method: 'POST', body: {} });
        location.hash = '#/play';
      } catch (err) { toast(err.message, { type: 'error' }); }
    });

    // countdown overlay
    if (l.status === 'starting' && l.startsAt) {
      if (!overlayShown) {
        overlayShown = true;
        const ov = document.createElement('div');
        ov.className = 'countdown-overlay';
        ov.innerHTML = `<div style="text-align:center">
          <div class="countdown-overlay__label">Match starting</div>
          <div class="countdown-overlay__num" id="ovNum">5</div>
          <div class="countdown-overlay__theme">${MODE_ICONS[l.mode] || '🧱'} ${esc(l.modeName)}${l.customTheme ? ' · ' + esc(l.customTheme) : ''}</div>
          <div class="note" style="margin-top:10px">Get Blender open. Theme drops at zero.</div>
        </div>`;
        document.body.appendChild(ov);
        const tick = () => {
          const left = Math.max(0, Math.ceil((l.startsAt - now()) / 1000));
          const el = ov.querySelector('#ovNum');
          if (el && el.textContent !== String(left)) {
            el.textContent = String(left);
            el.style.animation = 'none';
            void el.offsetWidth;
            el.style.animation = 'popNum .9s var(--ease)';
            sfx.tick();
          }
          if (left <= 0) { clearInterval(ovTimer); ov.remove(); }
        };
        const ovTimer = setInterval(tick, 250);
        tick();
        cleanups.push(() => { clearInterval(ovTimer); ov.remove(); });
      }
      const sc = root.querySelector('#startClock');
      if (sc) {
        const t2 = setInterval(() => {
          sc.textContent = fmtClock(l.startsAt - now());
        }, 250);
        cleanups.push(() => clearInterval(t2));
      }
    }
  }

  async function copy(text, msg) {
    try {
      await navigator.clipboard.writeText(text);
      toast(msg, { type: 'success' });
    } catch {
      toast('Copy failed — select the code manually.', { type: 'warn' });
    }
  }

  await refresh(true);
  timer = setInterval(() => refresh(), 6000); // polling fallback alongside SSE
  return () => {
    disposed = true;
    clearInterval(timer);
    cleanups.forEach((f) => f());
  };
}
