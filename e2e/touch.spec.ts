import { expect, test } from './support/fixtures';
import { actionBar, buyPrompt, cashOn, endTurn, manageDialog, playersPanel, rollButton } from './support/play';
import { position, seatInfos } from './support/positions';
import { watch } from './support/watch';

/*
 * A phone (390 x 844, touch, mobile user agent): the lobby in one column, and in the game the players along the
 * top with the decision and the action bar in a bottom sheet, every control big enough for a thumb, dialogs as
 * sheets from the bottom, and the 2D view one tap away. Played with taps only.
 */

test('on a phone: the lobby fits, and a turn plays from the bottom sheet with taps', async ({ players }) => {
  const p = await players.open({ name: 'Tess', mobile: true });
  const { page } = p;
  const seen = watch(page);
  const vp = page.viewportSize()!;

  await p.gotoLobby();
  await expect(page.getByRole('button', { name: /Play now/ })).toBeInViewport();
  await expect(page.getByRole('tab', { name: 'Local game' })).toBeInViewport();
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);

  await p.startSolo(position(seatInfos([{ name: 'Tess' }, { name: 'Ava', bot: true }])));
  const bar = actionBar(page);
  const dock = (await bar.boundingBox())!;
  // Docked along the bottom edge, full width; the players strip along the top
  expect(dock.y + dock.height).toBeGreaterThanOrEqual(vp.height - 2);
  expect(dock.width).toBeGreaterThanOrEqual(vp.width - 16);
  expect((await playersPanel(page).boundingBox())!.y).toBeLessThan(80);
  expect((await rollButton(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  for (const name of [/^Manage/, /^Trade/, /^Menu$/]) {
    const b = (await bar.getByRole('button', { name }).boundingBox())!;
    expect(Math.min(b.width, b.height), String(name)).toBeGreaterThanOrEqual(44);
  }

  await p.rig([1, 2]);
  await rollButton(page).tap();
  // The decision sits in the sheet, above the action bar and on screen
  const buy = buyPrompt(page);
  await expect(buy).toBeInViewport();
  const sheet = (await buy.boundingBox())!;
  expect(sheet.y + sheet.height).toBeLessThanOrEqual((await bar.boundingBox())!.y + 1);
  await buy.getByRole('button', { name: /^Buy for Rs\. 6,000/ }).tap();
  await expect(cashOn(page, 'Tess')).toHaveText('Rs. 144,000');

  // Manage comes up as a sheet from the bottom, the full width of the screen
  await bar.getByRole('button', { name: /^Manage/ }).tap();
  const manage = manageDialog(page);
  await expect(manage).toBeVisible();
  const m = (await manage.boundingBox())!;
  expect(Math.round(m.x)).toBe(0);
  expect(Math.round(m.width)).toBe(vp.width);
  expect(m.y + m.height).toBeGreaterThanOrEqual(vp.height - 2);
  await manage.getByRole('button', { name: 'Close' }).tap();
  await expect(manage).toBeHidden();

  // The 2D / 3D switch: one tap to the top-down view, one back
  await bar.getByRole('button', { name: 'Switch to the 2D view' }).tap();
  await expect(bar.getByRole('button', { name: 'Switch to the 3D view' })).toBeVisible();
  expect(await page.evaluate(() => (JSON.parse(localStorage.getItem('tuktuk-settings') ?? '{}') as { boardView?: string }).boardView)).toBe('2d');
  await bar.getByRole('button', { name: 'Switch to the 3D view' }).tap();
  await expect(bar.getByRole('button', { name: 'Switch to the 2D view' })).toBeVisible();

  await endTurn(p);
  await expect(rollButton(page)).toBeInViewport();
  seen.check();
});
