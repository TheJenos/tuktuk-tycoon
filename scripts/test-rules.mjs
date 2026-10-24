/*
 * Checks database.rules.json against the Realtime Database emulator: loads the rules into a namespace of its own,
 * then makes writes the game makes (which must be allowed) and writes a broken or cheating client would try (which
 * must be refused). Run inside the emulator (needs Java):
 *
 *   npm run test:rules
 *
 * No dependencies: it talks to the emulator's REST API. The cases run in order; later ones build on earlier ones.
 */

import { readFile } from 'node:fs/promises';

const HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST ?? '127.0.0.1:9000';
const NS = 'rules-test';
const base = `http://${HOST}`;

const rules = await readFile(new URL('../database.rules.json', import.meta.url), 'utf8');
JSON.parse(rules); // fail early on broken JSON

async function admin(method, path, body) {
  const res = await fetch(`${base}/${path}?ns=${NS}`, {
    method,
    headers: { Authorization: 'Bearer owner' },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
}

/** An unauthenticated client write, like the game's. True if the rules allowed it. */
async function write(path, value) {
  const res = await fetch(`${base}/${path}.json?ns=${NS}`, { method: 'PUT', body: JSON.stringify(value) });
  return res.ok;
}

await admin('PUT', '.settings/rules.json', rules);
await admin('DELETE', '.json');

const now = Date.now();
const pid = 'p_TESTER000001';
const lobby = {
  name: 'Room', host: 'Tester', hostId: pid, createdAt: now, status: 'waiting', v: 1, speedDie: false, board: 'lanka',
  maxSeats: 4, seatsTaken: 1, public: true, spectators: true, lateJoin: false, members: { [pid]: 'Tester' },
};
const roomRules = {
  board: 'lanka', speedDie: false, startCash: 1500, luxuryTax: 75, triplesRollAgain: true, turnLimit: 0,
  goSalary: 200, incomeFlat: 200, incomePct: 10, jailFine: 50, mortgagePct: 10, houses: 32, hotels: 12,
  doubleGoLanding: false, jackpot: false, incomeTaxMode: 'choice', auctions: true, buyAfterFirstLap: false,
  jailRent: true, threeDoublesJail: true, dealProperties: 0, endMode: 'lastStanding', trading: 'on', tradeAfterLap: 1,
  turnTimer: 60, decisionTimer: 45, auctionTimer: 8, debtTimer: 120,
  afkStrikes: 2, botPace: 1, botSkill: 'normal', spectators: true, lateJoin: false, timeLimit: 0,
};
const human = { seat: 's0', name: 'Tester', token: 'tuktuk', color: '#e8a33d', kind: 'human', ctrl: pid };
const bot = { seat: 's1', name: 'Ava', token: 'elephant', color: '#3d8fe8', kind: 'bot', ctrl: '', skill: 'expert' };
const state = (over = {}) => ({ gid: 'g_GAME000001', seq: 0, v: 1, at: now, data: '{"game":{}}', ...over });
const presence = { name: 'Tester', seat: 's0', vis: true, at: now };

// An e2e room seeded by admin, with debug rules
await admin('PUT', 'rooms/SEED1/setup.json', { rules: { speedDie: false, turnTimer: 0, debug: true }, locked: '' });

/** [description, path, value, should it be allowed?] */
const cases = [
  // lobby/{code}
  ['lobby: a new room', 'lobby/ROOM1', lobby, true],
  ['lobby: lowercase room code', 'lobby/room1', lobby, false],
  ['lobby: room code too long', 'lobby/ABCDEFGHJ', lobby, false],
  ['lobby: Discord room code', 'lobby/DABCDEFG', lobby, true],
  ['lobby: unknown status', 'lobby/ROOM1/status', 'paused', false],
  ['lobby: 9 seats', 'lobby/ROOM1/maxSeats', 9, false],
  ['lobby: a field it does not have', 'lobby/ROOM1/admin', true, false],
  ['lobby: version not a number', 'lobby/ROOM1/v', '1', false],
  ['lobby: a Discord member', 'lobby/ROOM1/members/d_123456789012345678', 'Discord Dan', true],
  ['lobby: a bad player id', 'lobby/ROOM1/members/hacker', 'H', false],
  ['lobby: a 17-character name', 'lobby/ROOM1/members/p_TESTER000002', 'A'.repeat(17), false],
  ['lobby: a record with only members', 'lobby/ROOM2', { members: { [pid]: 'Tester' } }, false],
  ['lobby: a member of a deleted room', 'lobby/ROOM9/members/p_TESTER000001', 'Tester', false],
  ['lobby: the heir takes over', 'lobby/ROOM1/hostId', 'p_TESTER000002', true],
  ['lobby: created in the future', 'lobby/ROOM1/createdAt', now + 60_000, false],
  ['lobby: spectators off', 'lobby/ROOM1/spectators', false, true],
  ['lobby: spectators not a boolean', 'lobby/ROOM1/spectators', 'no', false],
  ['lobby: late join on', 'lobby/ROOM1/lateJoin', true, true],
  ['lobby: late join not a boolean', 'lobby/ROOM1/lateJoin', 1, false],
  ['lobby: the Colombo board', 'lobby/ROOM1/board', 'colombo', true],
  ['lobby: the Down South board', 'lobby/ROOM1/board', 'south', true],
  ['lobby: an unknown board', 'lobby/ROOM1/board', 'mars', false],
  ['lobby: a board id that is not a string', 'lobby/ROOM1/board', 1, false],

  // rooms/{code}/setup
  ['setup: the waiting room', 'rooms/ROOM1/setup', { rules: roomRules, seats: { s0: human }, locked: '' }, true],
  ['setup: debug from a client', 'rooms/ROOM1/setup/rules/debug', true, false],
  ['setup: unknown luxury tax', 'rooms/ROOM1/setup/rules/luxuryTax', 50, false],
  ['setup: a rule that does not exist', 'rooms/ROOM1/setup/rules/rentMode', 'claim', false],
  ['setup: auction timer too short', 'rooms/ROOM1/setup/rules/auctionTimer', 1, false],
  ['setup: the Hill Country board', 'rooms/ROOM1/setup/rules/board', 'hill', true],
  ['setup: the Colombo board', 'rooms/ROOM1/setup/rules/board', 'colombo', true],
  ['setup: the Down South board', 'rooms/ROOM1/setup/rules/board', 'south', true],
  ['setup: back to the All Island board', 'rooms/ROOM1/setup/rules/board', 'lanka', true],
  ['setup: an unknown board', 'rooms/ROOM1/setup/rules/board', 'atlantis', false],
  ['setup: a board id that is not a string', 'rooms/ROOM1/setup/rules/board', true, false],
  ['setup: turn timer off', 'rooms/ROOM1/setup/rules/turnTimer', 0, true],
  ['setup: a Start salary', 'rooms/ROOM1/setup/rules/goSalary', 300, true],
  ['setup: a negative Start salary', 'rooms/ROOM1/setup/rules/goSalary', -1, false],
  ['setup: Inland Revenue flat amount', 'rooms/ROOM1/setup/rules/incomeFlat', 150, true],
  ['setup: Inland Revenue over 100%', 'rooms/ROOM1/setup/rules/incomePct', 101, false],
  ['setup: a jail fine', 'rooms/ROOM1/setup/rules/jailFine', 100, true],
  ['setup: a jail fine as text', 'rooms/ROOM1/setup/rules/jailFine', '100', false],
  ['setup: mortgage interest', 'rooms/ROOM1/setup/rules/mortgagePct', 0, true],
  ['setup: mortgage interest over 100%', 'rooms/ROOM1/setup/rules/mortgagePct', 150, false],
  ['setup: unlimited houses', 'rooms/ROOM1/setup/rules/houses', 200, true],
  ['setup: too many houses', 'rooms/ROOM1/setup/rules/houses', 201, false],
  ['setup: unlimited hotels', 'rooms/ROOM1/setup/rules/hotels', 100, true],
  ['setup: too many hotels', 'rooms/ROOM1/setup/rules/hotels', 101, false],
  ['setup: double salary on Start', 'rooms/ROOM1/setup/rules/doubleGoLanding', true, true],
  ['setup: double salary not a boolean', 'rooms/ROOM1/setup/rules/doubleGoLanding', 'yes', false],
  ['setup: the jackpot', 'rooms/ROOM1/setup/rules/jackpot', true, true],
  ['setup: the jackpot as a number', 'rooms/ROOM1/setup/rules/jackpot', 1, false],
  ['setup: Inland Revenue always flat', 'rooms/ROOM1/setup/rules/incomeTaxMode', 'flat', true],
  ['setup: an unknown Inland Revenue mode', 'rooms/ROOM1/setup/rules/incomeTaxMode', 'none', false],
  ['setup: auctions off', 'rooms/ROOM1/setup/rules/auctions', false, true],
  ['setup: auctions not a boolean', 'rooms/ROOM1/setup/rules/auctions', 'off', false],
  ['setup: buying after the first lap', 'rooms/ROOM1/setup/rules/buyAfterFirstLap', true, true],
  ['setup: first-lap rule not a boolean', 'rooms/ROOM1/setup/rules/buyAfterFirstLap', 0, false],
  ['setup: no rent while jailed', 'rooms/ROOM1/setup/rules/jailRent', false, true],
  ['setup: jail rent as text', 'rooms/ROOM1/setup/rules/jailRent', 'no', false],
  ['setup: no jail for three doubles', 'rooms/ROOM1/setup/rules/threeDoublesJail', false, true],
  ['setup: three doubles not a boolean', 'rooms/ROOM1/setup/rules/threeDoublesJail', 3, false],
  ['setup: a quick-start deal of 3', 'rooms/ROOM1/setup/rules/dealProperties', 3, true],
  ['setup: a quick-start deal of 4', 'rooms/ROOM1/setup/rules/dealProperties', 4, false],
  ['setup: the first bankruptcy ends the game', 'rooms/ROOM1/setup/rules/endMode', 'firstBankrupt', true],
  ['setup: an unknown game end', 'rooms/ROOM1/setup/rules/endMode', 'sudden', false],
  ['setup: trading after a lap', 'rooms/ROOM1/setup/rules/trading', 'afterLap', true],
  ['setup: an unknown trading mode', 'rooms/ROOM1/setup/rules/trading', 'sometimes', false],
  ['setup: trading after lap 3', 'rooms/ROOM1/setup/rules/tradeAfterLap', 3, true],
  ['setup: trading after lap 0', 'rooms/ROOM1/setup/rules/tradeAfterLap', 0, false],
  ['setup: never AFK', 'rooms/ROOM1/setup/rules/afkStrikes', 0, true],
  ['setup: AFK after 11 timeouts', 'rooms/ROOM1/setup/rules/afkStrikes', 11, false],
  ['setup: quick bots', 'rooms/ROOM1/setup/rules/botPace', 0.5, true],
  ['setup: a bot pace that is not offered', 'rooms/ROOM1/setup/rules/botPace', 3, false],
  ['setup: expert bots by default', 'rooms/ROOM1/setup/rules/botSkill', 'expert', true],
  ['setup: an unknown default bot level', 'rooms/ROOM1/setup/rules/botSkill', 'godlike', false],
  ['setup: no spectators', 'rooms/ROOM1/setup/rules/spectators', false, true],
  ['setup: spectators as text', 'rooms/ROOM1/setup/rules/spectators', 'no', false],
  ['setup: late join', 'rooms/ROOM1/setup/rules/lateJoin', true, true],
  ['setup: late join as a number', 'rooms/ROOM1/setup/rules/lateJoin', 1, false],
  ['setup: a 60 minute time limit', 'rooms/ROOM1/setup/rules/timeLimit', 60, true],
  ['setup: a time limit over 10 hours', 'rooms/ROOM1/setup/rules/timeLimit', 601, false],
  ['setup: the full rules again', 'rooms/ROOM1/setup/rules', roomRules, true],
  ['setup: a bot seat', 'rooms/ROOM1/setup/seats/s1', bot, true],
  ['setup: seat s8', 'rooms/ROOM1/setup/seats/s8', { ...human, seat: 's8' }, false],
  ['setup: seat key and seat id differ', 'rooms/ROOM1/setup/seats/s2', human, false],
  ['setup: unknown token', 'rooms/ROOM1/setup/seats/s1/token', 'dragon', false],
  ['setup: unknown bot skill', 'rooms/ROOM1/setup/seats/s1/skill', 'godlike', false],
  ['setup: a 17-character seat name', 'rooms/ROOM1/setup/seats/s1/name', 'B'.repeat(17), false],
  ['setup: a bad controller id', 'rooms/ROOM1/setup/seats/s0/ctrl', 'someone', false],
  ['setup: extra seat field', 'rooms/ROOM1/setup/seats/s1/admin', true, false],
  ['setup: locked to a gid', 'rooms/ROOM1/setup/locked', 'g_GAME000001', true],
  ['setup: locked to junk', 'rooms/ROOM1/setup/locked', 'start!', false],
  ['setup: an edit id', 'rooms/ROOM1/setup/op', 'ABCDEFGH', true],
  ['setup: an edit id that is not one', 'rooms/ROOM1/setup/op', 'x/y', false],
  ['setup: a seeded debug flag written back unchanged', 'rooms/SEED1/setup', { rules: { speedDie: false, turnTimer: 0, debug: true }, seats: { s0: human }, locked: '' }, true],
  ['setup: a seeded debug flag turned off', 'rooms/SEED1/setup/rules/debug', false, false],

  // rooms/{code}/state
  ['state: a new game at seq 0 while waiting', 'rooms/ROOM1/state', state(), true],
  ['state: the next seq', 'rooms/ROOM1/state', state({ seq: 1, at: now + 1 }), true],
  ['state: the same seq (a seat handover)', 'rooms/ROOM1/state', state({ seq: 1, at: now + 2 }), true],
  ['state: seq +2', 'rooms/ROOM1/state', state({ seq: 3, at: now + 3 }), false],
  ['state: seq going back', 'rooms/ROOM1/state', state({ seq: 0, at: now + 3 }), false],
  ['state: at going back', 'rooms/ROOM1/state', state({ seq: 2, at: now }), false],
  ['state: at in the future', 'rooms/ROOM1/state', state({ seq: 2, at: now + 60_000 }), false],
  ['state: data not a string', 'rooms/ROOM1/state', state({ seq: 2, at: now + 3, data: { game: {} } }), false],
  ['state: data over 64 KB', 'rooms/ROOM1/state', state({ seq: 2, at: now + 3, data: 'x'.repeat(65_537) }), false],
  ['state: an extra field', 'rooms/ROOM1/state', { ...state({ seq: 2, at: now + 3 }), extra: 1 }, false],
  ['state: a missing field', 'rooms/ROOM1/state', { gid: 'g_GAME000001', seq: 2, at: now + 3, data: '{}' }, false],
  ['lobby: the game starts', 'lobby/ROOM1/status', 'playing', true],
  ['state: a new gid while playing', 'rooms/ROOM1/state', state({ gid: 'g_GAME000002', at: now + 4 }), false],
  ['lobby: back to waiting for a rematch', 'lobby/ROOM1/status', 'waiting', true],
  ['state: a new gid not at seq 0', 'rooms/ROOM1/state', state({ gid: 'g_GAME000003', seq: 5, at: now + 4 }), false],
  ['state: a rematch at seq 0 while waiting', 'rooms/ROOM1/state', state({ gid: 'g_GAME000003', at: now + 4 }), true],
  ['state: a gid that is not one', 'rooms/ROOM1/state', state({ gid: 'game 4', at: now + 5 }), false],

  // rooms/{code}/log, driver, presence, kicked
  ['log: the first move', 'rooms/ROOM1/log/g_GAME000001/m000001', { env: '{"id":"ABCDEFGH"}', h: '1a2b3c4d' }, true],
  ['log: overwriting a move', 'rooms/ROOM1/log/g_GAME000001/m000001', { env: '{"id":"ZZZZZZZZ"}', h: '00000000' }, false],
  ['log: the same move number in a rematch', 'rooms/ROOM1/log/g_GAME000003/m000001', { env: '{"id":"ABCDEFGH"}', h: '1a2b3c4d' }, true],
  ['log: a key outside a game', 'rooms/ROOM1/log/m000002', { env: '{}', h: '0' }, false],
  ['log: a game id that is not one', 'rooms/ROOM1/log/game1/m000002', { env: '{}', h: '0' }, false],
  ['log: a numeric key', 'rooms/ROOM1/log/g_GAME000001/1', { env: '{}', h: '0' }, false],
  ['log: a key with 7 digits', 'rooms/ROOM1/log/g_GAME000001/m0000002', { env: '{}', h: '0' }, false],
  ['log: no hash', 'rooms/ROOM1/log/g_GAME000001/m000002', { env: '{}' }, false],
  ['driver: take the lease', 'rooms/ROOM1/driver', { pid, until: now + 6_000 }, true],
  ['driver: a lease for a minute', 'rooms/ROOM1/driver', { pid, until: now + 60_000 }, false],
  ['driver: a bad player id', 'rooms/ROOM1/driver', { pid: 'x', until: now }, false],
  ['driver: release', 'rooms/ROOM1/driver', null, true],
  ['presence: register', `rooms/ROOM1/presence/${pid}`, presence, true],
  ['presence: an unknown seat', `rooms/ROOM1/presence/${pid}/seat`, 's9', false],
  ['presence: a bad player id', 'rooms/ROOM1/presence/admin', presence, false],
  ['presence: missing a field', 'rooms/ROOM1/presence/p_TESTER000003', { name: 'X', seat: '' }, false],
  ['kicked: a player', 'rooms/ROOM1/kicked/p_TESTER000002', true, true],
  ['kicked: not a boolean', 'rooms/ROOM1/kicked/p_TESTER000002', 'yes', false],

  // Everything else
  ['rooms: a child it does not have', 'rooms/ROOM1/events/x', { t: 1 }, false],
  ['rooms: lowercase room code', 'rooms/lower/kicked/p_TESTER000002', true, false],
  ['rooms: delete a room', 'rooms/ROOM1', null, true],
  ['lobby: delete a room', 'lobby/ROOM1', null, true],
  ['unknown top-level path', 'admin/flag', true, false],
];

let failed = 0;
for (const [name, path, value, allowed] of cases) {
  const ok = (await write(path, value)) === allowed;
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${name} (${allowed ? 'allowed' : 'refused'} expected)`);
}

await admin('DELETE', '.json');
if (failed) {
  console.error(`\n${failed} of ${cases.length} rule checks failed`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} rule checks passed`);
