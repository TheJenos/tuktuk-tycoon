import type { ReactNode } from 'react';

/** The Hill Country's token silhouettes (24x24 viewBox; ids in src/shared/tokens.ts) */
export const HILL_ICONS: Record<string, ReactNode> = {
  // Steam locomotive: cab, boiler with a flared chimney and dome, three wheels and a cowcatcher
  steamTrain: (
    <>
      <path d="M1 3.5h9.5V5H9.5v11H2.5V5H1z" />
      <path d="M3.8 6.5h4.4v3.6H3.8z" fill="var(--panel-bg, #151a24)" />
      <path d="M9 9h10.8c.9 0 1.7.8 1.7 1.7V16H9z" />
      <path d="M15.6 3.5h4l-.8 1.6V9.5h-2.4V5.1z" />
      <circle cx="12.8" cy="9" r="1.7" />
      <path d="M20 14.5h1.5l2 3.5H20z" />
      <circle cx="5.5" cy="18.5" r="2.8" />
      <circle cx="11.8" cy="19" r="2.3" />
      <circle cx="17" cy="19" r="2.3" />
    </>
  ),
  // Adam's Peak: a steep summit with a shoulder peak, the pilgrims' path and a shrine on top
  adamsPeak: (
    <>
      <path d="M1.5 21.5c1.8-3 3.5-5.8 5.3-8.4l1.6 1.4L12 6.5l3.6 8 1.6-1.4c1.9 2.6 3.6 5.4 5.3 8.4z" />
      <path d="M10.6 4.3h2.8v2.4h-2.8zM10 4.5 12 2.4l2 2.1z" />
      <path d="M12 9.5 10.8 12l2.4 2.4-2 2.6 2.6 2.6" fill="none" stroke="var(--panel-bg, #151a24)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  // Nine Arch Bridge: a deck with parapets on a row of round arches
  archBridge: (
    <>
      <path d="M.5 4.5h23V6H.5z" />
      <path d="M1 6.5h22V20h-1.4v-6a1.9 1.9 0 0 0-3.8 0v6h-1.33v-6a1.9 1.9 0 0 0-3.8 0v6h-1.34v-6a1.9 1.9 0 0 0-3.8 0v6H6.2v-6a1.9 1.9 0 0 0-3.8 0v6H1z" />
    </>
  ),
  // Tea plucker's basket: a tall tapered wicker basket with weave bands, heaped with leaves
  teaBasket: (
    <>
      <path d="M12 1.2c1.6 1.2 2 3.2 0 5-2-1.8-1.6-3.8 0-5zM16.8 2.6c.6 1.9-.2 3.7-2.6 4.3-.5-2.4.6-3.9 2.6-4.3zM7.2 2.6c-.6 1.9.2 3.7 2.6 4.3.5-2.4-.6-3.9-2.6-4.3z" />
      <path d="M5.5 8c1.2-2 3.5-3 6.5-3s5.3 1 6.5 3z" />
      <path d="M4 7.6h16v2H4zM5.2 10h13.6l-2.4 12H7.6z" />
      <path d="M5.8 13.5h12.4M6.6 17.5h10.8" fill="none" stroke="var(--panel-bg, #151a24)" strokeWidth=".8" />
    </>
  ),
  // Strawberry: a plump seeded berry under a star of sepals and a stem
  strawberry: (
    <>
      <path d="M12 22.5c-3.6-1.6-8.2-6-8.2-10.6 0-3 2.6-4.6 5.2-4.1 1.2.2 2.2.6 3 .6s1.8-.4 3-.6c2.6-.5 5.2 1.1 5.2 4.1 0 4.6-4.6 9-8.2 10.6z" />
      <path d="M12 9.6 8.2 10.4l1.4-1.9-3.4-.6 3.3-1.3L7.7 4.8l3 .8L12 3.4l1.3 2.2 3-.8-1.8 1.8 3.3 1.3-3.4.6 1.4 1.9z" stroke="var(--panel-bg, #151a24)" strokeWidth=".8" strokeLinejoin="round" />
      <path d="M12 3.6V1.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <g fill="var(--panel-bg, #151a24)">
        <circle cx="8" cy="12.5" r=".6" />
        <circle cx="12" cy="12" r=".6" />
        <circle cx="16" cy="12.5" r=".6" />
        <circle cx="10" cy="15.5" r=".6" />
        <circle cx="14" cy="15.5" r=".6" />
        <circle cx="12" cy="18.8" r=".6" />
      </g>
    </>
  ),
  // Rain umbrella: a scalloped canopy with a finial, on a shaft ending in a crook handle
  umbrella: (
    <>
      <path d="M1.5 12.5C1.9 7 6.4 3 12 3s10.1 4 10.5 9.5a2.625 1.4 0 0 0-5.25 0 2.625 1.4 0 0 0-5.25 0 2.625 1.4 0 0 0-5.25 0 2.625 1.4 0 0 0-5.25 0z" />
      <path d="M12 3.2V1.3M12 11v8.3a2 2 0 0 1-4 0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </>
  ),
  // Leech: a body lying in a curve on its tail sucker, rearing up with its head bent forward
  leech: (
    <>
      <path d="M4.5 19.5c2.5 1.5 7 1.4 8.8-.6 1.4-1.6.4-4-.5-6.4s-1.4-5.1.6-6.6c1.6-1.2 3.7-.9 5.1.7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <ellipse cx="4.2" cy="19.6" rx="2.8" ry="2.2" />
    </>
  ),
  // Sambar deer, side-on: deep body on four legs, raised neck and head, and branching antlers
  sambar: (
    <>
      <path d="M4.5 11c0-1.5 1.3-2.5 3-2.5h6.5l2.2-2.6c.5-.6 1.3-.9 2-.7l1.3.4 2.8 2.4c.4.4.3 1-.2 1.2l-1 .3-3.4-.4-1.7 2.5V15c0 .9-.6 1.5-1.5 1.6H6.5c-1.2 0-2-.9-2-2.1z" />
      <path d="M5.6 15h1.8v7H5.6zM8.4 15h1.8v7H8.4zM12.4 15h1.7v7h-1.7zM14.6 15h1.6v7h-1.6zM4.7 10.4l-1.8.9.5 1.4 1.4-.7zM17 6.2l-2.9-1.3 1.3 2.1z" />
      <path d="M18.2 5.3 16.5 1M17.7 4.1l2.7-1.5M16.9 2.3l1.9-1.5M16.6 5.6 13.8 2.4M14.9 3.6l-.3-2.3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </>
  ),
};
