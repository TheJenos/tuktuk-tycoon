import { startAuction } from './auction';
import { type BuildPlan, applyBuild, capacity, placeSites, placeUnit, planBuild } from './buildings';
import { type Ctx, activeSeats, emit, err, isActive, player, setPhase } from './ctx';
import { type Handler, isInt, seatAction, systemAction } from './handler';
import { transfer } from './money';
import type { BuildClaimPhase, BuildKind, GameState, Phase, RuleError, SeatId } from './types';

/*
 * The building shortage contest. When a build would leave the bank with fewer units than the other players could
 * want right now, the others get a window to ask for units (requestBuild{n}) or pass. If all the requests fit the
 * bank's supply they are all granted; otherwise units are auctioned one at a time among the requesters (from a bid of
 * 1), and each winner places the unit it won.
 */

const supplyOf = (s: GameState, kind: BuildKind): number => (kind === 'house' ? s.bank.houses : s.bank.hotels);

/** The contest a build would start, or undefined when it can go up straight away */
export function findContest(
  c: Ctx,
  seat: SeatId,
  plan: BuildPlan,
): { kind: BuildKind; need: number; rivals: SeatId[] } | undefined {
  for (const kind of ['house', 'hotel'] as const) {
    const need = kind === 'house' ? plan.houses : plan.hotels;
    if (need === 0) continue;
    const caps = activeSeats(c.s)
      .filter((o) => o !== seat)
      .map((o) => ({ o, cap: capacity(c.s, c.b, o, kind) }))
      .filter((x) => x.cap > 0);
    const demand = caps.reduce((a, x) => a + x.cap, 0);
    if (caps.length > 0 && supplyOf(c.s, kind) - need < demand) return { kind, need, rivals: caps.map((x) => x.o) };
  }
  return undefined;
}

export function startClaim(
  c: Ctx,
  seat: SeatId,
  contest: { kind: BuildKind; need: number; rivals: SeatId[] },
  build: { group: string; levels: number[] },
): void {
  const ph: BuildClaimPhase = {
    k: 'buildClaim',
    kind: contest.kind,
    by: seat,
    build,
    req: { [seat]: contest.need },
    open: [...contest.rivals],
    resume: c.s.phase,
  };
  setPhase(c, ph);
  const supply = supplyOf(c.s, contest.kind);
  emit(c, { t: 'claimStart', kind: contest.kind, by: seat, open: [...contest.rivals], supply });
}

/** Queue place phases (seat, units) one after another, then `resume` */
function placeChain(c: Ctx, kind: BuildKind, entries: [SeatId, number][], resume: Phase): void {
  let next = resume;
  for (const [seat, count] of [...entries].reverse()) {
    if (count > 0) next = { k: 'place', seat, kind, count, resume: next };
  }
  setPhase(c, next);
  for (const [seat, count] of entries) if (count > 0) emit(c, { t: 'placeStart', seat, kind, count });
}

/** Runs once nobody is left to answer the contest window (and again after each auctioned unit is placed) */
export function resolveClaim(c: Ctx): void {
  const ph = c.s.phase;
  if (ph.k !== 'buildClaim') return;
  const s = c.s;
  const want = (seat: SeatId): number => (isActive(s, seat) ? (ph.req[seat] ?? 0) : 0);

  if (!ph.auctioning) {
    const seats = s.order.filter((seat) => want(seat) > 0);
    const total = seats.reduce((a, seat) => a + want(seat), 0);
    if (total <= supplyOf(s, ph.kind)) {
      emit(c, { t: 'claimEnd', kind: ph.kind, outcome: 'granted' });
      setPhase(c, ph.resume);
      // The starter's build goes up as asked if it still can; the others place their units one by one.
      if (ph.build && isActive(s, ph.by)) {
        const plan = planBuild(s, c.b, ph.by, ph.build.group, ph.build.levels);
        if (!('code' in plan) && player(s, ph.by).cash >= plan.cost) applyBuild(c, ph.by, plan);
      }
      const others = seats.filter((seat) => seat !== ph.by).map((seat): [SeatId, number] => [seat, want(seat)]);
      placeChain(c, ph.kind, others, ph.resume);
      return;
    }
    if (!s.cfg.auctions) {
      grantInRequestOrder(c, ph, want);
      return;
    }
    ph.auctioning = true;
    emit(c, { t: 'claimEnd', kind: ph.kind, outcome: 'auction' });
  }

  const left = supplyOf(s, ph.kind);
  const seats = s.order.filter((seat) => want(seat) > 0 && placeSites(s, c.b, seat, ph.kind, false).length > 0);
  if (ph.stop || left === 0 || seats.length === 0) {
    emit(c, { t: 'claimEnd', kind: ph.kind, outcome: 'done' });
    setPhase(c, ph.resume);
    return;
  }
  const total = seats.reduce((a, seat) => a + want(seat), 0);
  if (total <= left || seats.length === 1) {
    let rest = left;
    const entries = seats.map((seat): [SeatId, number] => {
      const n = Math.min(want(seat), rest);
      rest -= n;
      return [seat, n];
    });
    emit(c, { t: 'claimEnd', kind: ph.kind, outcome: 'granted' });
    placeChain(c, ph.kind, entries, ph.resume);
    return;
  }
  startAuction(c, { k: ph.kind }, seats, ph);
}

