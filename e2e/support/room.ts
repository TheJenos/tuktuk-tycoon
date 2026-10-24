import type { Locator, Page } from '@playwright/test';

/* The online room's screens before the game (src/ui/lobby/WaitingRoom.tsx, RoomBrowser.tsx) */

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const waitingRoom = (page: Page) => page.locator('#waiting-room');
export const startButton = (page: Page) => waitingRoom(page).getByRole('button', { name: /^Start game/ });

/** A seat's card in the waiting room, by the name on it */
export function seatCard(page: Page, name: string): Locator {
  return waitingRoom(page).locator('.seat-card').filter({ has: page.locator('.seat-who strong', { hasText: new RegExp(`^${escape(name)}$`) }) });
}

export const roomList = (page: Page) => page.locator('#room-list');
/** A room's card in Rooms, by its code */
export const roomCard = (page: Page, code: string) => roomList(page).locator('.room-card').filter({ has: page.locator('.code', { hasText: new RegExp(`^${code}$`) }) });
