import { expect, test, type Page } from '@playwright/test';

const preview = process.env.TEAMWATER_PREVIEW_URL;
const password = process.env.TEAMWATER_PREVIEW_PASSWORD;

test('normal password login protects assets and connects two phones through the deployed gateway', async ({ browser }) => {
  test.skip(!preview || !password, 'Set TEAMWATER_PREVIEW_URL and TEAMWATER_PREVIEW_PASSWORD to test the deployed preview.');
  test.setTimeout(90_000);
  const origin = new URL(preview!).origin;
  const bossContext = await browser.newContext();
  const employeeContext = await browser.newContext();
  const meshURLs: string[] = [];
  function trackMesh(page: Page) {
    page.on('request', request => {
      const url = new URL(request.url());
      if (/^\/(?:api\/)?(?:nodes|state|messages\/|send\/|ws$)/.test(url.pathname)) meshURLs.push(`${url.origin}${url.pathname}`);
    });
    page.on('websocket', socket => meshURLs.push(socket.url().replace(/^wss:/, 'https:').replace(/^ws:/, 'http:')));
  }
  try {
    const anonymousAsset = await bossContext.request.get(`${origin}/_expo/static/private-test.js`, { maxRedirects: 0 });
    expect(anonymousAsset.status()).toBe(303);
    expect(anonymousAsset.headers().location).toBe('/login');

    const boss = await bossContext.newPage();
    trackMesh(boss);
    await boss.goto(`${origin}/login`);
    await boss.getByLabel('Team password').fill(`${password}-incorrect`);
    const wrongResponse = boss.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/login');
    await boss.getByRole('button', { name: 'Open phone app' }).click();
    expect((await wrongResponse).status()).toBe(401);
    await expect(boss.getByRole('alert')).toContainText('That password did not match');

    async function login(page: Page, role: 'boss' | 'employee') {
      await page.goto(`${origin}/login`);
      await page.getByLabel('Team password').fill(password!);
      const loginResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/login');
      await page.getByRole('button', { name: 'Open phone app' }).click();
      const response = await loginResponse;
      expect((await response.request().allHeaders()).origin).toBe(origin);
      expect(response.status()).toBe(303);
      await expect(page).toHaveURL(`${origin}/`);
      await page.getByRole('button', { name: `Use ${role} phone` }).click();
      await expect(page.getByText('Connected', { exact: true })).toBeVisible();
    }

    const employee = await employeeContext.newPage();
    trackMesh(employee);
    await login(boss, 'boss');
    await login(employee, 'employee');
    const text = `Team preview browser check ${Date.now()}: Alex to Jordan.`;
    await boss.getByLabel('Message input').fill(text);
    await boss.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect.poll(async () => {
      const receivedText = employee.getByText(text, { exact: true });
      if (await receivedText.count() !== 1) return false;
      const messageRow = receivedText.locator('..').locator('..');
      const content = await messageRow.textContent();
      return content?.includes('Receiver verified') && !content.includes('Unverified preview');
    }, { timeout: 45_000, message: 'The unique new message must reconstruct and verify in Jordan’s own bubble' }).toBe(true);
    expect(meshURLs.length).toBeGreaterThan(0);
    expect(meshURLs.filter(url => { const target = new URL(url); return target.origin !== origin || !target.pathname.startsWith('/api/'); }), 'All mesh requests must use the protected same-origin /api gateway').toEqual([]);
    if (process.env.TEAMWATER_PREVIEW_SCREENSHOT) await employee.screenshot({ path: process.env.TEAMWATER_PREVIEW_SCREENSHOT, fullPage: true });
  } finally {
    await bossContext.close();
    await employeeContext.close();
  }
});