/**
 * Auctions off and more wanted than the bank holds: the requests are granted in the order they were made (the
 * starter's first) until the supply runs out. The starter's build goes up as asked when it got every unit it needs;
 * otherwise everyone places the units they got one at a time at the normal price.
 */
function grantInRequestOrder(c: Ctx, ph: BuildClaimPhase, want: (seat: SeatId) => number): void {
  const s = c.s;
  let rest = supplyOf(s, ph.kind);
  // req keeps insertion order: the starter's entry, then each requestBuild as it came
  const entries = (Object.keys(ph.req) as SeatId[])
    .filter((seat) => want(seat) > 0)
    .map((seat): [SeatId, number] => {
      const n = Math.min(want(seat), rest);
      rest -= n;
      return [seat, n];
    });
  emit(c, { t: 'claimEnd', kind: ph.kind, outcome: 'granted' });
  setPhase(c, ph.resume);
  let place = entries;
  const starter = entries.find(([seat]) => seat === ph.by);
  if (ph.build && starter && starter[1] === want(ph.by)) {
    const plan = planBuild(s, c.b, ph.by, ph.build.group, ph.build.levels);
    if (!('code' in plan) && player(s, ph.by).cash >= plan.cost) applyBuild(c, ph.by, plan);
    place = entries.filter(([seat]) => seat !== ph.by);
  }
  placeChain(c, ph.kind, place, ph.resume);
}

/**
 * Moves on from a place phase that can no longer be used (seat out, nothing left, no legal site). An auctioned unit
 * that cannot be placed is refunded. Returns false when the phase is waiting for a `place`.
 */
export function advancePlace(c: Ctx): boolean {
  const ph = c.s.phase;
  if (ph.k !== 'place') return false;
  const live = isActive(c.s, ph.seat) && ph.count > 0;
  if (live && placeSites(c.s, c.b, ph.seat, ph.kind, ph.bid === undefined).length > 0) return false;
  if (live && ph.bid !== undefined) transfer(c, 'bank', ph.seat, ph.bid, 'refund');
  setPhase(c, ph.resume);
  return true;
}

export const requestBuild: Handler<'requestBuild'> = seatAction(
  (s, b, seat, a) => {
    const ph = s.phase;
    if (ph.k !== 'buildClaim' || ph.auctioning) return err('phase', 'No building contest is open');
    if (!ph.open.includes(seat)) return err('notOpen', 'You are not asked');
    const cap = capacity(s, b, seat, ph.kind);
    if (!isInt(a.n) || a.n < 1 || a.n > cap) return err('badCount', `Ask for 1 to ${cap}`);
    return null;
  },
  (c, seat, a) => {
    const ph = c.s.phase;
    if (ph.k !== 'buildClaim') return;
    ph.req[seat] = a.n;
    ph.open = ph.open.filter((o) => o !== seat);
    emit(c, { t: 'claimRequest', seat, n: a.n });
  },
);

export function checkPassClaim(s: GameState, seat: SeatId): RuleError | null {
  const ph = s.phase;
  if (ph.k !== 'buildClaim' || ph.auctioning) return err('phase', 'No building contest is open');
  return ph.open.includes(seat) ? null : err('notOpen', 'You are not asked');
}

export function passClaim(c: Ctx, seat: SeatId): void {
  const ph = c.s.phase;
  if (ph.k !== 'buildClaim') return;
  ph.open = ph.open.filter((o) => o !== seat);
  emit(c, { t: 'claimRequest', seat, n: 0 });
}

export const closeClaim: Handler<'closeClaim'> = systemAction(
  (s) => (s.phase.k === 'buildClaim' && s.phase.open.length > 0 ? null : err('phase', 'No contest window is open')),
  (c) => {
    const ph = c.s.phase;
    if (ph.k !== 'buildClaim') return;
    for (const seat of ph.open) emit(c, { t: 'claimRequest', seat, n: 0 });
    ph.open = [];
  },
);

export const place: Handler<'place'> = seatAction(
  (s, b, seat, a) => {
    const ph = s.phase;
    if (ph.k !== 'place') return err('phase', 'Nothing to place');
    if (ph.seat !== seat) return err('notYou', 'Another player is placing');
    if (!isInt(a.space) || !placeSites(s, b, seat, ph.kind, ph.bid === undefined).includes(a.space)) {
      return err('badSite', 'It cannot go there');
    }
    return null;
  },
  (c, seat, a) => {
    const ph = c.s.phase;
    if (ph.k !== 'place') return;
    placeUnit(c, seat, a.space, ph.bid === undefined);
    ph.count--;
    if (ph.count <= 0) setPhase(c, ph.resume);
  },
);
