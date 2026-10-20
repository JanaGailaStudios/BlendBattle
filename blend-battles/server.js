'use strict';
/**
 * BLEND BATTLES — demo backend
 * Zero-dependency Node HTTP server. See README.md for the demo-mode disclosure:
 * everything here is a real, working server (auth, uploads, matches, votes,
 * moderation, persistence), but the database is a local JSON file and the
 * "other players" in quick play are clearly-labelled simulated bots.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { db, save, saveNow, audit, activity, UPLOAD_DIR } = require('./lib/db');
const auth = require('./lib/auth');
const util = require('./lib/util');
const { MODES, THEMES, pickTheme } = require('./lib/themes');
const { makeProofSVG, makeRenderSVG } = require('./lib/render');

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEMO_MODE = !process.env.SUPABASE_URL && !process.env.FIREBASE_PROJECT_ID;
const MAX_UPLOAD = { render: 48 * 1024 * 1024, proof: 64 * 1024 * 1024, model: 48 * 1024 * 1024 };
const BOT_DELAY_MAX = 0.86;
/** BB_SPEED lets the demo timers be compressed for automated testing (1 = real time). */
const SPEED = Math.max(0.02, Number(process.env.BB_SPEED || 1));
const scaled = (sec) => Math.max(3, Math.round(sec * SPEED));

/* ------------------------------------------------------------------ helpers */
class ApiError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra || {};
  }
}
const bad = (msg, status = 400) => new ApiError(status, msg);
const getUser = (id) => db.users.find((u) => u.id === id);
const getMatch = (id) => db.matches.find((m) => m.id === id);
const getLobby = (code) => db.lobbies.find((l) => l.code === String(code || '').toUpperCase());
const getSubmission = (id) => db.submissions.find((s) => s.id === id);
const matchSubs = (matchId) => db.submissions.filter((s) => s.matchId === matchId);
const isParticipant = (match, user) => !!user && !!match && match.players.some((p) => p.userId === user.id);
const rankOf = (xp) => util.rankProgress(xp).current;
const shuffle = (arr, seedStr) => {
  const rand = util.prng(String(seedStr));
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const humanPlayers = (match) => match.players.filter((p) => !p.isBot);

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new ApiError(413, 'Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new ApiError(400, 'Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function streamToFile(req, dest, limit) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest);
    let size = 0;
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      out.destroy();
      fs.unlink(dest, () => reject(err));
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) fail(new ApiError(413, `File exceeds the ${(limit / 1048576).toFixed(0)} MB limit`));
    });
    req.on('error', fail);
    out.on('error', fail);
    out.on('finish', () => {
      if (settled) return;
      settled = true;
      resolve(size);
    });
    req.pipe(out);
  });
}

