import { expect, type Locator, type Page } from '@playwright/test';

/** Set a range slider the way dragging it would (Playwright can't fill() ranges). */
export async function setRange(slider: Locator, value: number): Promise<void> {
  await slider.evaluate((el, v) => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(v));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

/** The range input inside the `label.setting` whose text starts with `label` */
export const rangeIn = (scope: Locator, label: string | RegExp) =>
  scope.locator('label.setting', { hasText: label }).locator('input[type=range]');

/**
 * Press a ConfirmButton and answer yes (src/ui/ConfirmButton.tsx: the button turns into a question with
 * the yes button first, focused).
 */
export async function confirm(button: Locator): Promise<void> {
  await button.click();
  const question = button.page().locator('.confirm[role=group]');
  await expect(question).toBeVisible();
  await question.getByRole('button').first().click();
}

/** Pick an option in a group of radio buttons (Settings and the create steps draw their choices this way). */
export async function choose(scope: Locator | Page, group: string | RegExp, option: string | RegExp): Promise<void> {
  const radio = scope.getByRole('radiogroup', { name: group }).getByRole('radio', { name: option });
  await radio.click();
  await expect(radio).toHaveAttribute('aria-checked', 'true');
}

/** A menu tab by its label (MenuTabs), clicked and shown. */
export async function openTab(page: Page, name: string | RegExp): Promise<void> {
  const tab = page.getByRole('tab', { name });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/** The open modal dialog named `name` */
export const dialog = (page: Page, name: string | RegExp) => page.getByRole('dialog', { name });
