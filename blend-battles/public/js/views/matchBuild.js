/* Blend Battles — build + submission phase (two required uploads) */
import { api, uploadFile, state } from '../core.js';
import {
  esc, toast, avatarHTML, fmtClock, fmtSize, mountCountdown, confirmDialog, openModal, closeModal, sfx, mediaSrcKind, wireImageFallbacks,
} from '../ui.js';

const MAX = { render: 48 * 1024 * 1024, proof: 64 * 1024 * 1024, model: 48 * 1024 * 1024 };

export default function renderBuild(root, ctx) {
  let match = ctx.match;
  const cleanups = [];
  let viewer = null;

  root.innerHTML = `
    <div id="matchHead"></div>
    <div id="stageBanner"></div>
    <div id="playersStrip" style="margin-bottom:16px"></div>
    <div class="submit-grid">
      <div class="stack" style="gap:16px">
        <div class="card upload-panel" data-panel="render">
          <div class="upload-panel__head">
            <div class="upload-panel__letter">A</div>
            <div>
              <div class="upload-panel__title">Final Render <span class="pill pill--sm pill--bad" data-req>required</span></div>
              <div class="upload-panel__sub">The polished creation voters judge. PNG / JPG / MP4 / WebM — up to ${fmtSize(MAX.render)}.</div>
            </div>
          </div>
          <div class="upload-panel__body" data-body></div>
        </div>

        <div class="card upload-panel upload-panel--proof" data-panel="proof">
          <div class="upload-panel__head">
            <div class="upload-panel__letter">B</div>
            <div>
              <div class="upload-panel__title">Blender Viewport Proof <span class="pill pill--sm pill--bad" data-req>required</span></div>
              <div class="upload-panel__sub">Screenshot or screen recording of the scene inside Blender itself — the interface visible, geometry inspectable.</div>
            </div>
          </div>
          <div class="upload-panel__body" data-body></div>
          <div class="upload-panel__body" style="padding-top:0">
            <div class="proof-tips">
              <h5>What valid proof looks like</h5>
              <ul>
                <li>Show the actual Blender UI — header, outliner, and viewport controls, not a cropped render.</li>
                <li>Solid or Material Preview shading so the geometry can be inspected.</li>
                <li>Include your scene contents in the outliner (object names are a strong signal).</li>
                <li>Video proof is stronger: 5–20 seconds of rotating the model and navigating the scene.</li>
                <li>Proof is <b>supporting evidence, not proof of authorship</b> — be honest, moderators review reports.</li>
              </ul>
            </div>
          </div>
        </div>

        <div class="card upload-panel" data-panel="model">
          <div class="upload-panel__head">
            <div class="upload-panel__letter" style="background:linear-gradient(135deg,#0ea5e9,#22d3ee);color:#04222b">C</div>
            <div>
              <div class="upload-panel__title">GLB / glTF model <span class="pill pill--sm">optional</span></div>
              <div class="upload-panel__sub">Attach the exported model so voters can inspect it in the 3D viewer. Never replaces the two required uploads.</div>
            </div>
          </div>
          <div class="upload-panel__body" data-body></div>
        </div>
      </div>

      <div class="stack" style="gap:16px">
        <div class="card">
          <div class="row" style="justify-content:space-between;margin-bottom:12px">
            <b style="font-size:14px">Submission checklist</b>
            <span class="pill pill--sm" id="statusPill">draft</span>
          </div>
          <div class="checklist" id="checklist"></div>
          <div class="divider"></div>
          <div class="field">
            <label for="entryTitle">Entry title <span style="opacity:.5;text-transform:none;letter-spacing:0">(optional)</span></label>
            <input class="input" id="entryTitle" maxlength="60" placeholder="e.g. Bolt-9 Service Unit" value="${esc(match.yourSubmission?.title || '')}" />
          </div>
          <div class="finalize-bar" style="margin-top:14px" id="finalizeBar">
            <button class="btn btn--accent" id="finalizeBtn" disabled aria-disabled="true">🔒 Finalize submission</button>
            <span class="note" id="finalizeHint">Both uploads must finish processing before you can finalize.</span>
          </div>
          <p class="note" style="margin-top:10px" id="deadlineNote"></p>
        </div>

        <div class="card card--flat" id="deadlineCard">
          <b style="font-size:14px">Deadline</b>
          <div class="timer" style="margin-top:8px">
            <div>
              <div class="timer__value countdown-inline" id="deadlineClock">--:--</div>
              <div class="timer__label" id="deadlineLabel">until uploads lock</div>
            </div>
          </div>
          <p class="note" style="margin-top:10px">Files can be replaced as often as you like until the clock hits zero. After that, the submission is locked server-side.</p>
        </div>

        <div class="card card--flat">
          <b style="font-size:14px">Submitting tips</b>
          <ul class="reason-list" style="margin-top:10px">
            <li>Render at least 1080p — voters are looking at detail.</li>
            <li>Keep your viewport proof one single capture of the finished scene.</li>
            <li>Compress long recordings under 20 seconds (WebM is smaller).</li>
            <li>You can keep modelling after uploading — just replace the files.</li>
          </ul>
        </div>
      </div>
    </div>

    <div class="glb-panel" id="viewerCard" hidden>
      <div class="card">
        <div class="row" style="justify-content:space-between;margin-bottom:10px">
          <b style="font-size:14px">3D preview</b>
          <button class="btn btn--sm btn--ghost" id="closeViewer">Close</button>
        </div>
        <div class="viewer-stage" id="viewerStage"><div class="viewer-loader"><div class="spinner"></div><div>Loading viewer…</div></div></div>
        <p class="note" style="margin-top:8px">Drag to orbit · scroll to zoom · right-drag to pan. Loads your uploaded GLB, or a demo model if none exists yet.</p>
      </div>
    </div>`;

  /* ------------------------------------------------------------- head + strip */
  function paintHead() {
    const phaseName = match.phase === 'building' ? 'Build phase' : 'Submission window';
    const pillClass = match.phase === 'building' ? 'pill--build' : 'pill--vote';
    root.querySelector('#matchHead').innerHTML = `
      <div class="match-head">
        <div class="match-head__top">
          <span class="pill ${pillClass}">${esc(phaseName)}</span>
          <span class="pill">${esc(match.modeName)}</span>
          <span class="pill">${esc(match.difficulty)}</span>
          ${match.requiresVideo ? '<span class="pill pill--warn">video render required</span>' : ''}
          <span class="spacer"></span>
          ${match.practice ? '<span class="pill pill--good">practice — no voting</span>' : ''}
        </div>
        <div class="row row--wrap" style="justify-content:space-between;gap:16px">
          <div style="min-width:240px">
            <div class="match-head__title">🎯 ${esc(match.theme)}</div>
            <div class="match-head__blurb">${esc(match.themeBlurb || 'Create a 3D model in Blender on this theme. Submit a final render plus viewport proof.')}</div>
          </div>
          <div class="timer">
            <div>
              <div class="timer__value countdown-inline" id="phaseClock">--:--</div>
              <div class="timer__label">${match.phase === 'building' ? 'build time left' : 'upload window'}</div>
            </div>
          </div>
        </div>
        <div class="progress" style="margin-top:16px"><i id="phaseProgress" style="width:0%"></i></div>
        <div class="row row--wrap" style="gap:16px;margin-top:12px;font-size:12px;color:var(--muted)">
          <span>🎨 ${match.counts.submissions}/${match.counts.players} entries submitted</span>
          <span>🗳️ ${match.counts.votesCast} votes queued</span>
          <span>👥 ${match.counts.players} contestants</span>
          ${match.mode === 'duo' ? `<span>🤝 your team: ${esc(match.yourSubmission?.teamLabel || '—')}</span>` : ''}
        </div>
      </div>`;
  }

  function paintBanner() {
    const el = root.querySelector('#stageBanner');
    if (match.phase === 'submission') {
      el.innerHTML = `<div class="stage-banner stage-banner--submission">⏳ <span><b>Build timer ended.</b> The submission window is open — late uploads still count, but they must finish before the clock reaches zero.</span></div>`;
    } else if (match.practice) {
      el.innerHTML = `<div class="stage-banner stage-banner--build">🎨 <span><b>Practice room.</b> No timer, no votes. Upload whenever you like and end the session when you are done.</span></div>`;
    } else {
      el.innerHTML = '';
    }
  }

  function paintPlayers() {
    root.querySelector('#playersStrip').innerHTML = `
      <div class="players-strip">
        ${match.players.map((p) => `
          <div class="player-chip ${p.submitted ? 'is-submitted' : ''}">
            ${avatarHTML({ hue: p.avatarHue, name: p.name, size: 'avatar--sm' })}
            <div>
              <div class="player-chip__name">${esc(p.name)}${p.isBot ? ' <span class="tag tag--bot">BOT</span>' : ''}</div>
              <div class="player-chip__state">${p.submitted ? '✓ submitted' : 'building…'}</div>
            </div>
          </div>`).join('')}
      </div>`;
  }

  /* --------------------------------------------------------------- uploaders */
  function panelState(kind) {
    const sub = match.yourSubmission || {};
    const file = sub.files ? sub.files[kind] : null;
    return { file, sub, locked: !match.canUpload };
  }

  function paintPanel(kind) {
    const panel = root.querySelector(`[data-panel="${kind}"]`);
    if (!panel) return;
    const body = panel.querySelector('[data-body]');
    const { file, locked } = panelState(kind);
    if (file) {
      const isVideo = mediaSrcKind(file.url, file.mime) === 'video';
      body.innerHTML = `
        <div class="preview-box">
          ${isVideo
            ? `<video src="${esc(file.url)}" controls playsinline preload="metadata"></video>`
            : `<img src="${esc(file.url)}" alt="${esc(kind === 'render' ? 'Final render preview' : 'Viewport proof preview')}" />`}
          <span class="preview-box__tag pill pill--good pill--sm">${kind === 'model' ? 'GLB attached' : 'processed ✓'}</span>
        </div>
        <div class="file-chip">
          <span class="file-chip__icon">${isVideo ? '🎬' : kind === 'model' ? '🧊' : '🖼️'}</span>
          <div class="file-chip__main">
            <div class="file-chip__name">${esc(file.name)}</div>
            <div class="file-chip__meta">${fmtSize(file.size)} · ${esc(file.mime)} · uploaded ${new Date(file.uploadedAt).toLocaleTimeString()}</div>
          </div>
          ${locked ? '<span class="pill pill--sm">🔒 locked</span>' : `
            <button class="btn btn--sm btn--ghost" data-replace="${kind}">Replace</button>
            <button class="btn btn--sm btn--danger" data-remove="${kind}">Remove</button>`}
        </div>
        <div class="status-line status-line--ok">✓ Validated on the server · ${kind === 'proof' ? 'shown to voters alongside your render' : 'ready for voting'}</div>`;
    } else {
      const accept = kind === 'model' ? '.glb,.gltf' : 'image/png,image/jpeg,video/mp4,video/webm';
      const label = kind === 'render' ? 'Drop your final render here' : kind === 'proof' ? 'Drop your Blender viewport capture here' : 'Drop your GLB / glTF here';
      body.innerHTML = `
        ${locked ? '<div class="callout callout--bad" style="margin-bottom:10px">Uploads are locked — the deadline has passed.</div>' : ''}
        <div class="dropzone" data-drop="${kind}" role="button" tabindex="0" aria-label="${esc(label)}">
          <div class="dropzone__icon">${kind === 'render' ? '🖼️' : kind === 'proof' ? '🎥' : '🧊'}</div>
          <div class="dropzone__title">${esc(label)}</div>
          <div class="dropzone__hint">or <b>browse files</b> · ${kind === 'model' ? '.glb / .gltf, up to ' + fmtSize(MAX.model) : kind === 'render' ? 'PNG, JPG, MP4, WebM · up to ' + fmtSize(MAX.render) : 'PNG, JPG, MP4, WebM · up to ' + fmtSize(MAX.proof)}</div>
          <input type="file" accept="${accept}" hidden data-input="${kind}" />
        </div>
        <div class="upload-progress" hidden data-progress="${kind}"><i></i></div>
        <div data-status="${kind}"></div>`;
    }
    wirePanel(kind);
  }

  function wirePanel(kind) {
    const panel = root.querySelector(`[data-panel="${kind}"]`);
    if (!panel) return;
    const body = panel.querySelector('[data-body]');
    const dz = body.querySelector(`[data-drop="${kind}"]`);
    const input = body.querySelector(`[data-input="${kind}"]`);
    if (dz && input && match.canUpload) {
      dz.addEventListener('click', () => input.click());
      dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
      input.addEventListener('change', () => { if (input.files[0]) doUpload(kind, input.files[0]); input.value = ''; });
      ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('is-over'); }));
      ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('is-over'); }));
      dz.addEventListener('drop', (e) => {
        const file = e.dataTransfer.files[0];
        if (file) doUpload(kind, file);
      });
    }
    body.querySelectorAll(`[data-replace="${kind}"]`).forEach((b) => b.addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = kind === 'model' ? '.glb,.gltf' : 'image/png,image/jpeg,video/mp4,video/webm';
      inp.addEventListener('change', () => { if (inp.files[0]) doUpload(kind, inp.files[0]); });
      inp.click();
    }));
    body.querySelectorAll(`[data-remove="${kind}"]`).forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Remove this file?', message: 'You can upload a different one straight after. Nothing is finalized until you press the finalize button.', confirmText: 'Remove file', danger: true });
      if (!ok) return;
      try {
        const res = await api(`/api/matches/${match.id}/file?kind=${kind}`, { method: 'DELETE' });
        match.yourSubmission = res.submission;
        paintAll();
        toast('File removed.', { type: 'info' });
      } catch (err) { toast(err.message, { type: 'error' }); }
    }));
  }

  function validate(kind, file) {
    const ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
    const okExt = kind === 'model' ? ['.glb', '.gltf'] : ['.png', '.jpg', '.jpeg', '.mp4', '.webm'];
    if (!okExt.includes(ext)) return `Unsupported file type ${ext}. Allowed: ${okExt.join(', ')}.`;
    if (file.size > MAX[kind]) return `File is ${fmtSize(file.size)} — the limit is ${fmtSize(MAX[kind])}.`;
    if (file.size === 0) return 'That file is empty.';
    if (match.requiresVideo && kind === 'render' && !/\.(mp4|webm)$/i.test(file.name) && !(file.type || '').startsWith('video')) {
      return 'Animation Battles require a video final render (MP4 or WebM).';
    }
    return null;
  }

  async function doUpload(kind, file) {
    const panel = root.querySelector(`[data-panel="${kind}"]`);
    const err = validate(kind, file);
    if (err) {
      toast(err, { type: 'error', title: 'Upload rejected' });
      sfx.error();
      return;
    }
    const progress = panel.querySelector(`[data-progress="${kind}"]`);
    if (progress) { progress.hidden = false; progress.querySelector('i').style.width = '4%'; }
    const dz = panel.querySelector(`[data-drop="${kind}"]`);
    if (dz) dz.classList.add('is-busy');
    let statusEl = panel.querySelector(`[data-status="${kind}"]`);
    if (statusEl) statusEl.innerHTML = `<div class="status-line status-line--busy"><span class="spinner" style="width:12px;height:12px"></span> Uploading ${esc(file.name)}…</div>`;
    try {
      const res = await uploadFile(`/api/matches/${match.id}/upload?kind=${kind}`, file, {
        onProgress: (pct) => {
          if (progress) progress.querySelector('i').style.width = `${pct}%`;
          if (statusEl) statusEl.innerHTML = `<div class="status-line status-line--busy"><span class="spinner" style="width:12px;height:12px"></span> Uploading… ${pct}%</div>`;
        },
      });
      match.yourSubmission = res.submission;
      sfx.upload();
      toast(`${kind === 'render' ? 'Final render' : kind === 'proof' ? 'Viewport proof' : 'GLB model'} uploaded and validated.`, { type: 'success', title: 'Upload complete' });
      paintAll();
      if (kind === 'model') openViewer();
    } catch (e) {
      sfx.error();
      if (statusEl) statusEl.innerHTML = `<div class="status-line status-line--err">⚠ ${esc(e.message)}</div>
        <button class="btn btn--sm btn--ghost" id="retry-${kind}" style="margin-top:8px">Retry upload</button>`;
      const retry = document.getElementById(`retry-${kind}`);
      if (retry) retry.addEventListener('click', () => doUpload(kind, file));
      toast(e.message, { type: 'error', title: 'Upload failed' });
      if (dz) dz.classList.remove('is-busy');
      if (progress) progress.hidden = true;
      return;
    }
  }

  /* ---------------------------------------------------------------- checklist */
  function paintChecklist() {
    const sub = match.yourSubmission || {};
    const files = sub.files || {};
    const hasRender = !!files.render;
    const hasProof = !!files.proof;
    const processed = hasRender && hasProof;
    const finalized = sub.status === 'submitted';
    const items = [
      { label: 'Final render uploaded', done: hasRender },
      { label: 'Blender viewport proof uploaded', done: hasProof },
      { label: 'Both files validated by the server', done: processed },
      { label: 'Submission finalized', done: finalized, pending: processed && !finalized },
    ];
    root.querySelector('#checklist').innerHTML = items.map((i) => `
      <div class="check-item ${i.done ? 'is-done' : i.pending ? 'is-pending' : ''}">
        <span class="check-item__box">${i.done ? '✓' : i.pending ? '!' : ''}</span>
        <span>${esc(i.label)}</span>
      </div>`).join('');

    const pill = root.querySelector('#statusPill');
    const status = sub.disqualified ? 'disqualified' : finalized ? 'submitted' : processed ? 'ready' : 'draft';
    pill.textContent = status;
    pill.className = `pill pill--sm ${status === 'submitted' ? 'pill--good' : status === 'ready' ? 'pill--vote' : status === 'disqualified' ? 'pill--bad' : ''}`;

    const btn = root.querySelector('#finalizeBtn');
    const hint = root.querySelector('#finalizeHint');
    const canFinalize = processed && match.canUpload && !sub.disqualified;
    btn.disabled = !canFinalize;
    btn.setAttribute('aria-disabled', String(!canFinalize));
    btn.innerHTML = finalized ? '✓ Submission finalized' : '🔒 Finalize submission';
    btn.classList.toggle('btn--good', finalized);
    hint.textContent = sub.disqualified
      ? 'This submission was disqualified by a moderator. Uploads are locked.'
      : !match.canUpload && !finalized
        ? 'The submission deadline has passed. Only finalized entries enter voting.'
        : finalized
          ? 'Locked in. You can still replace files until the deadline — re-finalize to confirm.'
          : processed
            ? 'Both files are validated. Lock it in when you are happy with the render.'
            : 'Both uploads must finish processing before you can finalize.';
    const dl = root.querySelector('#deadlineNote');
    if (dl) {
      dl.innerHTML = match.uploadDeadline
        ? `Uploads lock at <b class="countdown-inline" data-upload-deadline="${match.uploadDeadline}">--:--</b>.`
        : 'Practice room — no upload deadline.';
    }
    const dcard = root.querySelector('#deadlineCard');
    if (dcard) dcard.hidden = !match.uploadDeadline;
  }

  function paintAll() {
    paintHead();
    paintBanner();
    paintPlayers();
    ['render', 'proof', 'model'].forEach(paintPanel);
    paintChecklist();
    const titleInput = root.querySelector('#entryTitle');
    if (titleInput && match.yourSubmission) titleInput.value = match.yourSubmission.title || titleInput.value;
    startCountdowns();
  }

  /* --------------------------------------------------------------- countdowns */
  function startCountdowns() {
    cleanups.forEach((f) => f());
    cleanups.length = 0;
    const phaseEl = root.querySelector('#phaseClock');
    if (phaseEl && match.phaseEndsAt) {
      cleanups.push(mountCountdown(phaseEl, match.phaseEndsAt, {
        onZero: () => ctx.refreshSoon(600),
      }));
    } else if (phaseEl) {
      phaseEl.textContent = '∞';
    }
    const dlEl = root.querySelector('[data-upload-deadline]');
    if (dlEl && match.uploadDeadline) cleanups.push(mountCountdown(dlEl, match.uploadDeadline, { onZero: () => ctx.refreshSoon(600) }));

    const total = (match.phase === 'building' ? match.settings.buildSeconds : Math.max(20, Math.round(match.settings.buildSeconds * 0.25))) * 1000;
    const prog = root.querySelector('#phaseProgress');
    if (prog && match.phaseEndsAt) {
      const t = setInterval(() => {
        if (!prog.isConnected) return clearInterval(t);
        const left = match.phaseEndsAt - Date.now();
        prog.style.width = `${Math.max(0, Math.min(100, (1 - left / total) * 100))}%`;
      }, 500);
      cleanups.push(() => clearInterval(t));
    }
  }

  /* ------------------------------------------------------------------ actions */
  root.querySelector('#finalizeBtn').addEventListener('click', async () => {
    const title = root.querySelector('#entryTitle')?.value.trim() || '';
    const ok = await confirmDialog({
      title: 'Finalize this submission?',
      message: `Your final render and viewport proof will be entered into voting${title ? ` as <b>${esc(title)}</b>` : ''}. You can still replace files until the deadline.`,
      confirmText: 'Finalize entry',
    });
    if (!ok) return;
    try {
      const res = await api(`/api/matches/${match.id}/submit`, { method: 'POST', body: { title } });
      match.yourSubmission = res.submission;
      sfx.success();
      paintAll();
      showSubmitConfirmation();
    } catch (err) {
      toast(err.message, { type: 'error', title: 'Could not finalize' });
    }
  });

  root.querySelector('#entryTitle').addEventListener('change', async (e) => {
    if (!match.yourSubmission || match.yourSubmission.status !== 'submitted') return;
    try {
      const res = await api(`/api/matches/${match.id}/submit`, { method: 'POST', body: { title: e.target.value.trim() } });
      match.yourSubmission = res.submission;
      toast('Entry title updated.', { type: 'success' });
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  });

  async function openViewer() {
    const card = root.querySelector('#viewerCard');
    card.hidden = false;
    const stage = root.querySelector('#viewerStage');
    stage.innerHTML = '<div class="viewer-loader"><div class="spinner"></div><div>Loading 3D viewer…</div></div>';
    try {
      const { createViewer } = await import('../viewer.js');
      if (viewer) { viewer.dispose(); viewer = null; }
      viewer = await createViewer(stage, { hue: state.user?.avatarHue || 265 });
      const modelUrl = match.yourSubmission?.files?.model?.url;
      if (modelUrl) {
        const info = await viewer.loadGLB(modelUrl);
        stage.insertAdjacentHTML('beforeend', `<span class="viewer-hint">${info.triangles.toLocaleString()} tris · drag to orbit</span>`);
      } else {
        stage.querySelector('.viewer-loader')?.remove();
        stage.insertAdjacentHTML('beforeend', '<span class="viewer-hint">demo geometry — upload a GLB to inspect your own</span>');
      }
    } catch (err) {
      stage.innerHTML = `<div class="viewer-loader" style="color:#ffb4b4">⚠ ${esc(err.message)}</div>`;
    }
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  root.querySelector('#closeViewer').addEventListener('click', () => {
    root.querySelector('#viewerCard').hidden = true;
    if (viewer) { viewer.dispose(); viewer = null; }
  });

  function showSubmitConfirmation() {
    const sub = match.yourSubmission;
    openModal({
      title: 'Submission confirmed',
      sub: 'Locked in for this round.',
      body: `
        <div class="stack">
          <div class="check-item is-done"><span class="check-item__box">✓</span><span>Final render received</span></div>
          <div class="check-item is-done"><span class="check-item__box">✓</span><span>Blender viewport proof received</span></div>
          <div class="check-item is-done"><span class="check-item__box">✓</span><span>Entry finalized at ${esc(new Date(sub.submittedAt || Date.now()).toLocaleTimeString())}</span></div>
          <div class="callout callout--info">You can keep replacing files until the deadline. Files are locked permanently once the timer hits zero.</div>
        </div>`,
      actions: [
        { label: 'Keep editing', variant: 'btn--ghost' },
        { label: 'Back to lobby', variant: 'btn--primary', onClick: () => { location.hash = `#/play`; } },
      ],
    });
  }

  paintAll();
  wireImageFallbacks(root);

  return {
    update(next) {
      const phaseChanged = next.phase !== match.phase;
      const filesKey = JSON.stringify(next.yourSubmission?.files || {});
      const changedFiles = filesKey !== JSON.stringify(match.yourSubmission?.files || {});
      match = next;
      if (phaseChanged) {
        paintAll();
        if (next.phase === 'submission') toast('Build timer ended — submission window is open.', { type: 'warn', title: 'Time' });
      } else {
        paintPlayers();
        if (changedFiles) paintAll();
        paintChecklist();
      }
    },
    destroy() {
      cleanups.forEach((f) => f());
      if (viewer) viewer.dispose();
    },
  };
}
