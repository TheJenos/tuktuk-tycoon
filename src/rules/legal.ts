import { minBid } from './auction';
import { getBoard, isStreet } from './board';
import { capacity, groupLevels, placeSites } from './buildings';
import { isActive, isSeat, ownedBy } from './ctx';
import type { Handler } from './handler';
import { HANDLERS } from './handlers';
import type { Action, BoardDef, GameState, SeatId } from './types';

/** Single-step build and sell actions (and "sell the whole group") for every group the seat could touch */
export function manageCandidates(s: GameState, b: BoardDef, seat: SeatId): Action[] {
  const out: Action[] = [];
  for (const g of b.groups) {
    if (!g.spaces.every((space) => isStreet(b.spaces[space]))) continue;
    const levels = groupLevels(s, g);
    const step = (i: number, d: number): number[] => levels.map((l, j) => (j === i ? l + d : l));
    g.spaces.forEach((_, i) => {
      out.push({ k: 'build', group: g.id, levels: step(i, 1) });
      if ((levels[i] ?? 0) > 0) out.push({ k: 'sell', group: g.id, levels: step(i, -1) });
    });
    if (levels.some((l) => l > 1)) out.push({ k: 'sell', group: g.id, levels: levels.map(() => 0) });
  }
  for (const space of ownedBy(s, seat)) {
    out.push({ k: 'mortgage', space }, { k: 'unmortgage', space }, { k: 'sellProperty', space });
  }
  return out;
}

function phaseCandidates(s: GameState, b: BoardDef, seat: SeatId): Action[] {
  const ph = s.phase;
  switch (ph.k) {
    case 'preRoll':
      return [{ k: 'roll' }, { k: 'payFine' }, { k: 'useCard' }];
    case 'bus':
      return ph.opts.map((n) => ({ k: 'bus', n }));
    case 'chooseSpace':
      return b.spaces.map((_, space) => ({ k: 'chooseSpace', space }));
    case 'buy':
      return [{ k: 'buy' }, { k: 'decline' }];
    case 'incomeTax':
      return [
        { k: 'incomeTax', pick: 'flat' },
        { k: 'incomeTax', pick: 'percent' },
      ];
    case 'postRoll':
      return [{ k: 'endTurn' }];
    case 'auction':
      return [{ k: 'bid', amount: minBid(ph) }, { k: 'pass' }];
    case 'place':
      return placeSites(s, b, seat, ph.kind, ph.bid === undefined).map((space) => ({ k: 'place', space }));
    case 'buildClaim': {
      const cap = capacity(s, b, seat, ph.kind);
      return [...new Set([1, cap])].map((n): Action => ({ k: 'requestBuild', n })).concat({ k: 'pass' });
    }
    case 'mortgageXfer':
      return [
        { k: 'settleMortgages', lift: [] },
        ...ph.spaces.map((space): Action => ({ k: 'settleMortgages', lift: [space] })),
        ...(ph.spaces.length > 1 ? [{ k: 'settleMortgages', lift: [...ph.spaces] } as Action] : []),
      ];
    case 'debt':
      return [{ k: 'autoRaise' }, { k: 'bankrupt' }];
    default:
      return [];
  }
}

/**
 * Every concrete action a seat may take now (for buttons, bots and fuzzing). Bids are represented by the minimum
 * bid; building and selling by single-step changes. Trade proposals are open-ended and not listed.
 */
export function legalActions(s: GameState, seat: SeatId): Action[] {
  if (!isSeat(s, seat) || !isActive(s, seat) || s.phase.k === 'over') return [];
  const b = getBoard(s.cfg.board);
  const candidates: Action[] = [
    ...phaseCandidates(s, b, seat),
    ...(ownedBy(s, seat).length ? manageCandidates(s, b, seat) : []),
    ...Object.values(s.trades).flatMap((t): Action[] => {
      if (t.to === seat) return [{ k: 'accept', id: t.id }, { k: 'reject', id: t.id }];
      return t.from === seat ? [{ k: 'cancel', id: t.id }] : [];
    }),
    { k: 'resign' },
  ];
  return candidates.filter((a) => (HANDLERS[a.k] as Handler<Action['k']>).check(s, b, seat, a as never) === null);
}
