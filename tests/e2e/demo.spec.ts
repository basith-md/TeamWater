import { test, expect } from '@playwright/test';

test('a boss message crosses the trace and the employee can reply', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Sample replay', exact: true }).click();
  const boss = page.getByTestId('phone-boss');
  const employee = page.getByTestId('phone-employee');
  await boss.getByLabel('Message input').fill('The deploy is failing. Can you fix the code from the playa?');
  await boss.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(employee.getByText('The deploy is failing. Can you fix the code from the playa?', { exact: true })).toBeVisible();
  await expect(boss.getByText('Delivered', { exact: true })).toBeVisible();
  await expect(page.getByTestId('packet-log')).toContainText(/receipt/i);
  await employee.getByLabel('Message input').fill('On it. Sending the fix over the mesh.');
  await employee.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(boss.getByText('On it. Sending the fix over the mesh.', { exact: true })).toBeVisible();
  await expect(employee.getByText('Delivered', { exact: true })).toBeVisible();
  await expect(employee.getByText('Receiver verified', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('loss replay shows packet drop and retry before delivery', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sample replay', exact: true }).click();
  await page.getByLabel('Replay scenario').selectOption('lossy');
  const boss = page.getByTestId('phone-boss');
  await boss.getByLabel('Message input').fill('Retry this message through the dust.');
  await boss.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByTestId('packet-log')).toContainText(/drop/i);
  await expect(page.getByTestId('packet-log')).toContainText(/retry/i);
  await expect(boss.getByText('Delivered', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
  await expect(boss.getByText('Retry this message through the dust.', { exact: true })).toHaveCount(0);
});

test('outage replay follows an alternate route and reports it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sample replay', exact: true }).click();
  await page.getByLabel('Replay scenario').selectOption('outage');
  const boss = page.getByTestId('phone-boss');
  await boss.getByLabel('Message input').fill('Find another relay.');
  await boss.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByTestId('packet-log')).toContainText(/route/i);
  await expect(boss.getByText('Delivered', { exact: true })).toBeVisible();
});

test('the mobile-width stage stays within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Sample replay', exact: true }).click();
  await expect(page.getByTestId('phone-boss').getByLabel('Message input')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
});
