import { LANKA_THEME } from '../lanka/theme';

/** Hero League: what it brings besides its spaces and rules (those are in rules.ts) */
export const HEROES_THEME = {
  /** Its six tokens, in seat-slot order: one per hero, ids = the heroes' ids (shapes: tokens.ts and icons.tsx) */
  tokens: [
    { id: 'jadeTitan', label: 'Jade Titan' },
    { id: 'starCaptain', label: 'Star Captain' },
    { id: 'steelAce', label: 'Steel Ace' },
    { id: 'stormLord', label: 'Storm Lord' },
    { id: 'velvetViper', label: 'Velvet Viper' },
    { id: 'sharpshot', label: 'Sharpshot' },
  ],
  /** Default names for bots, in the order they are handed out */
  botNames: ['Ruwan', 'Sachini', 'Dilan', 'Nethmi', 'Kavindu', 'Ishani'],
  /** No music of its own: every sound falls back to All Island's, so the loop is cut where All Island's is */
  loopSeconds: LANKA_THEME.loopSeconds,
} as const;
