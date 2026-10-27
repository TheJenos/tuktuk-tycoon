/** Hill Country: what it brings besides its spaces and rules (those are in rules.ts) */
export const HILL_THEME = {
  /** Its eight tokens, in seat-slot order (their shapes: tokens.ts and icons.tsx) */
  tokens: [
    { id: 'steamTrain', label: 'Steam train' },
    { id: 'adamsPeak', label: "Adam's Peak" },
    { id: 'archBridge', label: 'Nine Arch Bridge' },
    { id: 'teaBasket', label: 'Tea basket' },
    { id: 'strawberry', label: 'Strawberry' },
    { id: 'umbrella', label: 'Umbrella' },
    { id: 'leech', label: 'Leech' },
    { id: 'sambar', label: 'Sambar deer' },
  ],
  /** Default names for bots, in the order they are handed out */
  botNames: ['Sunil', 'Pushpa', 'Muthu', 'Kumari', 'Bandara', 'Lakshmi', 'Selvam', 'Menike'],
  /** Seconds of sounds/music-loop: the loop is cut there (an MP3 decoder may pad the end) */
  loopSeconds: 130.23,
} as const;
