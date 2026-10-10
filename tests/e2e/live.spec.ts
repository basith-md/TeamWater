import { expect, test } from '@playwright/test';

test('the console receives verified content and packet traces from the real pipeline', async ({ page }) => {
  test.skip(!process.env.TEAMWATER_PIPELINE_URL, 'Start the pipeline and point the Vite proxy at it first.');
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Live backend', exact: true }).click();
  await expect(page.getByText('6 / 6 nodes online')).toBeVisible();
  const boss = page.getByTestId('phone-boss');
  const employee = page.getByTestId('phone-employee');
  const text = `Browser check ${Date.now()}: Please fix the code. The recovered content must include this ending beyond the sixty-character preview.`;
  await boss.getByLabel('Message input').fill(text);
  await boss.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(employee.getByText(text, { exact: true })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId('packet-log')).toContainText('Verified receipt', { timeout: 15_000 });
  await expect(page.getByRole('columnheader', { name: 'Sim time' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Range', exact: true })).toContainText('Unavailable');
  await expect(page.getByRole('group', { name: 'Delay', exact: true })).toContainText('Unavailable');
  expect(errors).toEqual([]);
});