function sniffMime(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, 4096, 0);
    const b = buf.subarray(0, n);
    if (n >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
    if (n >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (n >= 12 && b.subarray(4, 8).toString('latin1') === 'ftyp') return 'video/mp4';
    if (n >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
    if (n >= 4 && b.subarray(0, 4).toString('latin1') === 'glTF') return 'model/gltf-binary';
    const head = b.toString('utf8', 0, Math.min(300, n)).trim();
    if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
    if (head.startsWith('{') || head.startsWith('[')) return 'application/json';
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

const EXT_BY_MIME = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'video/mp4': '.mp4',
  'video/webm': '.webm', 'model/gltf-binary': '.glb', 'image/svg+xml': '.svg',
  'application/json': '.gltf',
};
const ALLOWED = {
  render: { 'image/png': 1, 'image/jpeg': 1, 'video/mp4': 1, 'video/webm': 1 },
  proof: { 'image/png': 1, 'image/jpeg': 1, 'video/mp4': 1, 'video/webm': 1 },
  model: { 'model/gltf-binary': 1, 'application/json': 1 },
};

/* -------------------------------------------------------------------- SSE */
const streams = new Map(); // userId -> Set(res)
function sseSend(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch { /* stream closed */ }
}
function pushTo(userId, event, data) {
  const set = streams.get(userId);
  if (set) set.forEach((res) => sseSend(res, event, data));
}
function pushLobby(lobby) {
  lobby.players.forEach((p) => pushTo(p.userId, 'lobby', { code: lobby.code }));
  if (lobby.matchId) matchOf(lobby);
}
function matchOf(lobby) {
  const m = getMatch(lobby.matchId);
  if (m) m.players.forEach((p) => pushTo(p.userId, 'match', { id: m.id }));
  return m;
}
function pushMatch(match) {
  if (!match) return;
  match.players.forEach((p) => pushTo(p.userId, 'match', { id: match.id }));
}

/* ---------------------------------------------------------------- profiles */
function userBadges(u) {
  return (u.badges || []).slice(0, 8);
}

function matchSummaryFor(match, userId) {
  const mySub = db.submissions.find((s) => s.matchId === match.id && s.userId === userId);
  const res = match.results;
  const place = res ? (res.entries.find((e) => e.userId === userId) || {}).place || null : null;
  return {
    id: match.id, mode: match.mode, modeName: match.modeName, theme: match.theme,
    startedAt: match.startedAt, endedAt: match.endedAt, phase: match.phase,
    players: match.players.length, place,
    score: res && res.entries.find((e) => e.userId === userId) ? res.entries.find((e) => e.userId === userId).avgScore : null,
    renderUrl: mySub && mySub.files.render ? publicRenderUrl(mySub) : null,
    submissionId: mySub ? mySub.id : null,
    practice: !!match.practice,
  };
}

/* ----------------------------------------------------------- serialisation */
function publicRenderUrl(sub) {
  if (!sub || !sub.files || !sub.files.render) return null;
  return sub.files.render.url || `/api/media/${sub.id}/render`;
}
function teamLabel(match, sub) {
  if (match.mode !== 'duo') return null;
  const members = match.players.filter((p) => p.team === sub.team).map((p) => p.name);
  return members.join(' & ');
}

function serializeOwnSubmission(match, sub, viewer) {
  if (!sub) {
    return {
      exists: false,
      files: { render: null, proof: null, model: null },
      status: 'none',
      ready: false,
    };
  }
  const deadline = uploadDeadline(match);
  return {
    id: sub.id,
    status: sub.status,
    reviewStatus: sub.reviewStatus || 'clear',
    title: sub.title || '',
    team: sub.team,
    teamLabel: teamLabel(match, sub),
    submittedAt: sub.submittedAt || null,
    createdAt: sub.createdAt,
    canEdit: canUpload(match, viewer),
    deadline,
    files: {
      render: sub.files.render ? { ...sub.files.render, url: publicRenderUrl(sub), path: undefined } : null,
      proof: sub.files.proof ? { ...sub.files.proof, url: `/api/media/${sub.id}/proof`, path: undefined } : null,
      model: sub.files.model ? { ...sub.files.model, url: `/api/media/${sub.id}/model`, path: undefined } : null,
    },
    ready: !!(sub.files.render && sub.files.proof),
    auditTrail: (sub.auditTrail || []).slice(-12),
    reviewNote: sub.reviewNote || null,
    disqualified: !!sub.disqualified,
  };
}

function serializeEntry(sub, match, viewer, opts = {}) {
  const owner = getUser(sub.userId);
  const myVote = db.votes.find((v) => v.submissionId === sub.id && v.voterId === viewer?.id && !v.invalidated);
  const ownTeam = match.mode === 'duo'
    ? sub.team === (match.players.find((p) => p.userId === viewer?.id) || {}).team
    : sub.userId === viewer?.id;
  return {
    submissionId: sub.id,
    username: owner ? owner.username : sub.username,
    displayName: teamLabel(match, sub) || (owner ? owner.username : sub.username),
    avatarHue: owner ? owner.avatarHue : 260,
    rank: owner ? rankOf(owner.xp).name : 'Beginner',
    rankColor: owner ? rankOf(owner.xp).color : '#888',
    title: sub.title || '',
    renderUrl: publicRenderUrl(sub),
    renderKind: sub.files.render ? (sub.files.render.mime || '').startsWith('video') ? 'video' : 'image' : null,
    hasProof: !!(sub.files.proof),
    hasModel: !!(sub.files.model),
    proofUrl: sub.files.proof ? `/api/media/${sub.id}/proof` : null,
    isSelf: !!ownTeam,
    canVote: !!opts.voting && !ownTeam && !sub.disqualified,
    myVote: myVote ? myVote.score : 0,
    disqualified: !!sub.disqualified,
    reviewStatus: sub.reviewStatus || 'clear',
    submittedAt: sub.submittedAt,
  };
}

function uploadDeadline(match) {
  if (match.practice) return null;
  if (match.phase === 'building' || match.phase === 'submission') return match.phaseEndsAt;
  return match.submissionClosedAt || match.phaseEndsAt;
}
function canUpload(match, user) {
  if (!user || !isParticipant(match, user)) return false;
  if (match.practice) return match.phase === 'building';
  return (match.phase === 'building' || match.phase === 'submission') && match.phaseEndsAt > Date.now();
}

function serializeMatch(match, viewer, opts = {}) {
  const subs = matchSubs(match.id);
  const mySub = getMySubmission(match, viewer);
  const canSeeEntries = match.phase === 'voting' || match.phase === 'results';
  const voters = match.players;
  const votedCount = voters.filter((p) => subs.some((s) => s.id !== mySub?.id && db.votes.some((v) => v.voterId === p.userId && v.submissionId === s.id && !v.invalidated))).length;
  const out = {
    id: match.id,
    mode: match.mode,
    modeName: match.modeName,
    modeTagline: (MODES[match.mode] || {}).tagline || '',
    theme: match.theme,
    themeBlurb: match.themeBlurb || '',
    difficulty: match.difficulty,
    practice: !!match.practice,
    requiresVideo: !!MODES[match.mode]?.requiresVideo,
    phase: match.phase,
    phaseEndsAt: match.phaseEndsAt || null,
    serverNow: Date.now(),
    startedAt: match.startedAt,
    endedAt: match.endedAt || null,
    submissionClosedAt: match.submissionClosedAt || null,
    settings: match.settings,
    isMod: !!(viewer && viewer.isMod),
    viewerIsParticipant: isParticipant(match, viewer),
    players: match.players.map((p) => {
      const u = getUser(p.userId);
      const s = subs.find((x) => (match.mode === 'duo' ? x.team === p.team : x.userId === p.userId));
      return {
        userId: p.userId,
        name: p.name,
        avatarHue: u ? u.avatarHue : 250,
        rank: u ? rankOf(u.xp).name : 'Beginner',
        rankColor: u ? rankOf(u.xp).color : '#888',
        level: u ? util.levelProgress(u.xp).level : 1,
        isBot: !!p.isBot,
        isGuest: !!(u && u.isGuest),
        connected: p.isBot ? true : !!p.connected,
        submitted: !!(s && s.files.render && s.files.proof),
        disqualified: !!(s && s.disqualified),
        team: p.team ?? null,
      };
    }),
    counts: {
      submissions: subs.filter((s) => s.files.render && s.files.proof && !s.disqualified).length,
      players: match.players.length,
      humanPlayers: humanPlayers(match).length,
      votesCast: db.votes.filter((v) => v.matchId === match.id && !v.invalidated).length,
      votersDone: votedCount,
    },
    yourSubmission: serializeOwnSubmission(match, mySub, viewer),
    uploadDeadline: uploadDeadline(match),
    canUpload: canUpload(match, viewer),
    auditRecent: (match.auditTrail || []).slice(-8),
  };
  if (canSeeEntries || opts.forceEntries) {
    const visible = subs.filter((s) => s.files.render && s.files.proof);
    const ordered = match.phase === 'voting' ? shuffle(visible, match.id + 'order') : [...visible].sort((a, b) => (b.avgScore || 0) - (a.avgScore || 0));
    out.entries = ordered.map((s) => serializeEntry(s, match, viewer, { voting: match.phase === 'voting' }));
    out.myVoting = {
      eligible: match.phase === 'voting' && isParticipant(match, viewer),
      votesCast: db.votes.filter((v) => v.matchId === match.id && v.voterId === viewer?.id && !v.invalidated).length,
      votesPossible: Math.max(0, visible.filter((s) => !(match.mode === 'duo' ? s.team === (match.players.find((p) => p.userId === viewer?.id) || {}).team : s.userId === viewer?.id)).length),
    };
  }
  if (match.phase === 'results' && match.results) {
    out.results = {
      ...match.results,
      entries: match.results.entries.map((e) => {
        const sub = getSubmission(e.submissionId);
        return {
          ...e,
          proofUrl: sub && sub.files.proof ? `/api/media/${e.submissionId}/proof` : null,
          reviewStatus: sub ? sub.reviewStatus : 'clear',
          disqualified: sub ? !!sub.disqualified : false,
        };
      }),
      yourXp: (match.results.awards || []).find((a) => a.userId === viewer?.id) || null,
    };
  }
  return out;
}

function getMySubmission(match, viewer) {
  if (!viewer) return null;
  const subs = matchSubs(match.id);
  const me = match.players.find((p) => p.userId === viewer.id);
  if (!me) return null;
  if (match.mode === 'duo') return subs.find((s) => s.team === me.team) || null;
  return subs.find((s) => s.userId === viewer.id) || null;
}

function serializeLobby(lobby, viewer) {
  const mode = MODES[lobby.mode] || MODES.build;
  return {
    code: lobby.code,
    name: lobby.name,
    mode: lobby.mode,
    modeName: mode.name,
    tagline: mode.tagline,
    isPrivate: !!lobby.isPrivate,
    maxPlayers: lobby.maxPlayers,
    difficulty: lobby.difficulty,
    customTheme: lobby.customTheme || null,
    status: lobby.status,
    startsAt: lobby.startsAt || null,
    serverNow: Date.now(),
    hostId: lobby.hostId,
    isHost: !!viewer && viewer.id === lobby.hostId,
    isMember: !!viewer && lobby.players.some((p) => p.userId === viewer.id),
    yourReady: !!(viewer && (lobby.players.find((p) => p.userId === viewer.id) || {}).ready),
    matchId: lobby.matchId || null,
    buildSeconds: lobby.buildSeconds,
    createdAt: lobby.createdAt,
    players: lobby.players.map((p) => {
      const u = getUser(p.userId);
      return {
        userId: p.userId,
        name: p.name,
        avatarHue: u ? u.avatarHue : 250,
        rank: u ? rankOf(u.xp).name : 'Beginner',
        rankColor: u ? rankOf(u.xp).color : '#888',
        level: u ? util.levelProgress(u.xp).level : 1,
        ready: !!p.ready,
        isBot: !!p.isBot,
        isGuest: !!(u && u.isGuest),
        isHost: p.userId === lobby.hostId,
        connected: p.isBot ? true : !!p.connected,
      };
    }),
  };
}

function serializeUserSummary(u) {
  const rp = util.rankProgress(u.xp);
  return {
    id: u.id, username: u.username, avatarHue: u.avatarHue, xp: u.xp,
    rank: rp.current.name, rankColor: rp.current.color, rankPct: Math.round(rp.pct),
    level: util.levelProgress(u.xp).level, badges: userBadges(u),
    isMod: !!u.isMod, isGuest: !!u.isGuest, isDemo: !!u.isDemo,
    stats: u.stats, region: u.region, lastSeen: u.lastSeen,
  };
}

/* ------------------------------------------------------------- game logic */
function addBot(lobby, index) {
  const names = ['botKilo', 'botMira', 'botRust', 'botJuno', 'botHex', 'botPika', 'botVex', 'botOnyx', 'botSable', 'botNim'];
  const used = new Set(lobby.players.map((p) => p.name));
  let name = names[index % names.length];
  let k = 1;
  while (used.has(name)) name = names[index % names.length] + k++;
  const bot = {
    id: util.id('bot'),
    username: name,
    email: null,
    isBot: true,
    isGuest: false,
    isDemo: true,
    xp: 400 + Math.floor(Math.random() * 3000),
    avatarHue: Math.floor(Math.random() * 360),
    region: 'EU',
    location: 'Practice Bot',
    bio: 'Simulated practice opponent (demo mode).',
    badges: [],
    stats: { wins: 0, matches: 0, podiums: 0, votes: 0, avgScore: 0 },
    friends: [], blocked: [],
    privacy: { showHistory: false }, settings: {},
    createdAt: Date.now(), lastSeen: Date.now(),
    pass: '', salt: '',
  };
  db.users.push(bot);
  return bot;
}

function startMatchFromLobby(lobby) {
  const mode = MODES[lobby.mode] || MODES.build;
  const theme = lobby.customTheme || pickTheme(lobby.difficulty, lobby.code).name;
  const themeMeta = THEMES.find((t) => t.name === theme) || THEMES[0];
  const buildSeconds = lobby.buildSeconds || mode.buildSeconds;
  const players = lobby.players.map((p) => {
    const u = getUser(p.userId);
    return {
      userId: p.userId, name: (u && u.username) || p.name, isBot: !!p.isBot,
      submitted: false, connected: true, joinedAt: p.joinedAt || Date.now(), team: null,
    };
  });
  if (lobby.mode === 'duo') {
    // pair players into teams of 2
    const order = [...players].sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
    order.forEach((p, i) => { p.team = Math.floor(i / 2); });
  }
  const match = {
    id: util.id('mat'),
    code: lobby.code,
    mode: lobby.mode,
    modeName: mode.name,
    theme,
    themeBlurb: themeMeta.blurb,
    difficulty: lobby.difficulty,
    practice: !!mode.practice,
    phase: 'building',
    createdAt: Date.now(),
    startedAt: Date.now(),
    phaseEndsAt: mode.practice ? null : Date.now() + scaled(buildSeconds) * 1000,
    submissionClosedAt: null,
    endedAt: null,
    players,
    settings: {
      buildSeconds,
      votingSeconds: mode.votingSeconds,
      maxPlayers: lobby.maxPlayers,
      difficulty: lobby.difficulty,
    },
    botPlan: [],
    results: null,
    abandoned: false,
    auditTrail: [{ at: Date.now(), action: 'match-created', note: `Theme "${theme}" · ${mode.name}` }],
  };
  matchSubsCreate(match);
  if (!mode.practice) {
    // schedule bot uploads + votes
    players.filter((p) => p.isBot).forEach((p) => {
      match.botPlan.push({
        userId: p.userId,
        submitAt: Date.now() + scaled(buildSeconds) * 1000 * (0.45 + Math.random() * (BOT_DELAY_MAX - 0.45)),
        voteAt: null,
        scoreRange: [3, 5],
      });
    });
  }
  db.matches.push(match);
  lobby.status = 'in_match';
  lobby.matchId = match.id;
  lobby.startsAt = null;
  activity({ type: 'match', text: `${mode.name} started — theme “${theme}”${lobby.players.some((p) => p.isBot) ? ' (with practice bots)' : ''}.`, matchId: match.id });
  save();
  pushLobby(lobby);
  pushMatch(match);
  return match;
}

function matchSubsCreate(match) {
  // create draft submission rows so uploads have a home
  if (match.mode === 'duo') return;
}

function ensureSubmission(match, user) {
  const me = match.players.find((p) => p.userId === user.id);
  if (!me) throw bad('You are not in this match', 403);
  let sub = getMySubmission(match, user);
  if (sub) return sub;
  sub = {
    id: util.id('sub'),
    matchId: match.id,
    userId: user.id,
    username: user.username,
    team: match.mode === 'duo' ? me.team : null,
    title: '',
    status: 'draft',
    reviewStatus: 'clear',
    createdAt: Date.now(),
    submittedAt: null,
    files: {},
    auditTrail: [{ at: Date.now(), action: 'draft-opened', note: 'Submission workspace opened' }],
  };
  db.submissions.push(sub);
  save();
  return sub;
}

function botSubmit(match, plan) {
  const bot = getUser(plan.userId);
  if (!bot) return;
  const me = match.players.find((p) => p.userId === plan.userId);
  if (!me) return;
  const theme = THEMES.find((t) => t.name === match.theme) || THEMES[0];
  const subId = util.id('sub');
  const art = theme.art;
  let renderFile;
  if (art && fs.existsSync(path.join(PUBLIC_DIR, art))) {
    renderFile = { name: `${theme.slug}-${subId.slice(-4)}.jpg`, mime: 'image/jpeg', size: 0, url: art, uploadedAt: Date.now(), simulated: true };
  } else {
    const name = `bot-render-${subId}.svg`;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), makeRenderSVG(match.theme, subId));
    renderFile = { name: `${theme.slug}.svg`, mime: 'image/svg+xml', size: 0, path: name, uploadedAt: Date.now(), simulated: true };
  }
  const proofName = `bot-proof-${subId}.svg`;
  fs.writeFileSync(path.join(UPLOAD_DIR, proofName), makeProofSVG(match.theme, subId, bot.username));
  const existing = match.mode === 'duo'
    ? db.submissions.find((s) => s.matchId === match.id && s.team === me.team)
    : db.submissions.find((s) => s.matchId === match.id && s.userId === bot.id);
  const sub = existing || {
    id: subId, matchId: match.id, userId: bot.id, username: bot.username,
    team: match.mode === 'duo' ? me.team : null, title: '', status: 'draft', reviewStatus: 'clear',
    createdAt: Date.now(), submittedAt: null, files: {}, auditTrail: [],
  };
  sub.files = {
    render: renderFile,
    proof: { name: `${bot.username}_viewport.png`, mime: 'image/svg+xml', size: 0, path: proofName, uploadedAt: Date.now(), simulated: true },
  };
  const titles = ['Study in wireframe', 'Late-night sculpt', 'Third coffee, first idea', 'Silhouette first', 'Modular kit experiment'];
  sub.title = titles[Math.floor(Math.random() * titles.length)];
  sub.status = 'submitted';
  sub.submittedAt = Date.now();
  sub.auditTrail.push({ at: Date.now(), action: 'submitted', note: 'Simulated bot entry submitted (demo mode)' });
  if (!existing) db.submissions.push(sub);
  const p = match.players.find((x) => x.userId === bot.id);
  if (p) p.submitted = true;
  save();
}

