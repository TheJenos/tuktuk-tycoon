import type { GameEvent, GameState, PlayerState, PropState, SeatId } from '../rules';

/*
 * The displayed state after one event: the event's post-change values (cash after, position, owner, level, ...)
 * written into a copy of the state. Copy-on-write: whatever the event doesn't touch keeps its identity, so a
 * selector on an untouched player or property doesn't re-render. Only what the view draws is patched; phases,
 * decks and offers come from the batch's state, which replaces this at the end of every batch.
 */

type Players = GameState['players'];

function patchPlayer(game: GameState, seat: SeatId, fn: (p: PlayerState) => PlayerState): GameState {
  const p = game.players[seat];
  if (!p) return game;
  const next = fn(p);
  return next === p ? game : { ...game, players: { ...game.players, [seat]: next } };
}

function withoutJail(p: PlayerState): PlayerState {
  if (!p.jail) return p;
  const { jail: _jail, ...rest } = p;
  return rest;
}

const dropCard = (p: PlayerState, id: string): PlayerState =>
  p.goojf.includes(id) ? { ...p, goojf: p.goojf.filter((c) => c !== id) } : p;

function patchProp(game: GameState, space: number, fn: (p: PropState | undefined) => PropState | undefined): GameState {
  const key = `p${space}`;
  const prev = game.props[key];
  const next = fn(prev);
  if (next === prev) return game;
  const props = { ...game.props };
  if (next) props[key] = next;
  else delete props[key];
  return { ...game, props };
}

export function reduceView(game: GameState, ev: GameEvent): GameState {
  switch (ev.t) {
    case 'cash': {
      let players: Players = game.players;
      for (const [seat, cash] of Object.entries(ev.after) as [SeatId, number][]) {
        const p = players[seat];
        if (p && p.cash !== cash) players = { ...players, [seat]: { ...p, cash } };
      }
      return players === game.players ? game : { ...game, players };
    }
    case 'move':
      return patchPlayer(game, ev.seat, (p) => (p.pos === ev.to ? p : { ...p, pos: ev.to }));
    case 'jail':
      return patchPlayer(game, ev.seat, (p) => ({ ...p, jail: { tries: 0 } }));
    case 'jailStay':
      return patchPlayer(game, ev.seat, (p) => ({ ...p, jail: { tries: ev.tries } }));
    case 'jailExit':
      return patchPlayer(game, ev.seat, withoutJail);
    case 'card':
      return ev.kept ? patchPlayer(game, ev.seat, (p) => ({ ...p, goojf: [...p.goojf, ev.cardId] })) : game;
    case 'cardReturn':
      return ev.seat ? patchPlayer(game, ev.seat, (p) => dropCard(p, ev.cardId)) : game;
    case 'cardGive': {
      const g = patchPlayer(game, ev.from, (p) => dropCard(p, ev.cardId));
      return patchPlayer(g, ev.to, (p) => ({ ...p, goojf: [...p.goojf, ev.cardId] }));
    }
    case 'speedOn':
      return patchPlayer(game, ev.seat, (p) => (p.speed ? p : { ...p, speed: true }));
    case 'bankrupt':
      return patchPlayer(game, ev.seat, (p) => ({ ...withoutJail(p), goojf: [], out: ev.resigned ? 'resigned' : 'bankrupt' }));
    case 'owner':
      return patchProp(game, ev.space, (p) => {
        if (!ev.to) return undefined;
        return p ? { ...p, owner: ev.to } : { owner: ev.to, level: 0 };
      });
    case 'level': {
      const g = patchProp(game, ev.space, (p) => (p ? { ...p, level: ev.to } : p));
      return { ...g, bank: { houses: ev.bank.houses, hotels: ev.bank.hotels } };
    }
    case 'mortgage':
      return patchProp(game, ev.space, (p) => {
        if (!p || !!p.mortgaged === ev.on) return p;
        if (ev.on) return { ...p, mortgaged: true };
        const { mortgaged: _m, ...rest } = p;
        return rest;
      });
    case 'turn':
      return { ...game, turn: { seat: ev.seat, no: ev.no, doubles: 0, again: false } };
    case 'dice': {
      if (ev.purpose === 'order') return game;
      const roll = ev.s === undefined ? { w: ev.w } : { w: ev.w, s: ev.s };
      return { ...game, turn: { ...game.turn, roll } };
    }
    case 'order':
      return { ...game, order: [...ev.order] };
    case 'over':
      return { ...game, phase: { k: 'over', winner: ev.winner, ranking: [...ev.ranking], why: ev.why } };
    default:
      return game;
  }
}
