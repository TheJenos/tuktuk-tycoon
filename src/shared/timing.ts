import type { GameEvent, TimerInfo } from '../rules';

/*
 * Animation and decision timing shared by the net layer (deadlines) and the view (playback). Both must agree: a
 * deadline is the commit time + the time every client needs to animate the events + the time to decide, so players
 * who are still watching their token walk never lose decision time.
 */

/** Durations in ms at 'normal' animation speed. The director uses these; animBudget() sums them. */
export const ANIM = {
  dice: 1100,
  /** Per hop along a path; long paths compress so a walk never takes longer than moveMax */
  hop: 180,
  hopMin: 70,
  moveMax: 2200,
  /** A single jump (to jail) */
  jump: 700,
  /** Long enough to read the card: it holds in front of the camera for about 60% of this */
  card: 4500,
  owner: 300,
  level: 350,
  mortgage: 250,
  auctionStart: 400,
  jail: 600,
  bankrupt: 900,
  /** A superpower's floating label (Hero League) */
  power: 400,
  /** Upper bound for one batch, however many events it has */
  batchMax: 8000,
} as const;

/** Time per hop for a path of n spaces, at normal speed */
export const hopMs = (n: number): number => Math.max(ANIM.hopMin, Math.min(ANIM.hop, ANIM.moveMax / Math.max(1, n)));

/** How long the events take to play at normal speed */
export function animBudget(events: readonly GameEvent[]): number {
  let ms = 0;
  for (const ev of events) {
    switch (ev.t) {
      case 'dice': ms += ev.purpose === 'order' ? 0 : ANIM.dice; break;
      case 'heroDie': ms += ANIM.dice; break;
      case 'move': ms += ev.via === 'jail' || ev.via === 'swap' ? ANIM.jump : hopMs(ev.path.length) * ev.path.length; break;
      case 'power': ms += ANIM.power; break;
      case 'card': ms += ANIM.card; break;
      case 'owner': ms += ANIM.owner; break;
      case 'level': ms += ANIM.level; break;
      case 'mortgage': ms += ANIM.mortgage; break;
      case 'auctionStart': ms += ANIM.auctionStart; break;
      case 'jail': ms += ANIM.jail; break;
      case 'bankrupt': ms += ANIM.bankrupt; break;
      default: break;
    }
  }
  return Math.min(ms, ANIM.batchMax);
}

/**
 * Seconds allowed per decision kind. 0 = no timer (the auction and a Hero League reaction window always have one, or
 * they could never close).
 */
export interface TimerRules {
  turn: number;
  decision: number;
  auction: number;
  debt: number;
  /** A Hero League reaction window (re-roll / shield); absent in older rooms: 6 s */
  reaction?: number;
}

export const ONLINE_TIMERS: TimerRules = { turn: 60, decision: 45, auction: 8, debt: 120, reaction: 8 };
/** Offline: nobody waits on a human except the auction countdown and reaction windows */
export const OFFLINE_TIMERS: TimerRules = { turn: 0, decision: 0, auction: 8, debt: 0, reaction: 6 };

export function phaseSecs(kind: TimerInfo['kind'], t: TimerRules): number {
  switch (kind) {
    case 'turn': return t.turn;
    case 'decision': return t.decision;
    case 'auction': return Math.max(3, t.auction);
    case 'debt': return t.debt;
    case 'trade': return 0;
    case 'reaction': return Math.max(3, t.reaction ?? 6);
  }
}
