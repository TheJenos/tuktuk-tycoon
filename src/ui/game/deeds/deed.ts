import { isProperty, ownsGroup, type BoardDef, type GameState, type SeatId, type SpaceDef } from '../../../rules';
import { capital, deckName, money as moneyIn, powerName, termsOf } from '../format';

/*
 * What a Title Deed card says, as rows, with the row that applies right now marked. Pure, so the card component
 * only draws it. A Hero League location's card has its power-up (doubled for the colour pair) and its villain: no
 * buildings, no mortgage.
 */

export interface DeedRow {
  label: string;
  value: string;
  /** The rent a visitor would pay now */
  active?: boolean;
}

export interface Deed {
  kind: 'street' | 'rail' | 'utility';
  name: string;
  /** Colour band (streets) */
  colour?: string;
  price: number;
  rent: DeedRow[];
  /** House and hotel cost, mortgage and unmortgage values */
  costs: DeedRow[];
  note?: string;
  /** Hero League: the villain holding the location until a hero saves it */
  villain?: string;
  owner?: SeatId;
  mortgaged: boolean;
  /** 0-5 */
  level: number;
}

const interestOf = (s: GameState | null, m: number): number => Math.ceil((m * (s?.cfg.mortgagePct ?? 10)) / 100);

const ownedOfKind = (b: BoardDef, s: GameState, owner: SeatId, kind: 'rail' | 'utility'): number =>
  b.spaces.filter((sp, i) => sp.k === kind && s.props[`p${i}`]?.owner === owner).length;

/** The deed of a property space (null for other spaces). Without a state it is the blank printed card. */
export function deedFor(b: BoardDef, space: number, s: GameState | null): Deed | null {
  const sp = b.spaces[space];
  if (!isProperty(sp)) return null;
  const money = (n: number) => moneyIn(n, b);
  const ps = s?.props[`p${space}`];
  const mortgaged = !!ps?.mortgaged;
  const level = ps?.level ?? 0;
  const live = !!ps && !mortgaged;
  const m = sp.mortgage;
  const costs: DeedRow[] = [];
  const base = { name: sp.name, price: sp.price, mortgaged, level, ...(ps ? { owner: ps.owner } : {}) };

  if (sp.k === 'street' && b.heroes) {
    const full = !!ps && !!s && ownsGroup(s, ps.owner, sp.group);
    // Nothing is due while the owner is in the Holding Cell
    const due = !!ps && !s?.players[ps.owner]?.jail;
    const pr = sp.rent[0] ?? 0;
    const rent: DeedRow[] = [
      { label: capital(termsOf(b).rent), value: money(pr), active: due && !full },
      { label: 'With the colour pair', value: money(pr * 2), active: due && full },
    ];
    return {
      kind: 'street',
      colour: b.display.groupColours[sp.group],
      rent,
      costs: [],
      note: `No ${termsOf(b).rent} while the owner is in the ${b.spaces[b.jailIndex]?.name ?? 'jail'}.`,
      ...(sp.villain ? { villain: sp.villain } : {}),
      ...base,
    };
  }

  if (sp.k === 'street') {
    const full = !!ps && !mortgaged && !!s && ownsGroup(s, ps.owner, sp.group);
    const r = sp.rent;
    const rent: DeedRow[] = [
      { label: 'Rent', value: money(r[0] ?? 0), active: live && level === 0 && !full },
      { label: 'With the colour set', value: money((r[0] ?? 0) * 2), active: live && level === 0 && full },
      ...[1, 2, 3, 4].map((n) => ({
        label: n === 1 ? 'With 1 house' : `With ${n} houses`,
        value: money(r[n] ?? 0),
        active: live && level === n,
      })),
      { label: 'With a hotel', value: money(r[5] ?? 0), active: live && level === 5 },
    ];
    costs.push(
      { label: 'Houses cost', value: `${money(sp.house)} each` },
      { label: 'Hotels cost', value: `${money(sp.hotel ?? sp.house)} plus 4 houses` },
    );
    costs.push(...mortgageRows(s, m));
    return { kind: 'street', colour: b.display.groupColours[sp.group], rent, costs, ...base };
  }

  if (sp.k === 'rail') {
    const n = ps && !mortgaged && s ? ownedOfKind(b, s, ps.owner, 'rail') : 0;
    const rent = b.railRent.map((v, i) => ({
      label: i === 0 ? 'Rent' : `If ${i + 1} stations are owned`,
      value: money(v),
      active: n === i + 1,
    }));
    return { kind: 'rail', rent, costs: mortgageRows(s, m), ...base };
  }

  const n = ps && !mortgaged && s ? ownedOfKind(b, s, ps.owner, 'utility') : 0;
  const rent = b.utilityMul.map((mul, i) => ({
    label: i === 0 ? 'If one board is owned' : 'If both boards are owned',
    value: `${mul} × the dice`,
    active: n === i + 1,
  }));
  const speed = !!s?.cfg.speedDie;
  return {
    kind: 'utility',
    rent,
    costs: mortgageRows(s, m),
    ...(speed ? { note: 'With the Speed Die the dice are all three (Bus and Tuk-Tuk Uncle count 0).' } : {}),
    ...base,
  };
}

