import { isProperty, ownsGroup, type BoardDef, type GameState, type SeatId, type SpaceDef } from '../../../rules';
import { deckName, money } from '../format';

/*
 * What a Title Deed card says, as rows, with the row that applies right now marked. Pure, so the card component
 * only draws it.
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
  const ps = s?.props[`p${space}`];
  const mortgaged = !!ps?.mortgaged;
  const level = ps?.level ?? 0;
  const live = !!ps && !mortgaged;
  const m = sp.mortgage;
  const costs: DeedRow[] = [];
  const base = { name: sp.name, price: sp.price, mortgaged, level, ...(ps ? { owner: ps.owner } : {}) };

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
    { label: 'Mortgage value', value: money(m) },
    { label: 'To lift the mortgage', value: money(m + interestOf(s, m)) },
  ];
}

/** A line about a space that is not a property (the inspector's text) */
export function spaceBlurb(b: BoardDef, sp: SpaceDef | undefined, s: GameState | null): string {
  const cfg = s?.cfg;
  const start = b.spaces[0]?.name ?? 'Start';
  const jail = b.spaces[b.jailIndex]?.name ?? 'jail';
  switch (sp?.k) {
    case 'go': return `Collect ${money(cfg?.goSalary ?? 200)} salary every time you land on or pass ${start}.`;
    case 'jail': return `Just visiting, unless you were sent here. Leave by rolling doubles, using a Get Out of Jail Free card, or paying ${money(cfg?.jailFine ?? 50)}.`;
    case 'parking': return `${sp.name}: nothing happens here.`;
    case 'goToJail': return `Go directly to the ${jail}. Do not pass ${start}, do not collect your salary.`;
    case 'chance': return `Draw the top ${deckName(b, 'chance')} card and do what it says.`;
    case 'chest': return `Draw the top ${deckName(b, 'chest')} card and do what it says.`;
    case 'tax':
      return sp.tax === 'income'
        ? `Pay ${money(cfg?.incomeFlat ?? 200)} or ${cfg?.incomePct ?? 10}% of your total worth. You choose before adding it up.`
        : `${sp.name}: pay ${money(cfg?.luxuryTax ?? 75)}.`;
    default: return '';
  }
}
