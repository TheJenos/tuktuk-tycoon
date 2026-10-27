import type { ReactNode } from 'react';

const CUT = 'var(--panel-bg, #151a24)';

/** colombo's token silhouettes (24x24 viewBox; ids in src/shared/tokens.ts) */
export const COLOMBO_ICONS: Record<string, ReactNode> = {
  // Side-on city bus: long boxy body, a band of windows, two wheels
  cityBus: (
    <>
      <path d="M3 4h16.4c1.3 0 2.2.8 2.5 2l.9 4.6V16c0 .8-.7 1.5-1.5 1.5H3c-.8 0-1.5-.7-1.5-1.5V5.5C1.5 4.7 2.2 4 3 4z" />
      <path d="M3.3 6h3.4v4.3H3.3zM8 6h3.4v4.3H8zM12.7 6h3.4v4.3h-3.4zM17.4 6h1.9c.5 0 .8.3.9.7l.7 3.6h-3.5z" fill={CUT} />
      <circle cx="6.5" cy="18" r="2.6" stroke={CUT} strokeWidth="1.2" />
      <circle cx="17.5" cy="18" r="2.6" stroke={CUT} strokeWidth="1.2" />
    </>
  ),
  // Lotus Tower: a slim shaft on a flared base, topped by a lotus-bud pod and a mast
  lotusTower: (
    <>
      <path d="M12 1v4.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M12 4c2.4 1.8 5 3.9 5 6.4 0 1.3-.9 2.1-2.2 2.1H9.2c-1.3 0-2.2-.8-2.2-2.1C7 7.9 9.6 5.8 12 4z" />
      <path d="M9.6 12.5c-.4-2.6.6-5 2.4-6.6M14.4 12.5c.4-2.6-.6-5-2.4-6.6" fill="none" stroke={CUT} strokeWidth=".9" />
      <path d="M11 12.5h2l1 7.5h-4z" />
      <path d="M8 22.5c.5-1.6 1.8-2.5 3-2.5h2c1.2 0 2.5.9 3 2.5z" />
    </>
  ),
  // Clock tower: square shaft on a plinth, a clock face, cornice, lantern and dome
  clockTower: (
    <>
      <path d="M12 1.5c1.7 0 3 1.1 3 3H9c0-1.9 1.3-3 3-3z" />
      <path d="M9.6 5h4.8v3H9.6zM7 8h10v1.6H7zM8.2 9.6h7.6V20H8.2zM6.5 20h11v2.5h-11z" />
      <circle cx="12" cy="13" r="2.7" fill={CUT} />
      <path d="M12 13v-1.7M12 13h1.3" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </>
  ),
  // Side-on crow: round head, heavy beak to the right, long tail, two legs
  crow: (
    <>
      <path d="M12.3 6.2C12.8 4.7 14 4 15.2 4c1.4 0 2.4.9 2.7 2l4.1 1.4-4.1 1.3c.3 4-1.8 7-5.4 7.4L8.8 16.3 2 18.6l.6-2.4 5-3.6C8.4 9.8 10 7.4 12.3 6.2z" />
      <circle cx="15.6" cy="6.2" r=".75" fill={CUT} />
      <path d="M8.8 12.8c2 .4 4.3-.4 5.6-2.3" fill="none" stroke={CUT} strokeWidth="1" strokeLinecap="round" />
      <path d="M11 16v5M13.5 15.8V21M10 21h2.2M12.5 21h2.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </>
  ),
  // Hopper: a deep bowl with a crisp rim, an egg yolk in its middle
  hopper: (
    <>
      <path d="M1.5 9.5c0 6.2 4.7 11 10.5 11s10.5-4.8 10.5-11c0-2-4.7-3.5-10.5-3.5S1.5 7.5 1.5 9.5z" />
      <path d="M3 14.2l1.4-.9 1.4 1.2 1.6-.8 1.5 1.2 1.6-.8 1.5 1.1 1.5-1.1 1.6.8 1.5-1.2 1.6.8 1.4-1.2 1.4.9" fill="none" stroke={CUT} strokeWidth=".8" />
      <path d="M3.6 9.8a8.4 2.7 0 1 0 16.8 0a8.4 2.7 0 1 0-16.8 0z" fill={CUT} />
      <path d="M7 10.6a5 1.7 0 1 0 10 0a5 1.7 0 1 0-10 0z" />
      <circle cx="12.3" cy="9.3" r="2" />
    </>
  ),
  // Isso: a prawn curled into a C, head and feelers top right, fanned tail bottom right
  isso: (
    <>
      <path d="M16.1 5.9A8 8 0 1 0 15.6 18.6l-1.9-2a3.8 3.8 0 1 1 .2-6z" />
      <path d="M13 4.6c3.2-.9 6.3-.3 8.7 1.8l-2.2.9c-.4 1.9-2.3 3.5-5.5 3.5z" />
      <path d="M13.5 16.3l5.5-.8-.6 2.6 2 2.4-6.6.3z" />
      <path d="M3.6 9.2l4.3 2M3.1 13.8l4.6-.5M4.9 17.8l3.9-2.2M8.6 20.2l1.7-3.6" fill="none" stroke={CUT} strokeWidth=".9" />
      <circle cx="16" cy="6.8" r=".7" fill={CUT} />
      <path d="M20.5 6C18 2.5 12 1.5 6.5 3.5M19.5 6.6C17.5 4.6 14 4 10 4.8" fill="none" stroke="currentColor" strokeWidth=".9" strokeLinecap="round" />
    </>
  ),
  // Briefcase: the case with a handle on top, a lid seam and two clasps
  briefcase: (
    <>
      <path d="M9 6.5v-2c0-.6.4-1 1-1h4c.6 0 1 .4 1 1v2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M2 8.5c0-1.1.9-2 2-2h16c1.1 0 2 .9 2 2V19c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2z" />
      <path d="M2 11.8h20" fill="none" stroke={CUT} strokeWidth="1" />
      <path d="M6 10.3h2.6v3H6zM15.4 10.3H18v3h-2.6z" stroke={CUT} strokeWidth=".7" />
    </>
  ),
  // Traffic cone on its square base, with two stripe bands
  trafficCone: (
    <>
      <path d="M10.5 2h3l5 17.5h-13z" />
      <path d="M8.8 8h6.4M7.4 13h9.2" fill="none" stroke={CUT} strokeWidth="2" />
      <path d="M3 19.5h18c.6 0 1 .4 1 1V22H2v-1.5c0-.6.4-1 1-1z" />
    </>
  ),
};
