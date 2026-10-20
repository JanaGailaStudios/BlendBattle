'use strict';
const { prng, esc } = require('./util');
const { themeByName } = require('./themes');

/** Stylised fallback "render" used when no demo artwork exists for a theme. */
function makeRenderSVG(themeName, seed = 'x') {
  const rand = prng(themeName + seed);
  const t = themeByName(themeName);
  const hue = Math.floor(rand() * 360);
  const hue2 = (hue + 90 + Math.floor(rand() * 120)) % 360;
  const shapes = [];
  for (let i = 0; i < 9; i++) {
    const cx = 200 + rand() * 800;
    const cy = 150 + rand() * 600;
    const r = 30 + rand() * 130;
    const rot = rand() * 180;
    const op = 0.25 + rand() * 0.5;
    const kind = rand();
    if (kind < 0.33) {
      shapes.push(`<rect x="${(cx - r).toFixed(1)}" y="${(cy - r).toFixed(1)}" width="${(r * 2).toFixed(1)}" height="${(r * 2).toFixed(1)}" rx="${(r * 0.18).toFixed(1)}" fill="hsl(${hue2} 80% ${45 + rand() * 25}%)" opacity="${op.toFixed(2)}" transform="rotate(${rot.toFixed(1)} ${cx.toFixed(1)} ${cy.toFixed(1)})"/>`);
    } else if (kind < 0.66) {
      shapes.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="hsl(${hue2} 85% ${55 + rand() * 20}%)" opacity="${op.toFixed(2)}"/>`);
    } else {
      shapes.push(`<polygon points="${cx.toFixed(1)},${(cy - r).toFixed(1)} ${(cx + r).toFixed(1)},${(cy + r * 0.7).toFixed(1)} ${(cx - r).toFixed(1)},${(cy + r * 0.7).toFixed(1)}" fill="hsl(${hue2} 90% ${50 + rand() * 25}%)" opacity="${op.toFixed(2)}"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="75%">
      <stop offset="0%" stop-color="hsl(${hue} 60% 18%)"/>
      <stop offset="100%" stop-color="#07070c"/>
    </radialGradient>
    <filter id="blur"><feGaussianBlur stdDeviation="26"/></filter>
  </defs>
  <rect width="1200" height="900" fill="url(#bg)"/>
  <g filter="url(#blur)" opacity="0.85">
    <circle cx="${(300 + rand() * 200).toFixed(0)}" cy="${(250 + rand() * 150).toFixed(0)}" r="220" fill="hsl(${hue} 90% 55%)" opacity="0.5"/>
    <circle cx="${(800 + rand() * 200).toFixed(0)}" cy="${(600 + rand() * 120).toFixed(0)}" r="260" fill="hsl(${hue2} 90% 55%)" opacity="0.35"/>
  </g>
  ${shapes.join('\n  ')}
  <rect y="770" width="1200" height="130" fill="#05050a" opacity="0.55"/>
  <text x="60" y="828" font-family="Inter,Segoe UI,sans-serif" font-size="42" font-weight="800" fill="#ffffff" opacity="0.92">${esc(themeName)}</text>
  <text x="60" y="866" font-family="Inter,Segoe UI,sans-serif" font-size="21" fill="#ffffff" opacity="0.5">Simulated demo render</text>
  <g opacity="0.55">
    <rect x="1020" y="806" width="120" height="34" rx="8" fill="none" stroke="#ffffff" stroke-opacity="0.4"/>
    <text x="1080" y="829" text-anchor="middle" font-family="Inter,sans-serif" font-size="16" fill="#fff">DEMO</text>
  </g>
</svg>`;
}

/**
 * A stylised mock of the Blender UI with the model in the 3D viewport, used as
 * demo/simulated "viewport proof". Real players must upload their own screenshot.
 */
function makeProofSVG(themeName, seed = 'x', author = 'sim') {
  const rand = prng(themeName + seed + author);
  const wire = [];
  const cx = 430, cy = 330;
  // wireframe-ish silhouette
  for (let i = 0; i < 34; i++) {
    const x1 = cx + (rand() - 0.5) * 420;
    const y1 = cy + (rand() - 0.5) * 300;
    const x2 = x1 + (rand() - 0.5) * 170;
    const y2 = y1 + (rand() - 0.5) * 150;
    wire.push(`<line x1="${x1.toFixed(0)}" y1="${y1.toFixed(0)}" x2="${x2.toFixed(0)}" y2="${y2.toFixed(0)}" stroke="#7fd4ff" stroke-opacity="${(0.18 + rand() * 0.5).toFixed(2)}" stroke-width="1"/>`);
  }
  const polys = [];
  for (let i = 0; i < 14; i++) {
    const x = cx + (rand() - 0.5) * 380;
    const y = cy + (rand() - 0.5) * 260;
    const s = 22 + rand() * 46;
    polys.push(`<polygon points="${x.toFixed(0)},${y.toFixed(0)} ${(x + s).toFixed(0)},${(y + s * 0.6).toFixed(0)} ${(x - s * 0.2).toFixed(0)},${(y + s).toFixed(0)}" fill="#ff9a3d" fill-opacity="${(0.12 + rand() * 0.3).toFixed(2)}" stroke="#ffb457" stroke-opacity="0.5"/>`);
  }
  const outline = [{ x: 't', t: 'Cube' }, { x: 't', t: 'Camera' }, { x: 't', t: 'Light' }, { x: 't', t: 'Model_Body' }, { x: 't', t: 'Model_Detail' }, { x: 't', t: 'Material_Slot' }];
  const rows = outline.map((o, i) => `<text x="946" y="${146 + i * 24}" font-family="Inter,sans-serif" font-size="13" fill="#c9cbd6"><tspan fill="#e8a33d">${i < 3 ? '▣' : '◈'}</tspan>  ${esc(o.t)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" viewBox="0 0 1200 760">
  <defs>
    <linearGradient id="chrome" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#2b2b31"/><stop offset="100%" stop-color="#1c1c21"/></linearGradient>
    <linearGradient id="vp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#3a3f47"/><stop offset="100%" stop-color="#22262b"/></linearGradient>
  </defs>
  <rect width="1200" height="760" fill="#1b1b1f"/>
  <!-- top bar -->
  <rect width="1200" height="34" fill="url(#chrome)"/>
  <text x="14" y="22" font-family="Inter,sans-serif" font-size="13" fill="#e6e6ea">File · Edit · Render · Window · Help</text>
  <text x="600" y="22" text-anchor="middle" font-family="Inter,sans-serif" font-size="13" fill="#8e919c">${esc(themeName)}.blend</text>
  <text x="1186" y="22" text-anchor="end" font-family="Inter,sans-serif" font-size="12" fill="#6f7280">Blender 4.2 — Viewport Proof</text>
  <!-- tool shelf -->
  <rect y="34" width="42" height="726" fill="url(#chrome)"/>
  ${['⬚', '⬡', '◯', '✥', '↻', '⤢', '✎'].map((g, i) => `<text x="21" y="${74 + i * 40}" text-anchor="middle" font-family="Inter,sans-serif" font-size="17" fill="#a9adba">${g}</text>`).join('')}
  <!-- viewport -->
  <rect x="42" y="34" width="880" height="640" fill="url(#vp)"/>
  <g opacity="0.5">
    ${Array.from({ length: 18 }).map((_, i) => `<line x1="${42 + i * 52}" y1="34" x2="${42 + i * 52}" y2="674" stroke="#ffffff" stroke-opacity="0.045"/>`).join('')}
    ${Array.from({ length: 13 }).map((_, i) => `<line x1="42" y1="${34 + i * 52}" x2="922" y2="${34 + i * 52}" stroke="#ffffff" stroke-opacity="0.045"/>`).join('')}
  </g>
  <text x="60" y="58" font-family="Inter,sans-serif" font-size="13" fill="#cfd3dc" opacity="0.85">User Perspective</text>
  <text x="60" y="78" font-family="Inter,sans-serif" font-size="12" fill="#8e919c" opacity="0.8">Solid Mode · 1,284,502 verts · 2,731 faces</text>
  ${polys.join('\n  ')}
  ${wire.join('\n  ')}
  <!-- gizmo -->
  <g transform="translate(860 604)">
    <line x1="0" y1="0" x2="40" y2="0" stroke="#ff5c5c" stroke-width="3"/><text x="44" y="4" font-family="Inter,sans-serif" font-size="11" fill="#ff8a8a">X</text>
    <line x1="0" y1="0" x2="0" y2="-40" stroke="#5cff9d" stroke-width="3"/><text x="-3" y="-46" font-family="Inter,sans-serif" font-size="11" fill="#8affc0">Z</text>
    <line x1="0" y1="0" x2="-26" y2="26" stroke="#5c9dff" stroke-width="3"/><text x="-46" y="40" font-family="Inter,sans-serif" font-size="11" fill="#9dc2ff">Y</text>
  </g>
  <text x="60" y="630" font-family="Inter,sans-serif" font-size="13" fill="#e8a33d">⬤ Edit Mode — Mesh (vertex select)</text>
  <text x="60" y="652" font-family="Inter,sans-serif" font-size="12" fill="#9aa0ad">Theme: ${esc(themeName)} · rotated model to show geometry</text>
  <!-- outliner -->
  <rect x="922" y="34" width="278" height="330" fill="#232328"/>
  <text x="938" y="58" font-family="Inter,sans-serif" font-size="12" fill="#8e919c">OUTLINER</text>
  <rect x="922" y="68" width="278" height="1" fill="#33333a"/>
  ${rows}
  <!-- properties -->
  <rect x="922" y="364" width="278" height="396" fill="#1f1f24"/>
  <text x="938" y="388" font-family="Inter,sans-serif" font-size="12" fill="#8e919c">PROPERTIES</text>
  ${['Transform', 'Modifiers', 'Material', 'Render'].map((h, i) => `<text x="938" y="${414 + i * 26}" font-family="Inter,sans-serif" font-size="13" fill="#c9cbd6">▸ ${h}</text>`).join('')}
  <rect x="938" y="536" width="246" height="72" rx="6" fill="#2b2b31" stroke="#3a3a44"/>
  <text x="950" y="558" font-family="Inter,sans-serif" font-size="12" fill="#e8a33d">Render Engine</text>
  <text x="950" y="578" font-family="Inter,sans-serif" font-size="12" fill="#c9cbd6">Cycles · 256 samples</text>
  <text x="950" y="596" font-family="Inter,sans-serif" font-size="12" fill="#c9cbd6">1920 × 1080 · Denoise</text>
  <text x="938" y="640" font-family="Inter,sans-serif" font-size="12" fill="#8e919c">Viewport: Solid · Studio Light</text>
  <text x="938" y="662" font-family="Inter,sans-serif" font-size="12" fill="#8e919c">Author: ${esc(author)}</text>
  <!-- timeline -->
  <rect y="674" width="1200" height="86" fill="#18181c"/>
  <rect x="42" y="690" width="1130" height="26" rx="4" fill="#26262c" stroke="#33333a"/>
  <line x1="180" y1="686" x2="180" y2="720" stroke="#e8a33d" stroke-width="2"/>
  <text x="52" y="742" font-family="Inter,sans-serif" font-size="12" fill="#8e919c">Timeline · Frame 1 / 240 · 24 fps</text>
  <text x="1160" y="742" text-anchor="end" font-family="Inter,sans-serif" font-size="12" fill="#5f636f">SIMULATED DEMO PROOF</text>
</svg>`;
}

module.exports = { makeRenderSVG, makeProofSVG };