function beginVoting(match) {
  match.submissionClosedAt = Date.now();
  const subs = matchSubs(match.id).filter((s) => s.files.render && s.files.proof && !s.disqualified);
  if (!match.practice) {
    // bots vote
    const voters = match.players.filter((p) => p.isBot);
    voters.forEach((v) => {
      if (!match.botPlan.find((b) => b.userId === v.userId)) return;
      const plan = match.botPlan.find((b) => b.userId === v.userId);
      plan.voteAt = Date.now() + 1500 + Math.random() * Math.max(2000, match.settings.votingSeconds * 1000 * 0.6);
    });
  }
  match.phase = 'voting';
  match.phaseEndsAt = Date.now() + scaled(match.settings.votingSeconds) * 1000;
  match.auditTrail.push({ at: Date.now(), action: 'voting-started', note: `${subs.length} valid ${subs.length === 1 ? 'entry' : 'entries'} entered voting` });
  const validHumans = matchSubs(match.id).filter((s) => s.files.render && s.files.proof && !s.disqualified && !(match.players.find((p) => p.userId === s.userId) || {}).isBot);
  if (subs.length === 0) {
    finishMatch(match, { abandoned: true, reason: 'No valid entries were submitted.' });
    return;
  }
  if (subs.length === 1 && validHumans.length === 1 && match.players.filter((p) => !p.isBot).length === 1) {
    // solo vs nothing — still let the player see results quickly
    match.phaseEndsAt = Date.now() + 8000;
  }
  save();
  pushMatch(match);
  pushLobby(getLobby(match.code));
}

function awardXP(user, amount) {
  if (!user || user.isBot) return;
  user.xp = Math.max(0, (user.xp || 0) + Math.round(amount));
  user.level = util.levelProgress(user.xp).level;
  user.rank = rankOf(user.xp);
}

function finishMatch(match, opts = {}) {
  const subs = matchSubs(match.id).filter((s) => s.files.render && s.files.proof && !s.disqualified);
  const scored = subs.map((s) => {
    const votes = db.votes.filter((v) => v.submissionId === s.id && !v.invalidated);
    const total = votes.reduce((a, v) => a + v.score, 0);
    const avg = votes.length ? total / votes.length : 0;
    s.avgScore = +avg.toFixed(2);
    s.voteCount = votes.length;
    return s;
  }).sort((a, b) => b.avgScore - a.avgScore || b.voteCount - a.voteCount || a.submittedAt - b.submittedAt);

  const awards = [];
  const entries = scored.map((s, i) => {
    const place = i + 1;
    const owner = getUser(s.userId);
    let xpAwarded = 0;
    if (!match.practice && owner && !owner.isBot) {
      const placeBonus = [250, 160, 100][i] || 60;
      xpAwarded = Math.round(placeBonus + s.avgScore * 15 + s.voteCount * 2);
      awardXP(owner, xpAwarded);
      owner.stats = owner.stats || { wins: 0, matches: 0, podiums: 0, votes: 0, avgScore: 0 };
      owner.stats.matches = (owner.stats.matches || 0) + 1;
      owner.stats.votes = (owner.stats.votes || 0) + s.voteCount;
      if (place === 1) owner.stats.wins = (owner.stats.wins || 0) + 1;
      if (place <= 3) owner.stats.podiums = (owner.stats.podiums || 0) + 1;
      owner.stats.avgScore = +(((owner.stats.avgScore || 0) * (owner.stats.matches - 1) + s.avgScore) / owner.stats.matches).toFixed(2);
      if (place === 1 && !owner.badges.includes('first-blood')) owner.badges.push('first-blood');
      if (owner.stats.matches >= 5 && !owner.badges.includes('regular')) owner.badges.push('regular');
      if (owner.stats.podiums >= 5 && !owner.badges.includes('podium-hunter')) owner.badges.push('podium-hunter');
      if (owner.xp >= 8000 && !owner.badges.includes('legend-track')) owner.badges.push('legend-track');
      awards.push({ userId: owner.id, username: owner.username, place, xpAwarded, avgScore: s.avgScore });
    }
    return {
      place,
      submissionId: s.id,
      userId: s.userId,
      username: (owner && owner.username) || s.username,
      displayName: teamLabel(match, s) || (owner && owner.username) || s.username,
      avgScore: s.avgScore,
      voteCount: s.voteCount,
      disqualified: !!s.disqualified,
      renderUrl: publicRenderUrl(s),
      renderKind: (s.files.render.mime || '').startsWith('video') ? 'video' : 'image',
      title: s.title,
      xpAwarded,
    };
  });

  match.phase = 'results';
  match.endedAt = Date.now();
  match.phaseEndsAt = Date.now();
  match.abandoned = !!opts.abandoned;
  match.results = {
    computedAt: Date.now(),
    abandoned: !!opts.abandoned,
    reason: opts.reason || null,
    entries,
    awards,
    podium: entries.slice(0, 3),
    stats: {
      entries: entries.length,
      votes: db.votes.filter((v) => v.matchId === match.id && !v.invalidated).length,
      durationSeconds: Math.round(((match.endedAt || Date.now()) - match.startedAt) / 1000),
      theme: match.theme,
      mode: match.modeName,
    },
  };
  if (!match.practice) {
    setImmediate(() => {
      const lobby = getLobby(match.code);
      if (lobby) { lobby.status = 'waiting'; lobby.matchId = null; lobby.startsAt = null; lobby.players.forEach((p) => { p.ready = !!p.isBot; }); pushLobby(lobby); }
    });
    activity({ type: 'results', text: `${entries[0] ? entries[0].displayName : 'Nobody'} won “${match.theme}” — ${entries[0] ? entries[0].avgScore.toFixed(1) : 0}★ average.`, matchId: match.id });
  }
  save();
  audit({ action: 'match-finished', actor: 'system', matchId: match.id, note: `${entries.length} entries scored` });
  pushMatch(match);
}

/* ------------------------------------------------------------------ ticker */
setInterval(() => {
  const now = Date.now();
  let changed = new Set();
  // lobby countdowns
  db.lobbies.forEach((lobby) => {
    if (lobby.status === 'starting' && lobby.startsAt && now >= lobby.startsAt) {
      const human = lobby.players.filter((p) => !p.isBot);
      if (human.length && lobby.players.length >= 1) {
        startMatchFromLobby(lobby);
      } else {
        lobby.status = 'waiting';
        lobby.startsAt = null;
        pushLobby(lobby);
      }
    }
  });
  db.matches.forEach((match) => {
    if (match.phase === 'building' && !match.practice && match.phaseEndsAt && now >= match.phaseEndsAt) {
      match.phase = 'submission';
      match.phaseEndsAt = now + scaled(Math.max(20, Math.min(90, Math.round(match.settings.buildSeconds * 0.25)))) * 1000;
      match.auditTrail.push({ at: now, action: 'submission-window', note: 'Build timer ended — final submission window opened' });
      save(); pushMatch(match); changed.add(match.id);
    } else if (match.phase === 'submission' && match.phaseEndsAt && now >= match.phaseEndsAt) {
      beginVoting(match);
      changed.add(match.id);
    } else if (match.phase === 'voting' && match.phaseEndsAt && now >= match.phaseEndsAt) {
      finishMatch(match);
      changed.add(match.id);
    }
    // bot submissions
    if ((match.phase === 'building' || match.phase === 'submission') && match.botPlan) {
      match.botPlan.forEach((plan) => {
        if (plan.submitAt && now >= plan.submitAt && !plan.done) {
          plan.done = true;
          botSubmit(match, plan);
          save(); pushMatch(match);
        }
      });
    }
    // bot votes
    if (match.phase === 'voting' && match.botPlan) {
      match.botPlan.forEach((plan) => {
        if (plan.voteAt && now >= plan.voteAt && !plan.voteDone) {
          plan.voteDone = true;
          const targets = matchSubs(match.id).filter((s) => s.files.render && s.files.proof && !s.disqualified &&
            !(match.mode === 'duo' ? s.team === (match.players.find((p) => p.userId === plan.userId) || {}).team : s.userId === plan.userId));
          targets.forEach((t) => {
            if (db.votes.some((v) => v.voterId === plan.userId && v.submissionId === t.id)) return;
            const score = Math.max(1, Math.min(5, 3 + Math.round((Math.random() - 0.4) * 3)));
            db.votes.push({
              id: util.id('vote'), matchId: match.id, submissionId: t.id, voterId: plan.userId,
              voterName: (getUser(plan.userId) || {}).username || 'bot', score, createdAt: Date.now(), invalidated: false,
            });
          });
          save(); pushMatch(match);
        }
      });
    }
    // auto-close voting when every eligible human has voted
    if (match.phase === 'voting' && !match.autoCloseChecked) {
      const subs = matchSubs(match.id).filter((s) => s.files.render && s.files.proof && !s.disqualified);
      const humans = match.players.filter((p) => !p.isBot);
      const allVoted = humans.length > 1 && humans.every((p) => {
        const targets = subs.filter((s) => (match.mode === 'duo' ? s.team !== p.team : s.userId !== p.userId));
        return targets.length > 0 && targets.every((t) => db.votes.some((v) => v.voterId === p.userId && v.submissionId === t.id && !v.invalidated));
      });
      if (allVoted) {
        match.autoCloseChecked = true;
        match.phaseEndsAt = Math.min(match.phaseEndsAt, Date.now() + 3000);
        save();
      }
    }
  });
  if (changed.size) { /* pushes already handled */ }
}, 1000);

