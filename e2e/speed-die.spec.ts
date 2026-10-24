import { expect, test } from './support/fixtures';
import { buyPrompt, cashOn, endTurn, gameLog, prompt, rollButton, swatch, turnBar } from './support/play';
import { position, seatInfos, space, speedOn } from './support/positions';
import { openTab } from './support/ui';
import { watch } from './support/watch';

/*
 * The Speed Die rules (docs/rules.md): the room setting, then a rigged game with the die unlocked: triples and the
 * space picker (with another roll after), the Bus choice, and Tuk-Tuk Uncle moving on to the next property for sale.
 */

test('the Local game wizard starts a Speed Die game: the bonus cash and the rules in the game menu', async ({ players }) => {
  const p = await players.open('Rita');
  const { page } = p;
  const seen = watch(page);
  await p.gotoLobby();
  await openTab(page, 'Local game');
  const panel = page.getByRole('tabpanel', { name: 'Local game' });
  const speed = panel.getByRole('checkbox', { name: 'Speed Die' });
  const triples = panel.getByRole('checkbox', { name: 'Triples roll again' });
  await expect(speed).not.toBeChecked();
  await expect(triples).toBeDisabled();
  await speed.check();
  await expect(triples).toBeEnabled();
  await panel.getByRole('button', { name: /^Next: Seats/ }).click();
  await panel.getByRole('button', { name: /^Next: Start/ }).click();
  await expect(panel.getByRole('button', { name: 'Rules. Change' })).toContainText('Classic + Speed Die');
  await panel.getByRole('button', { name: 'Start game' }).click();

  await p.waitStarted();
  const s = await p.state();
  expect(s.cfg.speedDie).toBe(true);
  // Rs. 1,500 and the Speed Die's Rs. 1,000 each
  await expect(cashOn(page, 'Rita')).toHaveText('Rs. 2,500');
  await p.openGameMenu();
  await openTab(page, 'Rules');
  await expect(p.gameMenu.locator('.rules-list')).toContainText('Classic with the Speed Die');
  seen.check();
});

test('rigged Speed Die: triples pick any space and roll again, the Bus picks a move, Tuk-Tuk Uncle moves on', async ({ players }) => {
  const p = await players.open('Rita');
  const { page } = p;
  const seen = watch(page);
  await p.startSolo(position(seatInfos([{ name: 'Rita' }, { name: 'Ava', bot: true }]), {
    rules: { speedDie: true, triplesRollAgain: true },
    edit: (s) => speedOn(s, 's0'),
  }));
  await expect(turnBar(page).locator('.badge.speed')).toHaveText('Speed Die');
  await expect(rollButton(page)).toContainText('+ Speed Die');

  // Triples: the space picker, then a roll again
  await p.rig([3, 3, 3], [2, 5, 'bus']);
  await rollButton(page).click();
  await expect(prompt(page).getByRole('heading', { level: 2 })).toHaveText('Triples! Move to any space');
  const spaces = prompt(page).getByRole('listbox', { name: 'Spaces' });
  await expect(spaces.getByRole('option')).toHaveCount(39);
  await spaces.getByRole('option', { name: /^Galle Face Penthouse/ }).click();
  await expect(spaces.getByRole('option', { name: /^Galle Face Penthouse/ })).toHaveAttribute('aria-selected', 'true');
  await prompt(page).getByRole('button', { name: 'Move to Galle Face Penthouse' }).click();
  await expect(buyPrompt(page).getByRole('heading', { level: 2 })).toHaveText('Buy Galle Face Penthouse?');
  await buyPrompt(page).getByRole('button', { name: /^Buy for Rs\. 400/ }).click();
  await expect(swatch(page, 'Rita', 'Galle Face Penthouse')).toBeVisible();

  // The Bus: either white die or their sum, each shown with where it lands
  await rollButton(page).click();
  await expect(prompt(page).getByRole('heading', { level: 2 })).toHaveText('Bus: choose your move');
  const moves = prompt(page).getByRole('button', { name: /^Move \d/ });
  await expect(moves).toHaveCount(3);
  await expect(moves.nth(0)).toContainText('Move 2Pettah Pavement');
  await expect(moves.nth(1)).toContainText('Move 5Inland Revenue');
  await expect(moves.nth(2)).toContainText('Move 7Kottu Street');
  await moves.nth(2).click();
  await expect(gameLog(page)).toContainText('Rita takes the bus to Kottu Street');
  await buyPrompt(page).getByRole('button', { name: /^Buy for Rs\. 100/ }).click();
  // Rs. 2,500 − Rs. 400 + Rs. 200 (passing Start) − Rs. 100
  await expect(cashOn(page, 'Rita')).toHaveText('Rs. 2,200');

  await endTurn(p, [space('Negombo Fish Market')]);

  // Tuk-Tuk Uncle: 1 + 3 to Just Visiting, then on to the next property the bank owns
  await p.rig([1, 3, 'uncle']);
  await rollButton(page).click();
  await expect(buyPrompt(page).getByRole('heading', { level: 2 })).toHaveText('Buy Negombo Fish Market?');
  await expect(buyPrompt(page)).toContainText('Tuk-Tuk Uncle brought you here.');
  await expect(gameLog(page)).toContainText('Tuk-Tuk Uncle: Rita heads to Negombo Fish Market (for sale)');
  await expect(page.getByTestId('dice-readout')).toContainText('Tuk-Tuk Uncle');
  await buyPrompt(page).getByRole('button', { name: /^Buy for Rs\. 140/ }).click();
  await expect(swatch(page, 'Rita', 'Negombo Fish Market')).toBeVisible();
  seen.check();
});
