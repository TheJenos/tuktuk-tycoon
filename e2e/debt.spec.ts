import { expect, needsEmulator, test } from './support/fixtures';
import { cashOn, endTurnButton, gameLog, gameOver, manageDialog, rollButton, swatch, badge } from './support/play';
import { build, own, place, roomPosition, setCash, space } from './support/positions';
import { confirm } from './support/ui';

/*
 * Owing more than you have: raise the cash (here by mortgaging in Manage, after which the debt settles by itself),
 * or, when even selling everything couldn't cover it, declare bankruptcy, which hands everything to the creditor
 * and in a two-player game ends it.
 */

needsEmulator();

test('rent Alice can only pay by mortgaging: Manage from the debt panel, and the debt settles itself', async ({ table }) => {
  const { alice, bob } = await table({
    position: (setup) => roomPosition(setup, {
      edit: (s) => {
        own(s, 's1', space('Cinnamon Gardens'), space('Galle Face Penthouse'));
        own(s, 's0', space('Colombo Fort Station'));
        place(s, 's0', space('Galle Station'));
        setCash(s, 's0', 40);
      },
    }),
  });
  await alice.rig([1, 3]);
  await rollButton(alice.page).click();
  // Galle Face Penthouse with the set: Rs. 100
  const debt = alice.page.locator('.debt-panel');
  await expect(debt.getByRole('heading', { level: 2 })).toHaveText('You owe Rs. 100');
  await expect(debt).toContainText(`Rs. 100 to ${bob.name}`);
  await expect(debt).toContainText('Raise Rs. 60 more to pay.');
  await expect(bob.page.getByTestId('turn-bar')).toContainText(`${alice.name} must raise cash to pay Rs. 100`);

  await debt.getByRole('button', { name: 'Sell or mortgage' }).click();
  const manage = manageDialog(alice.page);
  await manage.getByRole('region', { name: 'Stations and boards' }).getByRole('button', { name: 'Mortgage for Rs. 100' }).click();
  await manage.getByRole('button', { name: 'Apply (+Rs. 100)' }).click();
  await expect(debt).toHaveCount(0);
  await manage.getByRole('button', { name: 'Close' }).click();

  await expect(endTurnButton(alice.page)).toBeVisible();
  for (const p of [alice, bob]) {
    await expect(cashOn(p.page, alice.name)).toHaveText('Rs. 40');
    await expect(cashOn(p.page, bob.name)).toHaveText('Rs. 1,600');
    await expect(swatch(p.page, alice.name, 'Colombo Fort Station, mortgaged')).toBeAttached();
    await expect(gameLog(p.page)).toContainText(`${alice.name} pays ${bob.name} Rs. 100 rent for Galle Face Penthouse`);
  }
});

test('a debt nothing can cover: bankruptcy to the creditor ends a two-player game', async ({ table }) => {
  const { alice, bob } = await table({
    position: (setup) => roomPosition(setup, {
      edit: (s) => {
        own(s, 's1', space('Cinnamon Gardens'), space('Galle Face Penthouse'));
        build(s, space('Cinnamon Gardens'), 5);
        build(s, space('Galle Face Penthouse'), 5);
        own(s, 's0', space('Pettah Pavement'));
        place(s, 's0', space('Galle Station'));
        setCash(s, 's0', 300);
      },
    }),
  });
  await alice.rig([1, 3]);
  await rollButton(alice.page).click();
  // A hotel on Galle Face Penthouse: Rs. 2,000, against Rs. 300 and a Rs. 30 mortgage
  const debt = alice.page.locator('.debt-panel');
  await expect(debt.getByRole('heading', { level: 2 })).toHaveText('You owe Rs. 2,000');
  await expect(debt).toContainText('could raise up to Rs. 330');
  await expect(debt.getByRole('button', { name: 'Auto-raise and pay' })).toHaveCount(0);
  await confirm(debt.getByRole('button', { name: 'Declare bankruptcy' }));

  for (const p of [alice, bob]) {
    await expect(gameOver(p.page).getByRole('heading', { level: 2 })).toHaveText(`${bob.name} wins!`);
    await expect(gameOver(p.page)).toContainText('Last player standing');
    await expect(gameLog(p.page)).toContainText(`${alice.name} goes bankrupt to ${bob.name}`);
    await expect(badge(p.page, alice.name, 'Bankrupt')).toBeAttached();
    await expect(swatch(p.page, bob.name, 'Pettah Pavement')).toBeAttached();
  }
});