function mortgageRows(s: GameState | null, m: number): DeedRow[] {
  return [
    { label: 'Mortgage value', value: moneyIn(m) },
    { label: 'To lift the mortgage', value: moneyIn(m + interestOf(s, m)) },
  ];
}

/** Hero League's corners and card spaces: the fine at the next turn's start, the superpower back with the salary */
function heroesBlurb(b: BoardDef, sp: SpaceDef | undefined, s: GameState | null): string | null {
  const cfg = s?.cfg;
  const money = (n: number) => moneyIn(n, b);
  const start = b.spaces[0]?.name ?? 'Start';
  const jail = b.spaces[b.jailIndex]?.name ?? 'jail';
  const salary = money(cfg?.goSalary ?? 200);
  switch (sp?.k) {
    case 'go':
      return cfg?.doubleGoLanding
        ? `Collect ${salary} every time you pass ${start}, and ${money(cfg.goSalary * 2)} for landing on it. Your superpower is ready again too.`
        : `Collect ${salary} every time you land on or pass ${start}, and your superpower is ready again.`;
    case 'jail':
      return `Just visiting, unless you were captured. A captured hero pays the ${money(cfg?.jailFine ?? 50)} fine (what they have, if less) at the start of their next turn and rolls as usual.`;
    case 'goToJail': return `Captured! Go directly to the ${jail}. Do not pass ${start}, do not collect ${salary}.`;
    case 'chance':
      return `Draw the top ${deckName(b, 'chance')} card and do what it says: they all work against heroes. With ${powerName(b, 'aim')}, take the top ${b.heroes?.aimCards ?? 2} and play one.`;
    case 'chest': return `Draw the top ${deckName(b, 'chest')} card and do what it says: they all help.`;
    default: return null;
  }
}

/** A line about a space that is not a property (the inspector's text) */
export function spaceBlurb(b: BoardDef, sp: SpaceDef | undefined, s: GameState | null): string {
  if (b.heroes) {
    const text = heroesBlurb(b, sp, s);
    if (text !== null) return text;
  }
  const money = (n: number) => moneyIn(n, b);
  const cfg = s?.cfg;
  const start = b.spaces[0]?.name ?? 'Start';
  const jail = b.spaces[b.jailIndex]?.name ?? 'jail';
  switch (sp?.k) {
    case 'go':
      return cfg?.doubleGoLanding
        ? `Collect ${money(cfg.goSalary)} salary every time you pass ${start}, and ${money(cfg.goSalary * 2)} for landing on it.`
        : `Collect ${money(cfg?.goSalary ?? 200)} salary every time you land on or pass ${start}.`;
    case 'jail': return `Just visiting, unless you were sent here. Leave by rolling doubles, using a Get Out of Jail Free card, or paying ${money(cfg?.jailFine ?? 50)}.`;
    case 'parking':
      return cfg?.jackpot
        ? `${sp.name}: land here to win the jackpot of taxes, fines and card payments, now ${money(s?.pot ?? 0)}.`
        : `${sp.name}: nothing happens here.`;
    case 'goToJail': return `Go directly to the ${jail}. Do not pass ${start}, do not collect your salary.`;
    case 'chance': return `Draw the top ${deckName(b, 'chance')} card and do what it says.`;
    case 'chest': return `Draw the top ${deckName(b, 'chest')} card and do what it says.`;
    case 'tax':
      if (sp.tax === 'income' && cfg?.incomeTaxMode === 'flat') return `${sp.name}: pay ${money(cfg.incomeFlat)}.`;
      if (sp.tax === 'income' && cfg?.incomeTaxMode === 'percent') return `${sp.name}: pay ${cfg.incomePct}% of your total worth.`;
      return sp.tax === 'income'
        ? `Pay ${money(cfg?.incomeFlat ?? 200)} or ${cfg?.incomePct ?? 10}% of your total worth. You choose before adding it up.`
        : `${sp.name}: pay ${money(cfg?.luxuryTax ?? 75)}.`;
    default: return '';
  }
}
