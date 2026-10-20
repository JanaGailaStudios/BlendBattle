/* Blend Battles — moderator review tools */
import { api, state } from '../core.js';
import { esc, toast, loadingBlock, confirmDialog, promptDialog, openModal, closeModal, timeAgo, wireImageFallbacks, mediaSrcKind } from '../ui.js';
import { login, refreshMe, requestRerender } from '../core.js';

const REASONS = {
  'ai-generated': 'Looks AI-generated',
  'not-their-work': 'Not their own work',
  'proof-mismatch': 'Proof does not match render',
  'missing-proof': 'Missing / useless proof',
  offensive: 'Offensive content',
  other: 'Other',
};

export default async function mod(root) {
  root.innerHTML = loadingBlock('Loading moderation queue…');
  let data;
  try {
    data = await api('/api/mod/queue');
  } catch (err) {
    if (err.status === 403 || err.status === 401) {
      root.innerHTML = `
        <div class="page-head"><h1>Moderation</h1>
        <p>Review reports, inspect viewport proof, invalidate fraudulent votes and disqualify entries that break the rules.</p></div>
        <div class="card" style="max-width:620px">
          <div class="row" style="gap:10px"><span style="font-size:26px">🛡️</span><b style="font-size:16px">Moderator access required</b></div>
          <p class="note" style="margin-top:10px">This area is restricted server-side: every moderation endpoint checks the <code>isMod</code> flag on your account. In this demo you can sign in with the seeded moderator account to try the workflow.</p>
          <div class="callout callout--info" style="margin-top:14px">
            <b>Demo moderator</b><br />username <code>modvex</code> · password <code>blendbattles</code>
          </div>
          <button class="btn btn--primary" id="modLogin" style="margin-top:6px">Sign in as demo moderator</button>
        </div>`;
      const btn = root.querySelector('#modLogin');
      btn.addEventListener('click', async () => {
        btn.classList.add('is-loading');
        try {
          if (state.user) await api('/api/auth/logout', { method: 'POST', body: {} });
          await login('modvex', 'blendbattles');
          await refreshMe();
          toast('Signed in as modvex (moderator).', { type: 'success' });
          requestRerender();
        } catch (e) {
          toast(e.message, { type: 'error' });
          btn.classList.remove('is-loading');
        }
      });
      return () => {};
    }
    throw err;
  }

  const tabs = ['Reports', 'Flagged entries', 'Votes', 'Audit log'];
  let active = 'Reports';

  root.innerHTML = `
    <div class="page-head">
      <div class="crumbs"><a href="#/">Home</a> / <span>Moderation</span></div>
      <h1>Moderation</h1>
      <p>Proof is supporting evidence, not proof of authorship. Use both files plus player reports to make the call — and never punish on an AI-detector score alone.</p>
    </div>

    <div class="grid grid--4" style="margin-bottom:18px">
      <div class="stat-tile"><b>${data.stats.openReports}</b><span>Open reports</span></div>
      <div class="stat-tile"><b>${data.flagged.length}</b><span>Flagged entries</span></div>
      <div class="stat-tile"><b>${data.stats.disqualified}</b><span>Disqualified</span></div>
      <div class="stat-tile"><b>${data.stats.invalidVotes}</b><span>Votes invalidated</span></div>
    </div>

    <div class="tabs" id="modTabs">${tabs.map((t) => `<button class="tab ${t === active ? 'is-active' : ''}" data-tab="${t}">${t}</button>`).join('')}</div>
    <div id="modBody"></div>`;

  const body = root.querySelector('#modBody');

  function proofButton(sub, label = 'View proof') {
    return `<button class="btn btn--sm btn--outline" data-proof='${esc(JSON.stringify({ url: sub.proofUrl, mime: sub.proofMime || '' }))}'>🔍 ${label}</button>`;
  }

  function paint() {
    if (active === 'Reports') {
      body.innerHTML = `
        <div class="stack" style="gap:14px">
          ${data.reports.length ? data.reports.map((r, i) => `
            <div class="card mod-card">
              <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
                <div class="row" style="gap:8px">
                  <span class="pill pill--bad">${esc(REASONS[r.reason] || r.reason)}</span>
                  <span class="pill pill--sm">${r.status}</span>
                  <span class="note">filed by ${esc(r.reporterName)} · ${timeAgo(r.createdAt)}</span>
                </div>
                <span class="note mono">${esc(r.id)}</span>
              </div>
              ${r.submission ? `
                <div class="mod-report">
                  <div class="mod-report__media">
                    <img src="${esc(r.submission.renderUrl)}" alt="Reported entry" loading="lazy" />
                  </div>
                  <div class="mod-report__body">
                    <div>
                      <b style="font-size:14px">${esc(r.submission.title || r.submission.theme)} · ${esc(r.submission.username)}</b>
                      <div class="note">${esc(r.submission.theme)} · ${r.submission.votes} votes · status ${esc(r.submission.reviewStatus)}${r.submission.disqualified ? ' · <span style="color:#ff9d9d">disqualified</span>' : ''}</div>
                    </div>
                    <p class="note" style="background:rgba(255,255,255,.03);padding:10px;border-radius:9px">“${esc(r.details || 'No extra detail supplied.')}”</p>
                    <div class="row row--wrap" style="gap:8px">
                      <button class="btn btn--sm btn--outline" data-proof='${esc(JSON.stringify({ url: r.submission.proofUrl, mime: '' }))}'>🔍 Inspect proof</button>
                      <button class="btn btn--sm btn--ghost" data-request="${esc(r.submission.id)}">Request more evidence</button>
                      <button class="btn btn--sm btn--good" data-dismiss="${esc(r.submission.id)}">Dismiss report</button>
                      <button class="btn btn--sm btn--danger" data-dq="${esc(r.submission.id)}">Disqualify entry</button>
                    </div>
                    <details>
                      <summary class="note" style="cursor:pointer">Audit trail for this entry</summary>
                      <div class="stack" style="gap:2px;margin-top:8px">
                        ${(r.submission.auditTrail || []).map((a) => `<div class="audit-row"><span class="audit-row__time">${new Date(a.at).toLocaleString()}</span><span><b>${esc(a.action)}</b> — ${esc(a.note || '')}</span></div>`).join('')}
                      </div>
                    </details>
                  </div>
                </div>` : '<div class="note">The reported submission no longer exists.</div>'}
            </div>`).join('') : '<div class="empty"><div class="empty__icon">✅</div><b>No reports in the queue</b><div>Reported entries will show up here with both files attached.</div></div>'}
        </div>`;
    } else if (active === 'Flagged entries') {
      body.innerHTML = `
        <div class="stack" style="gap:12px">
          ${data.flagged.length ? data.flagged.map((f) => `
            <div class="card mod-card">
              <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
                <div class="row" style="gap:8px">
                  <b style="font-size:14px">${esc(f.username)}</b>
                  <span class="note">${esc(f.theme || '—')}</span>
                  <span class="pill pill--sm ${f.reviewStatus === 'disqualified' ? 'pill--bad' : 'pill--warn'}">${esc(f.reviewStatus)}</span>
                  <span class="note">${f.voteCount} votes</span>
                </div>
                <div class="row" style="gap:8px">
                  <button class="btn btn--sm btn--outline" data-proof='${esc(JSON.stringify({ url: f.proofUrl, mime: '' }))}'>🔍 Proof</button>
                  <button class="btn btn--sm btn--ghost" data-request="${esc(f.id)}">Request evidence</button>
                  ${f.disqualified
                    ? `<button class="btn btn--sm btn--good" data-restore="${esc(f.id)}">Restore</button>`
                    : `<button class="btn btn--sm btn--danger" data-dq="${esc(f.id)}">Disqualify</button>`}
                </div>
              </div>
              ${f.reviewNote ? `<p class="note">Moderator note: ${esc(f.reviewNote)}</p>` : ''}
              <img src="${esc(f.renderUrl)}" alt="" style="width:170px;border-radius:10px;border:1px solid var(--line)" loading="lazy" />
            </div>`).join('') : '<div class="empty"><div class="empty__icon">🚩</div><b>No flagged entries</b><div>Entries with open reports or pending evidence requests appear here.</div></div>'}
        </div>`;
    } else if (active === 'Votes') {
      body.innerHTML = `
        <div class="card" style="padding:8px">
          <div class="row" style="justify-content:space-between;padding:10px 12px">
            <b style="font-size:14px">Recent votes</b>
            <span class="note">Invalidate votes that break the rules — averages are recalculated from non-invalidated votes only.</span>
          </div>
          <div class="stack" style="gap:6px;padding:0 6px 6px">
            ${data.votes.length ? data.votes.map((v) => `
              <div class="list-row" style="padding:8px 10px">
                <span class="pill pill--sm">${v.score} ★</span>
                <div class="list-row__main"><b>${esc(v.voterName)}</b><span>→ ${esc(v.entryName)} · ${timeAgo(v.createdAt)}</span></div>
                <button class="btn btn--sm btn--danger" data-invalidate="${esc(v.id)}">Invalidate</button>
              </div>`).join('') : '<div class="note" style="padding:12px">No votes recorded yet.</div>'}
          </div>
        </div>`;
    } else {
      body.innerHTML = `
        <div class="card">
          <div class="row" style="justify-content:space-between;margin-bottom:10px">
            <b style="font-size:14px">Audit log</b>
            <span class="note">Newest first · immutable history of moderation actions</span>
          </div>
          <div class="stack" style="gap:0">
            ${data.audit.map((a) => `<div class="audit-row">
              <span class="audit-row__time">${new Date(a.at).toLocaleString()}</span>
              <span><b>${esc(a.action)}</b> ${a.actor ? 'by ' + esc(a.actor) : ''} ${a.note ? '— ' + esc(a.note) : ''}</span>
            </div>`).join('')}
          </div>
        </div>`;
    }
    wire();
    wireImageFallbacks(body);
  }

  function openProof(sub) {
    if (!sub.url) return toast('No proof file attached to that entry.', { type: 'warn' });
    const isVideo = mediaSrcKind(sub.url, sub.mime) === 'video' || /\.(mp4|webm)$/i.test(sub.url);
    openModal({
      title: 'Viewport proof',
      sub: 'Supporting evidence — check that the UI, outliner and geometry are visible and consistent with the render.',
      wide: true,
      body: `<div class="proof-frame">${isVideo ? `<video src="${esc(sub.url)}" controls playsinline></video>` : `<img src="${esc(sub.url)}" alt="Viewport proof" />`}</div>
        <div class="proof-note" style="margin-top:12px">Remember: a screenshot can be faked. Weigh the render, the proof, the audit trail and any player reports together. Request a short screen recording when something smells wrong.</div>`,
      actions: [{ label: 'Close', variant: 'btn--ghost' }],
    });
  }

  async function act(fn, successMsg, { title = 'Confirm', message = '', danger = false, confirmText = 'Confirm' } = {}) {
    const ok = await confirmDialog({ title, message, danger, confirmText });
    if (!ok) return;
    try {
      await fn();
      toast(successMsg, { type: 'success' });
      const fresh = await api('/api/mod/queue');
      data = fresh;
      paint();
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  }

  function wire() {
    body.querySelectorAll('[data-tab]').forEach(() => {});
    body.querySelectorAll('[data-proof]').forEach((b) => b.addEventListener('click', () => {
      try { openProof(JSON.parse(b.dataset.proof)); } catch { toast('Could not open proof.', { type: 'error' }); }
    }));
    body.querySelectorAll('[data-dq]').forEach((b) => b.addEventListener('click', async () => {
      const reason = await promptDialog({
        title: 'Disqualify entry',
        message: 'This removes the entry from voting/results and locks uploads. The reason is stored in the audit log and shown to the artist.',
        placeholder: 'e.g. Render matches a stock AI image; viewport proof shows a different scene.',
        multiline: true,
        confirmText: 'Disqualify',
      });
      if (!reason) return;
      try {
        await api(`/api/mod/submissions/${b.dataset.dq}/disqualify`, { method: 'POST', body: { reason } });
        toast('Entry disqualified and logged.', { type: 'success' });
        data = await api('/api/mod/queue');
        paint();
      } catch (err) { toast(err.message, { type: 'error' }); }
    }));
    body.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', () => act(
      () => api(`/api/mod/submissions/${b.dataset.restore}/restore`, { method: 'POST', body: {} }),
      'Entry restored to good standing.',
      { title: 'Restore entry?', message: 'The disqualification is lifted and the entry returns to voting/results.' },
    )));
    body.querySelectorAll('[data-dismiss]').forEach((b) => b.addEventListener('click', () => act(
      () => api(`/api/mod/submissions/${b.dataset.dismiss}/dismiss`, { method: 'POST', body: {} }),
      'Report dismissed — evidence reviewed.',
      { title: 'Dismiss report?', message: 'Use this when the proof checks out and the report is unfounded.' },
    )));
    body.querySelectorAll('[data-request]').forEach((b) => b.addEventListener('click', async () => {
      const note = await promptDialog({
        title: 'Request additional evidence',
        message: 'The artist is notified and the entry is flagged as under review. Ask for something specific and easy to provide.',
        value: 'Please upload a 5–20s screen recording of the finished scene open in Blender, rotating the model in the viewport with the outliner visible.',
        multiline: true,
        confirmText: 'Send request',
      });
      if (!note) return;
      try {
        await api(`/api/mod/submissions/${b.dataset.request}/request-evidence`, { method: 'POST', body: { note } });
        toast('Evidence request sent to the artist.', { type: 'success' });
        data = await api('/api/mod/queue');
        paint();
      } catch (err) { toast(err.message, { type: 'error' }); }
    }));
    body.querySelectorAll('[data-invalidate]').forEach((b) => b.addEventListener('click', async () => {
      const reason = await promptDialog({
        title: 'Invalidate vote',
        message: 'Invalidated votes stop counting toward averages. Useful for obvious vote brigading or rule-breaking votes.',
        placeholder: 'Reason (stored in audit log)',
        confirmText: 'Invalidate vote',
      });
      if (!reason) return;
      try {
        await api(`/api/mod/votes/${b.dataset.invalidate}/invalidate`, { method: 'POST', body: { reason } });
        toast('Vote invalidated.', { type: 'success' });
        data = await api('/api/mod/queue');
        paint();
      } catch (err) { toast(err.message, { type: 'error' }); }
    }));
  }

  root.querySelectorAll('[data-tab]').forEach((t) => t.addEventListener('click', () => {
    active = t.dataset.tab;
    root.querySelectorAll('#modTabs .tab').forEach((x) => x.classList.toggle('is-active', x.dataset.tab === active));
    paint();
  }));

  paint();
  return () => {};
}
