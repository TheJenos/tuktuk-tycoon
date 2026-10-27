import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { Doc } from '../../src/net/types';
import type { Action, GameState, SeatId } from '../../src/rules';
import { soloSave } from './positions';
import { confirm } from './ui';

/*
 * One player: a browser context of their own (own localStorage, so own name and seat) with a page on the
 * game. Wraps the lobby steps and `window.game` for the in-game ones.
 *
 * window.game arrives with the waiting room or game screen (src/ui/testHooks.ts). Assertions should read the DOM,
 * and use window.game only to wait for the right moment or to rig what the dice would otherwise decide.
 */

export type { SeatId };

/** One rigged throw: two white dice, then the speed die's face when it's in play (1-3, 'bus', 'uncle') */
export type Throw = (number | string)[];

export type DispatchResult = { ok: true; seq: number } | { ok: false; code: string; message: string; error?: string };

/** What `window.game` offers the tests (dev and e2e builds only); src/ui/testHooks.ts has the real one */
export interface GameHooks {
  joined: boolean;
  roomCode: string;
  /** This browser's player id */
  me: string;
  seq(): number;
  /** The logical game state, as the engine has it (null before the game starts) */
  state(): GameState | null;
  /** What the board shows right now (catches up with state() once the animations are done) */
  view(): GameState | null;
  /** No animations playing or queued */
  idle(): boolean;
  /** Finish the animations at once */
  flush(): void;
  mySeats(): SeatId[];
  /** An engine action from one of our seats (the one the game waits on by default), as the buttons send it */
  dispatch(action: Action, seat?: SeatId): Promise<DispatchResult>;
  test: {
    /** The next throws (debug games only) */
    rig(dice: Throw[]): Promise<void>;
    /** Hero League: the next Hero-die throws, by face (1-6) or by hero ('stormLord', 'Storm Lord') */
    rigHero(faces: (number | string)[]): Promise<void>;
    setCash(seat: SeatId, cash: number): Promise<void>;
    /** Click a tile, as the 3D board would (a test can't aim at it) */
    pickTile(index: number): void;
    hoverTile(index: number | null): void;
    openDeed(index: number): void;
  };
}

declare global {
  interface Window {
    game?: GameHooks;
  }
}

/** Saved settings for every test player: no animations, no physics, cheapest rendering, silent. */
export const SETTINGS = { animSpeed: 'instant', quality: 'low', dicePhysics: false, sound: false, music: false, version: 1 };

export interface PlayerOptions {
  /** Skip the first-visit name prompt with this name; null shows the prompt */
  name: string | null;
  /** A touch-screen player */
  touch?: boolean;
  /** A phone: touch, a mobile viewport and user agent (implies touch) */
  mobile?: boolean;
  viewport?: { width: number; height: number };
  /** Merged over SETTINGS */
  settings?: Record<string, unknown>;
}

const PHONE_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

export class Player {
  private constructor(readonly context: BrowserContext, readonly page: Page, readonly name: string) {}

