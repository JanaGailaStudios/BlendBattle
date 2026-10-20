/* Blend Battles — gallery of finished entries */
import { api, state } from '../core.js';
import { esc, toast, avatarHTML, loadingBlock, emptyBlock, wireImageFallbacks } from '../ui.js';
import { openEntryLightbox } from '../entry.js';
import { openFullscreenViewer } from '../viewer.js';

export default async function gallery(root) {
  root.innerHTML = loadingBlock('Loading the gallery…');
  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  const filters = {
    theme: query.get('theme') || '',
    mode: query.get('mode') || '',
    sort: query.get('sort') || 'recent',
    mine: query.get('mine') === '1',
  };

  const data = await api('/api/gallery');
  const themes = [...new Set(data.items.map((i) => i.theme))].sort();
  const modes = [...new Set(data.items.map((i) => i.mode))];

  const filtered = data.items
    .filter((i) => (!filters.theme || i.theme === filters.theme))
    .filter((i) => (!filters.mode || i.mode === filters.mode))
    .filter((i) => (!filters.mine || (state.user && i.username === state.user.username)))
    .sort((a, b) => (filters.sort === 'top' ? b.score - a.score : b.endedAt - a.endedAt));

  root.innerHTML = `
    <div class="page-head">
      <div class="crumbs"><a href="#/">Home</a> / <span>Gallery</span></div>
      <h1>The gallery</h1>
      <p>Every finished entry, with its final render, Blender viewport proof and — where the artist attached one — an interactive GLB you can orbit in the browser.</p>
    </div>

    <div class="row row--wrap" style="justify-content:space-between;gap:12px;margin-bottom:16px">
      <div class="filters">
        <select class="select" id="fTheme" style="width:auto;min-width:150px">
          <option value="">All themes</option>
          ${themes.map((t) => `<option value="${esc(t)}" ${filters.theme === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
        </select>
        <select class="select" id="fMode" style="width:auto;min-width:150px">
          <option value="">All modes</option>
          ${modes.map((m) => `<option value="${esc(m)}" ${filters.mode === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}
        </select>
        ${state.user ? `<label class="chip ${filters.mine ? 'is-active' : ''}" id="fMine" style="cursor:pointer">Only mine</label>` : ''}
      </div>
      <div class="filters">
        <button class="chip ${filters.sort === 'recent' ? 'is-active' : ''}" data-sort="recent">Newest</button>
        <button class="chip ${filters.sort === 'top' ? 'is-active' : ''}" data-sort="top">Highest rated</button>
      </div>
    </div>

    <div class="row" style="margin-bottom:12px"><span class="note">${filtered.length} entr${filtered.length === 1 ? 'y' : 'ies'}${filters.theme ? ` in ${esc(filters.theme)}` : ''}</span></div>

    <div class="gallery-grid" id="galleryGrid">
      ${filtered.length ? filtered.map((item, i) => `
        <article class="gcard" data-item="${i}" tabindex="0" role="button" aria-label="${esc(item.title)} by ${esc(item.username)}">
          <div class="gcard__media">
            ${item.renderKind === 'video'
              ? `<video src="${esc(item.renderUrl)}" muted loop playsinline preload="metadata"></video>`
              : `<img src="${esc(item.renderUrl)}" alt="${esc(item.title)}" loading="lazy" />`}
            <div class="gcard__badges">
              ${item.place && item.place <= 3 ? `<span class="pill pill--sm" style="background:rgba(8,8,13,.8)">${['🥇', '🥈', '🥉'][item.place - 1]} #${item.place}</span>` : ''}
              ${item.hasModel ? '<span class="pill pill--sm" style="background:rgba(8,8,13,.8)">🧊 3D</span>' : ''}
              ${item.reviewStatus && item.reviewStatus !== 'clear' ? '<span class="pill pill--sm pill--warn">review</span>' : ''}
            </div>
          </div>
          <div class="gcard__info">
            <div class="row" style="justify-content:space-between;gap:8px">
              <b>${esc(item.title)}</b>
              <span style="color:#ffd08a;font-weight:800;font-size:12.5px">★ ${Number(item.score).toFixed(1)}</span>
            </div>
            <div class="row" style="gap:7px;margin-top:7px">
              ${avatarHTML({ hue: item.avatarHue, name: item.username, size: 'avatar--sm' })}
              <div class="gcard__sub" style="margin:0">${esc(item.username)} · ${esc(item.theme)}</div>
            </div>
          </div>
        </article>`).join('') : emptyBlock({
        icon: '🖼️', title: 'No entries match those filters',
        text: 'Try a different theme or clear the filters.',
        action: '<button class="btn btn--sm btn--ghost" id="clearFilters" style="margin-top:8px">Clear filters</button>',
      })}
    </div>

    <div class="card" style="margin-top:22px">
      <div class="row row--wrap" style="justify-content:space-between;gap:12px">
        <div>
          <b style="font-size:14px">About the proof button</b>
          <p class="note" style="margin-top:4px;max-width:640px">Every card opens the entry with a <b>View proof</b> action. Proof is supporting evidence only: it makes cheating harder and gives moderators something to review, but it is not a cryptographic guarantee of authorship.</p>
        </div>
        <a class="btn btn--sm btn--ghost" href="#/rules">Rules & proof guidance</a>
      </div>
    </div>`;

  wireImageFallbacks(root);

  const updateUrl = () => {
    const q = new URLSearchParams();
    if (filters.theme) q.set('theme', filters.theme);
    if (filters.mode) q.set('mode', filters.mode);
    if (filters.sort !== 'recent') q.set('sort', filters.sort);
    if (filters.mine) q.set('mine', '1');
    const qs = q.toString();
    history.replaceState(null, '', `#/gallery${qs ? '?' + qs : ''}`);
    gallery(root);
  };

  root.querySelector('#fTheme').addEventListener('change', (e) => { filters.theme = e.target.value; updateUrl(); });
  root.querySelector('#fMode').addEventListener('change', (e) => { filters.mode = e.target.value; updateUrl(); });
  root.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => { filters.sort = b.dataset.sort; updateUrl(); }));
  const mine = root.querySelector('#fMine');
  if (mine) mine.addEventListener('click', () => { filters.mine = !filters.mine; updateUrl(); });
  const clear = root.querySelector('#clearFilters');
  if (clear) clear.addEventListener('click', () => { filters.theme = ''; filters.mode = ''; filters.mine = false; updateUrl(); });

  root.querySelectorAll('.gcard').forEach((card) => {
    const item = filtered[Number(card.dataset.item)];
    const open = () => openEntryLightbox({ ...item, canReport: !!state.user });
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    // hover: play videos
    const vid = card.querySelector('video');
    if (vid) {
      card.addEventListener('mouseenter', () => { vid.play().catch(() => {}); });
      card.addEventListener('mouseleave', () => { vid.pause(); });
    }
  });
  return () => {};
}
