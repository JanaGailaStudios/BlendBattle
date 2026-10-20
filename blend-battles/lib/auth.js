'use strict';
const { db, save } = require('./db');
const { token, parseCookies, rankProgress, levelProgress } = require('./util');

const SESSION_COOKIE = 'bb_session';
const SESSION_TTL = 1000 * 60 * 60 * 24 * 30;

function createSession(userId) {
  const t = token();
  db.sessions[t] = { userId, createdAt: Date.now(), lastSeen: Date.now() };
  save();
  return t;
}
function destroySession(t) {
  if (t && db.sessions[t]) {
    delete db.sessions[t];
    save();
  }
}
function sessionFrom(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return cookies[SESSION_COOKIE] || null;
}
function userFromRequest(req) {
  const t = sessionFrom(req);
  if (!t) return null;
  const s = db.sessions[t];
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL) {
    destroySession(t);
    return null;
  }
  const user = db.users.find((u) => u.id === s.userId);
  if (!user) return null;
  s.lastSeen = Date.now();
  user.lastSeen = Date.now();
  return user;
}

/** Everything the client is allowed to know about a user. */
function publicUser(u, viewer) {
  if (!u) return null;
  const rp = rankProgress(u.xp);
  const lp = levelProgress(u.xp);
  const isSelf = viewer && viewer.id === u.id;
  const isFriend = viewer && (viewer.friends || []).includes(u.id);
  return {
    id: u.id,
    username: u.username,
    avatarHue: u.avatarHue,
    isGuest: !!u.isGuest,
    isDemo: !!u.isDemo,
    isMod: !!u.isMod,
    xp: u.xp,
    level: lp.level,
    levelPct: lp.pct,
    xpToNextLevel: lp.toNext,
    rank: rp.current.name,
    rankColor: rp.current.color,
    rankPct: Math.round(rp.pct),
    nextRank: rp.next ? rp.next.name : null,
    xpToNextRank: rp.toNext,
    region: u.region || 'EU',
    location: u.location || '',
    bio: u.bio || '',
    badges: u.badges || [],
    stats: u.stats,
    friends: (u.friends || []).length,
    isFriend: !!isFriend,
    privacy: isSelf || isFriend ? u.privacy : { showHistory: !!(u.privacy || {}).showHistory },
    settings: isSelf ? u.settings : undefined,
    isSelf: !!isSelf,
    createdAt: u.createdAt,
    lastSeen: u.lastSeen,
  };
}

/** Minimal identity used inside lobbies / matches. */
function lobbyUser(u) {
  return {
    id: u.id,
    username: u.username,
    avatarHue: u.avatarHue,
    rank: rankProgress(u.xp).current.name,
    rankColor: rankProgress(u.xp).current.color,
    level: levelProgress(u.xp).level,
    isBot: !!u.isBot,
    isGuest: !!u.isGuest,
    isDemo: !!u.isDemo,
  };
}

/* --------------------------------------------------------------- rate limits */
const buckets = new Map();
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    buckets.set(key, arr);
    return { ok: false, retryAfter: Math.ceil((windowMs - (now - arr[0])) / 1000) };
  }
  arr.push(now);
  buckets.set(key, arr);
  return { ok: true };
}

module.exports = {
  SESSION_COOKIE, createSession, destroySession, sessionFrom, userFromRequest,
  publicUser, lobbyUser, rateLimit,
};
