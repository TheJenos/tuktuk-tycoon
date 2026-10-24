import { db } from './support/db';
import { expect, needsEmulator, test, uniqueName } from './support/fixtures';
import { roomCard, roomList, seatCard, startButton, waitingRoom } from './support/room';
import { choose, openTab } from './support/ui';

/*
 * The lobby's ways into an online room: the live room list (with search), Create room's three steps, a room
 * code, and an invite link; and what it says when a room is gone or the server can't be reached.
 */

test.describe('with the database', () => {
  needsEmulator();

  test('Rooms lists a room live, search narrows the list, and Join takes a seat in its waiting room', async ({ players, rooms }) => {
    const code = await rooms.seed();
    const p = await players.open(uniqueName('Lena'));
    await p.gotoLobby();
    await openTab(p.page, 'Rooms');
    const card = roomCard(p.page, code);
    await expect(card).toBeVisible();
    await expect(card).toContainText(`E2E ${code}`);
    await expect(card).toContainText('0/8 seats');
    await expect(card).toContainText('Waiting to start');

    const search = p.page.getByRole('searchbox', { name: 'Search rooms' });
    await search.fill('no room is called this');
    await expect(roomList(p.page)).toContainText('No rooms match');
    await roomList(p.page).getByRole('button', { name: 'Clear search' }).click();
    await search.fill(code);
    await expect(roomList(p.page).locator('.room-card')).toHaveCount(1);

    await card.getByRole('button', { name: `Join E2E ${code} (${code})` }).click();
    await p.waitJoined();
    await expect(waitingRoom(p.page)).toBeVisible();
    await expect(waitingRoom(p.page).locator('.room-chip .room-code')).toHaveText(code);
    await expect(seatCard(p.page, p.name).locator('.badge', { hasText: 'You' })).toBeVisible();
    await expect(p.page).toHaveURL(new RegExp(`#${code}$`));
    await expect.poll(() => db.get(`rooms/${code}/setup/seats/s0/name`)).toBe(p.name);
    await expect.poll(() => db.get(`lobby/${code}/seatsTaken`)).toBe(1);
  });

  test('Create room: Rules, Seats, then Launch opens its waiting room with a code to share', async ({ players, rooms }) => {
    const p = await players.open(uniqueName('Cara'));
    const { page } = p;
    await p.gotoLobby();
    await openTab(page, 'Create room');
    const panel = page.getByRole('tabpanel', { name: 'Create room' });

    await p.createStep('Rules');
    await panel.getByRole('checkbox', { name: 'Speed Die' }).check();
    await choose(panel, 'Turn timer', 'Off');
    await p.createStep('Seats');
    await choose(panel, 'Seats', '4');
    await panel.getByRole('button', { name: '＋ Add a bot' }).click();
    await p.createStep('Launch');
    await expect(panel.getByRole('button', { name: 'Rules. Change' })).toContainText('Classic + Speed Die');
    await expect(panel.getByRole('button', { name: '4 seats. Change' })).toContainText('1 bot (Normal)');
    await panel.getByLabel('Room name').fill('Cara test table');
    await choose(panel, 'Who can find it', 'Private');
    await panel.getByRole('button', { name: 'Create room', exact: true }).click();

    await p.waitJoined();
    const code = rooms.track(await p.roomCode());
    await expect(waitingRoom(page).locator('.room-chip')).toContainText('Cara test table');
    await expect(waitingRoom(page).locator('.room-chip .room-code')).toHaveText(code);
    await expect(waitingRoom(page).locator('.seat-card.bot')).toHaveCount(1);
    await expect(waitingRoom(page).locator('.seat-card.open')).toHaveCount(2);
    await expect(startButton(page)).toBeEnabled();
    expect(await db.get(`lobby/${code}`)).toMatchObject({ name: 'Cara test table', public: false, speedDie: true, maxSeats: 4, seatsTaken: 2, status: 'waiting' });
    expect(await db.get(`rooms/${code}/setup/rules`)).toMatchObject({ speedDie: true, turnTimer: 0 });
    // A private room isn't listed for anyone else
    const other = await players.open(uniqueName('Olaf'));
    await other.gotoLobby();
    await openTab(other.page, 'Rooms');
    await expect(roomList(other.page)).toHaveAttribute('aria-busy', 'false');
    await expect(roomCard(other.page, code)).toHaveCount(0);
  });

  test('a code for a room that is gone says so, and stays in the lobby', async ({ players }) => {
    const p = await players.open(uniqueName('Gus'));
    await p.gotoLobby();
    // Six characters: no seeded room (five) can have it
    await p.page.getByLabel('Room code').fill('TZZZZZ');
    await p.page.locator('form.code-join').getByRole('button', { name: 'Join' }).click();
    await expect(p.page.locator('.code-join-box').getByRole('alert')).toHaveText('That room has closed.');
    await expect(p.page.locator('#lobby')).toBeVisible();
    await expect(p.page.locator('#connecting-overlay')).toHaveCount(0);
  });

  test('an invite link counts down and goes straight into the room', async ({ players, rooms }) => {
    const code = await rooms.seed();
    const p = await players.open(uniqueName('Ivy'));
    await p.page.goto(`/?room=${code}`);
    await expect(p.page.locator('.invite-card')).toContainText(`Joining room ${code}`, { timeout: 45_000 });
    await p.waitJoined();
    await expect(waitingRoom(p.page)).toBeVisible();
    // The address now holds the room, not the invite
    await expect(p.page).toHaveURL(new RegExp(`/#${code}$`));
  });

  test('a second tab of the same browser opening the invite is a second player, not the first one again', async ({ players, rooms }) => {
    const code = await rooms.seed();
    const p = await players.open(uniqueName('Tess'));
    await p.page.goto(`/?room=${code}`);
    await p.waitJoined();
    const first = await p.id();
    const tab = await p.context.newPage();
    await tab.goto(`/?room=${code}`);
    await tab.waitForFunction(() => window.game?.joined === true, null, { timeout: 90_000 });
    expect(await tab.evaluate(() => window.game!.me)).not.toBe(first);
    await expect.poll(async () => Object.keys((await db.get<Record<string, unknown>>(`rooms/${code}/setup/seats`)) ?? {}).length).toBe(2);
    await expect.poll(() => db.get(`lobby/${code}/members/${first}`)).toBe(p.name);
  });

  test('an invite to a room that has closed says so', async ({ players }) => {
    const p = await players.open(uniqueName('Ned'));
    await p.page.goto('/?room=TZZZZZ');
    await expect(p.page.locator('#lobby').getByRole('alert')).toContainText('That room has closed.', { timeout: 45_000 });
    await expect(p.page).not.toHaveURL(/room=/);
  });
});

test('the room list says when the server cannot be reached', async ({ players }) => {
  test.slow();
  const p = await players.open('Offline');
  // Nothing gets through to the database (with or without an emulator running)
  await p.context.route(/127\.0\.0\.1:9000|localhost:9000/, (route) => route.abort());
  await p.context.routeWebSocket(/:9000/, () => {});
  await p.gotoLobby();
  await openTab(p.page, 'Rooms');
  await expect(roomList(p.page)).toContainText("Couldn't reach the server", { timeout: 20_000 });
  await expect(roomList(p.page).getByRole('button', { name: 'Retry' })).toBeVisible();
});
