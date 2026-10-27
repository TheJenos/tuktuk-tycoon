import type { ReactNode } from 'react';

/** Down South's token silhouettes (24x24 viewBox; ids in src/shared/tokens.ts) */
export const SOUTH_ICONS: Record<string, ReactNode> = {
  // Stilt fisherman: a figure sat on the crossbar of a pole in the waves, rod held out with its line
  stiltFisher: (
    <>
      <path d="M8.5 7v14M5.5 13h6.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="10.8" cy="4.3" r="2" />
      <path d="M9.4 6.8h3l1 4.7h3v5.3h-1.7v-3.6H9.4z" />
      <path d="M11.5 10.2 21 2.8" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M21 2.8v11.5" fill="none" stroke="currentColor" strokeWidth=".8" />
      <path d="M2 20.5c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 4.5 0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </>
  ),
  // Sea turtle from above: oval shell with a scute pattern, swept-back front flippers, small rear ones, head forward
  seaTurtle: (
    <>
      <path d="M4.5 12a6.5 5.3 0 1 0 13 0a6.5 5.3 0 1 0-13 0z" />
      <path d="M17 12c0-1.3 1-2.3 2.5-2.3S22 10.7 22 12s-1 2.3-2.5 2.3S17 13.3 17 12z" />
      <path d="M13.5 7.6c1.5-2.6 3.6-4.3 6.3-5-.8 2.4-2.5 4.3-4.7 5.8zM13.5 16.4c1.5 2.6 3.6 4.3 6.3 5-.8-2.4-2.5-4.3-4.7-5.8z" />
      <path d="M6.6 8.4c-1.4-.9-2.8-1.3-4.1-1.1.4 1.3 1.4 2.2 2.7 2.7zM6.6 15.6c-1.4.9-2.8 1.3-4.1 1.1.4-1.3 1.4-2.2 2.7-2.7zM4.7 12l-2.2-.9v1.8z" />
      <path d="M9 10h4l1.5 2-1.5 2H9l-1.5-2zM9 10 7.6 7.6M13 10l1.4-2.4M9 14l-1.4 2.4M13 14l1.4 2.4" fill="none" stroke="var(--panel-bg, #151a24)" strokeWidth=".9" strokeLinejoin="round" />
    </>
  ),
  // Surfboard standing on its tail in the sand: pointed nose, stringer, tail fin
  surfboard: (
    <>
      <path d="M12 1.5c2.6 3 3.7 7.5 3.7 12 0 3.3-.6 5.7-1.4 7h-4.6c-.8-1.3-1.4-3.7-1.4-7 0-4.5 1.1-9 3.7-12z" />
      <path d="M12 3.5v16.5" fill="none" stroke="var(--panel-bg, #151a24)" strokeWidth=".9" />
      <path d="M9.6 15.5c-1.8.9-3 2.4-3.6 4.3h3.9z" />
      <path d="M4 22.2c2.5-1.6 5-2 8-2s5.5.4 8 2z" />
    </>
  ),
  // Galle lighthouse: tapering tower on a base, balcony, lantern room and domed cap, light beaming out
  lighthouse: (
    <>
      <path d="M9.2 20.5 10.4 9.5h3.2l1.2 11z" />
      <path d="M8.5 8.2h7v1.4h-7zM10 4.8h4v3.4h-4zM9.6 4.9C9.7 3.2 10.7 2 12 2s2.3 1.2 2.4 2.9z" />
      <path d="M6.5 20.3h11v2.2h-11z" />
      <path d="M11 5.6h2v1.8h-2zM11.2 17h1.6v3.4h-1.6zM9.9 14h4.2" fill="none" stroke="var(--panel-bg, #151a24)" strokeWidth=".9" />
      <path d="M16 5.2l5-1.5M16 7.4l5 1.5M8 5.2 3 3.7M8 7.4 3 8.9" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </>
  ),
  // Coconut palm: a trunk curving up, a crown of arching fronds, a cluster of nuts
  palmTree: (
    <>
      <path d="M8.2 22c-.3-5.5 1.3-9.5 4.4-12.6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M13 9C10.6 6.6 7.1 6 4 7.5c3 .1 5.6 1.1 7.5 3zM13 9c-1-2.8-3.5-5-7-5.5 2.4 1.2 4.2 3.3 5 6zM13 9c1-2.8 3.5-5 7-5.5-2.4 1.2-4.2 3.3-5 6zM13 9c2.4-2.4 5.9-3 9-1.5-3 .1-5.6 1.1-7.5 3zM13 9c3 .5 5.5 2.5 6.5 5.5-1.8-1.5-4-2.6-6.5-3zM13 9c-3 .5-5.5 2.5-6.5 5.5 1.8-1.5 4-2.6 6.5-3z" />
      <circle cx="12.2" cy="11" r="1.3" />
      <circle cx="14.4" cy="11.2" r="1.3" />
    </>
  ),
  // Devil mask face-on: bulging eyes, grinning mouth with fangs, ears, and a crown of cobra hoods
  devilMask: (
    <>
      <circle cx="5.2" cy="8" r="1.8" />
      <circle cx="7.6" cy="4.6" r="1.8" />
      <circle cx="12" cy="3.2" r="1.9" />
      <circle cx="16.4" cy="4.6" r="1.8" />
      <circle cx="18.8" cy="8" r="1.8" />
      <path d="M6.2 9.5c0-2.5 2.6-4 5.8-4s5.8 1.5 5.8 4v5.5c0 3.6-2.6 6.8-5.8 6.8s-5.8-3.2-5.8-6.8z" />
      <path d="M6.3 11 3.2 9.8l.6 3.8 2.5 1.2zM17.7 11l3.1-1.2-.6 3.8-2.5 1.2z" />
      <circle cx="9.5" cy="10.5" r="2" fill="var(--panel-bg, #151a24)" />
      <circle cx="14.5" cy="10.5" r="2" fill="var(--panel-bg, #151a24)" />
      <circle cx="9.5" cy="10.5" r=".9" />
      <circle cx="14.5" cy="10.5" r=".9" />
      <path d="M8 15h8c-.5 2.5-2 4-4 4s-3.5-1.5-4-4z" fill="var(--panel-bg, #151a24)" />
      <path d="M9.4 15l.8 2.4.8-2.4zM13 15l.8 2.4.8-2.4z" />
    </>
  ),
  // Crab: a wide shell on bent legs, both claws raised, eyes on stalks
  crab: (
    <>
      <path d="M5.5 14.5c0-2.5 3-4 6.5-4s6.5 1.5 6.5 4-3 4-6.5 4-6.5-1.5-6.5-4z" />
      <path d="M7.5 11.5 5 7.5M16.5 11.5 19 7.5M10.5 10.6V7.8M13.5 10.6V7.8M6 15.5l-3.5 1M6.5 17 3.3 19.5M8 18l-2.3 3.5M18 15.5l3.5 1M17.5 17l3.2 2.5M16 18l2.3 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M3.6 8.2C1.9 6.7 2 4 3.9 2.6l.9 2.9 1.7-2.3c1.4 1.6 1.2 4-.5 5.1zM20.4 8.2c1.7-1.5 1.6-4.2-.3-5.6l-.9 2.9-1.7-2.3c-1.4 1.6-1.2 4 .5 5.1z" />
      <circle cx="10.5" cy="7.4" r="1" />
      <circle cx="13.5" cy="7.4" r="1" />
    </>
  ),
  // Conch shell: a whorled spire, knobbed shoulder tapering to its point, and a flared lip
  conch: (
    <>
      <path d="M8.3 8.4 12 1.5l3.7 6.9z" />
      <path d="M6.5 10c0-1.5 2.4-2.5 5.5-2.5s5.5 1 5.5 2.5c0 4-3 9-5.5 12-2.5-3-5.5-8-5.5-12z" />
      <path d="M6.9 9.3 4.9 7.4l2.8.5zM17.1 9.3l2-1.9-2.8.5z" />
      <path d="M16.5 10.5c2.5-.6 4.9.5 5.6 3-1.3 3-4.2 5.7-7.6 7.6 1.4-3 2-6.6 2-10.6z" />
      <path d="M10.3 4.8h3.4M9.3 6.6h5.4M15.8 12c-.2 3-1.1 5.5-2.4 7.6" fill="none" stroke="var(--panel-bg, #151a24)" strokeWidth=".8" strokeLinecap="round" />
    </>
  ),
};
