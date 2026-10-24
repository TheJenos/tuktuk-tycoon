import { test as base, expect } from '@playwright/test';
import type { SetupRecord } from '../../src/net/network';
import type { Doc } from '../../src/net/types';
import { db, deleteRoom, dropPlaceholder, rules, seedRoom, seedState, type RoomRules, type SeedOptions } from './db';
import { Player, type PlayerOptions } from './player';

/*
 * Fixtures:
 *   players  opens players (each in their own browser context) and closes them after the test
 *   rooms    remembers room codes so their database records are deleted after the test
 *   table    a room with debug rules and Alice and Bob seated in it: in the waiting room, or in a started
 *            game (by the owner's Start button, or from a seeded position)
 *
 * The online specs need the Realtime Database emulator: `npm run test:e2e` runs it around Playwright, and
 * global-setup.ts finds one started by hand (`npm run emulator`). Without one they skip (needsEmulator()), so
 * `npx playwright test` still runs the offline specs on a machine without Java.
 */

/** The database emulator is up for this run */
export const EMULATOR = !!process.env.FIREBASE_DATABASE_EMULATOR_HOST;

/** At the top of an online spec: skip it when there is no emulator to talk to */
export function needsEmulator(): void {
  base.skip(!EMULATOR, 'Needs the Realtime Database emulator (npm run test:e2e)');
}

export interface Table {
  code: string;
  alice: Player;
  bob: Player;
}

export interface TableOptions {
  rules?: RoomRules;
  room?: SeedOptions;
  /** Alice (the owner, as the first to join) starts the game from the waiting room */
  start?: boolean;
  /** Before the game starts, with both seated: e.g. the owner adds a bot */
  seated?(t: Table): Promise<void>;
  /**
   * Or: begin from a chosen position. Called once both have taken their seats (Alice s0, Bob s1), with the room's
   * setup; returns the transacted document to start from (positions.ts roomPosition).
   */
  position?(setup: Partial<SetupRecord> | null): Doc;
}

export interface Fixtures {
  players: { open(opts: PlayerOptions | string): Promise<Player> };
  rooms: { track(code: string): string; seed(r?: RoomRules, opts?: SeedOptions): Promise<string> };
  table(opts?: TableOptions): Promise<Table>;
}

/** Each test gets its own names, so parallel workers never mix up their rooms. */
let serial = 0;
export const uniqueName = (prefix: string) => `${prefix}${process.pid % 1000}${++serial}`.slice(0, 16);

export const test = base.extend<Fixtures>({
  players: async ({ browser }, use) => {
    const open: Player[] = [];
    await use({
      async open(opts) {
        const p = await Player.open(browser, typeof opts === 'string' ? { name: opts } : opts);
        open.push(p);
        return p;
      },
    });
    await Promise.all(open.map((p) => p.close()));
  },

  rooms: async ({}, use) => {
    const codes = new Set<string>();
    await use({
      track: (code) => (codes.add(code), code),
      seed: async (r, opts) => {
        const code = await seedRoom(r, opts);
        codes.add(code);
        return code;
      },
    });
    await Promise.all([...codes].map((c) => deleteRoom(c).catch(() => {})));
  },

  table: async ({ players, rooms }, use) => {
    await use(async ({ rules: r = rules(), room, start = false, seated, position } = {}) => {
      const code = await rooms.seed(r, room);
      const alice = await players.open(uniqueName('Alice'));
      const bob = await players.open(uniqueName('Bob'));
      await alice.gotoLobby();
      await alice.joinByCode(code);
      // Alice is the only member left, so she becomes the owner before Bob arrives.
      await dropPlaceholder(code);
      await expect(alice.page.locator('#waiting-room').getByRole('button', { name: /^Start game/ })).toBeVisible();
      await bob.gotoLobby();
      await bob.joinByCode(code);
      const t = { code, alice, bob };
      await seated?.(t);
      if (position) {
        const doc = position(await db.get<Partial<SetupRecord>>(`rooms/${code}/setup`));
        await seedState(code, doc, { gid: doc.gid, seq: doc.seq });
      } else if (start) await alice.startGame();
      if (start || position) {
        await Promise.all([alice.waitStarted(), bob.waitStarted()]);
        // Both screens on the same move before the test begins
        await expect.poll(async () => {
          const [a, b] = await Promise.all([alice.seq(), bob.seq()]);
          return a === b;
        }).toBe(true);
        await Promise.all([alice.waitIdle(), bob.waitIdle()]);
      }
      return t;
    });
  },
});

export { expect };
export { rules };
