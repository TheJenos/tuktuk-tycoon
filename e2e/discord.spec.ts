import { expect, test } from './support/fixtures';

/*
 * Inside Discord the game runs in an Activity iframe, talking to Discord's client through postMessage. That
 * handshake can't happen outside Discord, so this only checks that the Discord lobby takes over (and doesn't fall
 * back to the browser lobby) when launched as one. It never gets as far as the database, so it needs no emulator.
 */
test('launched as a Discord Activity, it waits for Discord', async ({ players }) => {
  const p = await players.open('Discordian');
  await p.page.goto('/?frame_id=e2e&instance_id=e2e&platform=desktop');
  await expect(p.page.locator('#lobby')).toBeVisible({ timeout: 45_000 });
  await expect(p.page.locator('#lobby')).toContainText(/Connecting to Discord|Could not connect to Discord/);
  await expect(p.page.getByLabel('Your name')).toHaveCount(0);
  await expect(p.page.getByRole('tab', { name: 'Create room' })).toHaveCount(0);
  await expect(p.page.getByRole('button', { name: /Play now/ })).toHaveCount(0);
});
