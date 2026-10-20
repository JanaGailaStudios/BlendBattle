/* Blend Battles — shared entry lightbox: final render + viewport proof + optional 3D */
import { openModal, closeModal, esc, toast, avatarHTML, starsStatic, mediaSrcKind, fmtDate, promptDialog, confirmDialog } from './ui.js';
import { state, api } from './core.js';
import { openFullscreenViewer } from './viewer.js';
import { requireAuth } from './views/auth.js';

export function openEntryLightbox(entry, { onReported = null } = {}) {
  if (!entry) return;
  const isVideo = entry.renderKind === 'video' || mediaSrcKind(entry.renderUrl) === 'video';
  const voted = entry.myVote || entry.score || 0;
  const body = `
    <div class="lightbox__body" style="padding:0">
      <div>
        <div class="lightbox__media" id="elMedia">
          ${isVideo
            ? `<video src="${esc(entry.renderUrl)}" controls playsinline autoplay loop muted></video>`
            : `<img src="${esc(entry.renderUrl)}" alt="${esc(entry.title || 'Final render')}" />`}
        </div>
        <div class="row row--wrap" style="margin-top:12px">
          <button class="btn btn--sm btn--outline" id="elProof">🔍 View proof</button>
          ${entry.hasModel || entry.modelUrl ? '<button class="btn btn--sm btn--ghost" id="el3d">🧊 3D preview</button>' : ''}
          ${entry.canReport ? '<button class="btn btn--sm btn--danger" id="elReport">⚑ Report</button>' : ''}
        </div>
        <div id="elExtra" style="margin-top:12px"></div>
      </div>
      <div class="lightbox__side">
        <div class="row">
          ${avatarHTML({ hue: entry.avatarHue, name: entry.displayName || entry.username })}
          <div>
            <b style="font-size:14px">${esc(entry.displayName || entry.username)}</b>
            <div style="font-size:11.5px;color:var(--muted)">${esc(entry.rank || '')}${entry.theme ? ' · ' + esc(entry.theme) : ''}</div>
          </div>
        </div>
        <div class="panel" style="padding:13px">
          <div class="row" style="justify-content:space-between">
            <span class="note">Average score</span>
            <b style="color:#ffd08a">${Number(entry.score || entry.avgScore || 0).toFixed(1)} ★</b>
          </div>
          <div class="row" style="margin-top:6px">${starsStatic(entry.score || entry.avgScore || 0)}</div>
          ${entry.votes != null || entry.voteCount != null ? `<div class="note" style="margin-top:8px">${entry.votes ?? entry.voteCount} vote(s) counted</div>` : ''}
          ${entry.submittedAt ? `<div class="note" style="margin-top:4px">Submitted ${esc(fmtDate(entry.submittedAt))}</div>` : ''}
        </div>
        <div class="proof-note">
          <b>Viewport proof is supporting evidence, not a guarantee.</b> Screenshots and viewport captures can be faked, and generated imagery can look convincing. Entries are judged by voters and reviewed by moderators when reported.
        </div>
        ${entry.reviewStatus && entry.reviewStatus !== 'clear' ? `<div class="pill pill--warn">Review status: ${esc(entry.reviewStatus)}</div>` : ''}
        <div class="proof-frame" id="elProofSlot" hidden></div>
      </div>
    </div>`;

  const inst = openModal({
    title: entry.title || entry.theme || 'Entry',
    sub: `${esc(entry.username || '')}${entry.place ? ` · finished #${entry.place}` : ''}`,
    body,
    wide: true,
    onMount: (root) => {
      wireEntryActions(root, entry, { onReported });
    },
  });
  return inst;
}

function wireEntryActions(root, entry, { onReported }) {
  const proofSlot = root.querySelector('#elProofSlot');
  const proofBtn = root.querySelector('#elProof');
  if (proofBtn) {
    let open = false;
    proofBtn.addEventListener('click', () => {
      open = !open;
      proofSlot.hidden = !open;
      if (open) {
        const proofIsVideo = entry.proofKind === 'video' || mediaSrcKind(entry.proofUrl) === 'video';
        proofSlot.innerHTML = entry.proofUrl
          ? (proofIsVideo
            ? `<video src="${esc(entry.proofUrl)}" controls playsinline></video>`
            : `<img src="${esc(entry.proofUrl)}" alt="Blender viewport proof" />`)
          : '<div class="note" style="padding:14px">No viewport proof is attached to this entry.</div>';
        proofBtn.textContent = '🔍 Hide proof';
        proofSlot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else proofBtn.textContent = '🔍 View proof';
    });
  }

  const three3d = root.querySelector('#el3d');
  if (three3d) {
    three3d.addEventListener('click', () => {
      openFullscreenViewer({
        modelUrl: entry.modelUrl || `/api/media/${entry.submissionId}/model`,
        hue: entry.avatarHue || 265,
        title: `${entry.title || entry.theme || 'Entry'} — 3D preview`,
      });
    });
  }

  const reportBtn = root.querySelector('#elReport');
  if (reportBtn) {
    reportBtn.addEventListener('click', async () => {
      if (!requireAuth('Sign in to report a submission.')) return;
      const reason = await chooseReportReason();
      if (!reason) return;
      const details = await promptDialog({
        title: 'Report submission',
        message: `Reason: <b>${esc(reason.label)}</b>. Add any detail that helps a moderator (timestamps, what looks wrong in the proof, etc.).`,
        placeholder: 'Optional detail for the moderator review…',
        multiline: true,
        required: false,
        confirmText: 'File report',
      });
      if (details === null) return;
      try {
        await api(`/api/matches/${entry.matchId}/report`, {
          method: 'POST',
          body: { submissionId: entry.submissionId, reason: reason.value, details },
        });
        toast('Report filed. A moderator will review the proof for this entry.', { type: 'success', title: 'Thanks — report received' });
        closeModal();
        if (onReported) onReported();
      } catch (err) {
        toast(err.message, { type: 'error' });
      }
    });
  }
}

function chooseReportReason() {
  const reasons = [
    { value: 'ai-generated', label: 'Looks AI-generated (not modelled)' },
    { value: 'not-their-work', label: 'Not their own work / stolen' },
    { value: 'proof-mismatch', label: 'Proof does not match the render' },
    { value: 'missing-proof', label: 'Proof is missing or useless' },
    { value: 'offensive', label: 'Offensive content' },
    { value: 'other', label: 'Something else' },
  ];
  return new Promise((resolve) => {
    let settled = false;
    openModal({
      title: 'Report this submission',
      sub: 'Reports go to the moderator queue with the render and viewport proof attached.',
      body: `<div class="stack">${reasons.map((r, i) => `<button class="btn btn--ghost" style="justify-content:flex-start" data-r="${i}">${esc(r.label)}</button>`).join('')}</div>`,
      onMount: (root) => {
        root.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => {
          settled = true;
          resolve(reasons[Number(b.dataset.r)]);
          closeModal();
        }));
      },
      actions: [{ label: 'Cancel', variant: 'btn--ghost', onClick: () => { settled = true; resolve(null); } }],
    });
    const rootEl = document.getElementById('modalRoot');
    const obs = new MutationObserver(() => {
      if (rootEl.hidden && !settled) { settled = true; resolve(null); obs.disconnect(); }
    });
    obs.observe(rootEl, { attributes: true, attributeFilter: ['hidden'] });
  });
}
