'use strict';
const crypto = require('crypto');

const RANKS = [
  { name: 'Beginner', min: 0, color: '#8b93a7', icon: '◐' },
  { name: 'Apprentice', min: 600, color: '#6f8cff', icon: '◑' },
  { name: 'Modeler', min: 1600, color: '#4fd1c5', icon: '◒' },
  { name: 'Artist', min: 3200, color: '#b06bff', icon: '◓' },
  { name: 'Expert', min: 5200, color: '#ff8a3d', icon: '★' },
  { name: 'Master', min: 8000, color: '#ff4d6d', icon: '✦' },
  { name: 'Blender Legend', min: 12000, color: '#ffd166', icon: '♛' },
];

function id(prefix = '') {
  return (prefix ? prefix + '_' : '') + crypto.randomBytes(9).toString('hex');
}
function token() {
  return crypto.randomBytes(32).toString('hex');
}
function roomCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += abc[crypto.randomInt(abc.length)];
  return s;
}
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, expected) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function rankFor(xp) {
  let rank = RANKS[0];
  for (const r of RANKS) if (xp >= r.min) rank = r;
  return rank;
}
function rankProgress(xp) {
  const cur = rankFor(xp);
  const idx = RANKS.indexOf(cur);
  const next = RANKS[idx + 1] || null;
  if (!next) return { current: cur, next: null, pct: 100, toNext: 0 };
  const span = next.min - cur.min;
  const pct = Math.max(0, Math.min(100, ((xp - cur.min) / span) * 100));
  return { current: cur, next, pct, toNext: next.min - xp };
}
function levelFor(xp) {
  return Math.floor(xp / 250) + 1;
}
function levelProgress(xp) {
  const lvl = levelFor(xp);
  const base = (lvl - 1) * 250;
  return { level: lvl, pct: Math.round(((xp - base) / 250) * 100), toNext: 250 - (xp - base) };
}
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const now = () => Date.now();
function parseCookies(header = '') {
  const out = {};
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function avatarColor(seed = '') {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

/** Deterministic tiny PRNG so simulated art is stable per seed. */
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
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

module.exports = {
  RANKS, id, token, roomCode, hashPassword, verifyPassword, rankFor, rankProgress,
  levelFor, levelProgress, clamp, now, parseCookies, safeEqual, avatarColor, prng, esc,
};
