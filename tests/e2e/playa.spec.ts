import { expect, test } from '@playwright/test';

test('Malcome invites Basith through the live playa mesh and receives a verified reply', async ({ page }) => {
  test.skip(!process.env.TEAMWATER_PIPELINE_URL, 'Requires the running backend and console proxy.');
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const sender = page.getByTestId('phone-boss');
  const receiver = page.getByTestId('phone-employee');
  await expect(sender.getByPlaceholder('Message Basith…')).toBeVisible();
  await expect(receiver.getByPlaceholder('Message Malcome…')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Malcome profile' })).toContainText('Deep playa');
  await expect(page.getByRole('group', { name: 'Basith profile' })).toContainText('Playa airport');
  await expect(page.getByRole('img', { name: 'Mesh network topology' })).toContainText('Lucas');
  await expect(page.getByRole('img', { name: 'Mesh network topology' })).toContainText('Shravanthi');
  await expect(page.getByRole('status', { name: 'Simulation status' })).toContainText('Live simulation');
  await expect(page.getByRole('button', { name: 'Sample replay', exact: true })).toHaveCount(0);
  const expectRealMultiRelayRoute = async (source: string, destination: string) => {
    const selectedRoute = page.getByLabel('Selected route');
    await expect.poll(async () => {
      const route = (await selectedRoute.innerText()).split(' → ');
      return route[0] === source && route.at(-1) === destination && route.length >= 5;
    }).toBe(true);
    const route = (await selectedRoute.innerText()).split(' → ');
    expect(new Set(route).size).toBe(route.length);
    const response = await page.request.get(`${process.env.TEAMWATER_PIPELINE_URL}/state`);
    expect(response.ok()).toBe(true);
    const snapshot = await response.json();
    for (let index = 0; index < route.length - 1; index++) {
      expect(snapshot.connections[route[index]]).toContain(route[index + 1]);
    }
  };
  const invitation = `Basith, come meet me at the Mayan Warrior set in deep playa! (${Date.now()})`;
  await sender.getByLabel('Message input').fill(invitation);
  await sender.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByTestId('trace-packet')).toBeVisible();
  await expect(receiver.getByText(invitation, { exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(receiver.getByText('Receiver verified', { exact: true }).last()).toBeVisible();
  await expectRealMultiRelayRoute('node0', 'node4');
  await expect(page.getByTestId('packet-log')).toContainText('Verified receipt');
  const reply = `On my way from the playa airport, Malcome. See you at Mayan Warrior! (${Date.now()})`;
  await receiver.getByLabel('Message input').fill(reply);
  await receiver.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(sender.getByText(reply, { exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(sender.getByText('Receiver verified', { exact: true }).last()).toBeVisible();
  await expectRealMultiRelayRoute('node4', 'node0');
  for (const name of ['Bandwidth', 'Delay', 'Range', 'Packet loss']) {
    await expect(page.getByRole('group', { name, exact: true })).not.toContainText('Unavailable');
  }
  expect(errors).toEqual([]);
  await page.screenshot({ path: '/tmp/teamwater-playa-verified.png', fullPage: true });
});