/* ------------------------------------------------------------------ routing */
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:[a-zA-Z]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
};

function requireUser(ctx) {
  if (!ctx.user) throw bad('Sign in to continue', 401);
  return ctx.user;
}
function isMod(user) { return !!(user && user.isMod); }

/* auth */
route('POST', '/api/auth/register', async (ctx) => {
  const { username, email, password } = ctx.body;
  const rl = auth.rateLimit('auth:' + (ctx.ip || 'x'), 12, 60_000);
  if (!rl.ok) throw bad(`Too many attempts. Try again in ${rl.retryAfter}s.`, 429);
  if (!/^[A-Za-z0-9_]{3,18}$/.test(username || '')) throw bad('Username must be 3–18 characters: letters, numbers, underscore.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email || '')) throw bad('Enter a valid email address.');
  if (typeof password !== 'string' || password.length < 8) throw bad('Password must be at least 8 characters.');
  if (db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) throw bad('That username is taken.');
  if (db.users.some((u) => u.email && u.email.toLowerCase() === email.toLowerCase())) throw bad('An account with that email already exists.');
  const { salt, hash } = util.hashPassword(password);
  const user = {
    id: util.id('usr'), username, email, salt, pass: hash,
    avatarHue: Math.floor(Math.random() * 360),
    xp: 0, level: 1, rank: rankOf(0),
    region: ctx.body.region || 'EU', location: '',
    isMod: false, isGuest: false, isDemo: false,
    bio: '', badges: [],
    stats: { wins: 0, matches: 0, podiums: 0, votes: 0, avgScore: 0 },
    friends: [], blocked: [],
    privacy: { showHistory: true, friendsOnlyLeaderboard: false },
    settings: { sfx: true, reducedMotion: false },
    challengeClaims: {},
    createdAt: Date.now(), lastSeen: Date.now(),
  };
  db.users.push(user);
  const t = auth.createSession(user.id);
  ctx.setSession(t);
  audit({ action: 'register', actor: user.username, note: 'Account created' });
  activity({ type: 'player', text: `${username} joined Blend Battles.` });
  save();
  return { user: auth.publicUser(user, user) };
});

route('POST', '/api/auth/login', async (ctx) => {
  const rl = auth.rateLimit('auth:' + (ctx.ip || 'x'), 12, 60_000);
  if (!rl.ok) throw bad(`Too many attempts. Try again in ${rl.retryAfter}s.`, 429);
  const { username, password } = ctx.body;
  const user = db.users.find((u) => u.username.toLowerCase() === String(username || '').toLowerCase() && !u.isBot);
  if (!user || !user.pass || !util.verifyPassword(String(password || ''), user.salt, user.pass)) {
    throw bad('Incorrect username or password.', 401);
  }
  const t = auth.createSession(user.id);
  ctx.setSession(t);
  return { user: auth.publicUser(user, user) };
});

route('POST', '/api/auth/guest', async (ctx) => {
  const adjectives = ['Neon', 'Low', 'Cyber', 'Rogue', 'Turbo', 'Velvet', 'Quantum', 'Feral', 'Chrome', 'Pixel'];
  const nouns = ['Cube', 'Ortho', 'Vertex', 'Suzanne', 'Shader', 'Gizmo', 'Rig', 'Mesh', 'Normal', 'Bevel'];
  let name;
  do {
    name = `${adjectives[Math.floor(Math.random() * adjectives.length)]}${nouns[Math.floor(Math.random() * nouns.length)]}${Math.floor(10 + Math.random() * 89)}`;
  } while (db.users.some((u) => u.username.toLowerCase() === name.toLowerCase()));
  const user = {
    id: util.id('usr'), username: name, email: null, salt: '', pass: '',
    avatarHue: Math.floor(Math.random() * 360), xp: 0, level: 1, rank: rankOf(0),
    region: 'EU', location: '', isMod: false, isGuest: true, isDemo: false,
    bio: 'Guest artist — progress is kept on this device session only.',
    badges: [], stats: { wins: 0, matches: 0, podiums: 0, votes: 0, avgScore: 0 },
    friends: [], blocked: [], privacy: { showHistory: true }, settings: { sfx: true, reducedMotion: false },
    challengeClaims: {}, createdAt: Date.now(), lastSeen: Date.now(),
  };
  db.users.push(user);
  const t = auth.createSession(user.id);
  ctx.setSession(t);
  activity({ type: 'player', text: `Guest ${name} is trying the arena.` });
  save();
  return { user: auth.publicUser(user, user) };
});

route('POST', '/api/auth/logout', async (ctx) => {
  const t = auth.sessionFrom(ctx.req);
  auth.destroySession(t);
  ctx.clearSession();
  return { ok: true };
});

/* me */
route('GET', '/api/me', async (ctx) => {
  if (!ctx.user) return { user: null, demoMode: DEMO_MODE, online: onlineCount() };
  return {
    user: auth.publicUser(ctx.user, ctx.user),
    demoMode: DEMO_MODE,
    online: onlineCount(),
    challenges: challengesFor(ctx.user),
  };
});

route('PATCH', '/api/me', async (ctx) => {
  const user = requireUser(ctx);
  const b = ctx.body;
  if (b.username !== undefined) {
    if (!/^[A-Za-z0-9_]{3,18}$/.test(b.username)) throw bad('Username must be 3–18 characters: letters, numbers, underscore.');
    if (db.users.some((u) => u.id !== user.id && u.username.toLowerCase() === b.username.toLowerCase())) throw bad('That username is taken.');
    user.username = b.username;
  }
  if (b.bio !== undefined) user.bio = String(b.bio).slice(0, 240);
  if (b.avatarHue !== undefined) user.avatarHue = util.clamp(Number(b.avatarHue) || 0, 0, 359);
  if (b.region !== undefined) user.region = ['EU', 'NA', 'APAC', 'SA', 'AF'].includes(b.region) ? b.region : user.region;
  if (b.location !== undefined) user.location = String(b.location).slice(0, 60);
  if (b.privacy) user.privacy = Object.assign({}, user.privacy, {
    showHistory: b.privacy.showHistory !== undefined ? !!b.privacy.showHistory : user.privacy.showHistory,
    friendsOnlyLeaderboard: b.privacy.friendsOnlyLeaderboard !== undefined ? !!b.privacy.friendsOnlyLeaderboard : user.privacy.friendsOnlyLeaderboard,
  });
  if (b.settings) user.settings = Object.assign({}, user.settings, {
    sfx: b.settings.sfx !== undefined ? !!b.settings.sfx : user.settings.sfx,
    reducedMotion: b.settings.reducedMotion !== undefined ? !!b.settings.reducedMotion : user.settings.reducedMotion,
  });
  save();
  return { user: auth.publicUser(user, user) };
});

route('POST', '/api/me/friends', async (ctx) => {
  const user = requireUser(ctx);
  const target = getUser(ctx.body.userId);
  if (!target) throw bad('Player not found', 404);
  if (target.id === user.id) throw bad('You cannot add yourself.');
  if (target.isBot) throw bad('Practice bots are not friendable.');
  user.friends = user.friends || [];
  if (ctx.body.action === 'remove') user.friends = user.friends.filter((f) => f !== target.id);
  else if (!user.friends.includes(target.id)) user.friends.push(target.id);
  save();
  return { friends: user.friends, user: auth.publicUser(user, user) };
});

/* meta */
route('GET', '/api/config', async () => ({
  demoMode: DEMO_MODE,
  modes: Object.values(MODES),
  themes: THEMES,
  ranks: util.RANKS,
  limits: { render: MAX_UPLOAD.render, proof: MAX_UPLOAD.proof, model: MAX_UPLOAD.model },
  demoAccounts: [
    { username: 'NovaKite', password: 'blendbattles', note: 'Top-ranked artist' },
    { username: 'modvex', password: 'blendbattles', note: 'Moderator (review tools)' },
  ],
  online: onlineCount(),
}));

route('GET', '/api/themes', async () => ({ themes: THEMES }));

function onlineCount() {
  const cutoff = Date.now() - 1000 * 60 * 12;
  return db.users.filter((u) => (u.lastSeen || 0) > cutoff && !u.isBot).length;
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
  return {
    daily: defs.filter((d) => d.scope === 'daily').map(decorate),
    weekly: defs.filter((d) => d.scope === 'weekly').map(decorate),
  };
}

route('GET', '/api/challenges', async (ctx) => {
  const user = requireUser(ctx);
  return challengesFor(user);
});

route('POST', '/api/challenges/:id/claim', async (ctx) => {
  const user = requireUser(ctx);
  const all = challengesFor(user);
  const c = [...all.daily, ...all.weekly].find((x) => x.id === ctx.params.id);
  if (!c) throw bad('Unknown challenge', 404);
  if (!c.complete) throw bad('Challenge is not complete yet.');
  user.challengeClaims = user.challengeClaims || {};
  const list = user.challengeClaims[c.claimKey] || [];
  if (list.includes(c.id)) throw bad('Already claimed for this period.');
  list.push(c.id);
  user.challengeClaims[c.claimKey] = list;
  awardXP(user, c.xp);
  audit({ action: 'challenge-claim', actor: user.username, note: `${c.title} (+${c.xp} XP)` });
  save();
  return { user: auth.publicUser(user, user), challenges: challengesFor(user), awarded: c.xp };
});

/* lobbies */
route('GET', '/api/lobbies', async (ctx) => {
  const list = db.lobbies
    .filter((l) => !l.isPrivate && (l.status === 'waiting' || l.status === 'starting'))
    .filter((l) => ctx.query.mode === undefined || l.mode === ctx.query.mode)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((l) => serializeLobby(l, ctx.user));
  return { lobbies: list, modes: Object.values(MODES) };
});

route('POST', '/api/lobbies', async (ctx) => {
  const user = requireUser(ctx);
  const b = ctx.body;
  const mode = MODES[b.mode] ? b.mode : 'build';
  const cfg = MODES[mode];
  const maxPlayers = util.clamp(Number(b.maxPlayers) || cfg.maxPlayers, cfg.minPlayers, cfg.maxPlayers);
  const buildSeconds = util.clamp(Number(b.buildSeconds) || cfg.buildSeconds, cfg.practice ? 0 : 60, 1800);
  const difficulty = ['easy', 'medium', 'hard', 'any'].includes(b.difficulty) ? b.difficulty : 'any';
  const customTheme = b.customTheme ? String(b.customTheme).trim().slice(0, 40) : null;
  const lobby = {
    id: util.id('lob'),
    code: util.roomCode(),
    name: String(b.name || `${user.username}'s ${cfg.name}`).trim().slice(0, 40) || `${cfg.name} room`,
    mode, maxPlayers, difficulty, buildSeconds,
    customTheme: customTheme || null,
    isPrivate: !!b.isPrivate,
    hostId: user.id,
    status: 'waiting',
    players: [{ userId: user.id, name: user.username, ready: false, isBot: false, connected: true, joinedAt: Date.now() }],
    createdAt: Date.now(),
    startsAt: null,
    matchId: null,
  };
  db.lobbies.push(lobby);
  activity({ type: 'lobby', text: `${user.username} opened a ${cfg.name} room (${lobby.code}).` });
  save();
  return { lobby: serializeLobby(lobby, user) };
});

route('GET', '/api/lobbies/:code', async (ctx) => {
  const lobby = getLobby(ctx.params.code);
  if (!lobby) throw bad('Lobby not found', 404);
  return { lobby: serializeLobby(lobby, ctx.user) };
});

route('POST', '/api/lobbies/:code/join', async (ctx) => {
  const user = requireUser(ctx);
  const lobby = getLobby(ctx.params.code);
  if (!lobby) throw bad('Lobby not found — check the room code.', 404);
  if (lobby.status === 'in_match') throw bad('That match already started. Ask the host for the next round.');
  if (lobby.players.some((p) => p.userId === user.id)) return { lobby: serializeLobby(lobby, user) };
  if (lobby.players.length >= lobby.maxPlayers) throw bad('That lobby is full.');
  lobby.players.push({ userId: user.id, name: user.username, ready: false, isBot: false, connected: true, joinedAt: Date.now() });
  activity({ type: 'lobby', text: `${user.username} joined room ${lobby.code}.` });
  save();
  pushLobby(lobby);
  return { lobby: serializeLobby(lobby, user) };
});

route('POST', '/api/lobbies/:code/leave', async (ctx) => {
  const user = requireUser(ctx);
  const lobby = getLobby(ctx.params.code);
  if (!lobby) throw bad('Lobby not found', 404);
  lobby.players = lobby.players.filter((p) => p.userId !== user.id);
  if (lobby.matchId) {
    const m = getMatch(lobby.matchId);
    const p = m && m.players.find((x) => x.userId === user.id);
    if (p) { p.connected = false; audit({ action: 'player-left', actor: user.username, matchId: m.id, note: 'Left during match — submission kept' }); pushMatch(m); }
  }
  if (!lobby.players.some((p) => !p.isBot)) {
    const idx = db.lobbies.indexOf(lobby);
    if (idx >= 0) db.lobbies.splice(idx, 1);
    save();
    return { left: true, lobbyDeleted: true };
  }
  if (lobby.hostId === user.id) {
    const nextHost = lobby.players.find((p) => !p.isBot) || lobby.players[0];
    lobby.hostId = nextHost.userId;
  }
  save();
  pushLobby(lobby);
  return { left: true, lobby: serializeLobby(lobby, user) };
});

route('POST', '/api/lobbies/:code/ready', async (ctx) => {
  const user = requireUser(ctx);
  const lobby = getLobby(ctx.params.code);
  if (!lobby) throw bad('Lobby not found', 404);
  const p = lobby.players.find((x) => x.userId === user.id);
  if (!p) throw bad('Join the lobby before readying up.', 403);
  p.ready = ctx.body.ready !== false;
  save();
  pushLobby(lobby);
  return { lobby: serializeLobby(lobby, user) };
});

route('POST', '/api/lobbies/:code/bots', async (ctx) => {
  const user = requireUser(ctx);
  const lobby = getLobby(ctx.params.code);
  if (!lobby) throw bad('Lobby not found', 404);
  if (lobby.hostId !== user.id) throw bad('Only the host can add practice bots.', 403);
  if (lobby.status === 'in_match') throw bad('Match already running.');
  const want = util.clamp(Number(ctx.body.count) || 3, 0, lobby.maxPlayers);
  const currentBots = lobby.players.filter((p) => p.isBot).length;
  const toAdd = Math.max(0, Math.min(want, lobby.maxPlayers - lobby.players.length));
  for (let i = 0; i < toAdd; i++) {
    const bot = addBot(lobby, currentBots + i);
    lobby.players.push({ userId: bot.id, name: bot.username, ready: true, isBot: true, connected: true, joinedAt: Date.now() });
  }
  if (ctx.body.fill === true) {
    while (lobby.players.length < Math.min(lobby.maxPlayers, 4)) {
      const bot = addBot(lobby, lobby.players.length);
      lobby.players.push({ userId: bot.id, name: bot.username, ready: true, isBot: true, connected: true, joinedAt: Date.now() });
    }
  }
  save();
  pushLobby(lobby);
  return { lobby: serializeLobby(lobby, user) };
});

route('POST', '/api/lobbies/:code/kick', async (ctx) => {
  const user = requireUser(ctx);
  const lobby = getLobby(ctx.params.code);
  if (!lobby) throw bad('Lobby not found', 404);
  if (lobby.hostId !== user.id) throw bad('Only the host can remove players.', 403);
  const target = ctx.body.userId;
  if (target === user.id) throw bad('You cannot kick yourself — leave instead.');
  lobby.players = lobby.players.filter((p) => p.userId !== target);
  save();
  pushLobby(lobby);
  pushTo(target, 'kicked', { code: lobby.code });
  return { lobby: serializeLobby(lobby, user) };
});

route('POST', '/api/lobbies/:code/start', async (ctx) => {
  const user = requireUser(ctx);
  const lobby = getLobby(ctx.params.code);
  if (!lobby) throw bad('Lobby not found', 404);
  if (lobby.hostId !== user.id) throw bad('Only the host can start the match.', 403);
  if (lobby.status !== 'waiting') throw bad('This lobby is already starting.');
  const humans = lobby.players.filter((p) => !p.isBot);
  if (humans.length < 1) throw bad('Nobody is in the lobby.');
  if (lobby.players.length < 2 && !MODES[lobby.mode].practice) throw bad('You need at least 2 contestants. Add practice bots to play solo.');
  if (!MODES[lobby.mode].practice && humans.some((p) => !p.ready)) throw bad('Every human player must be ready.');
  lobby.status = 'starting';
  lobby.startsAt = Date.now() + 5000;
  lobby.players.forEach((p) => { p.ready = true; });
  save();
  pushLobby(lobby);
  return { lobby: serializeLobby(lobby, user) };
});

route('POST', '/api/lobbies/:code/theme', async (ctx) => {
  const user = requireUser(ctx);
  const lobby = getLobby(ctx.params.code);
  if (!lobby) throw bad('Lobby not found', 404);
  if (lobby.hostId !== user.id) throw bad('Only the host can change the theme.', 403);
  const custom = ctx.body.customTheme ? String(ctx.body.customTheme).trim().slice(0, 40) : null;
  lobby.customTheme = custom || null;
  if (ctx.body.difficulty) lobby.difficulty = ['easy', 'medium', 'hard', 'any'].includes(ctx.body.difficulty) ? ctx.body.difficulty : lobby.difficulty;
  if (ctx.body.buildSeconds) lobby.buildSeconds = util.clamp(Number(ctx.body.buildSeconds), 60, 1800);
  save();
  pushLobby(lobby);
  return { lobby: serializeLobby(lobby, user) };
});

route('POST', '/api/quickplay', async (ctx) => {
  const user = requireUser(ctx);
  const mode = MODES[ctx.body.mode] ? ctx.body.mode : 'build';
  const cfg = MODES[mode];
  // join an open public lobby that has room
  const open = db.lobbies.find((l) => l.mode === mode && !l.isPrivate && l.status === 'waiting' && l.players.length < l.maxPlayers && !l.players.some((p) => p.userId === user.id));
  if (open && !cfg.practice) {
    open.players.push({ userId: user.id, name: user.username, ready: false, isBot: false, connected: true, joinedAt: Date.now() });
    save();
    pushLobby(open);
    return { lobby: serializeLobby(open, user), joined: true };
  }
  const lobby = {
    id: util.id('lob'), code: util.roomCode(),
    name: `${user.username}'s ${cfg.name}`, mode,
    maxPlayers: cfg.maxPlayers, difficulty: 'any', buildSeconds: cfg.buildSeconds,
    customTheme: null, isPrivate: false, hostId: user.id, status: 'waiting',
    players: [{ userId: user.id, name: user.username, ready: false, isBot: false, connected: true, joinedAt: Date.now() }],
    createdAt: Date.now(), startsAt: null, matchId: null,
  };
  db.lobbies.push(lobby);
  if (!cfg.practice) {
    const fill = Math.min(lobby.maxPlayers, 1 + 3);
    while (lobby.players.length < fill) {
      const bot = addBot(lobby, lobby.players.length);
      lobby.players.push({ userId: bot.id, name: bot.username, ready: true, isBot: true, connected: true, joinedAt: Date.now() });
    }
  }
  save();
  pushLobby(lobby);
  return { lobby: serializeLobby(lobby, user), created: true };
});

/* matches */
route('GET', '/api/matches/:id', async (ctx) => {
  const match = getMatch(ctx.params.id);
  if (!match) throw bad('Match not found', 404);
  if (!isParticipant(match, ctx.user) && !isMod(ctx.user) && match.phase !== 'results') throw bad('This match is private until results are published.', 403);
  return { match: serializeMatch(match, ctx.user) };
});

route('POST', '/api/matches/:id/upload', async (ctx) => {
  const user = requireUser(ctx);
  const match = getMatch(ctx.params.id);
  if (!match) throw bad('Match not found', 404);
  if (!isParticipant(match, user)) throw bad('You are not in this match', 403);
  if (!canUpload(match, user)) throw bad('Uploads are closed for this match.', 403);
  const rl = auth.rateLimit('upload:' + user.id, 14, 60_000);
  if (!rl.ok) throw bad(`Upload rate limit reached. Retry in ${rl.retryAfter}s.`, 429);
  const kind = ctx.query.kind;
  if (!['render', 'proof', 'model'].includes(kind)) throw bad('Invalid upload kind');
  if (kind === 'model' && !ctx.query.name) throw bad('Model upload needs a filename');
  const sub = ensureSubmission(match, user);
  if (!['draft', 'submitted', 'revision'].includes(sub.status) && sub.status !== 'submitted') {
    // submissions can be revised until the deadline; only disqualified locks it
  }
  if (sub.disqualified) throw bad('This submission was disqualified — uploads are locked.', 403);

  const declared = String(ctx.req.headers['content-type'] || '').split(';')[0].trim();
  const originalName = decodeURIComponent(String(ctx.req.headers['x-file-name'] || ctx.query.name || 'upload')).slice(-120);
  const expectedExt = path.extname(originalName).toLowerCase();
  const allowedExt = kind === 'model' ? ['.glb', '.gltf'] : ['.png', '.jpg', '.jpeg', '.mp4', '.webm'];
  if (!allowedExt.includes(expectedExt)) throw bad(`Unsupported file extension ${expectedExt || '(none)'}. Allowed: ${allowedExt.join(', ')}`);

  const tmp = path.join(UPLOAD_DIR, `tmp-${sub.id}-${kind}-${crypto.randomBytes(4).toString('hex')}`);
  let size;
  try {
    size = await streamToFile(ctx.req, tmp, MAX_UPLOAD[kind]);
  } catch (e) {
    fs.unlink(tmp, () => {});
    throw e;
  }
  const mime = sniffMime(tmp);
  if (!mime || !ALLOWED[kind][mime]) {
    fs.unlink(tmp, () => {});
    throw bad(`The file contents do not match an allowed ${kind === 'model' ? 'GLB/glTF' : 'image/video'} format (detected: ${mime || 'unknown'}). Nothing was saved.`, 415);
  }
  const modeCfg = MODES[match.mode] || MODES.build;
  if (kind === 'render' && modeCfg.requiresVideo && !mime.startsWith('video')) {
    fs.unlink(tmp, () => {});
    throw bad('Animation Battles require a video final render (MP4 or WebM).', 415);
  }
  const ext = EXT_BY_MIME[mime] || expectedExt;
  const stored = `${sub.id}-${kind}-${crypto.randomBytes(4).toString('hex')}${ext}`;
  fs.renameSync(tmp, path.join(UPLOAD_DIR, stored));

  const prev = sub.files[kind];
  if (prev && prev.path) {
    const oldPath = path.join(UPLOAD_DIR, prev.path);
    if (fs.existsSync(oldPath)) fs.unlink(oldPath, () => {});
  }
  const fileRec = { name: originalName, mime, size, path: stored, uploadedAt: Date.now() };
  sub.files[kind] = fileRec;
  sub.status = sub.status === 'submitted' ? 'submitted' : 'draft';
  sub.auditTrail = sub.auditTrail || [];
  sub.auditTrail.push({
    at: Date.now(), action: prev ? 'file-replaced' : 'file-uploaded',
    note: `${kind === 'render' ? 'Final render' : kind === 'proof' ? 'Viewport proof' : 'GLB model'} — ${originalName} (${(size / 1024 / 1024).toFixed(2)} MB, ${mime})`,
    actor: user.username,
  });
  if (match.players) {
    const pl = match.players.find((p) => p.userId === user.id);
    if (pl) pl.submitted = !!(sub.files.render && sub.files.proof);
  }
  save();
  pushMatch(match);
  return {
    ok: true,
    kind,
    file: { ...fileRec, path: undefined, url: kind === 'render' ? `/api/media/${sub.id}/render` : `/api/media/${sub.id}/${kind}` },
    submission: serializeOwnSubmission(match, sub, user),
  };
});

route('DELETE', '/api/matches/:id/file', async (ctx) => {
  const user = requireUser(ctx);
  const match = getMatch(ctx.params.id);
  if (!match) throw bad('Match not found', 404);
  if (!isParticipant(match, user)) throw bad('You are not in this match', 403);
  if (!canUpload(match, user)) throw bad('The submission deadline has passed — files are locked.', 403);
  const kind = ctx.query.kind;
  const sub = getMySubmission(match, user);
  if (!sub) throw bad('No submission yet', 404);
  const rec = sub.files[kind];
  if (!rec) throw bad('No file to remove', 404);
  if (rec.path && !rec.url) {
    const p = path.join(UPLOAD_DIR, rec.path);
    if (fs.existsSync(p)) fs.unlink(p, () => {});
  }
  delete sub.files[kind];
  sub.status = 'draft';
  sub.auditTrail.push({ at: Date.now(), action: 'file-removed', note: `${kind} removed to be replaced`, actor: user.username });
  save();
  pushMatch(match);
  return { ok: true, submission: serializeOwnSubmission(match, sub, user) };
});

route('POST', '/api/matches/:id/submit', async (ctx) => {
  const user = requireUser(ctx);
  const match = getMatch(ctx.params.id);
  if (!match) throw bad('Match not found', 404);
  if (!isParticipant(match, user)) throw bad('You are not in this match', 403);
  if (!canUpload(match, user)) throw bad('The submission deadline has passed.', 403);
  const sub = getMySubmission(match, user) || ensureSubmission(match, user);
  if (sub.disqualified) throw bad('This submission was disqualified.', 403);
  if (!sub.files.render) throw bad('Upload your final render first.');
  if (!sub.files.proof) throw bad('Upload your Blender viewport proof — both files are required.');
  if (ctx.body.title !== undefined) sub.title = String(ctx.body.title).slice(0, 60);
  sub.status = 'submitted';
  sub.submittedAt = sub.submittedAt || Date.now();
  sub.auditTrail.push({ at: Date.now(), action: 'submitted', note: 'Entry finalized with final render + viewport proof', actor: user.username });
  match.auditTrail.push({ at: Date.now(), action: 'entry-submitted', note: `${user.username} finalized an entry` });
  const p = match.players.find((x) => x.userId === user.id);
  if (p) p.submitted = true;
  save();
  pushMatch(match);
  pushLobby(getLobby(match.code));
  return { ok: true, submission: serializeOwnSubmission(match, sub, user) };
});

route('POST', '/api/matches/:id/vote', async (ctx) => {
  const user = requireUser(ctx);
  const match = getMatch(ctx.params.id);
  if (!match) throw bad('Match not found', 404);
  if (!isParticipant(match, user)) throw bad('Only match participants can vote.', 403);
  if (match.phase !== 'voting') throw bad('Voting is not open right now.', 403);
  if (Date.now() > match.phaseEndsAt) throw bad('Voting has closed.', 403);
  const score = Number(ctx.body.score);
  if (!Number.isInteger(score) || score < 1 || score > 5) throw bad('Score must be a whole number from 1 to 5.');
  const sub = getSubmission(ctx.body.submissionId);
  if (!sub || sub.matchId !== match.id) throw bad('That entry is not part of this match.', 404);
  if (sub.disqualified) throw bad('That entry was disqualified and cannot be voted on.');
  if (!sub.files.render || !sub.files.proof) throw bad('That entry is incomplete.');
  const me = match.players.find((p) => p.userId === user.id);
  const own = match.mode === 'duo' ? sub.team === me.team : sub.userId === user.id;
  if (own) throw bad('You cannot vote for your own entry.');
  const rl = auth.rateLimit('vote:' + user.id, 40, 60_000);
  if (!rl.ok) throw bad('Slow down — too many votes submitted.', 429);
  const existing = db.votes.find((v) => v.voterId === user.id && v.submissionId === sub.id && !v.invalidated);
  if (existing) {
    if (ctx.body.change === true) {
      existing.score = score;
      existing.updatedAt = Date.now();
      save();
      pushMatch(match);
      return { ok: true, changed: true, score };
    }
    throw bad('You already voted on that entry.', 409);
  }
  db.votes.push({
    id: util.id('vote'), matchId: match.id, submissionId: sub.id, voterId: user.id,
    voterName: user.username, score, createdAt: Date.now(), invalidated: false,
  });
  if (!user.isBot) {
    user.stats = user.stats || {};
    user.stats.votesGiven = (user.stats.votesGiven || 0) + 1;
  }
  save();
  pushMatch(match);
  return { ok: true, score };
});

route('POST', '/api/matches/:id/report', async (ctx) => {
  const user = requireUser(ctx);
  const match = getMatch(ctx.params.id);
  if (!match) throw bad('Match not found', 404);
  const sub = getSubmission(ctx.body.submissionId);
  if (!sub || sub.matchId !== match.id) throw bad('Entry not found', 404);
  if (sub.userId === user.id) throw bad('You cannot report your own entry.');
  const rl = auth.rateLimit('report:' + user.id, 6, 60 * 60_000);
  if (!rl.ok) throw bad('Report limit reached for this hour.', 429);
  const reason = ['ai-generated', 'not-their-work', 'missing-proof', 'proof-mismatch', 'offensive', 'other'].includes(ctx.body.reason) ? ctx.body.reason : 'other';
  if (db.reports.some((r) => r.submissionId === sub.id && r.reporterId === user.id && r.status === 'open')) throw bad('You already have an open report on this entry.');
  const report = {
    id: util.id('rep'), submissionId: sub.id, matchId: match.id, reporterId: user.id,
    reporterName: user.username, reason, details: String(ctx.body.details || '').slice(0, 600),
    status: 'open', createdAt: Date.now(),
  };
  db.reports.push(report);
  sub.reviewStatus = 'reported';
  audit({ action: 'report-filed', actor: user.username, matchId: match.id, submissionId: sub.id, note: `${reason}: ${report.details.slice(0, 140)}` });
  save();
  return { ok: true, report: { id: report.id, status: report.status } };
});

route('POST', '/api/matches/:id/end', async (ctx) => {
  const user = requireUser(ctx);
  const match = getMatch(ctx.params.id);
  if (!match) throw bad('Match not found', 404);
  if (!isParticipant(match, user)) throw bad('You are not in this match', 403);
  if (!match.practice) throw bad('Only practice rooms can be ended manually.');
  if (match.phase === 'results') return { match: serializeMatch(match, user) };
  finishMatch(match, { abandoned: false });
  return { match: serializeMatch(match, user) };
});

/* media */
route('GET', '/api/media/:subId/:kind', async (ctx) => {
  const sub = getSubmission(ctx.params.subId);
  if (!sub) throw bad('File not found', 404);
  const match = getMatch(sub.matchId);
  const kind = ctx.params.kind;
  if (!['render', 'proof', 'model'].includes(kind)) throw bad('Invalid file kind');
  const rec = sub.files[kind];
  if (!rec) throw bad('File not found', 404);
  const viewer = ctx.user;
  const participant = isParticipant(match, viewer);
  const finished = match && (match.phase === 'results');
  const owner = viewer && sub.userId === viewer.id;
  if (kind === 'proof') {
    const allowed = owner || isMod(viewer) || participant || (finished && !!viewer);
    if (!allowed) throw new ApiError(403, viewer ? 'Viewport proof is visible to match participants, voters and moderators.' : 'Sign in to inspect viewport proof.');
  } else if (kind === 'model') {
    if (!viewer) throw bad('Sign in to view 3D models.', 401);
  } else if (!finished && !participant && !isMod(viewer)) {
    throw bad('That render is not public yet.', 403);
  }
  // public static asset (seeded demo renders live under /img/featured)
  if (rec.url && !rec.path) {
    const filePath = path.join(PUBLIC_DIR, rec.url);
    return { __file: filePath, mime: rec.mime || 'image/jpeg' };
  }
  const filePath = path.join(UPLOAD_DIR, rec.path);
  if (!fs.existsSync(filePath)) throw bad('File missing from storage', 410);
  return { __file: filePath, mime: rec.mime };
});

/* gallery & leaderboard */
route('GET', '/api/gallery', async (ctx) => {
  const items = db.submissions
    .filter((s) => s.files.render && s.files.proof && !s.disqualified)
    .map((s) => {
      const m = getMatch(s.matchId);
      if (!m || m.phase !== 'results' || m.abandoned) return null;
      const owner = getUser(s.userId);
      const place = m.results.entries.find((e) => e.submissionId === s.id);
      return {
        submissionId: s.id,
        matchId: m.id,
        title: s.title || m.theme,
        theme: m.theme,
        mode: m.modeName,
        modeKey: m.mode,
        renderUrl: publicRenderUrl(s),
        renderKind: (s.files.render.mime || '').startsWith('video') ? 'video' : 'image',
        proofUrl: `/api/media/${s.id}/proof`,
        hasModel: !!s.files.model,
        modelUrl: s.files.model ? `/api/media/${s.id}/model` : null,
        username: owner ? owner.username : s.username,
        avatarHue: owner ? owner.avatarHue : 250,
        rank: owner ? rankOf(owner.xp).name : 'Beginner',
        rankColor: owner ? rankOf(owner.xp).color : '#888',
        place: place ? place.place : null,
        score: s.avgScore || 0,
        votes: s.voteCount || 0,
        endedAt: m.endedAt,
        isBot: !!(owner && owner.isBot),
        reviewStatus: s.reviewStatus,
      };
    })
    .filter(Boolean)
    .filter((x) => ctx.query.theme === undefined || x.theme === ctx.query.theme)
    .filter((x) => ctx.query.mode === undefined || x.modeKey === ctx.query.mode)
    .filter((x) => ctx.query.mine !== '1' || (ctx.user && x.username === ctx.user.username))
    .sort((a, b) => (ctx.query.sort === 'top' ? b.score - a.score : b.endedAt - a.endedAt));
  return { items, themes: [...new Set(items.map((i) => i.theme))].sort() };
});

route('GET', '/api/leaderboard', async (ctx) => {
  const scope = ['global', 'regional', 'friends'].includes(ctx.query.scope) ? ctx.query.scope : 'global';
  let users = db.users.filter((u) => !u.isBot && !u.isGuest);
  if (scope === 'regional') users = users.filter((u) => u.region === (ctx.user ? ctx.user.region : 'EU'));
  if (scope === 'friends') {
    if (!ctx.user) throw bad('Sign in to see your friends ladder.', 401);
    users = users.filter((u) => (ctx.user.friends || []).includes(u.id) || u.id === ctx.user.id);
  }
  const ranked = users
    .map((u) => serializeUserSummary(u))
    .sort((a, b) => b.xp - a.xp)
    .slice(0, 100)
    .map((u, i) => ({ ...u, position: i + 1, isYou: !!(ctx.user && ctx.user.id === u.id) }));
  return { scope, entries: ranked, you: ranked.find((r) => r.isYou) || null };
});

route('GET', '/api/users/:id', async (ctx) => {
  const u = getUser(ctx.params.id);
  if (!u) throw bad('Player not found', 404);
  const isSelf = !!ctx.user && ctx.user.id === u.id;
  const isFriend = !!(ctx.user && (ctx.user.friends || []).includes(u.id));
  const matches = db.matches
    .filter((m) => m.players.some((p) => p.userId === u.id) && m.phase === 'results')
    .sort((a, b) => b.endedAt - a.endedAt)
    .slice(0, 20)
    .map((m) => matchSummaryFor(m, u.id));
  const creations = db.submissions
    .filter((s) => s.userId === u.id && s.files.render && s.files.proof)
    .sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0))
    .slice(0, 24)
    .map((s) => {
      const m = getMatch(s.matchId);
      return {
        submissionId: s.id, theme: m ? m.theme : '', mode: m ? m.modeName : '', renderUrl: publicRenderUrl(s),
        renderKind: (s.files.render.mime || '').startsWith('video') ? 'video' : 'image',
        proofUrl: `/api/media/${s.id}/proof`, score: s.avgScore || 0, place: m && m.results ? (m.results.entries.find((e) => e.submissionId === s.id) || {}).place : null,
        endedAt: m ? m.endedAt : s.submittedAt,
      };
    });
  return {
    user: auth.publicUser(u, ctx.user),
    isSelf, isFriend,
    canSeeHistory: isSelf || isFriend || (u.privacy || {}).showHistory !== false,
    matches: isSelf || isFriend || (u.privacy || {}).showHistory !== false ? matches : [],
    creations,
    matchCount: db.matches.filter((m) => m.players.some((p) => p.userId === u.id)).length,
  };
});

