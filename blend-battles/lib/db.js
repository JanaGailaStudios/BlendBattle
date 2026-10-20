'use strict';
const fs = require('fs');
const path = require('path');
const { id, hashPassword, rankFor, levelFor, prng } = require('./util');
const { makeProofSVG, makeRenderSVG } = require('./render');

const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const EMPTY = {
  meta: { version: 1, seeded: false, createdAt: Date.now() },
  users: [], sessions: {}, lobbies: [], matches: [], submissions: [], votes: [],
  reports: [], audit: [], activity: [],
};

let db = JSON.parse(JSON.stringify(EMPTY));
if (fs.existsSync(DB_FILE)) {
  try {
    db = Object.assign(JSON.parse(JSON.stringify(EMPTY)), JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
  } catch (e) {
    console.error('[db] could not parse db.json, starting fresh:', e.message);
  }
}

let saveTimer = null;
let dirty = false;
function save() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!dirty) return;
    dirty = false;
    fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(db, null, 1));
    fs.renameSync(DB_FILE + '.tmp', DB_FILE);
  }, 120);
}
function saveNow() {
  fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(db, null, 1));
  fs.renameSync(DB_FILE + '.tmp', DB_FILE);
}

function audit(entry) {
  db.audit.unshift(Object.assign({ id: id('aud'), at: Date.now() }, entry));
  if (db.audit.length > 800) db.audit.length = 800;
  save();
}
function activity(entry) {
  db.activity.unshift(Object.assign({ id: id('act'), at: Date.now() }, entry));
  if (db.activity.length > 120) db.activity.length = 120;
  save();
}
function writeUploadFile(name, contents) {
  const file = path.join(UPLOAD_DIR, name);
  fs.writeFileSync(file, contents);
  return file;
}

/* ------------------------------------------------------------------ seeding */
const SEED_PLAYERS = [
  ['NovaKite', 14210, 'EU', 'Riga, LV', true],
  ['polyPunk', 11890, 'EU', 'Berlin, DE', false],
  ['vertexVixen', 9640, 'NA', 'Austin, US', false],
  ['modvex', 8300, 'EU', 'Tallinn, EE', false],
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
  {
    theme: 'Cute Robot', daysAgo: 1,
    entries: [
      { user: 'NovaKite', art: 'cute-robot-a.jpg', scores: [5, 5, 4, 5], title: 'Bolt-9 Service Unit' },
      { user: 'vertexVixen', art: 'cute-robot-b.jpg', scores: [5, 4, 4, 3], title: 'Mochi Maintenance Bot' },
      { user: 'SuzanneStan', art: 'cute-robot-c.jpg', scores: [3, 4, 3, 4], title: 'Rusty Helper' },
    ],
  },
  {
    theme: 'Cyberpunk Car', daysAgo: 3,
    entries: [
      { user: 'polyPunk', art: 'cyberpunk-car-a.jpg', scores: [5, 5, 5, 4], title: 'Kitsune GT' },
      { user: 'GreyscaleGoblin', art: 'cyberpunk-car-b.jpg', scores: [4, 5, 4, 4], title: 'Nightshift Hover' },
      { user: 'claymoreKid', art: 'cyberpunk-car-c.jpg', scores: [3, 3, 4, 5], title: 'Chrome Drift' },
    ],
  },
  {
    theme: 'Fantasy Sword', daysAgo: 6,
    entries: [
      { user: 'subdivSam', art: 'fantasy-sword-a.jpg', scores: [5, 4, 5, 4], title: 'Oath of Embers' },
      { user: 'modvex', art: 'fantasy-sword-b.jpg', scores: [4, 4, 5, 4], title: 'Tidebiter' },
      { user: 'NurbsNerd', art: 'fantasy-sword-c.jpg', scores: [3, 4, 4, 4], title: 'Hollow Bloom' },
    ],
  },
];

