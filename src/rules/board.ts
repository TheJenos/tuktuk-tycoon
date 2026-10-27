import { COLOMBO } from '../boards/colombo/rules';
import { HEROES } from '../boards/heroes/rules';
import { HILL } from '../boards/hill/rules';
import { LANKA } from '../boards/lanka/rules';
import { SOUTH } from '../boards/south/rules';
import type { BoardDef, CardDef, Deck, GroupDef, PropertyDef, SpaceDef, StreetDef } from './types';

/**
 * Every board, in picker order (the first is the default). The classic boards share the rules and differ in theme and
 * size; Hero League (a `heroes` block) plays the Hero League rules (docs/heroes.md).
 */
const ALL: readonly BoardDef[] = [LANKA, COLOMBO, HILL, SOUTH, HEROES];

const REGISTRY: Record<string, BoardDef> = Object.fromEntries(ALL.map((b) => [b.id, b]));

/** The board ids a room or save may name */
export const BOARD_IDS: readonly string[] = ALL.map((b) => b.id);

/** What the board picker and the Rooms list show: id, name and a one-line blurb */
export interface BoardInfo {
  id: string;
  name: string;
  blurb: string;
}
export const BOARDS: readonly BoardInfo[] = ALL.map((b) => ({ id: b.id, name: b.display.name, blurb: b.display.blurb }));

export const hasBoard = (id: string): boolean => Object.prototype.hasOwnProperty.call(REGISTRY, id);

/** The board data for a config's `board` id (unknown ids fall back to the default board) */
export const getBoard = (id: string): BoardDef => (hasBoard(id) ? REGISTRY[id] : undefined) ?? LANKA;

/** A board's display name ("All Island" for unknown ids) */
export const boardName = (id: string): string => getBoard(id).display.name;

export const isProperty = (sp: SpaceDef | undefined): sp is PropertyDef =>
  sp?.k === 'street' || sp?.k === 'rail' || sp?.k === 'utility';

export const isStreet = (sp: SpaceDef | undefined): sp is StreetDef => sp?.k === 'street';

export function spaceAt(b: BoardDef, space: number): SpaceDef {
  const sp = b.spaces[space];
  if (!sp) throw new Error(`no space ${space}`);
  return sp;
}

/** The property at `space`, or undefined when it is not a property */
export function propertyAt(b: BoardDef, space: number): PropertyDef | undefined {
  const sp = b.spaces[space];
  return isProperty(sp) ? sp : undefined;
}

/** Every buyable space index, in board order */
export const propertySpaces = (b: BoardDef): number[] =>
  b.spaces.flatMap((sp, i) => (isProperty(sp) ? [i] : []));

export const groupById = (b: BoardDef, id: string): GroupDef | undefined => b.groups.find((g) => g.id === id);

/** The colour group of a street (undefined for railroads, utilities and other spaces) */
export function groupOf(b: BoardDef, space: number): GroupDef | undefined {
  const sp = b.spaces[space];
  return isStreet(sp) ? groupById(b, sp.group) : undefined;
}

/** The spaces whose buildings and mortgages are tied to this one: its colour group, or just itself */
export const siblings = (b: BoardDef, space: number): number[] => groupOf(b, space)?.spaces ?? [space];

export const hotelCost = (sp: StreetDef): number => sp.hotel ?? sp.house;

/** Cost of raising a street from `level - 1` to `level` */
export const stepCost = (sp: StreetDef, level: number): number => (level === 5 ? hotelCost(sp) : sp.house);

export function cardById(b: BoardDef, id: string): CardDef | undefined {
  return b.chance.find((c) => c.id === id) ?? b.chest.find((c) => c.id === id);
}

/** The deck a card belongs to (a Get Out of Jail Free card returns there) */
export const deckOf = (b: BoardDef, id: string): Deck => (b.chance.some((c) => c.id === id) ? 'chance' : 'chest');

/** Forward distance from one space to another (1 to the board's size; a full lap is the size) */
export function forward(b: BoardDef, from: number, to: number): number {
  const n = b.spaces.length;
  const d = (((to - from) % n) + n) % n;
  return d === 0 ? n : d;
}

/** The spaces entered walking forward from `from` to `to` */
export function pathForward(b: BoardDef, from: number, to: number): number[] {
  const n = b.spaces.length;
  const steps = forward(b, from, to);
  return Array.from({ length: steps }, (_, i) => (from + i + 1) % n);
}

/** The spaces entered walking back `steps` from `from` */
export function pathBack(b: BoardDef, from: number, steps: number): number[] {
  const n = b.spaces.length;
  return Array.from({ length: steps }, (_, i) => (((from - i - 1) % n) + n) % n);
}