route('GET', '/api/tournaments', async (ctx) => {
  const base = new Date();
  base.setHours(18, 0, 0, 0);
  const mk = (offsetDays, name, mode, prize, slots) => ({
    id: 'tour-' + offsetDays + '-' + mode,
    name, mode: MODES[mode].name, modeKey: mode,
    startsAt: base.getTime() + offsetDays * 86400000,
    prize, slots,
    registered: (db.tournaments || []).filter((t) => t.id === 'tour-' + offsetDays + '-' + mode).map((t) => t.userId),
  });
  const list = [
    mk(1, 'Weekly Render Rumble', 'build', '500 XP + Legend badge', 16),
    mk(3, 'Two-Minute Blitz', 'speed', '300 XP + Speed Demon badge', 12),
    mk(6, 'Motion Masters', 'animation', '750 XP + Animator badge', 8),
  ].map((t) => ({ ...t, isRegistered: !!(ctx.user && t.registered.includes(ctx.user.id)), registered: t.registered.length }));
  return { tournaments: list };
});

route('POST', '/api/tournaments/:id/register', async (ctx) => {
  const user = requireUser(ctx);
  db.tournaments = db.tournaments || [];
  const existing = db.tournaments.find((t) => t.id === ctx.params.id && t.userId === user.id);
  const count = db.tournaments.filter((t) => t.id === ctx.params.id).length;
  if (existing) {
    db.tournaments = db.tournaments.filter((t) => !(t.id === ctx.params.id && t.userId === user.id));
    save();
    return { registered: false, count: count - 1 };
  }
  if (count >= 16) throw bad('This tournament bracket is full.');
  db.tournaments.push({ id: ctx.params.id, userId: user.id, at: Date.now() });
  audit({ action: 'tournament-register', actor: user.username, note: ctx.params.id });
  save();
  return { registered: true, count: count + 1 };
});

