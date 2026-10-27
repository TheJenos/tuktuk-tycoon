/** All Island: what it brings besides its spaces and rules (those are in rules.ts) */
export const LANKA_THEME = {
  /** Its eight tokens, in seat-slot order (their shapes: tokens.ts and icons.tsx) */
  tokens: [
    { id: 'tuktuk', label: 'Tuk-tuk' },
    { id: 'elephant', label: 'Elephant' },
    { id: 'coconut', label: 'King coconut' },
    { id: 'cricket', label: 'Cricket bat' },
    { id: 'tea', label: 'Cup of tea' },
    { id: 'drum', label: 'Kandyan drum' },
    { id: 'oruwa', label: 'Oruwa canoe' },
    { id: 'kite', label: 'New Year kite' },
  ],
  /** Default names for bots, in the order they are handed out */
  botNames: ['Nimal', 'Kamala', 'Kasun', 'Dilini', 'Ruwan', 'Sanduni', 'Chamara', 'Nadeesha'],
  /** Seconds of sounds/music-loop: the loop is cut there (an MP3 decoder may pad the end) */
  loopSeconds: 17.44,
} as const;
