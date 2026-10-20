/* Blend Battles — match orchestrator: dispatches build / voting / results */
import { api, state, on } from '../core.js';
import { loadingBlock, esc, toast, sfx } from '../ui.js';
import renderBuild from './matchBuild.js';
import renderVoting from './matchVoting.js';
import renderResults from './matchResults.js';

export default async function matchView(root, params) {
  const id = params.id;
  let match = null;
  let inner = null;
  let disposed = false;
  let refreshTimer = null;
  let lastPhase = null;

  root.innerHTML = `<div id="matchInner">${loadingBlock('Entering match…')}</div>`;
  const innerEl = () => root.querySelector('#matchInner');

  const ctx = {
    get match() { return match; },
    refreshSoon(ms = 300) {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => refresh(), ms);
    },
    repaint() { mountInner(true); },
  };

  async function refresh() {
    if (disposed) return;
    try {
      const res = await api(`/api/matches/${id}`);
      const prev = match;
      match = res.match;
      if (!prev) {
        mountInner(false);
      } else if (prev.phase !== match.phase) {
        announcePhase(prev.phase, match.phase);
        mountInner(false);
      } else if (inner && inner.update) {
        inner.update(match);
      } else {
        mountInner(false);
      }
      lastPhase = match.phase;
    } catch (err) {
      if (!match) {
        root.innerHTML = `<div class="empty"><div class="empty__icon">🔒</div><b>Can't open this match</b>
          <div>${esc(err.message)}</div>
          <div class="row" style="gap:8px;margin-top:12px"><a class="btn btn--primary" href="#/play">Browse lobbies</a><a class="btn btn--ghost" href="#/gallery">Gallery</a></div></div>`;
      } else {
        toast(err.message, { type: 'error', ttl: 3000 });
      }
    }
  }

  function announcePhase(from, to) {
    const map = {
      submission: ['Build timer ended', 'Submission window is open — finish your two uploads.', 'warn'],
      voting: ['Voting has started', 'Score the other entries. Results stay hidden until it closes.', 'info'],
      results: ['Results are in', 'Podium, scores and XP have been published.', 'success'],
    };
    const m = map[to];
    if (m) toast(m[1], { type: m[2], title: m[0], ttl: 6000 });
    if (to === 'voting' || to === 'results') sfx.start();
  }

  function mountInner(force) {
    if (!match) return;
    if (inner && inner.destroy) inner.destroy();
    inner = null;
    if (force && innerEl()) innerEl().innerHTML = '';
    const container = document.createElement('div');
    if (!innerEl()) return;
    innerEl().innerHTML = '';
    innerEl().appendChild(container);
    const renderer = match.phase === 'voting' ? renderVoting : match.phase === 'results' ? renderResults : renderBuild;
    inner = renderer(container, ctx);
  }

  const offs = [
    on('match:update', (d) => { if (d.id === id) refresh(); }),
    on('me', () => refresh()),
  ];

  await refresh();
  const poll = setInterval(refresh, 3000);

  return () => {
    disposed = true;
    clearInterval(poll);
    clearTimeout(refreshTimer);
    offs.forEach((f) => f());
    if (inner && inner.destroy) inner.destroy();
  };
}