route('GET', '/api/activity', async () => {
  const seeded = db.activity.slice(0, 12);
  return { activity: seeded };
});

route('GET', '/api/home', async (ctx) => {
  const finished = db.matches.filter((m) => m.phase === 'results' && !m.abandoned && m.results).sort((a, b) => b.endedAt - a.endedAt);
  const featured = [];
  const seen = new Set();
  finished.forEach((m) => {
    m.results.entries.slice(0, 2).forEach((e) => {
      if (featured.length >= 6 || seen.has(e.submissionId)) return;
      seen.add(e.submissionId);
      featured.push({ ...e, theme: m.theme, mode: m.modeName, matchId: m.id });
    });
  });
  const winners = finished.slice(0, 5).map((m) => ({
    username: m.results.entries[0] ? m.results.entries[0].displayName : '—',
    renderUrl: m.results.entries[0] ? m.results.entries[0].renderUrl : null,
    theme: m.theme, mode: m.modeName, endedAt: m.endedAt,
    score: m.results.entries[0] ? m.results.entries[0].avgScore : 0,
    matchId: m.id,
  }));
  const openLobbies = db.lobbies.filter((l) => !l.isPrivate && (l.status === 'waiting' || l.status === 'starting')).length;
  const activeMatches = db.matches.filter((m) => m.phase !== 'results').map((m) => ({
    id: m.id, theme: m.theme, mode: m.modeName, phase: m.phase, phaseEndsAt: m.phaseEndsAt,
    players: m.players.length, submissions: matchSubs(m.id).filter((s) => s.files.render && s.files.proof).length,
    isParticipant: isParticipant(m, ctx.user),
  }));
  const topPlayers = db.users.filter((u) => !u.isBot && !u.isGuest).sort((a, b) => b.xp - a.xp).slice(0, 5).map(serializeUserSummary);
  const today = new Date().toISOString().slice(0, 10);
  const daily = pickTheme('any', 'daily-' + today);
  return {
    featured, winners, topPlayers, activeMatches, openLobbies,
    online: onlineCount(),
    dailyTheme: { ...daily, date: today },
    activity: db.activity.slice(0, 8),
    stats: {
      players: db.users.filter((u) => !u.isBot).length,
      entries: db.submissions.filter((s) => s.files.render).length,
      matches: finished.length,
      votes: db.votes.filter((v) => !v.invalidated).length,
    },
  };
});

