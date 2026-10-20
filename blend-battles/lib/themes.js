'use strict';
const { prng } = require('./util');

/**
 * Theme pool. `art` points at a generated demo render used by simulated (bot)
 * contestants so the demo has something to look at. Real players upload their own.
 */
const THEMES = [
  { name: 'Cyberpunk Car', difficulty: 'medium', slug: 'cyberpunk-car', tags: ['vehicle', 'neon'], art: '/img/featured/cyberpunk-car-a.jpg', blurb: 'Neon underglow, wet asphalt, chrome everything.' },
  { name: 'Fantasy Sword', difficulty: 'easy', slug: 'fantasy-sword', tags: ['prop', 'weapon'], art: '/img/featured/fantasy-sword-a.jpg', blurb: 'Give it a story — runes, gems, a worn hilt.' },
  { name: 'Cute Robot', difficulty: 'easy', slug: 'cute-robot', tags: ['character', 'hard-surface'], art: '/img/featured/cute-robot-a.jpg', blurb: 'Charming proportions beat technical density.' },
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
  build: {
    key: 'build', name: 'Build Battle', icon: 'cube',
    tagline: 'Same theme. Same clock. Best model wins.',
    description: 'Everyone gets one random theme and a fixed build window. Submit a final render plus Blender viewport proof, then vote on everyone else.',
    buildSeconds: 300, votingSeconds: 45, minPlayers: 2, maxPlayers: 12, requiresVideo: false,
  },
  duo: {
    key: 'duo', name: 'Duo Battles', icon: 'duo',
    tagline: 'Two artists. One entry.',
    description: 'Paired with another artist on a shared theme. Either teammate can upload — the newest successful uploads form the team entry.',
    buildSeconds: 420, votingSeconds: 45, minPlayers: 2, maxPlayers: 12, requiresVideo: false, team: true,
  },
  speed: {
    key: 'speed', name: 'Speed Modeling', icon: 'bolt',
    tagline: 'Two minutes. No excuses.',
    description: 'Strict timer, simple themes. Chunky shapes and clean silhouettes score best when there is no time for detail.',
    buildSeconds: 120, votingSeconds: 30, minPlayers: 2, maxPlayers: 12, requiresVideo: false,
  },
  animation: {
    key: 'animation', name: 'Animation Battles', icon: 'clapper',
    tagline: 'Make it move.',
    description: 'Create a short Blender animation on the theme. The final render must be a video (MP4 or WebM) — stills are rejected by the server.',
    buildSeconds: 480, votingSeconds: 60, minPlayers: 2, maxPlayers: 12, requiresVideo: true,
  },
  free: {
    key: 'free', name: 'Free Build', icon: 'brush',
    tagline: 'Practice room. No clock, no votes.',
    description: 'A private practice space. Upload whatever you like, keep everything in your personal gallery, and skip competitive voting entirely.',
    buildSeconds: 0, votingSeconds: 0, minPlayers: 1, maxPlayers: 8, requiresVideo: false, practice: true,
  },
};

function pickTheme(difficulty = 'any', seedKey = '') {
  const rand = seedKey ? prng(seedKey) : Math.random;
  const pool = difficulty === 'any' ? THEMES : THEMES.filter((t) => t.difficulty === difficulty);
  const list = pool.length ? pool : THEMES;
  return list[Math.floor(rand() * list.length)];
}
function themeByName(name) {
  return THEMES.find((t) => t.name === name) || THEMES[0];
}
function themeArt(themeName) {
  const t = themeByName(themeName);
  return t.art;
}

module.exports = { THEMES, MODES, pickTheme, themeByName, themeArt };
