/** Colombo: what it brings besides its spaces and rules (those are in rules.ts) */
export const COLOMBO_THEME = {
  /** Its eight tokens, in seat-slot order (their shapes: tokens.ts and icons.tsx) */
  tokens: [
    { id: 'cityBus', label: 'Red bus' },
    { id: 'lotusTower', label: 'Lotus Tower' },
    { id: 'clockTower', label: 'Clock tower' },
    { id: 'crow', label: 'Crow' },
    { id: 'hopper', label: 'Hopper' },
    { id: 'isso', label: 'Isso prawn' },
    { id: 'briefcase', label: 'Briefcase' },
    { id: 'trafficCone', label: 'Traffic cone' },
  ],
  /** Default names for bots, in the order they are handed out */
  botNames: ['Dinesh', 'Ishara', 'Tharindu', 'Malsha', 'Shehan', 'Thilini', 'Rukshan', 'Anjali'],
  /** Seconds of sounds/music-loop: the loop is cut there (an MP3 decoder may pad the end) */
  loopSeconds: 108.39,
} as const;
