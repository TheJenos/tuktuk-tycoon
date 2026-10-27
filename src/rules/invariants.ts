import { getBoard, groupOf, isProperty, isStreet, siblings } from './board';
import { activeSeats, phaseChain, prop } from './ctx';
import { powerSource } from './heroes';
import { cleanOwed, owedTotal } from './money';
import { isWindow, liveOpen } from './react';
import type { GameState, SeatId } from './types';

/** Things that must hold between commands. Returns what is broken (empty = all good). */
export function checkInvariants(s: GameState): string[] {
  const out: string[] = [];
  const b = getBoard(s.cfg.board);
  const bad = (msg: string): void => {
    out.push(msg);
  };

  jsonSafe(s, 'state', bad);

  // Players
  for (const seat of s.order) {
    const p = s.players[seat];
    if (!p) {
      bad(`order has unknown seat ${seat}`);
      continue;
    }
    if (!Number.isInteger(p.cash) || p.cash < 0) bad(`${seat} cash ${p.cash}`);
    if (!Number.isInteger(p.pos) || p.pos < 0 || p.pos >= b.spaces.length) bad(`${seat} pos ${p.pos}`);
    if (p.jail && (p.pos !== b.jailIndex || p.jail.tries < 0 || p.jail.tries > 2)) {
      bad(`${seat} jail ${JSON.stringify(p.jail)}`);
    }
    if (p.out && (p.cash !== 0 || p.goojf.length > 0 || p.jail)) bad(`${seat} is out but still holds assets`);
    if (p.speed && !s.cfg.speedDie) bad(`${seat} has the speed die with the rule off`);
    if (!Number.isInteger(p.laps) || p.laps < 0) bad(`${seat} laps ${p.laps}`);
    // Hero League: a hero exactly on a heroes board; a used superpower only with a hero
    if (b.heroes ? !b.heroes.list.some((h) => h.id === p.hero) : p.hero !== undefined) bad(`${seat} hero ${p.hero}`);
    if (p.powerUsed !== undefined && (p.hero === undefined || !Number.isInteger(p.powerUsed) || p.powerUsed < 1)) {
      bad(`${seat} powerUsed ${p.powerUsed}`);
    }
  }
  if (Object.keys(s.players).length !== s.order.length) bad('players and order differ');
  const heroes = s.order.map((seat) => s.players[seat]?.hero).filter((h) => h !== undefined);
  if (new Set(heroes).size !== heroes.length) bad('two seats play the same hero');

  // Property
  let houses = 0;
  let hotels = 0;
  for (const [key, ps] of Object.entries(s.props)) {
    const space = Number(key.slice(1));
    if (!/^p\d+$/.test(key) || !isProperty(b.spaces[space]) || !ps) {
      bad(`bad prop key ${key}`);
      continue;
    }
    const owner = s.players[ps.owner];
    if (!owner || owner.out) bad(`${key} owned by ${ps.owner}`);
    if (ps.level > 0) {
      const g = groupOf(b, space);
      if (!isStreet(b.spaces[space]) || !g) bad(`${key} has buildings but is not a street`);
      else if (!g.spaces.every((x) => prop(s, x)?.owner === ps.owner)) bad(`${key} built without the whole group`);
      if (ps.level === 5) hotels++;
      else houses += ps.level;
    }
    if (ps.mortgaged && siblings(b, space).some((x) => (prop(s, x)?.level ?? 0) > 0)) {
      bad(`${key} mortgaged while its group has buildings`);
    }
    if (ps.level > 0 && siblings(b, space).some((x) => prop(s, x)?.mortgaged)) {
      bad(`${key} built with a mortgaged sibling`);
    }
  }
  for (const g of b.groups) {
    const levels = g.spaces.map((x) => prop(s, x)?.level ?? 0);
    if (Math.max(...levels) - Math.min(...levels) > 1) bad(`${g.id} uneven ${levels.join(',')}`);
  }
  if (s.bank.houses < 0 || s.bank.hotels < 0) bad(`bank ${JSON.stringify(s.bank)}`);
  if (s.bank.houses + houses !== s.cfg.houses) bad(`houses ${s.bank.houses}+${houses} != ${s.cfg.houses}`);
  if (s.bank.hotels + hotels !== s.cfg.hotels) bad(`hotels ${s.bank.hotels}+${hotels} != ${s.cfg.hotels}`);

  // Cards: every card is in its deck or held, exactly once
  for (const deck of ['chance', 'chest'] as const) {
    const held = s.order
      .flatMap((seat) => s.players[seat]?.goojf ?? [])
      .filter((id) => b[deck].some((c) => c.id === id));
    const all = [...s.decks[deck], ...held].sort();
    const want = b[deck].map((c) => c.id).sort();
    if (JSON.stringify(all) !== JSON.stringify(want)) bad(`${deck} cards not conserved`);
  }

  // Turn and phase
  const active = activeSeats(s);
  const over = s.phase.k === 'over';
  if (!over) {
    if (active.length < 2) bad('fewer than 2 players but not over');
    // A turn seat that just went out keeps the turn until its property is auctioned and nextTurn runs.
    if (!active.includes(s.turn.seat) && !s.pending.some((st) => st.k === 'nextTurn')) {
      bad(`turn seat ${s.turn.seat} is not active`);
    }
    if (s.turn.doubles > 3) bad(`doubles ${s.turn.doubles}`);
  } else if (s.pending.length) bad('pending steps after the game is over');
  if (s.turn.roll?.s !== undefined && !(s.cfg.speedDie && s.players[s.turn.seat]?.speed)) {
    bad('speed face without the speed die');
  }

  const chain = phaseChain(s.phase);
  if (s.phase.k === 'busy') bad('resting in busy');
  const bottom = chain[chain.length - 1];
  // Steps wait under busy, or under the buy / Income Tax choice that resumes them; never at the start or end of a turn.
  if (s.pending.length && (bottom?.k === 'preRoll' || bottom?.k === 'postRoll')) bad(`pending steps in ${bottom.k}`);
  if (bottom && 'resume' in bottom) bad('phase chain has no base');
  const isIn = (seat: SeatId): boolean => active.includes(seat);
  const ph = s.phase;
  if (ph.k === 'auction') {
    if (ph.high && (!isIn(ph.high.seat) || !ph.eligible.includes(ph.high.seat))) {
      bad('high bidder is not in the auction');
    }
    if (ph.lot.k === 'prop' && prop(s, ph.lot.space)) bad('auctioning an owned property');
  }
  if (ph.k === 'debt') {
    if (!isIn(ph.debtor)) bad('debtor is out');
    if ((s.players[ph.debtor]?.cash ?? 0) >= owedTotal(cleanOwed(s, ph.debtor, ph.owed))) bad('debt could be settled');
  }
  if ((ph.k === 'place' || ph.k === 'mortgageXfer') && !isIn(ph.seat)) bad(`${ph.k} for an out seat`);
  if (ph.k === 'buy' && prop(s, ph.space)) bad('buy phase for an owned property');
  // Hero League's windows: only there, always over busy, never resting without someone to answer
  for (const p of chain) {
    if (!b.heroes && isWindow(p)) bad(`${p.k} off a heroes board`);
    if (b.heroes && p.k === 'debt') bad('a debt on a heroes board');
    if (isWindow(p) && p.resume.k !== 'busy') bad(`${p.k} not over busy`);
  }
  if (ph.k === 'react' && !ph.open.some(isIn)) bad('a reaction window with nobody to answer');
  if (ph.k === 'react' && b.heroes && liveOpen(b, s, ph).length !== ph.open.length) {
    bad('a reaction window open to a seat that can no longer answer it');
  }
  if ((ph.k === 'aim' || ph.k === 'boost') && !isIn(ph.seat)) bad(`${ph.k} for an out seat`);
  if (b.heroes && ph.k === 'boost' && !powerSource(b, s, ph.seat, 'sting')) bad('a boost without Viper Strike');
  if (b.heroes && ph.k === 'aim' && !ph.cards && !powerSource(b, s, ph.seat, 'aim')) bad('an aim without Dead Aim');
  if (b.heroes && ph.k === 'preRoll' && s.players[s.turn.seat]?.jail) bad('a jailed seat about to roll on a heroes board');

  // Trades
  const proposers = new Set<string>();
  for (const t of Object.values(s.trades)) {
    if (!isIn(t.from) || !isIn(t.to)) bad(`trade ${t.id} with an out seat`);
    if (proposers.has(t.from)) bad(`${t.from} has two open offers`);
    proposers.add(t.from);
  }
  if (!Number.isInteger(s.pot) || s.pot < 0) bad(`pot ${s.pot}`);
  if (s.pot > 0 && !s.cfg.jackpot) bad('a jackpot pot with the rule off');
  if (s.rig.length && !s.cfg.debug) bad('rigged dice without debug');
  if (s.rigHero !== undefined) {
    if (!s.cfg.debug) bad('a rigged Hero die without debug');
    if (s.rigHero.length === 0 || !s.rigHero.every((f) => Number.isInteger(f) && f >= 1 && f <= 6)) bad('bad rigHero');
  }
  if (!Number.isInteger(s.rng) || s.rng < 0 || s.rng > 0xffffffff) bad(`rng ${s.rng}`);
  return out;
}

/** No undefined, null, NaN, Infinity or non-plain values anywhere (the state must survive JSON unchanged) */
function jsonSafe(v: unknown, path: string, bad: (msg: string) => void): void {
  if (v === null || v === undefined) bad(`${path} is ${v}`);
  else if (typeof v === 'number') {
    if (!Number.isFinite(v)) bad(`${path} is ${v}`);
  } else if (Array.isArray(v)) v.forEach((x, i) => jsonSafe(x, `${path}[${i}]`, bad));
  else if (typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) jsonSafe(x, `${path}.${k}`, bad);
  } else if (typeof v !== 'string' && typeof v !== 'boolean') bad(`${path} is a ${typeof v}`);
}