  static async open(browser: Browser, opts: PlayerOptions): Promise<Player> {
    const context = await browser.newContext({
      viewport: opts.viewport ?? (opts.mobile ? { width: 390, height: 844 } : { width: 960, height: 540 }),
      ...(opts.mobile ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: PHONE_UA } : opts.touch ? { hasTouch: true, isMobile: false } : {}),
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    // Only seed what isn't there yet, so a test can change settings and reload.
    await context.addInitScript(({ name, settings }) => {
      const seed = (k: string, v: string) => { if (localStorage.getItem(k) === null) localStorage.setItem(k, v); };
      if (name) seed('tuktuk-name', name);
      seed('tuktuk-settings', JSON.stringify(settings));
    }, { name: opts.name, settings: { ...SETTINGS, ...opts.settings } });
    const page = await context.newPage();
    page.on('pageerror', (err) => console.log(`[${opts.name ?? 'new player'}] page error: ${err.message}`));
    return new Player(context, page, opts.name ?? '');
  }

  // ---------------------------------------------------------------- lobby

  async gotoLobby(query = ''): Promise<void> {
    await this.page.goto(`/${query ? `?${query}` : ''}`);
    // The dev server compiles the app on the first visits of a run
    await expect(this.page.locator('#lobby')).toBeVisible({ timeout: 45_000 });
  }

  /** Join a room with the code box in the menu, and wait until we're in it. */
  async joinByCode(code: string): Promise<void> {
    await this.page.getByLabel('Room code').fill(code);
    await this.page.locator('form.code-join').getByRole('button', { name: 'Join' }).click();
    await this.waitJoined();
  }

  /** In Create room, go to step `name`: by the step bar if it's been reached, else Next until it is. */
  async createStep(name: 'Rules' | 'Seats' | 'Launch'): Promise<void> {
    const target = this.page.getByRole('list', { name: 'Steps' }).getByRole('button', { name, exact: true });
    while (!(await target.isEnabled())) await this.page.getByRole('button', { name: /^Next:/ }).click();
    if ((await target.getAttribute('aria-current')) !== 'step') await target.click();
    await expect(target).toHaveAttribute('aria-current', 'step');
  }

  /** In the room (waiting room or game): connected, and our seat or spectator place taken. */
  async waitJoined(): Promise<void> {
    await this.page.waitForFunction(() => window.game?.joined === true, null, { timeout: 90_000 });
    await expect(this.page.locator('#connecting-overlay')).toBeHidden();
  }

  roomCode(): Promise<string> {
    return this.page.evaluate(() => window.game!.roomCode);
  }

  /** This browser's player id in the room it is in */
  id(): Promise<string> {
    return this.page.evaluate(() => window.game!.me);
  }

  /** As the room's owner, start the game from the waiting room, and wait until it's on screen. */
  async startGame(): Promise<void> {
    await this.page.locator('#waiting-room').getByRole('button', { name: /^Start game/ }).click();
    await this.waitStarted();
  }

  async waitStarted(): Promise<void> {
    await this.page.waitForFunction(() => window.game?.state() != null, null, { timeout: 30_000 });
  }

  /**
   * Start offline from a position (positions.ts): it goes in as the autosave, then "Continue solo game" picks it
   * up, just as after a reload.
   */
  async startSolo(doc: Doc): Promise<void> {
    await this.gotoLobby();
    const [key, value] = soloSave(doc, this.name);
    await this.page.evaluate(([k, v]) => localStorage.setItem(k, v), [key, value] as const);
    await this.page.reload();
    await this.page.getByRole('button', { name: /^Continue solo game/ }).click();
    await this.waitStarted();
    await this.waitIdle();
  }

  // ---------------------------------------------------------------- game

  seq(): Promise<number> {
    return this.page.evaluate(() => window.game!.seq());
  }

  state(): Promise<GameState> {
    return this.page.evaluate(() => window.game!.state()!);
  }

  view(): Promise<GameState> {
    return this.page.evaluate(() => window.game!.view()!);
  }

  mySeats(): Promise<SeatId[]> {
    return this.page.evaluate(() => window.game!.mySeats());
  }

  /** Wait until everything up to `seq` (whatever we have now, by default) has played out on this screen. */
  async waitIdle(seq?: number): Promise<void> {
    await this.page.waitForFunction(
      (seq) => !!window.game && window.game.idle() && (seq === null || window.game.seq() >= seq),
      seq ?? null,
      { timeout: 30_000 },
    );
  }

  /** Send an engine action as one of our seats, as the buttons would. */
  dispatch(action: Action, seat?: SeatId): Promise<DispatchResult> {
    return this.page.evaluate(({ action, seat }) => window.game!.dispatch(action, seat), { action, seat });
  }

  /** The next rolls come up `throws`, in order, whoever rolls them (debug games only). */
  async rig(...throws: Throw[]): Promise<void> {
    await this.page.evaluate((dice) => window.game!.test.rig(dice), throws);
  }

  /** Hero League: the next Hero-die throws come up these heroes (or faces), in order (debug games only). */
  async rigHero(...faces: (number | string)[]): Promise<void> {
    await this.page.evaluate((f) => window.game!.test.rigHero(f), faces);
  }

  async setCash(seat: SeatId, cash: number): Promise<void> {
    await this.page.evaluate(({ seat, cash }) => window.game!.test.setCash(seat, cash), { seat, cash });
  }

  async pickTile(index: number): Promise<void> {
    await this.page.evaluate((i) => window.game!.test.pickTile(i), index);
  }

  async openDeed(index: number): Promise<void> {
    await this.page.evaluate((i) => window.game!.test.openDeed(i), index);
  }

  // ---------------------------------------------------------------- menus

  /** The game menu (Esc), as GameMenu draws it */
  get gameMenu() {
    return this.page.locator('#game-menu');
  }

  /** By the action bar's Menu button (Esc would first close whatever else is up, such as a card's caption) */
  async openGameMenu(): Promise<void> {
    await this.page.locator('#hud').getByRole('navigation', { name: 'Actions' }).getByRole('button', { name: 'Menu', exact: true }).click();
    await expect(this.gameMenu).toBeVisible();
  }

  async leave(): Promise<void> {
    if (!(await this.gameMenu.isVisible())) await this.openGameMenu();
    await confirm(this.gameMenu.getByRole('button', { name: 'Leave room' }));
    await expect(this.page.locator('#lobby')).toBeVisible();
  }

  /**
   * Close this tab and open the game in a new one, in the same browser: localStorage (name, settings, the 7-day
   * seat memory) carries over, sessionStorage (this tab's room) doesn't.
   */
  async reopen(): Promise<Player> {
    await this.page.close();
    const page = await this.context.newPage();
    page.on('pageerror', (err) => console.log(`[${this.name}] page error: ${err.message}`));
    return new Player(this.context, page, this.name);
  }

  async close(): Promise<void> {
    await this.context.close().catch(() => {});
  }
}
