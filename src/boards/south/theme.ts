/** Down South: what it brings besides its spaces and rules (those are in rules.ts) */
export const SOUTH_THEME = {
  /** Its eight tokens, in seat-slot order (their shapes: tokens.ts and icons.tsx) */
  tokens: [
    { id: 'stiltFisher', label: 'Stilt fisherman' },
    { id: 'seaTurtle', label: 'Sea turtle' },
    { id: 'surfboard', label: 'Surfboard' },
    { id: 'lighthouse', label: 'Galle lighthouse' },
    { id: 'palmTree', label: 'Palm tree' },
    { id: 'devilMask', label: 'Devil mask' },
    { id: 'crab', label: 'Crab' },
    { id: 'conch', label: 'Conch shell' },
  ],
  /** Default names for bots, in the order they are handed out */
  botNames: ['Sampath', 'Nadeeka', 'Lahiru', 'Hiruni', 'Jayantha', 'Sewwandi', 'Kalum', 'Dulani'],
  /** Seconds of sounds/music-loop: the loop is cut there (an MP3 decoder may pad the end) */
  loopSeconds: 51.69,
} as const;