/* moderation */
route('GET', '/api/mod/queue', async (ctx) => {
  if (!isMod(ctx.user)) throw bad('Moderator access required.', 403);
  const reports = db.reports.map((r) => {
    const sub = getSubmission(r.submissionId);
    const m = sub ? getMatch(sub.matchId) : null;
    const owner = sub ? getUser(sub.userId) : null;
    return {
      ...r,
      submission: sub ? {
        id: sub.id, username: sub.username, title: sub.title, status: sub.status,
        reviewStatus: sub.reviewStatus, disqualified: !!sub.disqualified,
        renderUrl: publicRenderUrl(sub), proofUrl: sub.files.proof ? `/api/media/${sub.id}/proof` : null,
        submittedAt: sub.submittedAt, votes: db.votes.filter((v) => v.submissionId === sub.id && !v.invalidated).length,
        theme: m ? m.theme : '', matchId: m ? m.id : null, rank: owner ? rankOf(owner.xp).name : '',
        auditTrail: (sub.auditTrail || []).slice(-8),
      } : null,
    };
  }).sort((a, b) => b.createdAt - a.createdAt);
  const flagged = db.submissions
    .filter((s) => s.reviewStatus === 'reported' || s.reviewStatus === 'evidence-requested')
    .map((s) => ({
      id: s.id, username: s.username, reviewStatus: s.reviewStatus, theme: (getMatch(s.matchId) || {}).theme,
      renderUrl: publicRenderUrl(s), proofUrl: s.files.proof ? `/api/media/${s.id}/proof` : null,
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
});

route('POST', '/api/mod/submissions/:id/disqualify', async (ctx) => {
  if (!isMod(ctx.user)) throw bad('Moderator access required.', 403);
  const sub = getSubmission(ctx.params.id);
  if (!sub) throw bad('Submission not found', 404);
  const reason = String(ctx.body.reason || '').slice(0, 300);
  if (!reason) throw bad('A disqualification reason is required.');
  sub.disqualified = true;
  sub.reviewStatus = 'disqualified';
  sub.reviewNote = reason;
  sub.auditTrail.push({ at: Date.now(), action: 'disqualified', note: reason, actor: ctx.user.username });
  db.reports.filter((r) => r.submissionId === sub.id && r.status === 'open').forEach((r) => { r.status = 'actioned'; r.resolvedAt = Date.now(); r.resolvedBy = ctx.user.username; });
  audit({ action: 'disqualify', actor: ctx.user.username, submissionId: sub.id, note: reason });
  const match = getMatch(sub.matchId);
  save();
  pushMatch(match);
  return { ok: true };
});

route('POST', '/api/mod/submissions/:id/restore', async (ctx) => {
  if (!isMod(ctx.user)) throw bad('Moderator access required.', 403);
  const sub = getSubmission(ctx.params.id);
  if (!sub) throw bad('Submission not found', 404);
  sub.disqualified = false;
  sub.reviewStatus = 'clear';
  sub.reviewNote = null;
  sub.auditTrail.push({ at: Date.now(), action: 'restored', note: 'Disqualification lifted by moderator', actor: ctx.user.username });
  db.reports.filter((r) => r.submissionId === sub.id && r.status === 'open').forEach((r) => { r.status = 'dismissed'; r.resolvedAt = Date.now(); r.resolvedBy = ctx.user.username; });
  audit({ action: 'restore', actor: ctx.user.username, submissionId: sub.id, note: 'Entry restored' });
  const match = getMatch(sub.matchId);
  save();
  pushMatch(match);
  return { ok: true };
});

route('POST', '/api/mod/submissions/:id/request-evidence', async (ctx) => {
  if (!isMod(ctx.user)) throw bad('Moderator access required.', 403);
  const sub = getSubmission(ctx.params.id);
  if (!sub) throw bad('Submission not found', 404);
  const note = String(ctx.body.note || 'Please upload a short screen recording of the file open in Blender, rotating the model in the viewport.').slice(0, 400);
  sub.reviewStatus = 'evidence-requested';
  sub.reviewNote = note;
  sub.auditTrail.push({ at: Date.now(), action: 'evidence-requested', note, actor: ctx.user.username });
  audit({ action: 'request-evidence', actor: ctx.user.username, submissionId: sub.id, note });
  const owner = getUser(sub.userId);
  if (owner) pushTo(owner.id, 'notice', { kind: 'evidence', text: 'A moderator requested additional proof for your entry.', submissionId: sub.id });
  save();
  return { ok: true };
});

route('POST', '/api/mod/submissions/:id/dismiss', async (ctx) => {
  if (!isMod(ctx.user)) throw bad('Moderator access required.', 403);
  const sub = getSubmission(ctx.params.id);
  if (!sub) throw bad('Submission not found', 404);
  sub.reviewStatus = 'clear';
  sub.reviewNote = null;
  db.reports.filter((r) => r.submissionId === sub.id && r.status === 'open').forEach((r) => { r.status = 'dismissed'; r.resolvedAt = Date.now(); r.resolvedBy = ctx.user.username; });
  audit({ action: 'report-dismissed', actor: ctx.user.username, submissionId: sub.id, note: 'Evidence reviewed — entry cleared' });
  save();
  return { ok: true };
});

route('POST', '/api/mod/votes/:id/invalidate', async (ctx) => {
  if (!isMod(ctx.user)) throw bad('Moderator access required.', 403);
  const vote = db.votes.find((v) => v.id === ctx.params.id);
  if (!vote) throw bad('Vote not found', 404);
  vote.invalidated = true;
  vote.invalidatedBy = ctx.user.username;
  vote.invalidatedAt = Date.now();
  vote.invalidateReason = String(ctx.body.reason || 'Invalid vote').slice(0, 200);
  audit({ action: 'vote-invalidated', actor: ctx.user.username, submissionId: vote.submissionId, note: vote.invalidateReason });
  save();
  return { ok: true };
});

/* SSE */
route('GET', '/api/events', async (ctx) => {
  if (!ctx.user) throw bad('Sign in for live updates', 401);
  return { __sse: true };
});

/* ------------------------------------------------------------------ static */
const MIME_STATIC = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME_STATIC[ext] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache' };
    if (ext === '.mp4' || ext === '.webm') {
      // range support so video previews can seek
      const range = req.headers.range;
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        const start = m && m[1] ? parseInt(m[1], 10) : 0;
        const end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
        res.writeHead(206, {
          ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
        return;
      }
    }
    headers['Content-Length'] = stat.size;
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
}

/* ------------------------------------------------------------------- server */
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, 'http://localhost');
  const pathname = parsedUrl.pathname;

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': req.headers.origin || '*',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,X-File-Name',
    });
    return res.end();
  }

  if (pathname.startsWith('/api/')) {
    const ctx = {
      req, res, ip: (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0],
      params: {}, query: Object.fromEntries(parsedUrl.searchParams),
      body: {}, user: null,
      setSession(t) {
        res.setHeader('Set-Cookie', `${auth.SESSION_COOKIE}=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`);
      },
      clearSession() {
        res.setHeader('Set-Cookie', `${auth.SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
      },
    };
    ctx.user = auth.userFromRequest(req);
    try {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(pathname);
        if (!m) continue;
        r.keys.forEach((k, i) => { ctx.params[k] = decodeURIComponent(m[i + 1]); });
        if (req.method !== 'GET' && req.method !== 'DELETE') {
          if (!String(req.headers['content-type'] || '').includes('application/octet-stream')) {
            ctx.body = await readBody(req, 256 * 1024);
          }
        }
        const result = await r.handler(ctx);
        if (result && result.__sse) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
            Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
          });
          res.write(': connected\n\n');
          const set = streams.get(ctx.user.id) || new Set();
          set.add(res);
          streams.set(ctx.user.id, set);
          const keepAlive = setInterval(() => sseSend(res, 'ping', { t: Date.now() }), 20000);
          req.on('close', () => {
            clearInterval(keepAlive);
            set.delete(res);
            if (!set.size) streams.delete(ctx.user.id);
          });
          return;
        }
        if (result && result.__file) {
          const { __file, mime } = result;
          if (!fs.existsSync(__file)) return sendJson(res, 410, { error: 'File missing from storage' });
          const stat = fs.statSync(__file);
          const range = req.headers.range;
          const type = mime || 'application/octet-stream';
          if (range && stat.size > 2_000_000) {
            const mm = /bytes=(\d*)-(\d*)/.exec(range);
            const start = mm && mm[1] ? parseInt(mm[1], 10) : 0;
            const end = mm && mm[2] ? parseInt(mm[2], 10) : stat.size - 1;
            res.writeHead(206, {
              'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${stat.size}`,
              'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Cache-Control': 'private, max-age=60',
            });
            return fs.createReadStream(__file, { start, end }).pipe(res);
          }
          res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Cache-Control': 'private, max-age=60' });
          return fs.createReadStream(__file).pipe(res);
        }
        return sendJson(res, 200, result === undefined ? { ok: true } : result);
      }
      return sendJson(res, 404, { error: 'Endpoint not found' });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[api]', req.method, pathname, err);
      return sendJson(res, status, { error: err.message || 'Server error', ...(err.extra || {}) });
    }
  }

  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, pathname);
  res.writeHead(405).end('Method not allowed');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  BLEND BATTLES — Create. Render. Compete.`);
  console.log(`  Server:  http://0.0.0.0:${PORT}`);
  console.log(`  Mode:    ${DEMO_MODE ? 'DEMO (local JSON store, simulated bots)' : 'CLOUD configured'}`);
  console.log(`  Data:    ${path.join(__dirname, 'data')}`);
  console.log(`  Accounts: NovaKite / modvex — password "blendbattles"\n`);
});

process.on('SIGINT', () => { saveNow(); process.exit(0); });
process.on('SIGTERM', () => { saveNow(); process.exit(0); });