function seedDemoData() {
  const rand = prng('blend-battles-seed-v1');
  const users = [];
  const password = hashPassword('blendbattles');
  SEED_PLAYERS.forEach(([name, xp, region, location, isMod], i) => {
    const u = {
      id: id('usr'),
      username: name,
      email: `${name.toLowerCase()}@blendbattles.demo`,
      rank: rankFor(xp),
      xp,
      level: levelFor(xp),
      region,
      location,
      isMod: !!isMod,
      isGuest: false,
      isDemo: true,
      avatarHue: Math.floor(rand() * 360),
      bio: isMod ? 'Community moderator. Reviews proof, kills invalid votes, keeps the ladder honest.' : 'Blender artist. Renders in Cycles, models in Edit Mode.',
      badges: [],
      stats: {
        wins: Math.max(0, Math.round(xp / 900) + (i % 3)),
        matches: Math.max(1, Math.round(xp / 420) + (i % 5)),
        podiums: Math.max(0, Math.round(xp / 700)),
        votes: Math.round(xp / 30),
        avgScore: +(3.2 + rand() * 1.6).toFixed(1),
      },
      friends: [],
      blocked: [],
      privacy: { showHistory: true, friendsOnlyLeaderboard: false },
      settings: { sfx: true, reducedMotion: false },
      createdAt: Date.now() - (200 - i * 9) * 86400000,
      lastSeen: Date.now() - Math.floor(rand() * 1000 * 60 * 12),
      pass: password.hash,
      salt: password.salt,
    };
    users.push(u);
  });
  // make a couple of friendships
  users[0].friends = [users[1].id, users[2].id, users[3].id];
  users[1].friends = [users[0].id];
  users[2].friends = [users[0].id];
  db.users.push(...users);

  const byName = (n) => users.find((u) => u.username === n);

  SEED_MATCHES.forEach((m, mi) => {
    const created = Date.now() - m.daysAgo * 86400000;
    const match = {
      id: id('mat'),
      code: 'SEED' + (mi + 1),
      mode: 'build',
      modeName: 'Build Battle',
      theme: m.theme,
      difficulty: 'medium',
      practice: false,
      phase: 'results',
      createdAt: created,
      startedAt: created,
      phaseEndsAt: created + 345000,
      endedAt: created + 400000,
      seed: true,
      players: m.entries.map((e) => {
        const u = byName(e.user);
        return { userId: u.id, name: u.username, isBot: false, demo: true, submitted: true, connected: false, joinedAt: created };
      }),
      settings: { buildSeconds: 300, votingSeconds: 45, maxPlayers: 12 },
      results: null,
      abandoned: false,
    };
    const subs = [];
    m.entries.forEach((e, ei) => {
      const u = byName(e.user);
      const subId = id('sub');
      const proofName = `seed-proof-${subId}.svg`;
      writeUploadFile(proofName, makeProofSVG(m.theme, subId, u.username));
      const avg = e.scores.reduce((a, b) => a + b, 0) / e.scores.length;
      const sub = {
        id: subId,
        matchId: match.id,
        userId: u.id,
        username: u.username,
        title: e.title,
        status: 'submitted',
        reviewStatus: 'clear',
        createdAt: created + 60000 + ei * 20000,
        submittedAt: created + 240000 + ei * 12000,
        files: {
          render: {
            name: e.art,
            mime: e.art.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg',
            size: 0,
            url: '/img/featured/' + e.art,
            uploadedAt: created + 240000 + ei * 12000,
          },
          proof: {
            name: `${u.username}_viewport_proof.png`,
            mime: 'image/svg+xml',
            size: 0,
            path: proofName,
            uploadedAt: created + 240000 + ei * 12000,
          },
        },
        avgScore: +avg.toFixed(2),
        voteCount: e.scores.length,
        disqualified: false,
        auditTrail: [
          { at: created + 60000 + ei * 20000, action: 'created', note: 'Entry draft opened' },
          { at: created + 240000 + ei * 12000, action: 'submitted', note: 'Final render + viewport proof received' },
        ],
      };
      db.submissions.push(sub);
      subs.push(sub);
    });
    // seeded votes (each seeded player votes on every other entry)
    subs.forEach((sub, si) => {
      const entry = m.entries[si];
      // distribute the recorded scores to distinct fictional voters
      entry.scores.forEach((score, k) => {
        const voter = users[(si + k + 1) % users.length];
        if (voter.id === sub.userId) return;
        db.votes.push({
          id: id('vote'), matchId: match.id, submissionId: sub.id, voterId: voter.id,
          voterName: voter.username, score, createdAt: created + 300000 + k * 3000, invalidated: false,
        });
      });
    });
    const ranked = [...subs].sort((a, b) => b.avgScore - a.avgScore);
    match.results = {
      computedAt: created + 400000,
      podium: ranked.slice(0, 3).map((s, i) => ({
        place: i + 1, submissionId: s.id, userId: s.userId, username: s.username,
        avgScore: s.avgScore, voteCount: s.voteCount, xpAwarded: [250, 160, 100][i] || 40,
        renderUrl: s.files.render.url,
      })),
      entries: ranked.map((s, i) => ({
        place: i + 1, submissionId: s.id, userId: s.userId, username: s.username,
        avgScore: s.avgScore, voteCount: s.voteCount, disqualified: false,
        renderUrl: s.files.render.url, title: s.title,
      })),
    };
    db.matches.push(match);
  });

  db.users.forEach((u) => {
    if (u.stats.wins >= 1) u.badges.push('first-blood');
    if (u.stats.matches >= 5) u.badges.push('regular');
    if (u.stats.wins >= 5) u.badges.push('podium-hunter');
    if (u.xp >= 8000) u.badges.push('legend-track');
    if (u.isMod) u.badges.push('moderator');
    u.badges = [...new Set(u.badges)];
  });

  db.meta.seeded = true;
  activity({ type: 'seed', text: 'Demo ladder seeded with past matches and gallery entries.' });
  saveNow();
}

if (!db.meta.seeded) seedDemoData();

module.exports = { db, save, saveNow, audit, activity, UPLOAD_DIR, DATA_DIR, DB_FILE, makeProofSVG, makeRenderSVG };
