/* Blend Battles — static (GitHub Pages) backend.
 *
 * GitHub Pages can only serve files, so this script replaces the Node server with a
 * browser-local copy of it: /api/* requests are answered from localStorage, uploads are
 * data URLs held in memory, and a one-second ticker drives the match state machine.
 *
 * The data model, validation rules and payload shapes mirror server.js so the same
 * front-end runs unchanged. Everything stays on the visitor's device.
 */
(function () {
  'use strict';

  window.BB_STATIC = true;

  /* ------------------------------------------------------------------ tuning */
  const SPEED = 0.1;                    // 10x faster than the real server
  const MIN_BUILD = 12;                 // seconds
  const SUBMISSION_WINDOW = 15;         // seconds
  const VOTING_SECONDS = 45;            // enough time to score every entry
  const DB_KEY = 'bb_static_db_v1';
  const SESSION_KEY = 'bb_static_session_v1';
  const MAX_UPLOAD = { render: 48 * 1024 * 1024, proof: 64 * 1024 * 1024, model: 48 * 1024 * 1024 };
  const scaled = (sec) => Math.max(MIN_BUILD, Math.round(sec * SPEED));

  /* ------------------------------------------------------------------- ranks */
  const RANKS = [
    { name: 'Beginner', min: 0, color: '#8b93a7', icon: '◐' },
    { name: 'Apprentice', min: 600, color: '#6f8cff', icon: '◑' },
    { name: 'Modeler', min: 1600, color: '#4fd1c5', icon: '◒' },
    { name: 'Artist', min: 3200, color: '#b06bff', icon: '◓' },
    { name: 'Expert', min: 5200, color: '#ff8a3d', icon: '★' },
    { name: 'Master', min: 8000, color: '#ff4d6d', icon: '✦' },
    { name: 'Blender Legend', min: 12000, color: '#ffd166', icon: '♛' },
  ];

  /* ------------------------------------------------------------------ themes */
  const THEMES = [
    { name: 'Cyberpunk Car', difficulty: 'medium', slug: 'cyberpunk-car', tags: ['vehicle', 'neon'], art: 'img/featured/cyberpunk-car-a.jpg', blurb: 'Neon underglow, wet asphalt, chrome everything.' },
    { name: 'Fantasy Sword', difficulty: 'easy', slug: 'fantasy-sword', tags: ['prop', 'weapon'], art: 'img/featured/fantasy-sword-a.jpg', blurb: 'Give it a story — runes, gems, a worn hilt.' },
    { name: 'Cute Robot', difficulty: 'easy', slug: 'cute-robot', tags: ['character', 'hard-surface'], art: 'img/featured/cute-robot-a.jpg', blurb: 'Charming proportions beat technical density.' },
    { name: 'Dream House', difficulty: 'medium', slug: 'dream-house', tags: ['environment', 'architecture'], art: null, blurb: 'Interior, exterior, or something impossible.' },
    { name: 'Alien Planet', difficulty: 'hard', slug: 'alien-planet', tags: ['environment', 'space'], art: null, blurb: 'Flora, fauna, or a whole biome.' },
    { name: 'Medieval Castle', difficulty: 'hard', slug: 'medieval-castle', tags: ['architecture'], art: null, blurb: 'Modular kits go far. So does a great silhouette.' },
    { name: 'Futuristic Weapon', difficulty: 'medium', slug: 'futuristic-weapon', tags: ['prop', 'weapon'], art: null, blurb: 'Hard-surface study or stylised raygun?' },
    { name: 'Miniature City', difficulty: 'hard', slug: 'miniature-city', tags: ['environment', 'diorama'], art: null, blurb: 'Tilt-shift diorama energy welcome.' },
    { name: 'Space Station', difficulty: 'medium', slug: 'space-station', tags: ['environment', 'space'], art: null, blurb: 'Rings, solar panels, ominous docking bay.' },
    { name: 'Haunted Mansion', difficulty: 'hard', slug: 'haunted-mansion', tags: ['architecture', 'horror'], art: null, blurb: 'Lighting carries this theme. So does fog.' },
    { name: 'Coffee Mug', difficulty: 'easy', slug: 'coffee-mug', tags: ['prop'], art: null, blurb: 'A perfect warm-up: form, material, silhouette.' },
    { name: 'Treasure Chest', difficulty: 'easy', slug: 'treasure-chest', tags: ['prop'], art: null, blurb: 'Open or closed? Gold spilling out is encouraged.' },
    { name: 'Low-Poly Tree', difficulty: 'easy', slug: 'low-poly-tree', tags: ['nature'], art: null, blurb: 'Flat shading, big shapes, tiny tri count.' },
    { name: 'Mech Suit', difficulty: 'medium', slug: 'mech-suit', tags: ['hard-surface', 'character'], art: null, blurb: 'Joints, panels, and a cockpit worth peeking into.' },
    { name: 'Sunken Ship', difficulty: 'medium', slug: 'sunken-ship', tags: ['environment'], art: null, blurb: 'Volumetrics and marine growth are your friends.' },
    { name: 'Arcade Machine', difficulty: 'easy', slug: 'arcade-machine', tags: ['prop', 'retro'], art: null, blurb: 'Screen glow, worn decals, chunky buttons.' },
    { name: 'Dragon Throne', difficulty: 'hard', slug: 'dragon-throne', tags: ['prop', 'fantasy'], art: null, blurb: 'Sculpt, kitbash, or both.' },
    { name: 'Floating Islands', difficulty: 'hard', slug: 'floating-islands', tags: ['environment', 'fantasy'], art: null, blurb: 'Composition is the whole battle.' },
  ];

  const MODES = {
    build: { key: 'build', name: 'Build Battle', icon: 'cube', tagline: 'Same theme. Same clock. Best model wins.', description: 'Everyone gets one random theme and a fixed build window. Submit a final render plus Blender viewport proof, then vote on everyone else.', buildSeconds: 300, votingSeconds: 45, minPlayers: 2, maxPlayers: 12, requiresVideo: false },
    duo: { key: 'duo', name: 'Duo Battles', icon: 'duo', tagline: 'Two artists. One entry.', description: 'Paired with another artist on a shared theme. Either teammate can upload — the newest successful uploads form the team entry.', buildSeconds: 420, votingSeconds: 45, minPlayers: 2, maxPlayers: 12, requiresVideo: false, team: true },
    speed: { key: 'speed', name: 'Speed Modeling', icon: 'bolt', tagline: 'Two minutes. No excuses.', description: 'Strict timer, simple themes. Chunky shapes and clean silhouettes score best when there is no time for detail.', buildSeconds: 120, votingSeconds: 30, minPlayers: 2, maxPlayers: 12, requiresVideo: false },
    animation: { key: 'animation', name: 'Animation Battles', icon: 'clapper', tagline: 'Make it move.', description: 'Create a short Blender animation on the theme. The final render must be a video (MP4 or WebM) — stills are rejected by the server.', buildSeconds: 480, votingSeconds: 60, minPlayers: 2, maxPlayers: 12, requiresVideo: true },
    free: { key: 'free', name: 'Free Build', icon: 'brush', tagline: 'Practice room. No clock, no votes.', description: 'A private practice space. Upload whatever you like, keep everything in your personal gallery, and skip competitive voting entirely.', buildSeconds: 0, votingSeconds: 0, minPlayers: 1, maxPlayers: 8, requiresVideo: false, practice: true },
  };

  /* --------------------------------------------------------------- utilities */
  const id = (prefix = '') => (prefix ? prefix + '_' : '') + Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10);
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const roomCode = () => {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 6; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return s;
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function prng(seedStr) {
    let s = 0;
    for (let i = 0; i < seedStr.length; i++) s = (s * 131 + seedStr.charCodeAt(i)) >>> 0;
    s = s || 123456789;
    return function next() {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }
  const rankFor = (xp) => RANKS.reduce((acc, r) => (xp >= r.min ? r : acc), RANKS[0]);
  function rankProgress(xp) {
    const cur = rankFor(xp);
    const idx = RANKS.indexOf(cur);
    const next = RANKS[idx + 1] || null;
    if (!next) return { current: cur, next: null, pct: 100, toNext: 0 };
    const span = next.min - cur.min;
    return { current: cur, next, pct: clamp(((xp - cur.min) / span) * 100, 0, 100), toNext: next.min - xp };
  }
  const levelFor = (xp) => Math.floor(xp / 250) + 1;
  function levelProgress(xp) {
    const lvl = levelFor(xp);
    const base = (lvl - 1) * 250;
    return { level: lvl, pct: Math.round(((xp - base) / 250) * 100), toNext: 250 - (xp - base) };
  }
  function hashPassword(password, salt) {
    // Tiny non-cryptographic hash: this is a browser demo, accounts never leave the device.
    let h = 2166136261;
    const input = String(salt) + '|' + String(password);
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  /* ------------------------------------------------------ generated demo art */
  function svgUrl(svg) { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); }

  function makeRenderSVG(themeName, seed) {
    const rand = prng(themeName + seed);
    const hue = Math.floor(rand() * 360);
    const hue2 = (hue + 90 + Math.floor(rand() * 120)) % 360;
    const shapes = [];
    for (let i = 0; i < 9; i++) {
      const cx = 200 + rand() * 800;
      const cy = 150 + rand() * 600;
      const r = 30 + rand() * 130;
      const rot = rand() * 180;
      const op = (0.25 + rand() * 0.5).toFixed(2);
      const kind = rand();
      if (kind < 0.33) shapes.push(`<rect x="${(cx - r).toFixed(1)}" y="${(cy - r).toFixed(1)}" width="${(r * 2).toFixed(1)}" height="${(r * 2).toFixed(1)}" rx="${(r * 0.18).toFixed(1)}" fill="hsl(${hue2} 80% ${45 + rand() * 25}%)" opacity="${op}" transform="rotate(${rot.toFixed(1)} ${cx.toFixed(1)} ${cy.toFixed(1)})"/>`);
      else if (kind < 0.66) shapes.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="hsl(${hue2} 85% ${55 + rand() * 20}%)" opacity="${op}"/>`);
      else shapes.push(`<polygon points="${cx.toFixed(1)},${(cy - r).toFixed(1)} ${(cx + r).toFixed(1)},${(cy + r * 0.7).toFixed(1)} ${(cx - r).toFixed(1)},${(cy + r * 0.7).toFixed(1)}" fill="hsl(${hue2} 90% ${50 + rand() * 25}%)" opacity="${op}"/>`);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
  <defs><radialGradient id="bg" cx="50%" cy="40%" r="75%"><stop offset="0%" stop-color="hsl(${hue} 60% 18%)"/><stop offset="100%" stop-color="#07070c"/></radialGradient>
  <filter id="blur"><feGaussianBlur stdDeviation="26"/></filter></defs>
  <rect width="1200" height="900" fill="url(#bg)"/>
  <g filter="url(#blur)" opacity="0.85"><circle cx="${(300 + rand() * 200).toFixed(0)}" cy="${(250 + rand() * 150).toFixed(0)}" r="220" fill="hsl(${hue} 90% 55%)" opacity="0.5"/><circle cx="${(800 + rand() * 200).toFixed(0)}" cy="${(600 + rand() * 120).toFixed(0)}" r="260" fill="hsl(${hue2} 90% 55%)" opacity="0.35"/></g>
  ${shapes.join('\n  ')}
  <rect y="770" width="1200" height="130" fill="#05050a" opacity="0.55"/>
  <text x="60" y="828" font-family="Inter,Segoe UI,sans-serif" font-size="42" font-weight="800" fill="#ffffff" opacity="0.92">${esc(themeName)}</text>
  <text x="60" y="866" font-family="Inter,Segoe UI,sans-serif" font-size="21" fill="#ffffff" opacity="0.5">Simulated demo render</text>
</svg>`;
  }

  function makeProofSVG(themeName, seed, author) {
    const rand = prng(themeName + seed + (author || 'sim'));
    const wire = [];
    const cx = 430, cy = 330;
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
    const rows = ['Cube', 'Camera', 'Light', 'Model_Body', 'Model_Detail', 'Material_Slot']
      .map((t, i) => `<text x="946" y="${146 + i * 24}" font-family="Inter,sans-serif" font-size="13" fill="#c9cbd6"><tspan fill="#e8a33d">${i < 3 ? '▣' : '◈'}</tspan>  ${esc(t)}</text>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" viewBox="0 0 1200 760">
  <defs><linearGradient id="chrome" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#2b2b31"/><stop offset="100%" stop-color="#1c1c21"/></linearGradient>
  <linearGradient id="vp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#3a3f47"/><stop offset="100%" stop-color="#22262b"/></linearGradient></defs>
  <rect width="1200" height="760" fill="#1b1b1f"/>
  <rect width="1200" height="34" fill="url(#chrome)"/>
  <text x="14" y="22" font-family="Inter,sans-serif" font-size="13" fill="#e6e6ea">File · Edit · Render · Window · Help</text>
  <text x="600" y="22" text-anchor="middle" font-family="Inter,sans-serif" font-size="13" fill="#8e919c">${esc(themeName)}.blend</text>
  <text x="1186" y="22" text-anchor="end" font-family="Inter,sans-serif" font-size="12" fill="#6f7280">Blender 4.2 — Viewport Proof</text>
  <rect y="34" width="42" height="726" fill="url(#chrome)"/>
  <rect x="42" y="34" width="880" height="640" fill="url(#vp)"/>
  <g opacity="0.5">
    ${Array.from({ length: 18 }).map((_, i) => `<line x1="${42 + i * 52}" y1="34" x2="${42 + i * 52}" y2="674" stroke="#ffffff" stroke-opacity="0.045"/>`).join('')}
    ${Array.from({ length: 13 }).map((_, i) => `<line x1="42" y1="${34 + i * 52}" x2="922" y2="${34 + i * 52}" stroke="#ffffff" stroke-opacity="0.045"/>`).join('')}
  </g>
  <text x="60" y="58" font-family="Inter,sans-serif" font-size="13" fill="#cfd3dc" opacity="0.85">User Perspective</text>
  <text x="60" y="78" font-family="Inter,sans-serif" font-size="12" fill="#8e919c" opacity="0.8">Solid Mode · 1,284,502 verts · 2,731 faces</text>
  ${polys.join('\n  ')}
  ${wire.join('\n  ')}
  <text x="60" y="630" font-family="Inter,sans-serif" font-size="13" fill="#e8a33d">⬤ Edit Mode — Mesh (vertex select)</text>
  <text x="60" y="652" font-family="Inter,sans-serif" font-size="12" fill="#9aa0ad">Theme: ${esc(themeName)} · rotated model to show geometry</text>
  <rect x="922" y="34" width="278" height="330" fill="#232328"/>
  <text x="938" y="58" font-family="Inter,sans-serif" font-size="12" fill="#8e919c">OUTLINER</text>
  ${rows}
  <rect x="922" y="364" width="278" height="396" fill="#1f1f24"/>
  <text x="938" y="388" font-family="Inter,sans-serif" font-size="12" fill="#8e919c">PROPERTIES</text>
  <text x="938" y="414" font-family="Inter,sans-serif" font-size="13" fill="#c9cbd6">▸ Transform</text>
  <text x="938" y="440" font-family="Inter,sans-serif" font-size="13" fill="#c9cbd6">▸ Modifiers</text>
  <text x="938" y="466" font-family="Inter,sans-serif" font-size="13" fill="#c9cbd6">▸ Material</text>
  <text x="938" y="492" font-family="Inter,sans-serif" font-size="13" fill="#c9cbd6">▸ Render</text>
  <text x="938" y="640" font-family="Inter,sans-serif" font-size="12" fill="#8e919c">Viewport: Solid · Studio Light</text>
  <text x="938" y="662" font-family="Inter,sans-serif" font-size="12" fill="#8e919c">Author: ${esc(author || 'sim')}</text>
  <rect y="674" width="1200" height="86" fill="#18181c"/>
  <rect x="42" y="690" width="1130" height="26" rx="4" fill="#26262c" stroke="#33333a"/>
  <text x="52" y="742" font-family="Inter,sans-serif" font-size="12" fill="#8e919c">Timeline · Frame 1 / 240 · 24 fps</text>
  <text x="1160" y="742" text-anchor="end" font-family="Inter,sans-serif" font-size="12" fill="#5f636f">STATIC DEMO PROOF</text>
</svg>`;
  }

  /* ----------------------------------------------------------------- storage */
  const media = new Map(); // `${subId}:${kind}` -> data URL (session only)

  function emptyDb() {
    return {
      meta: { version: 1, seeded: false, createdAt: Date.now() },
      users: [], lobbies: [], matches: [], submissions: [], votes: [],
      reports: [], audit: [], activity: [], tournaments: [],
    };
  }
  let db = emptyDb();
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) db = Object.assign(emptyDb(), JSON.parse(raw));
  } catch (e) {
    console.warn('[static] could not read local database, starting fresh', e);
  }

  let saveTimer = null;
  function save() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try { localStorage.setItem(DB_KEY, JSON.stringify(db)); }
      catch (e) { console.warn('[static] local storage is full — progress is kept only for this session', e); }
    }, 80);
  }
  function resetDb() {
    db = emptyDb();
    try { localStorage.removeItem(DB_KEY); localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  }

  const getMatch = (mid) => db.matches.find((m) => m.id === mid);
  const getLobby = (code) => db.lobbies.find((l) => l.code === String(code || '').toUpperCase());
  const getSubmission = (sid) => db.submissions.find((s) => s.id === sid);
  const getUser = (uid) => db.users.find((u) => u.id === uid);
  const matchSubs = (mid) => db.submissions.filter((s) => s.matchId === mid);
  const isParticipant = (match, user) => !!user && !!match && match.players.some((p) => p.userId === user.id);
  const humanPlayers = (match) => match.players.filter((p) => !p.isBot);
  const onlineCount = () => clamp(db.users.filter((u) => !u.isBot && Date.now() - (u.lastSeen || 0) < 12 * 60000).length, 1, 99);

  function audit(entry) {
    db.audit.unshift(Object.assign({ id: id('aud'), at: Date.now() }, entry));
    if (db.audit.length > 300) db.audit.length = 300;
    save();
  }
  function activity(entry) {
    db.activity.unshift(Object.assign({ id: id('act'), at: Date.now() }, entry));
    if (db.activity.length > 80) db.activity.length = 80;
    save();
  }

  /* -------------------------------------------------------------- demo seed */
  const SEED_PLAYERS = [
    ['NovaKite', 14210, 'EU', 'Riga, LV', true],
    ['polyPunk', 11890, 'EU', 'Berlin, DE', false],
    ['vertexVixen', 9640, 'NA', 'Austin, US', false],
    ['modvex', 8300, 'EU', 'Tallinn, EE', true],
    ['subdivSam', 7210, 'NA', 'Toronto, CA', false],
    ['GreyscaleGoblin', 6480, 'EU', 'Lisbon, PT', false],
    ['BloomShift', 5120, 'APAC', 'Seoul, KR', false],
    ['NurbsNerd', 4380, 'EU', 'Warsaw, PL', false],
    ['claymoreKid', 3610, 'NA', 'Chicago, US', false],
    ['RuneRigger', 2980, 'EU', 'Utrecht, NL', false],
    ['TopoQueen', 2140, 'APAC', 'Osaka, JP', false],
    ['alphaTestAsh', 1560, 'NA', 'Denver, US', false],
    ['SuzanneStan', 980, 'EU', 'Vilnius, LT', false],
    ['lowPolyLuna', 520, 'EU', 'Helsinki, FI', false],
  ];
  const SEED_MATCHES = [
    { theme: 'Cute Robot', daysAgo: 1, entries: [
      { user: 'NovaKite', art: 'img/featured/cute-robot-a.jpg', scores: [5, 5, 4, 5], title: 'Bolt-9 Service Unit' },
      { user: 'vertexVixen', art: 'img/featured/cute-robot-b.jpg', scores: [5, 4, 4, 3], title: 'Mochi Maintenance Bot' },
      { user: 'SuzanneStan', art: 'img/featured/cute-robot-c.jpg', scores: [3, 4, 3, 4], title: 'Rusty Helper' },
    ] },
    { theme: 'Cyberpunk Car', daysAgo: 3, entries: [
      { user: 'polyPunk', art: 'img/featured/cyberpunk-car-a.jpg', scores: [5, 5, 5, 4], title: 'Kitsune GT' },
      { user: 'GreyscaleGoblin', art: 'img/featured/cyberpunk-car-b.jpg', scores: [4, 5, 4, 4], title: 'Nightshift Hover' },
      { user: 'claymoreKid', art: 'img/featured/cyberpunk-car-c.jpg', scores: [3, 3, 4, 5], title: 'Chrome Drift' },
    ] },
    { theme: 'Fantasy Sword', daysAgo: 6, entries: [
      { user: 'subdivSam', art: 'img/featured/fantasy-sword-a.jpg', scores: [5, 4, 5, 4], title: 'Oath of Embers' },
      { user: 'modvex', art: 'img/featured/fantasy-sword-b.jpg', scores: [4, 4, 5, 4], title: 'Tidebiter' },
      { user: 'NurbsNerd', art: 'img/featured/fantasy-sword-c.jpg', scores: [3, 4, 4, 4], title: 'Hollow Bloom' },
    ] },
  ];

  function seedDemoData() {
    const rand = prng('blend-battles-static-seed-v1');
    const users = SEED_PLAYERS.map(([name, xp, region, location, isMod], i) => ({
      id: id('usr'), username: name, email: name.toLowerCase() + '@blendbattles.demo',
      rank: rankFor(xp), xp, level: levelFor(xp), region, location,
      isMod: !!isMod, isGuest: false, isDemo: true, isBot: false,
      avatarHue: Math.floor(rand() * 360),
      bio: isMod ? 'Community moderator. Reviews proof, kills invalid votes, keeps the ladder honest.' : 'Blender artist. Renders in Cycles, models in Edit Mode.',
      badges: [], stats: {
        wins: Math.max(0, Math.round(xp / 900) + (i % 3)),
        matches: Math.max(1, Math.round(xp / 420) + (i % 5)),
        podiums: Math.max(0, Math.round(xp / 700)),
        votes: Math.round(xp / 30),
        avgScore: +(3.2 + rand() * 1.6).toFixed(1),
      },
      friends: [], blocked: [],
      privacy: { showHistory: true, friendsOnlyLeaderboard: false },
      settings: { sfx: true, reducedMotion: false },
      challengeClaims: {},
      createdAt: Date.now() - (200 - i * 9) * 86400000,
      lastSeen: Date.now() - Math.floor(rand() * 1000 * 60 * 12),
      pass: null, salt: null, demoPassword: 'blendbattles',
    }));
    users[0].friends = [users[1].id, users[2].id, users[3].id];
    users[1].friends = [users[0].id]; users[2].friends = [users[0].id];
    db.users.push(...users);

    SEED_MATCHES.forEach((m, mi) => {
      const created = Date.now() - m.daysAgo * 86400000;
      const match = {
        id: id('mat'), code: 'SEED' + (mi + 1), mode: 'build', modeName: 'Build Battle',
        theme: m.theme, themeBlurb: (THEMES.find((t) => t.name === m.theme) || {}).blurb || '',
        difficulty: 'medium', practice: false, phase: 'results',
        createdAt: created, startedAt: created, phaseEndsAt: created + 345000, endedAt: created + 400000, seed: true,
        players: m.entries.map((e) => {
          const u = users.find((x) => x.username === e.user);
          return { userId: u.id, name: u.username, isBot: false, submitted: true, connected: false, joinedAt: created, team: null };
        }),
        settings: { buildSeconds: 300, votingSeconds: 45, maxPlayers: 12, difficulty: 'medium' },
        results: null, abandoned: false, botPlan: [], auditTrail: [],
      };
      const subs = [];
      m.entries.forEach((e, ei) => {
        const u = users.find((x) => x.username === e.user);
        const subId = id('sub');
        const avg = e.scores.reduce((a, b) => a + b, 0) / e.scores.length;
        const sub = {
          id: subId, matchId: match.id, userId: u.id, username: u.username,
          title: e.title, status: 'submitted', reviewStatus: 'clear',
          createdAt: created + 60000 + ei * 20000, submittedAt: created + 240000 + ei * 12000,
          files: {
            render: { name: e.art.split('/').pop(), mime: 'image/jpeg', size: 0, url: e.art, uploadedAt: created },
            proof: { name: u.username + '_viewport_proof.svg', mime: 'image/svg+xml', size: 0, url: svgUrl(makeProofSVG(m.theme, subId, u.username)), uploadedAt: created },
          },
          avgScore: +avg.toFixed(2), voteCount: e.scores.length, disqualified: false, auditTrail: [],
        };
        db.submissions.push(sub); subs.push(sub);
      });
      subs.forEach((sub, si) => {
        m.entries[si].scores.forEach((score, k) => {
          const voter = users[(si + k + 1) % users.length];
          if (voter.id === sub.userId) return;
          db.votes.push({ id: id('vote'), matchId: match.id, submissionId: sub.id, voterId: voter.id, voterName: voter.username, score, createdAt: created + 300000 + k * 3000, invalidated: false });
        });
      });
      const ranked = [...subs].sort((a, b) => b.avgScore - a.avgScore);
      const entryFor = (s, i) => ({
        place: i + 1, submissionId: s.id, userId: s.userId, username: s.username, displayName: s.username,
        avgScore: s.avgScore, voteCount: s.voteCount, disqualified: false,
        renderUrl: s.files.render.url, renderKind: 'image', title: s.title, xpAwarded: [250, 160, 100][i] || 40,
      });
      match.results = {
        computedAt: created + 400000,
        podium: ranked.slice(0, 3).map(entryFor),
        entries: ranked.map(entryFor),
        awards: [],
        stats: { entries: ranked.length, votes: db.votes.filter((v) => v.matchId === match.id && !v.invalidated).length, durationSeconds: 400, theme: m.theme, mode: 'Build Battle' },
        abandoned: false, reason: null,
      };
      db.matches.push(match);
    });

    db.users.forEach((u) => {
      if (u.stats.wins >= 1) u.badges.push('first-blood');
      if (u.stats.matches >= 5) u.badges.push('regular');
      if (u.stats.podiums >= 5) u.badges.push('podium-hunter');
      if (u.xp >= 8000) u.badges.push('legend-track');
      if (u.isMod) u.badges.push('moderator');
      u.badges = [...new Set(u.badges)];
    });
    db.meta.seeded = true;
    activity({ type: 'seed', text: 'Static demo ladder seeded with past matches and gallery entries.' });
    save();
  }

  if (!db.meta.seeded) seedDemoData();

  /* ------------------------------------------------------------------- auth */
  let sessionToken = null;
  try { sessionToken = localStorage.getItem(SESSION_KEY); } catch (e) { /* ignore */ }
  const setSession = (t) => { sessionToken = t; try { localStorage.setItem(SESSION_KEY, t); } catch (e) { /* ignore */ } };
  const clearSession = () => { sessionToken = null; try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ } };
  function currentUser() {
    if (!sessionToken) return null;
    const uid = sessionToken.split('.')[1];
    const u = getUser(uid);
    if (u) u.lastSeen = Date.now();
    return u || null;
  }
  const makeToken = (uid) => id('sess') + '.' + uid;

  function publicUser(u, viewer) {
    if (!u) return null;
    const rp = rankProgress(u.xp);
    const lp = levelProgress(u.xp);
    const isSelf = !!viewer && viewer.id === u.id;
    const isFriend = !!viewer && (viewer.friends || []).includes(u.id);
    return {
      id: u.id, username: u.username, avatarHue: u.avatarHue,
      isGuest: !!u.isGuest, isDemo: !!u.isDemo, isMod: !!u.isMod,
      xp: u.xp, level: lp.level, levelPct: lp.pct, xpToNextLevel: lp.toNext,
      rank: rp.current.name, rankColor: rp.current.color, rankPct: Math.round(rp.pct),
      nextRank: rp.next ? rp.next.name : null, xpToNextRank: rp.toNext,
      region: u.region || 'EU', location: u.location || '', bio: u.bio || '',
      badges: u.badges || [], stats: u.stats,
      friends: (u.friends || []).length, isFriend,
      privacy: isSelf || isFriend ? u.privacy : { showHistory: !!(u.privacy || {}).showHistory },
      settings: isSelf ? u.settings : undefined,
      isSelf, createdAt: u.createdAt, lastSeen: u.lastSeen,
    };
  }
  function userSummary(u) {
    const rp = rankProgress(u.xp);
    return {
      id: u.id, username: u.username, avatarHue: u.avatarHue, xp: u.xp,
      rank: rp.current.name, rankColor: rp.current.color, rankPct: Math.round(rp.pct),
      level: levelProgress(u.xp).level, badges: (u.badges || []).slice(0, 8),
      isMod: !!u.isMod, isGuest: !!u.isGuest, isDemo: !!u.isDemo,
      stats: u.stats, region: u.region, lastSeen: u.lastSeen,
    };
  }

  /* ---------------------------------------------------------- serialisation */
  function mediaUrl(sub, kind) {
    const rec = sub.files[kind];
    if (!rec) return null;
    if (media.has(sub.id + ':' + kind)) return media.get(sub.id + ':' + kind);
    if (rec.url) return rec.url;
    // uploads do not survive a reload — fall back to generated demo art
    if (kind === 'proof') return svgUrl(makeProofSVG((getMatch(sub.matchId) || {}).theme || 'Blend', sub.id, sub.username));
    return svgUrl(makeRenderSVG((getMatch(sub.matchId) || {}).theme || 'Blend', sub.id));
  }
  function teamLabel(match, sub) {
    if (match.mode !== 'duo') return null;
    return match.players.filter((p) => p.team === sub.team).map((p) => p.name).join(' & ');
  }
  function uploadDeadline(match) {
    if (match.practice) return null;
    if (match.phase === 'building' || match.phase === 'submission') return match.phaseEndsAt;
    return match.submissionClosedAt || match.phaseEndsAt;
  }
  const canUpload = (match, user) => {
    if (!user || !isParticipant(match, user)) return false;
    if (match.practice) return match.phase === 'building';
    return (match.phase === 'building' || match.phase === 'submission') && match.phaseEndsAt > Date.now();
  };
  function getMySubmission(match, viewer) {
    if (!viewer) return null;
    const me = match.players.find((p) => p.userId === viewer.id);
    if (!me) return null;
    if (match.mode === 'duo') return matchSubs(match.id).find((s) => s.team === me.team) || null;
    return matchSubs(match.id).find((s) => s.userId === viewer.id) || null;
  }
  function serializeOwnSubmission(match, sub) {
    if (!sub) return { exists: false, files: { render: null, proof: null, model: null }, status: 'none', ready: false };
    return {
      id: sub.id, status: sub.status, reviewStatus: sub.reviewStatus || 'clear',
      title: sub.title || '', team: sub.team, teamLabel: teamLabel(match, sub),
      submittedAt: sub.submittedAt || null, createdAt: sub.createdAt,
      canEdit: canUpload(match, currentUser()), deadline: uploadDeadline(match),
      files: {
        render: sub.files.render ? { ...sub.files.render, url: mediaUrl(sub, 'render') } : null,
        proof: sub.files.proof ? { ...sub.files.proof, url: mediaUrl(sub, 'proof') } : null,
        model: sub.files.model ? { ...sub.files.model, url: mediaUrl(sub, 'model') } : null,
      },
      ready: !!(sub.files.render && sub.files.proof),
      auditTrail: (sub.auditTrail || []).slice(-12),
      reviewNote: sub.reviewNote || null, disqualified: !!sub.disqualified,
    };
  }
  function serializeEntry(sub, match, viewer, opts = {}) {
    const owner = getUser(sub.userId);
    const myVoteRec = db.votes.find((v) => v.submissionId === sub.id && viewer && v.voterId === viewer.id && !v.invalidated);
    const ownTeam = match.mode === 'duo'
      ? sub.team === (match.players.find((p) => p.userId === (viewer && viewer.id)) || {}).team
      : sub.userId === (viewer && viewer.id);
    return {
      submissionId: sub.id, matchId: match.id,
      username: owner ? owner.username : sub.username,
      displayName: teamLabel(match, sub) || (owner ? owner.username : sub.username),
      avatarHue: owner ? owner.avatarHue : 260,
      rank: owner ? rankFor(owner.xp).name : 'Beginner',
      rankColor: owner ? rankFor(owner.xp).color : '#888',
      title: sub.title || '',
      renderUrl: mediaUrl(sub, 'render'),
      renderKind: sub.files.render ? ((sub.files.render.mime || '').startsWith('video') ? 'video' : 'image') : null,
      hasProof: !!sub.files.proof,
      hasModel: !!sub.files.model,
      proofUrl: sub.files.proof ? mediaUrl(sub, 'proof') : null,
      proofKind: sub.files.proof && (sub.files.proof.mime || '').startsWith('video') ? 'video' : 'image',
      isSelf: !!ownTeam,
      canVote: !!opts.voting && !ownTeam && !sub.disqualified,
      myVote: myVoteRec ? myVoteRec.score : 0,
      disqualified: !!sub.disqualified,
      reviewStatus: sub.reviewStatus || 'clear',
      submittedAt: sub.submittedAt,
    };
  }
  function serializeMatch(match, viewer, opts = {}) {
    const subs = matchSubs(match.id);
    const mySub = getMySubmission(match, viewer);
    const canSeeEntries = match.phase === 'voting' || match.phase === 'results';
    const visible = subs.filter((s) => s.files.render && s.files.proof && !s.disqualified);
    const out = {
      id: match.id, code: match.code, mode: match.mode, modeName: match.modeName,
      modeTagline: (MODES[match.mode] || {}).tagline || '',
      theme: match.theme, themeBlurb: match.themeBlurb || '', difficulty: match.difficulty,
      practice: !!match.practice, requiresVideo: !!(MODES[match.mode] || {}).requiresVideo,
      phase: match.phase, phaseEndsAt: match.phaseEndsAt || null, serverNow: Date.now(),
      startedAt: match.startedAt, endedAt: match.endedAt || null,
      submissionClosedAt: match.submissionClosedAt || null,
      settings: match.settings, isMod: !!(viewer && viewer.isMod),
      viewerIsParticipant: isParticipant(match, viewer),
      players: match.players.map((p) => {
        const u = getUser(p.userId);
        const s = subs.find((x) => (match.mode === 'duo' ? x.team === p.team : x.userId === p.userId));
        return {
          userId: p.userId, name: p.name,
          avatarHue: u ? u.avatarHue : 250,
          rank: u ? rankFor(u.xp).name : 'Beginner',
          rankColor: u ? rankFor(u.xp).color : '#888',
          level: u ? levelProgress(u.xp).level : 1,
          isBot: !!p.isBot, isGuest: !!(u && u.isGuest),
          connected: p.isBot ? true : !!p.connected,
          submitted: !!(s && s.files.render && s.files.proof),
          disqualified: !!(s && s.disqualified),
          team: p.team == null ? null : p.team,
        };
      }),
      counts: {
        submissions: visible.length,
        players: match.players.length,
        humanPlayers: humanPlayers(match).length,
        votesCast: db.votes.filter((v) => v.matchId === match.id && !v.invalidated).length,
        votersDone: 0,
      },
      yourSubmission: serializeOwnSubmission(match, mySub),
      uploadDeadline: uploadDeadline(match),
      canUpload: canUpload(match, viewer),
      auditRecent: (match.auditTrail || []).slice(-8),
    };
    if (canSeeEntries || opts.forceEntries) {
      const ordered = match.phase === 'voting'
        ? [...visible].sort((a, b) => String(a.id).localeCompare(String(b.id)))
        : [...visible].sort((a, b) => (b.avgScore || 0) - (a.avgScore || 0));
      out.entries = ordered.map((s) => serializeEntry(s, match, viewer, { voting: match.phase === 'voting' }));
      out.myVoting = {
        eligible: match.phase === 'voting' && isParticipant(match, viewer),
        votesCast: db.votes.filter((v) => v.matchId === match.id && viewer && v.voterId === viewer.id && !v.invalidated).length,
        votesPossible: visible.filter((s) => !(match.mode === 'duo' ? s.team === (match.players.find((p) => p.userId === (viewer && viewer.id)) || {}).team : s.userId === (viewer && viewer.id))).length,
      };
    }
    if (match.phase === 'results' && match.results) {
      out.results = {
        ...match.results,
        entries: match.results.entries.map((e) => {
          const sub = getSubmission(e.submissionId);
          return {
            ...e,
            proofUrl: sub && sub.files.proof ? mediaUrl(sub, 'proof') : null,
            proofKind: sub && sub.files.proof && (sub.files.proof.mime || '').startsWith('video') ? 'video' : 'image',
            renderKind: e.renderKind || 'image', reviewStatus: sub ? sub.reviewStatus : 'clear', disqualified: sub ? !!sub.disqualified : false,
          };
        }),
        yourXp: (match.results.awards || []).find((a) => viewer && a.userId === viewer.id) || null,
      };
    }
    return out;
  }
  function serializeLobby(lobby, viewer) {
    const mode = MODES[lobby.mode] || MODES.build;
    return {
      code: lobby.code, name: lobby.name, mode: lobby.mode, modeName: mode.name,
      tagline: mode.tagline, isPrivate: !!lobby.isPrivate, maxPlayers: lobby.maxPlayers,
      difficulty: lobby.difficulty, customTheme: lobby.customTheme || null,
      status: lobby.status, startsAt: lobby.startsAt || null, serverNow: Date.now(), hostId: lobby.hostId,
      isHost: !!viewer && viewer.id === lobby.hostId,
      isMember: !!viewer && lobby.players.some((p) => p.userId === viewer.id),
      yourReady: !!(viewer && (lobby.players.find((p) => p.userId === viewer.id) || {}).ready),
      matchId: lobby.matchId || null, buildSeconds: lobby.buildSeconds, createdAt: lobby.createdAt,
      players: lobby.players.map((p) => {
        const u = getUser(p.userId);
        return {
          userId: p.userId, name: p.name, avatarHue: u ? u.avatarHue : 250,
          rank: u ? rankFor(u.xp).name : 'Beginner', rankColor: u ? rankFor(u.xp).color : '#888',
          level: u ? levelProgress(u.xp).level : 1,
          ready: !!p.ready, isBot: !!p.isBot, isGuest: !!(u && u.isGuest),
          isHost: p.userId === lobby.hostId, connected: p.isBot ? true : !!p.connected,
        };
      }),
    };
  }
  function matchSummaryFor(match, userId) {
    const mySub = db.submissions.find((s) => s.matchId === match.id && s.userId === userId);
    const res = match.results;
    const entry = res ? res.entries.find((e) => e.userId === userId) : null;
    return {
      id: match.id, mode: match.mode, modeName: match.modeName, theme: match.theme,
      startedAt: match.startedAt, endedAt: match.endedAt, phase: match.phase,
      players: match.players.length, place: entry ? entry.place : null,
      score: entry ? entry.avgScore : null,
      renderUrl: mySub && mySub.files.render ? mediaUrl(mySub, 'render') : null,
      proofUrl: mySub && mySub.files.proof ? mediaUrl(mySub, 'proof') : null,
      proofKind: mySub && mySub.files.proof && (mySub.files.proof.mime || '').startsWith('video') ? 'video' : 'image',
      submissionId: mySub ? mySub.id : null,
      practice: !!match.practice,
    };
  }

  /* ------------------------------------------------------------- game logic */
  function addBot(lobby, index) {
    const names = ['botKilo', 'botMira', 'botRust', 'botJuno', 'botHex', 'botPika', 'botVex', 'botOnyx'];
    const used = new Set(lobby.players.map((p) => p.name));
    let name = names[index % names.length];
    let k = 1;
    while (used.has(name)) name = names[index % names.length] + k++;
    const bot = {
      id: id('bot'), username: name, email: null, isBot: true, isGuest: false, isDemo: true,
      xp: 400 + Math.floor(Math.random() * 3000), avatarHue: Math.floor(Math.random() * 360),
      region: 'EU', location: 'Practice Bot', bio: 'Simulated practice opponent (static demo).',
      badges: [], stats: { wins: 0, matches: 0, podiums: 0, votes: 0, avgScore: 0 },
      friends: [], blocked: [], privacy: { showHistory: false }, settings: {},
      rank: rankFor(0), level: 1, createdAt: Date.now(), lastSeen: Date.now(), pass: null, salt: null,
    };
    bot.rank = rankFor(bot.xp);
    bot.level = levelFor(bot.xp);
    db.users.push(bot);
    return bot;
  }
  function pickTheme(difficulty, seedKey) {
    const rand = seedKey ? prng(seedKey) : Math.random;
    const pool = difficulty === 'any' ? THEMES : THEMES.filter((t) => t.difficulty === difficulty);
    const list = pool.length ? pool : THEMES;
    return list[Math.floor(rand() * list.length)];
  }
  function startMatchFromLobby(lobby) {
    const mode = MODES[lobby.mode] || MODES.build;
    const themeMeta = lobby.customTheme
      ? { name: lobby.customTheme, blurb: 'Custom theme set by the host.' }
      : pickTheme(lobby.difficulty, lobby.code);
    const buildSeconds = lobby.buildSeconds || mode.buildSeconds;
    const players = lobby.players.map((p) => {
      const u = getUser(p.userId);
      return { userId: p.userId, name: (u && u.username) || p.name, isBot: !!p.isBot, submitted: false, connected: true, joinedAt: p.joinedAt || Date.now(), team: null };
    });
    if (lobby.mode === 'duo') {
      [...players].sort((a, b) => a.joinedAt - b.joinedAt).forEach((p, i) => { p.team = Math.floor(i / 2); });
    }
    const match = {
      id: id('mat'), code: lobby.code, mode: lobby.mode, modeName: mode.name,
      theme: themeMeta.name, themeBlurb: themeMeta.blurb || '', difficulty: lobby.difficulty,
      practice: !!mode.practice, phase: 'building', createdAt: Date.now(), startedAt: Date.now(),
      phaseEndsAt: mode.practice ? null : Date.now() + scaled(buildSeconds) * 1000,
      submissionClosedAt: null, endedAt: null, players,
      settings: { buildSeconds, votingSeconds: VOTING_SECONDS, maxPlayers: lobby.maxPlayers, difficulty: lobby.difficulty },
      botPlan: [], results: null, abandoned: false,
      auditTrail: [{ at: Date.now(), action: 'match-created', note: `Theme "${themeMeta.name}" · ${mode.name}` }],
    };
    if (!mode.practice) {
      match.players.filter((p) => p.isBot).forEach((p) => {
        match.botPlan.push({ userId: p.userId, submitAt: Date.now() + scaled(buildSeconds) * 1000 * (0.45 + Math.random() * 0.4), voteAt: null, voteDone: false, done: false });
      });
    }
    db.matches.push(match);
    lobby.status = 'in_match';
    lobby.matchId = match.id;
    lobby.startsAt = null;
    activity({ type: 'match', text: `${mode.name} started — theme “${themeMeta.name}”${lobby.players.some((p) => p.isBot) ? ' (with practice bots)' : ''}.`, matchId: match.id });
    save();
    return match;
  }
  function ensureSubmission(match, user) {
    const me = match.players.find((p) => p.userId === user.id);
    if (!me) throw apiError('You are not in this match', 403);
    let sub = getMySubmission(match, user);
    if (sub) return sub;
    sub = {
      id: id('sub'), matchId: match.id, userId: user.id, username: user.username,
      team: match.mode === 'duo' ? me.team : null, title: '', status: 'draft', reviewStatus: 'clear',
      createdAt: Date.now(), submittedAt: null, files: {},
      auditTrail: [{ at: Date.now(), action: 'draft-opened', note: 'Submission workspace opened' }],
    };
    db.submissions.push(sub);
    save();
    return sub;
  }
  function botSubmit(match, plan) {
    const bot = getUser(plan.userId);
    const me = match.players.find((p) => p.userId === plan.userId);
    if (!bot || !me) return;
    const theme = THEMES.find((t) => t.name === match.theme);
    const subId = id('sub');
    const renderArt = theme && theme.art ? theme.art : svgUrl(makeRenderSVG(match.theme, subId));
    const proofArt = svgUrl(makeProofSVG(match.theme, subId, bot.username));
    const existing = match.mode === 'duo'
      ? db.submissions.find((s) => s.matchId === match.id && s.team === me.team)
      : db.submissions.find((s) => s.matchId === match.id && s.userId === bot.id);
    const sub = existing || { id: subId, matchId: match.id, userId: bot.id, username: bot.username, team: match.mode === 'duo' ? me.team : null, title: '', status: 'draft', reviewStatus: 'clear', createdAt: Date.now(), submittedAt: null, files: {}, auditTrail: [] };
    sub.files = {
      render: { name: 'bot-render.jpg', mime: 'image/jpeg', size: 0, url: renderArt, uploadedAt: Date.now(), simulated: true },
      proof: { name: bot.username + '_viewport_proof.svg', mime: 'image/svg+xml', size: 0, url: proofArt, uploadedAt: Date.now(), simulated: true },
    };
    const titles = ['Study in wireframe', 'Late-night sculpt', 'Third coffee, first idea', 'Silhouette first', 'Modular kit experiment'];
    sub.title = titles[Math.floor(Math.random() * titles.length)];
    sub.status = 'submitted';
    sub.submittedAt = Date.now();
    sub.auditTrail.push({ at: Date.now(), action: 'submitted', note: 'Simulated bot entry submitted (static demo)' });
    if (!existing) db.submissions.push(sub);
    me.submitted = true;
    save();
  }
  function beginVoting(match) {
    match.submissionClosedAt = Date.now();
    const subs = matchSubs(match.id).filter((s) => s.files.render && s.files.proof && !s.disqualified);
    match.botPlan.forEach((plan) => { if (!plan.done) { plan.done = true; botSubmit(match, plan); } plan.voteAt = Date.now() + 2500 + Math.random() * 12000; plan.voteDone = false; });
    match.phase = 'voting';
    match.phaseEndsAt = Date.now() + VOTING_SECONDS * 1000;
    match.auditTrail.push({ at: Date.now(), action: 'voting-started', note: `${subs.length} valid ${subs.length === 1 ? 'entry' : 'entries'} entered voting` });
    if (!subs.length) {
      finishMatch(match, { abandoned: true, reason: 'No valid entries were submitted.' });
      return;
    }
    save();
  }
  function awardXP(user, amount) {
    if (!user || user.isBot) return;
    user.xp = Math.max(0, (user.xp || 0) + Math.round(amount));
    user.level = levelFor(user.xp);
    user.rank = rankFor(user.xp);
  }
  function finishMatch(match, opts = {}) {
    const subs = matchSubs(match.id).filter((s) => s.files.render && s.files.proof && !s.disqualified);
    const scored = subs.map((s) => {
      const votes = db.votes.filter((v) => v.submissionId === s.id && !v.invalidated);
      const avg = votes.length ? votes.reduce((a, v) => a + v.score, 0) / votes.length : 0;
      s.avgScore = +avg.toFixed(2);
      s.voteCount = votes.length;
      return s;
    }).sort((a, b) => b.avgScore - a.avgScore || b.voteCount - a.voteCount || (a.submittedAt || 0) - (b.submittedAt || 0));

    const awards = [];
    const entries = scored.map((s, i) => {
      const place = i + 1;
      const owner = getUser(s.userId);
      let xpAwarded = 0;
      if (!match.practice && owner && !owner.isBot) {
        xpAwarded = Math.round(([250, 160, 100][i] || 60) + s.avgScore * 15 + s.voteCount * 2);
        awardXP(owner, xpAwarded);
        owner.stats = owner.stats || { wins: 0, matches: 0, podiums: 0, votes: 0, avgScore: 0 };
        owner.stats.matches = (owner.stats.matches || 0) + 1;
        owner.stats.votes = (owner.stats.votes || 0) + s.voteCount;
        if (place === 1) owner.stats.wins = (owner.stats.wins || 0) + 1;
        if (place <= 3) owner.stats.podiums = (owner.stats.podiums || 0) + 1;
        owner.stats.avgScore = +(((owner.stats.avgScore || 0) * (owner.stats.matches - 1) + s.avgScore) / owner.stats.matches).toFixed(2);
        const add = (b) => { if (!owner.badges.includes(b)) owner.badges.push(b); };
        if (place === 1) add('first-blood');
        if (owner.stats.matches >= 5) add('regular');
        if (owner.stats.podiums >= 5) add('podium-hunter');
        if (owner.xp >= 8000) add('legend-track');
        awards.push({ userId: owner.id, username: owner.username, place, xpAwarded, avgScore: s.avgScore });
      }
      return {
        place, submissionId: s.id, userId: s.userId, username: (owner && owner.username) || s.username,
        displayName: teamLabel(match, s) || (owner && owner.username) || s.username,
        avgScore: s.avgScore, voteCount: s.voteCount, disqualified: !!s.disqualified,
        renderUrl: mediaUrl(s, 'render'),
        renderKind: (s.files.render.mime || '').startsWith('video') ? 'video' : 'image',
        title: s.title, xpAwarded,
      };
    });
    match.phase = 'results';
    match.endedAt = Date.now();
    match.phaseEndsAt = Date.now();
    match.abandoned = !!opts.abandoned;
    match.results = {
      computedAt: Date.now(), abandoned: !!opts.abandoned, reason: opts.reason || null,
      entries, awards, podium: entries.slice(0, 3),
      stats: {
        entries: entries.length,
        votes: db.votes.filter((v) => v.matchId === match.id && !v.invalidated).length,
        durationSeconds: Math.round(((match.endedAt || Date.now()) - match.startedAt) / 1000),
        theme: match.theme, mode: match.modeName,
      },
    };
    const lobby = getLobby(match.code);
    if (lobby) {
      lobby.status = 'waiting'; lobby.matchId = null; lobby.startsAt = null;
      lobby.players.forEach((p) => { p.ready = !!p.isBot; });
    }
    if (!match.practice) {
      activity({ type: 'results', text: `${entries[0] ? entries[0].displayName : 'Nobody'} won “${match.theme}” — ${entries[0] ? entries[0].avgScore.toFixed(1) : 0}★ average.`, matchId: match.id });
    }
    save();
  }

  /* ----------------------------------------------------------------- ticker */
  function tick() {
    const now = Date.now();
    let changedLobby = false;
    let changedMatch = false;

    db.lobbies.forEach((lobby) => {
      if (lobby.status === 'starting' && lobby.startsAt && now >= lobby.startsAt) {
        if (lobby.players.some((p) => !p.isBot)) { startMatchFromLobby(lobby); changedLobby = true; changedMatch = true; }
        else { lobby.status = 'waiting'; lobby.startsAt = null; changedLobby = true; }
      }
    });

    db.matches.forEach((match) => {
      if (match.phase === 'building' && !match.practice && match.phaseEndsAt && now >= match.phaseEndsAt) {
        match.phase = 'submission';
        match.phaseEndsAt = now + SUBMISSION_WINDOW * 1000;
        match.auditTrail.push({ at: now, action: 'submission-window', note: 'Build timer ended — final submission window opened' });
        changedMatch = true;
      } else if (match.phase === 'submission' && match.phaseEndsAt && now >= match.phaseEndsAt) {
        beginVoting(match); changedMatch = true;
      } else if (match.phase === 'voting' && match.phaseEndsAt && now >= match.phaseEndsAt) {
        finishMatch(match); changedMatch = true; changedLobby = true;
      }

      if ((match.phase === 'building' || match.phase === 'submission') && match.botPlan) {
        match.botPlan.forEach((plan) => {
          if (plan.submitAt && now >= plan.submitAt && !plan.done) { plan.done = true; botSubmit(match, plan); changedMatch = true; }
        });
      }
      if (match.phase === 'voting' && match.botPlan) {
        match.botPlan.forEach((plan) => {
          if (plan.voteAt && now >= plan.voteAt && !plan.voteDone) {
            plan.voteDone = true;
            const targets = matchSubs(match.id).filter((s) => s.files.render && s.files.proof && !s.disqualified && s.userId !== plan.userId && s.team !== (match.players.find((p) => p.userId === plan.userId) || {}).team);
            targets.forEach((t) => {
              if (db.votes.some((v) => v.voterId === plan.userId && v.submissionId === t.id)) return;
              const score = Math.max(1, Math.min(5, 3 + Math.round((Math.random() - 0.4) * 3)));
              db.votes.push({ id: id('vote'), matchId: match.id, submissionId: t.id, voterId: plan.userId, voterName: (getUser(plan.userId) || {}).username || 'bot', score, createdAt: Date.now(), invalidated: false });
            });
            changedMatch = true;
          }
        });
      }
      if (match.phase === 'voting' && !match.autoCloseChecked) {
        const humans = match.players.filter((p) => !p.isBot);
        const subs = matchSubs(match.id).filter((s) => s.files.render && s.files.proof && !s.disqualified);
        const allVoted = humans.length > 1 && humans.every((p) => {
          const targets = subs.filter((s) => (match.mode === 'duo' ? s.team !== p.team : s.userId !== p.userId));
          return targets.length > 0 && targets.every((t) => db.votes.some((v) => v.voterId === p.userId && v.submissionId === t.id && !v.invalidated));
        });
        if (allVoted) { match.autoCloseChecked = true; match.phaseEndsAt = Math.min(match.phaseEndsAt || Infinity, Date.now() + 3000); }
      }
    });

    if (changedMatch) save();
    if (changedLobby) save();
    if (changedMatch || changedLobby) broadcast();
  }
  function broadcast() {
    const codes = db.lobbies.map((l) => l.code);
    const ids = db.matches.map((m) => m.id);
    clients.forEach((client) => {
      codes.forEach((code) => client._emit('lobby', { code }));
      ids.forEach((mid) => client._emit('match', { id: mid }));
    });
  }
  setInterval(tick, 1000);

  /* ------------------------------------------------------------- fake live */
  const clients = new Set();
  class FakeEventSource {
    constructor() {
      this.readyState = 1; this.listeners = {}; this.lobbies = new Set(); this.matches = new Set();
      clients.add(this);
      setTimeout(() => this._emit('open', {}), 30);
    }
    addEventListener(name, fn) {
      (this.listeners[name] = this.listeners[name] || []).push(fn);
    }
    _emit(name, payload) {
      (this.listeners[name] || []).forEach((fn) => { try { fn({ data: JSON.stringify(payload) }); } catch (e) { console.error(e); } });
    }
    close() { this.readyState = 2; clients.delete(this); }
  }

  /* ---------------------------------------------------------------- helpers */
  function apiError(message, status) {
    const err = new Error(message);
    err.status = status || 400;
    return err;
  }
  function challengesFor(user) {
    if (!user) return { daily: [], weekly: [] };
    const dayKey = new Date().toISOString().slice(0, 10);
    const weekKey = dayKey.slice(0, 8) + Math.ceil(Number(dayKey.slice(8)) / 7);
    const claims = user.challengeClaims || {};
    const mySubs = db.submissions.filter((s) => s.userId === user.id && s.submittedAt);
    const todaySubs = mySubs.filter((s) => new Date(s.submittedAt).toISOString().slice(0, 10) === dayKey);
    const myVotes = db.votes.filter((v) => v.voterId === user.id && !v.invalidated);
    const todayVotes = myVotes.filter((v) => new Date(v.createdAt).toISOString().slice(0, 10) === dayKey);
    const finished = db.matches.filter((m) => m.phase === 'results' && m.players.some((p) => p.userId === user.id));
    const todayWins = finished.filter((m) => new Date(m.endedAt).toISOString().slice(0, 10) === dayKey && m.results.entries[0] && m.results.entries[0].userId === user.id);
    const weekMatches = finished.filter((m) => Date.now() - m.endedAt < 7 * 86400000);
    const defs = [
      { id: 'daily_submit', title: 'Enter the arena', desc: 'Submit 1 competitive entry today.', progress: todaySubs.length, target: 1, xp: 60, scope: 'daily' },
      { id: 'daily_vote', title: 'Judge, fairly', desc: 'Cast 5 votes on other entries today.', progress: todayVotes.length, target: 5, xp: 40, scope: 'daily' },
      { id: 'daily_win', title: 'Top of the podium', desc: 'Win a match today.', progress: todayWins.length, target: 1, xp: 120, scope: 'daily' },
      { id: 'daily_proof', title: 'Proof positive', desc: 'Submit an entry with a viewport recording (video proof).', progress: mySubs.filter((s) => s.files.proof && (s.files.proof.mime || '').startsWith('video')).length, target: 1, xp: 50, scope: 'daily' },
      { id: 'weekly_matches', title: 'Five rounds', desc: 'Play 5 matches this week.', progress: weekMatches.length, target: 5, xp: 250, scope: 'weekly' },
      { id: 'weekly_votes', title: 'Community jury', desc: 'Cast 25 votes this week.', progress: myVotes.filter((v) => Date.now() - v.createdAt < 7 * 86400000).length, target: 25, xp: 200, scope: 'weekly' },
      { id: 'weekly_entries', title: 'Seven submissions', desc: 'Submit 7 entries this week.', progress: mySubs.filter((s) => Date.now() - s.submittedAt < 7 * 86400000).length, target: 7, xp: 300, scope: 'weekly' },
    ];
    const decorate = (c) => {
      const key = c.scope === 'daily' ? dayKey : weekKey;
      const claimed = !!(claims[c.scope + ':' + key] || []).includes(c.id);
      return { ...c, progress: Math.min(c.progress, c.target), complete: c.progress >= c.target, claimed, claimKey: c.scope + ':' + key };
    };
    return { daily: defs.filter((d) => d.scope === 'daily').map(decorate), weekly: defs.filter((d) => d.scope === 'weekly').map(decorate) };
  }

  /* ------------------------------------------------------------------- API */
  function parseBody(opts) {
    if (!opts || opts.body == null) return {};
    if (typeof opts.body === 'string') { try { return JSON.parse(opts.body); } catch (e) { return {}; } }
    return opts.body;
  }

  async function handle(method, url, opts) {
    const u = new URL(url, location.href);
    const p = u.pathname.replace(/^\/api/, '');
    const q = Object.fromEntries(u.searchParams);
    const body = parseBody(opts);
    const user = currentUser();
    const need = () => { if (!user) throw apiError('Sign in to continue', 401); return user; };

    /* --- meta */
    if (method === 'GET' && p === '/config') {
      return {
        demoMode: true, staticMode: true, modes: Object.values(MODES), themes: THEMES, ranks: RANKS,
        limits: MAX_UPLOAD,
        demoAccounts: [
          { username: 'NovaKite', password: 'blendbattles', note: 'Top-ranked artist' },
          { username: 'modvex', password: 'blendbattles', note: 'Moderator (review tools)' },
        ],
        online: onlineCount(),
      };
    }
    if (method === 'GET' && p === '/themes') return { themes: THEMES };
    if (method === 'GET' && p === '/me') {
      if (!user) return { user: null, demoMode: true, online: onlineCount() };
      return { user: publicUser(user, user), demoMode: true, online: onlineCount(), challenges: challengesFor(user) };
    }
    if (method === 'PATCH' && p === '/me') {
      const me = need();
      if (body.username !== undefined) {
        if (!/^[A-Za-z0-9_]{3,18}$/.test(body.username)) throw apiError('Username must be 3–18 characters: letters, numbers, underscore.');
        if (db.users.some((x) => x.id !== me.id && x.username.toLowerCase() === body.username.toLowerCase())) throw apiError('That username is taken.');
        me.username = body.username;
      }
      if (body.bio !== undefined) me.bio = String(body.bio).slice(0, 240);
      if (body.avatarHue !== undefined) me.avatarHue = clamp(Number(body.avatarHue) || 0, 0, 359);
      if (body.region !== undefined) me.region = ['EU', 'NA', 'APAC', 'SA', 'AF'].includes(body.region) ? body.region : me.region;
      if (body.location !== undefined) me.location = String(body.location).slice(0, 60);
      if (body.privacy) me.privacy = Object.assign({}, me.privacy, body.privacy);
      if (body.settings) me.settings = Object.assign({}, me.settings, body.settings);
      save();
      return { user: publicUser(me, me) };
    }

    /* --- auth */
    if (method === 'POST' && p === '/auth/login') {
      const found = db.users.find((x) => x.username.toLowerCase() === String(body.username || '').toLowerCase() && !x.isBot);
      const okPass = found && (found.demoPassword ? String(body.password) === found.demoPassword : found.pass && hashPassword(body.password, found.salt) === found.pass);
      if (!okPass) throw apiError('Incorrect username or password.', 401);
      setSession(makeToken(found.id));
      found.lastSeen = Date.now();
      save();
      return { user: publicUser(found, found) };
    }
    if (method === 'POST' && p === '/auth/register') {
      if (!/^[A-Za-z0-9_]{3,18}$/.test(body.username || '')) throw apiError('Username must be 3–18 characters: letters, numbers, underscore.');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(body.email || '')) throw apiError('Enter a valid email address.');
      if (typeof body.password !== 'string' || body.password.length < 8) throw apiError('Password must be at least 8 characters.');
      if (db.users.some((x) => x.username.toLowerCase() === body.username.toLowerCase())) throw apiError('That username is taken.');
      if (db.users.some((x) => x.email && x.email.toLowerCase() === body.email.toLowerCase())) throw apiError('An account with that email already exists.');
      const salt = Math.random().toString(36).slice(2, 10);
      const newUser = {
        id: id('usr'), username: body.username, email: body.email, salt, pass: hashPassword(body.password, salt),
        avatarHue: Math.floor(Math.random() * 360), xp: 0, level: 1, rank: rankFor(0),
        region: body.region || 'EU', location: '', isMod: false, isGuest: false, isDemo: false,
        bio: '', badges: [], stats: { wins: 0, matches: 0, podiums: 0, votes: 0, avgScore: 0 },
        friends: [], blocked: [], privacy: { showHistory: true, friendsOnlyLeaderboard: false },
        settings: { sfx: true, reducedMotion: false }, challengeClaims: {},
        createdAt: Date.now(), lastSeen: Date.now(),
      };
      db.users.push(newUser);
      setSession(makeToken(newUser.id));
      activity({ type: 'player', text: `${newUser.username} joined Blend Battles.` });
      save();
      return { user: publicUser(newUser, newUser) };
    }
    if (method === 'POST' && p === '/auth/guest') {
      const adjectives = ['Neon', 'Low', 'Cyber', 'Rogue', 'Turbo', 'Velvet', 'Quantum', 'Feral', 'Chrome', 'Pixel'];
      const nouns = ['Cube', 'Ortho', 'Vertex', 'Suzanne', 'Shader', 'Gizmo', 'Rig', 'Mesh', 'Normal', 'Bevel'];
      let name;
      do { name = adjectives[Math.floor(Math.random() * adjectives.length)] + nouns[Math.floor(Math.random() * nouns.length)] + Math.floor(10 + Math.random() * 89); }
      while (db.users.some((x) => x.username.toLowerCase() === name.toLowerCase()));
      const guest = {
        id: id('usr'), username: name, email: null, salt: null, pass: null,
        avatarHue: Math.floor(Math.random() * 360), xp: 0, level: 1, rank: rankFor(0),
        region: 'EU', location: '', isMod: false, isGuest: true, isDemo: false,
        bio: 'Guest artist — progress is kept in this browser only.', badges: [],
        stats: { wins: 0, matches: 0, podiums: 0, votes: 0, avgScore: 0 },
        friends: [], blocked: [], privacy: { showHistory: true }, settings: { sfx: true, reducedMotion: false },
        challengeClaims: {}, createdAt: Date.now(), lastSeen: Date.now(),
      };
      db.users.push(guest);
      setSession(makeToken(guest.id));
      activity({ type: 'player', text: `Guest ${name} is trying the arena.` });
      save();
      return { user: publicUser(guest, guest) };
    }
    if (method === 'POST' && p === '/auth/logout') { clearSession(); return { ok: true }; }

    /* --- friends */
    if (method === 'POST' && p === '/me/friends') {
      const me = need();
      const target = getUser(body.userId);
      if (!target) throw apiError('Player not found', 404);
      if (target.id === me.id) throw apiError('You cannot add yourself.');
      if (target.isBot) throw apiError('Practice bots are not friendable.');
      me.friends = me.friends || [];
      if (body.action === 'remove') me.friends = me.friends.filter((f) => f !== target.id);
      else if (!me.friends.includes(target.id)) me.friends.push(target.id);
      save();
      return { friends: me.friends, user: publicUser(me, me) };
    }

    /* --- home */
    if (method === 'GET' && p === '/home') {
      const finished = db.matches.filter((m) => m.phase === 'results' && !m.abandoned && m.results).sort((a, b) => b.endedAt - a.endedAt);
      const featured = [];
      const seen = new Set();
      finished.forEach((m) => {
        m.results.entries.slice(0, 2).forEach((e) => {
          if (featured.length >= 6 || seen.has(e.submissionId)) return;
          seen.add(e.submissionId);
          const sub = getSubmission(e.submissionId);
          featured.push({
            ...e, theme: m.theme, mode: m.modeName, matchId: m.id,
            proofUrl: sub && sub.files.proof ? mediaUrl(sub, 'proof') : null,
            proofKind: sub && sub.files.proof && (sub.files.proof.mime || '').startsWith('video') ? 'video' : 'image',
            hasModel: !!(sub && sub.files.model),
            modelUrl: sub && sub.files.model ? mediaUrl(sub, 'model') : null,
          });
        });
      });
      const winners = finished.slice(0, 5).map((m) => ({
        username: m.results.entries[0] ? (m.results.entries[0].displayName || m.results.entries[0].username || '—') : '—',
        renderUrl: m.results.entries[0] ? m.results.entries[0].renderUrl : null,
        theme: m.theme, mode: m.modeName, endedAt: m.endedAt,
        score: m.results.entries[0] ? m.results.entries[0].avgScore : 0, matchId: m.id,
      }));
      const openLobbies = db.lobbies.filter((l) => !l.isPrivate && (l.status === 'waiting' || l.status === 'starting')).length;
      const activeMatches = db.matches.filter((m) => m.phase !== 'results').map((m) => ({
        id: m.id, theme: m.theme, mode: m.modeName, phase: m.phase, phaseEndsAt: m.phaseEndsAt,
        players: m.players.length,
        submissions: matchSubs(m.id).filter((s) => s.files.render && s.files.proof).length,
        isParticipant: isParticipant(m, user),
      }));
      const topPlayers = db.users.filter((x) => !x.isBot && !x.isGuest).sort((a, b) => b.xp - a.xp).slice(0, 5).map(userSummary);
      const today = new Date().toISOString().slice(0, 10);
      const daily = Object.assign({}, pickTheme('any', 'daily-' + today), { date: today });
      return {
        featured, winners, topPlayers, activeMatches, openLobbies, online: onlineCount(),
        dailyTheme: daily, activity: db.activity.slice(0, 8),
        stats: {
          players: db.users.filter((x) => !x.isBot).length,
          entries: db.submissions.filter((s) => s.files.render).length,
          matches: finished.length,
          votes: db.votes.filter((v) => !v.invalidated).length,
        },
      };
    }
    if (method === 'GET' && p === '/activity') return { activity: db.activity.slice(0, 12) };

    /* --- gallery */
    if (method === 'GET' && p === '/gallery') {
      const items = db.submissions
        .filter((s) => s.files.render && s.files.proof && !s.disqualified)
        .map((s) => {
          const m = getMatch(s.matchId);
          if (!m || m.phase !== 'results' || m.abandoned) return null;
          const owner = getUser(s.userId);
          const place = m.results.entries.find((e) => e.submissionId === s.id);
          return {
            submissionId: s.id, matchId: m.id, title: s.title || m.theme, theme: m.theme,
            mode: m.modeName, modeKey: m.mode,
            renderUrl: mediaUrl(s, 'render'),
            renderKind: (s.files.render.mime || '').startsWith('video') ? 'video' : 'image',
            proofUrl: s.files.proof ? mediaUrl(s, 'proof') : null,
            proofKind: s.files.proof && (s.files.proof.mime || '').startsWith('video') ? 'video' : 'image',
            hasModel: !!s.files.model, modelUrl: s.files.model ? mediaUrl(s, 'model') : null,
            username: owner ? owner.username : s.username,
            avatarHue: owner ? owner.avatarHue : 250,
            rank: owner ? rankFor(owner.xp).name : 'Beginner',
            rankColor: owner ? rankFor(owner.xp).color : '#888',
            place: place ? place.place : null, score: s.avgScore || 0, votes: s.voteCount || 0,
            endedAt: m.endedAt, isBot: !!(owner && owner.isBot), reviewStatus: s.reviewStatus,
          };
        })
        .filter(Boolean)
        .filter((x) => q.theme === undefined || x.theme === q.theme)
        .filter((x) => q.mode === undefined || x.modeKey === q.mode)
        .filter((x) => q.mine !== '1' || (user && x.username === user.username))
        .sort((a, b) => (q.sort === 'top' ? b.score - a.score : b.endedAt - a.endedAt));
      return { items, themes: [...new Set(items.map((i) => i.theme))].sort() };
    }

    /* --- leaderboard / users */
    if (method === 'GET' && p === '/leaderboard') {
      const scope = ['global', 'regional', 'friends'].includes(q.scope) ? q.scope : 'global';
      let users = db.users.filter((x) => !x.isBot && !x.isGuest);
      if (scope === 'regional') users = users.filter((x) => x.region === (user ? user.region : 'EU'));
      if (scope === 'friends') {
        if (!user) throw apiError('Sign in to see your friends ladder.', 401);
        users = users.filter((x) => (user.friends || []).includes(x.id) || x.id === user.id);
      }
      const ranked = users.map(userSummary).sort((a, b) => b.xp - a.xp).slice(0, 100)
        .map((x, i) => ({ ...x, position: i + 1, isYou: !!(user && user.id === x.id) }));
      return { scope, entries: ranked, you: ranked.find((r) => r.isYou) || null };
    }
    if (method === 'GET' && p.startsWith('/users/')) {
      const target = getUser(decodeURIComponent(p.slice(7)));
      if (!target) throw apiError('Player not found', 404);
      const isSelf = !!user && user.id === target.id;
      const isFriend = !!(user && (user.friends || []).includes(target.id));
      const matches = db.matches
        .filter((m) => m.players.some((p) => p.userId === target.id) && m.phase === 'results')
        .sort((a, b) => b.endedAt - a.endedAt).slice(0, 20).map((m) => matchSummaryFor(m, target.id));
      const creations = db.submissions
        .filter((s) => s.userId === target.id && s.files.render && s.files.proof)
        .sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0)).slice(0, 24)
        .map((s) => {
          const m = getMatch(s.matchId);
          return {
            submissionId: s.id, theme: m ? m.theme : '', mode: m ? m.modeName : '',
            renderUrl: mediaUrl(s, 'render'),
            renderKind: (s.files.render.mime || '').startsWith('video') ? 'video' : 'image',
            proofUrl: s.files.proof ? mediaUrl(s, 'proof') : null,
            proofKind: s.files.proof && (s.files.proof.mime || '').startsWith('video') ? 'video' : 'image',
            score: s.avgScore || 0,
            place: m && m.results ? (m.results.entries.find((e) => e.submissionId === s.id) || {}).place : null,
            endedAt: m ? m.endedAt : s.submittedAt,
          };
        });
      const canSee = isSelf || isFriend || (target.privacy || {}).showHistory !== false;
      return {
        user: publicUser(target, user), isSelf, isFriend, canSeeHistory: canSee,
        matches: canSee ? matches : [], creations,
        matchCount: db.matches.filter((m) => m.players.some((p) => p.userId === target.id)).length,
      };
    }

    /* --- challenges */
    if (method === 'GET' && p === '/challenges') return challengesFor(need());
    if (method === 'POST' && p.startsWith('/challenges/')) {
      const me = need();
      const cid = p.split('/')[2];
      const all = challengesFor(me);
      const c = [...all.daily, ...all.weekly].find((x) => x.id === cid);
      if (!c) throw apiError('Unknown challenge', 404);
      if (!c.complete) throw apiError('Challenge is not complete yet.');
      me.challengeClaims = me.challengeClaims || {};
      const list = me.challengeClaims[c.claimKey] || [];
      if (list.includes(c.id)) throw apiError('Already claimed for this period.');
      list.push(c.id);
      me.challengeClaims[c.claimKey] = list;
      awardXP(me, c.xp);
      audit({ action: 'challenge-claim', actor: me.username, note: `${c.title} (+${c.xp} XP)` });
      save();
      return { user: publicUser(me, me), challenges: challengesFor(me), awarded: c.xp };
    }

    /* --- tournaments */
    if (method === 'GET' && p === '/tournaments') {
      const base = new Date(); base.setHours(18, 0, 0, 0);
      const mk = (offsetDays, name, mode, prize, slots) => {
        const tid = 'tour-' + offsetDays + '-' + mode;
        return {
          id: tid, name, mode: MODES[mode].name, modeKey: mode,
          startsAt: base.getTime() + offsetDays * 86400000, prize, slots,
          registered: db.tournaments.filter((x) => x.id === tid).length,
          isRegistered: !!(user && db.tournaments.some((x) => x.id === tid && x.userId === user.id)),
        };
      };
      return { tournaments: [
        mk(1, 'Weekly Render Rumble', 'build', '500 XP + Legend badge', 16),
        mk(3, 'Two-Minute Blitz', 'speed', '300 XP + Speed Demon badge', 12),
        mk(6, 'Motion Masters', 'animation', '750 XP + Animator badge', 8),
      ] };
    }
    if (method === 'POST' && p.startsWith('/tournaments/') && p.endsWith('/register')) {
      const me = need();
      const tid = p.split('/')[2];
      const existing = db.tournaments.find((x) => x.id === tid && x.userId === me.id);
      const count = db.tournaments.filter((x) => x.id === tid).length;
      if (existing) {
        db.tournaments = db.tournaments.filter((x) => !(x.id === tid && x.userId === me.id));
        save();
        return { registered: false, count: count - 1 };
      }
      if (count >= 16) throw apiError('This tournament bracket is full.');
      db.tournaments.push({ id: tid, userId: me.id, at: Date.now() });
      audit({ action: 'tournament-register', actor: me.username, note: tid });
      save();
      return { registered: true, count: count + 1 };
    }

    /* --- lobbies */
    if (method === 'GET' && p === '/lobbies') {
      const list = db.lobbies
        .filter((l) => !l.isPrivate && (l.status === 'waiting' || l.status === 'starting'))
        .filter((l) => q.mode === undefined || l.mode === q.mode)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((l) => serializeLobby(l, user));
      return { lobbies: list, modes: Object.values(MODES) };
    }
    if (method === 'POST' && p === '/lobbies') {
      const me = need();
      const mode = MODES[body.mode] ? body.mode : 'build';
      const cfg = MODES[mode];
      const lobby = {
        id: id('lob'), code: roomCode(),
        name: String(body.name || `${me.username}'s ${cfg.name}`).trim().slice(0, 40) || `${cfg.name} room`,
        mode,
        maxPlayers: clamp(Number(body.maxPlayers) || cfg.maxPlayers, cfg.minPlayers, cfg.maxPlayers),
        difficulty: ['easy', 'medium', 'hard', 'any'].includes(body.difficulty) ? body.difficulty : 'any',
        buildSeconds: clamp(Number(body.buildSeconds) || cfg.buildSeconds, cfg.practice ? 0 : 60, 1800),
        customTheme: body.customTheme ? String(body.customTheme).trim().slice(0, 40) : null,
        isPrivate: !!body.isPrivate, hostId: me.id, status: 'waiting',
        players: [{ userId: me.id, name: me.username, ready: false, isBot: false, connected: true, joinedAt: Date.now() }],
        createdAt: Date.now(), startsAt: null, matchId: null,
      };
      db.lobbies.push(lobby);
      activity({ type: 'lobby', text: `${me.username} opened a ${cfg.name} room (${lobby.code}).` });
      save();
      return { lobby: serializeLobby(lobby, me) };
    }
    if (method === 'POST' && p === '/quickplay') {
      const me = need();
      const mode = MODES[body.mode] ? body.mode : 'build';
      const cfg = MODES[mode];
      const lobby = {
        id: id('lob'), code: roomCode(), name: `${me.username}'s ${cfg.name}`, mode,
        maxPlayers: cfg.maxPlayers, difficulty: 'any', buildSeconds: cfg.buildSeconds,
        customTheme: null, isPrivate: false, hostId: me.id, status: 'waiting',
        players: [{ userId: me.id, name: me.username, ready: false, isBot: false, connected: true, joinedAt: Date.now() }],
        createdAt: Date.now(), startsAt: null, matchId: null,
      };
      db.lobbies.push(lobby);
      if (!cfg.practice) {
        while (lobby.players.length < Math.min(lobby.maxPlayers, 4)) {
          const bot = addBot(lobby, lobby.players.length);
          lobby.players.push({ userId: bot.id, name: bot.username, ready: true, isBot: true, connected: true, joinedAt: Date.now() });
        }
      }
      save();
      return { lobby: serializeLobby(lobby, me), created: true };
    }
    if (p.startsWith('/lobbies/')) {
      const parts = p.split('/');
      const lobby = getLobby(parts[2]);
      if (!lobby) throw apiError('Lobby not found', 404);
      const action = parts[3];
      if (method === 'GET' && !action) return { lobby: serializeLobby(lobby, user) };
      const me = need();
      if (action === 'join') {
        if (lobby.status === 'in_match') throw apiError('That match already started. Ask the host for the next round.');
        if (lobby.players.length >= lobby.maxPlayers && !lobby.players.some((x) => x.userId === me.id)) throw apiError('That lobby is full.');
        if (!lobby.players.some((x) => x.userId === me.id)) {
          lobby.players.push({ userId: me.id, name: me.username, ready: false, isBot: false, connected: true, joinedAt: Date.now() });
          activity({ type: 'lobby', text: `${me.username} joined room ${lobby.code}.` });
        }
        save();
        return { lobby: serializeLobby(lobby, me) };
      }
      if (action === 'leave') {
        lobby.players = lobby.players.filter((x) => x.userId !== me.id);
        if (!lobby.players.some((x) => !x.isBot)) {
          db.lobbies = db.lobbies.filter((l) => l !== lobby);
          save();
          return { left: true, lobbyDeleted: true };
        }
        if (lobby.hostId === me.id) {
          const next = lobby.players.find((x) => !x.isBot) || lobby.players[0];
          lobby.hostId = next.userId;
        }
        save();
        return { left: true, lobby: serializeLobby(lobby, me) };
      }
      if (action === 'ready') {
        const pl = lobby.players.find((x) => x.userId === me.id);
        if (!pl) throw apiError('Join the lobby before readying up.', 403);
        pl.ready = body.ready !== false;
        save();
        return { lobby: serializeLobby(lobby, me) };
      }
      if (action === 'bots') {
        if (lobby.hostId !== me.id) throw apiError('Only the host can add practice bots.', 403);
        const want = clamp(Number(body.count) || 3, 0, lobby.maxPlayers);
        const currentBots = lobby.players.filter((x) => x.isBot).length;
        const toAdd = Math.max(0, Math.min(want, lobby.maxPlayers - lobby.players.length));
        for (let i = 0; i < toAdd; i++) {
          const bot = addBot(lobby, currentBots + i);
          lobby.players.push({ userId: bot.id, name: bot.username, ready: true, isBot: true, connected: true, joinedAt: Date.now() });
        }
        if (body.fill === true) {
          while (lobby.players.length < Math.min(lobby.maxPlayers, 4)) {
            const bot = addBot(lobby, lobby.players.length);
            lobby.players.push({ userId: bot.id, name: bot.username, ready: true, isBot: true, connected: true, joinedAt: Date.now() });
          }
        }
        save();
        return { lobby: serializeLobby(lobby, me) };
      }
      if (action === 'kick') {
        if (lobby.hostId !== me.id) throw apiError('Only the host can remove players.', 403);
        if (body.userId === me.id) throw apiError('You cannot kick yourself — leave instead.');
        lobby.players = lobby.players.filter((x) => x.userId !== body.userId);
        save();
        return { lobby: serializeLobby(lobby, me) };
      }
      if (action === 'start') {
        if (lobby.hostId !== me.id) throw apiError('Only the host can start the match.', 403);
        if (lobby.status !== 'waiting') throw apiError('This lobby is already starting.');
        const humans = lobby.players.filter((x) => !x.isBot);
        if (!humans.length) throw apiError('Nobody is in the lobby.');
        if (lobby.players.length < 2 && !MODES[lobby.mode].practice) throw apiError('You need at least 2 contestants. Add practice bots to play solo.');
        if (!MODES[lobby.mode].practice && humans.some((x) => !x.ready)) throw apiError('Every human player must be ready.');
        lobby.status = 'starting';
        lobby.startsAt = Date.now() + 5000;
        lobby.players.forEach((x) => { x.ready = true; });
        save();
        return { lobby: serializeLobby(lobby, me) };
      }
      if (action === 'theme') {
        if (lobby.hostId !== me.id) throw apiError('Only the host can change the theme.', 403);
        lobby.customTheme = body.customTheme ? String(body.customTheme).trim().slice(0, 40) : null;
        if (body.difficulty) lobby.difficulty = ['easy', 'medium', 'hard', 'any'].includes(body.difficulty) ? body.difficulty : lobby.difficulty;
        if (body.buildSeconds) lobby.buildSeconds = clamp(Number(body.buildSeconds), 60, 1800);
        save();
        return { lobby: serializeLobby(lobby, me) };
      }
      throw apiError('Endpoint not found', 404);
    }

    /* --- matches */
    if (p.startsWith('/matches/')) {
      const parts = p.split('/');
      const match = getMatch(parts[2]);
      if (!match) throw apiError('Match not found', 404);
      const action = parts[3];
      if (method === 'GET' && !action) {
        if (!isParticipant(match, user) && !(user && user.isMod) && match.phase !== 'results') throw apiError('This match is private until results are published.', 403);
        return { match: serializeMatch(match, user) };
      }
      const me = need();
      if (action === 'upload') {
        if (!isParticipant(match, me)) throw apiError('You are not in this match', 403);
        if (!canUpload(match, me)) throw apiError('Uploads are closed for this match.', 403);
        const kind = q.kind;
        if (!['render', 'proof', 'model'].includes(kind)) throw apiError('Invalid upload kind');
        const sub = ensureSubmission(match, me);
        if (sub.disqualified) throw apiError('This submission was disqualified — uploads are locked.', 403);
        let file = opts.file;
        if (!file) throw apiError('No file received.', 400);
        const name = String(file.name || q.name || 'upload').slice(-120);
        const ext = '.' + (name.split('.').pop() || '').toLowerCase();
        const allowedExt = kind === 'model' ? ['.glb', '.gltf'] : ['.png', '.jpg', '.jpeg', '.mp4', '.webm'];
        if (!allowedExt.includes(ext)) throw apiError(`Unsupported file extension ${ext}. Allowed: ${allowedExt.join(', ')}`);
        if (file.size > MAX_UPLOAD[kind]) throw apiError(`File is too large — the limit is ${Math.round(MAX_UPLOAD[kind] / 1048576)} MB.`, 413);
        const mime = file.type || (kind === 'model' ? 'model/gltf-binary' : 'application/octet-stream');
        const allowedMime = kind === 'model'
          ? ['model/gltf-binary', 'application/json', '']
          : ['image/png', 'image/jpeg', 'image/jpg', 'video/mp4', 'video/webm', ''];
        if (!allowedMime.includes(mime)) throw apiError(`The file contents do not match an allowed ${kind === 'model' ? 'GLB/glTF' : 'image/video'} format (detected: ${mime || 'unknown'}). Nothing was saved.`, 415);
        if (kind === 'render' && (MODES[match.mode] || {}).requiresVideo && !mime.startsWith('video')) throw apiError('Animation Battles require a video final render (MP4 or WebM).', 415);
        const dataUrl = opts.dataUrl || await readAsDataUrl(file);
        media.set(sub.id + ':' + kind, dataUrl);
        sub.files[kind] = { name, mime, size: file.size, url: dataUrl, uploadedAt: Date.now(), local: true };
        sub.status = sub.status === 'submitted' ? 'submitted' : 'draft';
        sub.auditTrail.push({ at: Date.now(), action: 'file-uploaded', note: `${kind} — ${name} (${(file.size / 1048576).toFixed(2)} MB, ${mime})`, actor: me.username });
        const pl = match.players.find((x) => x.userId === me.id);
        if (pl) pl.submitted = !!(sub.files.render && sub.files.proof);
        save();
        return { ok: true, kind, file: { ...sub.files[kind], url: dataUrl }, submission: serializeOwnSubmission(match, sub) };
      }
      if (action === 'file' && method === 'DELETE') {
        if (!isParticipant(match, me)) throw apiError('You are not in this match', 403);
        if (!canUpload(match, me)) throw apiError('The submission deadline has passed — files are locked.', 403);
        const sub = getMySubmission(match, me);
        if (!sub) throw apiError('No submission yet', 404);
        const kind = q.kind;
        if (!sub.files[kind]) throw apiError('No file to remove', 404);
        media.delete(sub.id + ':' + kind);
        delete sub.files[kind];
        sub.status = 'draft';
        sub.auditTrail.push({ at: Date.now(), action: 'file-removed', note: `${kind} removed`, actor: me.username });
        save();
        return { ok: true, submission: serializeOwnSubmission(match, sub) };
      }
      if (action === 'submit') {
        if (!isParticipant(match, me)) throw apiError('You are not in this match', 403);
        if (!canUpload(match, me)) throw apiError('The submission deadline has passed.', 403);
        const sub = getMySubmission(match, me) || ensureSubmission(match, me);
        if (sub.disqualified) throw apiError('This submission was disqualified.', 403);
        if (!sub.files.render) throw apiError('Upload your final render first.');
        if (!sub.files.proof) throw apiError('Upload your Blender viewport proof — both files are required.');
        if (body.title !== undefined) sub.title = String(body.title).slice(0, 60);
        sub.status = 'submitted';
        sub.submittedAt = sub.submittedAt || Date.now();
        sub.auditTrail.push({ at: Date.now(), action: 'submitted', note: 'Entry finalized with final render + viewport proof', actor: me.username });
        const pl = match.players.find((x) => x.userId === me.id);
        if (pl) pl.submitted = true;
        save();
        return { ok: true, submission: serializeOwnSubmission(match, sub) };
      }
      if (action === 'vote') {
        if (!isParticipant(match, me)) throw apiError('Only match participants can vote.', 403);
        if (match.phase !== 'voting') throw apiError('Voting is not open right now.', 403);
        if (Date.now() > match.phaseEndsAt) throw apiError('Voting has closed.', 403);
        const score = Number(body.score);
        if (!Number.isInteger(score) || score < 1 || score > 5) throw apiError('Score must be a whole number from 1 to 5.');
        const sub = getSubmission(body.submissionId);
        if (!sub || sub.matchId !== match.id) throw apiError('That entry is not part of this match.', 404);
        if (sub.disqualified) throw apiError('That entry was disqualified and cannot be voted on.');
        if (!sub.files.render || !sub.files.proof) throw apiError('That entry is incomplete.');
        const own = match.mode === 'duo' ? sub.team === me.team : sub.userId === me.id;
        if (own) throw apiError('You cannot vote for your own entry.');
        const existing = db.votes.find((v) => v.voterId === me.id && v.submissionId === sub.id && !v.invalidated);
        if (existing) {
          if (body.change === true) { existing.score = score; existing.updatedAt = Date.now(); save(); return { ok: true, changed: true, score }; }
          throw apiError('You already voted on that entry.', 409);
        }
        db.votes.push({ id: id('vote'), matchId: match.id, submissionId: sub.id, voterId: me.id, voterName: me.username, score, createdAt: Date.now(), invalidated: false });
        save();
        return { ok: true, score };
      }
      if (action === 'report') {
        const sub = getSubmission(body.submissionId);
        if (!sub || sub.matchId !== match.id) throw apiError('Entry not found', 404);
        if (sub.userId === me.id) throw apiError('You cannot report your own entry.');
        if (db.reports.some((r) => r.submissionId === sub.id && r.reporterId === me.id && r.status === 'open')) throw apiError('You already have an open report on this entry.');
        const reason = ['ai-generated', 'not-their-work', 'missing-proof', 'proof-mismatch', 'offensive', 'other'].includes(body.reason) ? body.reason : 'other';
        const report = { id: id('rep'), submissionId: sub.id, matchId: match.id, reporterId: me.id, reporterName: me.username, reason, details: String(body.details || '').slice(0, 600), status: 'open', createdAt: Date.now() };
        db.reports.push(report);
        sub.reviewStatus = 'reported';
        audit({ action: 'report-filed', actor: me.username, matchId: match.id, submissionId: sub.id, note: reason });
        save();
        return { ok: true, report: { id: report.id, status: report.status } };
      }
      if (action === 'end') {
        if (!isParticipant(match, me)) throw apiError('You are not in this match', 403);
        if (!match.practice) throw apiError('Only practice rooms can be ended manually.');
        if (match.phase === 'results') return { match: serializeMatch(match, me) };
        finishMatch(match, { abandoned: false });
        return { match: serializeMatch(match, me) };
      }
      throw apiError('Endpoint not found', 404);
    }

    /* --- media (kept for compatibility; payloads usually embed data URLs already) */
    if (method === 'GET' && p.startsWith('/media/')) {
      const [, , sid, kind] = p.split('/');
      const sub = getSubmission(sid);
      if (!sub) throw apiError('File not found', 404);
      const rec = sub.files[kind];
      if (!rec) throw apiError('File not found', 404);
      if (kind === 'proof' && !user && sub.userId !== (user && user.id)) throw apiError('Sign in to inspect viewport proof.', 403);
      return { media: mediaUrl(sub, kind), mime: rec.mime };
    }

    /* --- moderation */
    if (method === 'GET' && p === '/mod/queue') {
      if (!user || !user.isMod) throw apiError('Moderator access required.', 403);
      const reports = db.reports.map((r) => {
        const sub = getSubmission(r.submissionId);
        const m = sub ? getMatch(sub.matchId) : null;
        const owner = sub ? getUser(sub.userId) : null;
        return {
          ...r,
          submission: sub ? {
            id: sub.id, username: sub.username, title: sub.title, status: sub.status,
            reviewStatus: sub.reviewStatus, disqualified: !!sub.disqualified,
            renderUrl: mediaUrl(sub, 'render'), proofUrl: sub.files.proof ? mediaUrl(sub, 'proof') : null,
            submittedAt: sub.submittedAt, votes: db.votes.filter((v) => v.submissionId === sub.id && !v.invalidated).length,
            theme: m ? m.theme : '', matchId: m ? m.id : null, rank: owner ? rankFor(owner.xp).name : '',
            auditTrail: (sub.auditTrail || []).slice(-8),
          } : null,
        };
      }).sort((a, b) => b.createdAt - a.createdAt);
      const flagged = db.submissions
        .filter((s) => s.reviewStatus === 'reported' || s.reviewStatus === 'evidence-requested' || s.disqualified)
        .map((s) => ({
          id: s.id, username: s.username, reviewStatus: s.reviewStatus,
          theme: (getMatch(s.matchId) || {}).theme,
          renderUrl: mediaUrl(s, 'render'), proofUrl: s.files.proof ? mediaUrl(s, 'proof') : null,
          voteCount: db.votes.filter((v) => v.submissionId === s.id && !v.invalidated).length,
          reviewNote: s.reviewNote || null, disqualified: !!s.disqualified,
        }));
      return {
        reports, flagged,
        votes: db.votes.filter((v) => !v.invalidated).slice(-60).reverse().map((v) => {
          const sub = getSubmission(v.submissionId);
          return { ...v, entryName: sub ? sub.username : '—', entryId: v.submissionId };
        }),
        audit: db.audit.slice(0, 60),
        stats: {
          openReports: db.reports.filter((r) => r.status === 'open').length,
          disqualified: db.submissions.filter((s) => s.disqualified).length,
          invalidVotes: db.votes.filter((v) => v.invalidated).length,
        },
      };
    }
    if (method === 'POST' && p.startsWith('/mod/')) {
      if (!user || !user.isMod) throw apiError('Moderator access required.', 403);
      const parts = p.split('/');
      if (parts[2] === 'submissions') {
        const sub = getSubmission(parts[3]);
        if (!sub) throw apiError('Submission not found', 404);
        const act = parts[4];
        if (act === 'disqualify') {
          const reason = String(body.reason || '').slice(0, 300);
          if (!reason) throw apiError('A disqualification reason is required.');
          sub.disqualified = true; sub.reviewStatus = 'disqualified'; sub.reviewNote = reason;
          sub.auditTrail.push({ at: Date.now(), action: 'disqualified', note: reason, actor: user.username });
          db.reports.filter((r) => r.submissionId === sub.id && r.status === 'open').forEach((r) => { r.status = 'actioned'; r.resolvedAt = Date.now(); r.resolvedBy = user.username; });
          audit({ action: 'disqualify', actor: user.username, submissionId: sub.id, note: reason });
        } else if (act === 'restore') {
          sub.disqualified = false; sub.reviewStatus = 'clear'; sub.reviewNote = null;
          sub.auditTrail.push({ at: Date.now(), action: 'restored', note: 'Disqualification lifted', actor: user.username });
          db.reports.filter((r) => r.submissionId === sub.id && r.status === 'open').forEach((r) => { r.status = 'dismissed'; r.resolvedAt = Date.now(); r.resolvedBy = user.username; });
        } else if (act === 'request-evidence') {
          const note = String(body.note || 'Please upload a short screen recording of the file open in Blender.').slice(0, 400);
          sub.reviewStatus = 'evidence-requested'; sub.reviewNote = note;
          sub.auditTrail.push({ at: Date.now(), action: 'evidence-requested', note, actor: user.username });
        } else if (act === 'dismiss') {
          sub.reviewStatus = 'clear'; sub.reviewNote = null;
          db.reports.filter((r) => r.submissionId === sub.id && r.status === 'open').forEach((r) => { r.status = 'dismissed'; r.resolvedAt = Date.now(); r.resolvedBy = user.username; });
        } else throw apiError('Endpoint not found', 404);
        save();
        return { ok: true };
      }
      if (parts[2] === 'votes' && parts[4] === 'invalidate') {
        const vote = db.votes.find((v) => v.id === parts[3]);
        if (!vote) throw apiError('Vote not found', 404);
        vote.invalidated = true;
        vote.invalidatedBy = user.username;
        vote.invalidatedAt = Date.now();
        vote.invalidateReason = String(body.reason || 'Invalid vote').slice(0, 200);
        save();
        return { ok: true };
      }
      throw apiError('Endpoint not found', 404);
    }

    throw apiError('Endpoint not found', 404);
  }

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(apiError('Could not read that file.', 400));
      reader.readAsDataURL(file);
    });
  }

  /* -------------------------------------------------------------- transport */
  async function respond(method, url, opts) {
    try {
      const data = await handle(method, url, opts);
      if (data && data.media) {
        const url = data.media;
        if (url.startsWith('data:')) {
          const comma = url.indexOf(',');
          const meta = url.slice(5, comma);
          const isB64 = /;base64$/i.test(meta);
          const mime = meta.replace(/;base64$/i, '') || data.mime || 'application/octet-stream';
          const bytes = isB64
            ? Uint8Array.from(atob(url.slice(comma + 1)), (c) => c.charCodeAt(0))
            : new TextEncoder().encode(decodeURIComponent(url.slice(comma + 1)));
          return new Response(bytes, { status: 200, headers: { 'content-type': mime } });
        }
        if (realFetch) {
          const res = await realFetch(url);
          const blob = await res.blob();
          return new Response(blob, { status: 200, headers: { 'content-type': data.mime || blob.type || 'application/octet-stream' } });
        }
        return new Response('', { status: 404 });
      }
      return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[static api]', method, url, err);
      return new Response(JSON.stringify({ error: err.message || 'Server error' }), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
    }
  }

  const realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (input, opts = {}) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (/\/api\//.test(url)) return respond((opts.method || 'GET').toUpperCase(), url, { ...opts, body: opts.body });
    if (realFetch) return realFetch(input, opts);
    return Promise.reject(new Error('fetch unavailable'));
  };

  /* XHR is only used for uploads (progress events); everything else goes through fetch. */
  class StaticXHR {
    constructor() {
      this.upload = {};
      this.status = 0;
      this.responseText = '';
      this.readyState = 0;
      this.withCredentials = false;
      this._headers = {};
    }
    open(method, url) { this._method = method; this._url = url; this.readyState = 1; }
    setRequestHeader(k, v) { this._headers[String(k).toLowerCase()] = v; }
    abort() { if (this.onabort) this.onabort(); }
    send(body) {
      const run = async () => {
        this.readyState = 2;
        const isFile = body && typeof body === 'object' && typeof body.size === 'number' && typeof body.name === 'string';
        let payload = {};
        if (isFile) {
          if (this.upload && this.upload.onprogress) {
            this.upload.onprogress({ lengthComputable: true, loaded: 1, total: 4 });
            this.upload.onprogress({ lengthComputable: true, loaded: 3, total: 4 });
          }
          payload = { file: body, dataUrl: await readAsDataUrl(body) };
        }
        const res = await respond(this._method || 'POST', this._url, payload);
        this.status = res.status;
        this.responseText = await res.text();
        this.readyState = 4;
        if (this.upload && this.upload.onprogress) this.upload.onprogress({ lengthComputable: true, loaded: 4, total: 4 });
        if (this.onload) this.onload();
      };
      run().catch((err) => { this.status = 0; if (this.onerror) this.onerror(err); });
    }
  }
  window.XMLHttpRequest = StaticXHR;
  window.EventSource = FakeEventSource;

  /* Re-seeding helper for the curious: localStorage.clear() or the console helpers below. */
  window.BB = window.BB || {};
  window.BB.static = {
    reset() { resetDb(); location.hash = '#/'; location.reload(); },
    /** Jump the match you are in to the end of its current phase (handy in the demo). */
    skipPhase() {
      const me = currentUser();
      if (!me) return false;
      const match = db.matches.find((m) => m.phase !== 'results' && m.players.some((p) => p.userId === me.id));
      if (!match) return false;
      match.phaseEndsAt = Date.now();
      save();
      broadcast();
      return true;
    },
    speed: SPEED,
  };

  console.info('%cBlend Battles — static demo', 'font-weight:bold;color:#a78bfa', '\nEverything runs in this browser. Reset with BB.static.reset() in the console.');
})();
