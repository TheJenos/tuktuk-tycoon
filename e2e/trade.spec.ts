import { expect, needsEmulator, test } from './support/fixtures';
import { actionBar, cashOn, gameLog, swatch, tradeDialog, tradeOffers } from './support/play';
import { own, roomPosition, space } from './support/positions';

/*
 * A trade between two browsers: Alice offers a swap, Bob counters with cash on top (his counter replaces her
 * offer), and Alice accepts. Both screens end with the same holdings.
 */

needsEmulator();

test('an offer, a counter-offer with cash, and an accept', async ({ table }) => {
  const { alice, bob } = await table({
    position: (setup) => roomPosition(setup, {
      edit: (s) => {
        own(s, 's0', space('Pettah Pavement'));
        own(s, 's1', space('Maradana Lane'));
      },
    }),
  });

  await actionBar(alice.page).getByRole('button', { name: /^Trade/ }).click();
  const offer = tradeDialog(alice.page);
  await expect(offer.getByRole('radio', { name: bob.name })).toHaveAttribute('aria-checked', 'true');
  await offer.getByRole('group', { name: 'You give' }).getByRole('checkbox', { name: 'Pettah Pavement' }).check();
  await offer.getByRole('group', { name: `You get from ${bob.name}` }).getByRole('checkbox', { name: 'Maradana Lane' }).check();
  await expect(offer.locator('.trade-problems')).toHaveText('The offer is valid');
  await offer.getByRole('button', { name: 'Send offer' }).click();
  await expect(offer).toBeHidden();
  await expect(tradeOffers(alice.page).getByRole('article', { name: `Your offer to ${bob.name}` })).toBeVisible();

  // Bob counters: the same swap, and Rs. 2,500 on top
  const incoming = tradeOffers(bob.page).getByRole('article', { name: `Offer from ${alice.name}` });
  await expect(incoming).toContainText('Pettah Pavement');
  await expect(incoming).toContainText('Maradana Lane');
  await incoming.getByRole('button', { name: 'Counter' }).click();
  const counter = tradeDialog(bob.page);
  await expect(counter.getByRole('group', { name: 'You give' }).getByRole('checkbox', { name: 'Maradana Lane' })).toBeChecked();
  await expect(counter.getByRole('group', { name: `You get from ${alice.name}` }).getByRole('checkbox', { name: 'Pettah Pavement' })).toBeChecked();
  await counter.getByRole('group', { name: `You get from ${alice.name}` }).getByLabel('Cash').fill('2500');
  await expect(counter.locator('.trade-problems')).toHaveText('The offer is valid');
  await counter.getByRole('button', { name: 'Send offer' }).click();
  await expect(counter).toBeHidden();

  // Alice's own offer is gone; Bob's is up for her to accept
  await expect(tradeOffers(alice.page).getByRole('article', { name: `Your offer to ${bob.name}` })).toHaveCount(0);
  const back = tradeOffers(alice.page).getByRole('article', { name: `Offer from ${bob.name}` });
  await expect(back).toContainText('Rs. 2,500');
  await back.getByRole('button', { name: 'Accept' }).click();

  for (const p of [alice, bob]) {
    await expect(tradeOffers(p.page)).toHaveCount(0);
    await expect(swatch(p.page, alice.name, 'Maradana Lane')).toBeVisible();
    await expect(swatch(p.page, bob.name, 'Pettah Pavement')).toBeVisible();
    await expect(cashOn(p.page, alice.name)).toHaveText('Rs. 147,500');
    await expect(cashOn(p.page, bob.name)).toHaveText('Rs. 152,500');
    await expect(gameLog(p.page)).toContainText(`${bob.name} and ${alice.name} trade: Maradana Lane for Rs. 2,500 and Pettah Pavement`);
  }
});
