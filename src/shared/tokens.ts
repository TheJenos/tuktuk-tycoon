/**
 * The player tokens: eight per board, each board its own set (ids unique across boards). Ids are stored in rooms
 * (database.rules.json checks their form); labels are shown in the UI. A board's set is in seat-slot order: slot k of
 * one board stands for slot k of another (tokenOn), so a seat keeps a token of its own when the board changes.
 */
export const TOKENS = [
  // All Island
  { id: 'tuktuk', label: 'Tuk-tuk', board: 'lanka' },
  { id: 'elephant', label: 'Elephant', board: 'lanka' },
  { id: 'coconut', label: 'King coconut', board: 'lanka' },
  { id: 'cricket', label: 'Cricket bat', board: 'lanka' },
  { id: 'tea', label: 'Cup of tea', board: 'lanka' },
  { id: 'drum', label: 'Kandyan drum', board: 'lanka' },
  { id: 'oruwa', label: 'Oruwa canoe', board: 'lanka' },
  { id: 'kite', label: 'New Year kite', board: 'lanka' },
  // Colombo
  { id: 'cityBus', label: 'Red bus', board: 'colombo' },
  { id: 'lotusTower', label: 'Lotus Tower', board: 'colombo' },
  { id: 'clockTower', label: 'Clock tower', board: 'colombo' },
  { id: 'crow', label: 'Crow', board: 'colombo' },
  { id: 'hopper', label: 'Hopper', board: 'colombo' },
  { id: 'isso', label: 'Isso prawn', board: 'colombo' },
  { id: 'briefcase', label: 'Briefcase', board: 'colombo' },
  { id: 'trafficCone', label: 'Traffic cone', board: 'colombo' },
  // Hill Country
  { id: 'steamTrain', label: 'Steam train', board: 'hill' },
  { id: 'adamsPeak', label: "Adam's Peak", board: 'hill' },
  { id: 'archBridge', label: 'Nine Arch Bridge', board: 'hill' },
  { id: 'teaBasket', label: 'Tea basket', board: 'hill' },
  { id: 'strawberry', label: 'Strawberry', board: 'hill' },
  { id: 'umbrella', label: 'Umbrella', board: 'hill' },
  { id: 'leech', label: 'Leech', board: 'hill' },
  { id: 'sambar', label: 'Sambar deer', board: 'hill' },
  // Down South
  { id: 'stiltFisher', label: 'Stilt fisherman', board: 'south' },
  { id: 'seaTurtle', label: 'Sea turtle', board: 'south' },
  { id: 'surfboard', label: 'Surfboard', board: 'south' },
  { id: 'lighthouse', label: 'Galle lighthouse', board: 'south' },
  { id: 'palmTree', label: 'Palm tree', board: 'south' },
  { id: 'devilMask', label: 'Devil mask', board: 'south' },
  { id: 'crab', label: 'Crab', board: 'south' },
  { id: 'conch', label: 'Conch shell', board: 'south' },
] as const;

export type TokenId = (typeof TOKENS)[number]['id'];

export const isTokenId = (v: unknown): v is TokenId => TOKENS.some((t) => t.id === v);

/** Shown for a seat whose token is missing or from an older version */
export const DEFAULT_TOKEN: TokenId = 'tuktuk';

/** The board whose set a token is from (All Island's for an unknown one) */
export const tokenBoard = (id: string): string => TOKENS.find((t) => t.id === id)?.board ?? 'lanka';

/** A board's eight tokens, in slot order (All Island's for a board without a set) */
export function boardTokens(board: string): TokenId[] {
  const own = TOKENS.filter((t) => t.board === board).map((t) => t.id);
  return own.length ? own : TOKENS.filter((t) => t.board === 'lanka').map((t) => t.id);
}

/** A token as `board` shows it: itself when it's from that board's set, else the same slot of that board's set */
export function tokenOn(board: string, id: string): TokenId {
  const set = boardTokens(board);
  if ((set as string[]).includes(id)) return id as TokenId;
  const slot = boardTokens(tokenBoard(id)).indexOf(id as TokenId);
  return set[slot < 0 ? 0 : slot] ?? DEFAULT_TOKEN;
}

/**
 * Seat colours, one per seat (s0..s7): saturated, and spread as far apart around the colour wheel as eight hues go
 * (red, blue, yellow, green, then purple, orange, cyan, pink), so the first four seats get the four most distinct.
 * The token silhouette is always shown next to the colour, so colour is never the only cue.
 */
export const SEAT_COLORS = ['#e01e2b', '#2457ff', '#f5c400', '#1e9e3a', '#a32eff', '#ff7f00', '#00b7cc', '#ff40c0'] as const;
