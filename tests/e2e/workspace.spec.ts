import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

function account() {
  return { username: `e2e_${randomUUID().replaceAll('-', '').slice(0, 20)}`, password: `Pass_${randomUUID()}` };
}
async function register(page: Page, credentials: ReturnType<typeof account>) {
  await page.goto('/register');
  await page.locator('#register-username').fill(credentials.username);
  await page.locator('#register-password').fill(credentials.password);
  await page.locator('#register-submit').click();
  await expect(page.locator('#home-view')).toBeVisible();
}

test('register, persist, refresh, continue from history and log in again', async ({ page }, info) => {
  const user = account();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await register(page, user);
  await page.screenshot({ path: info.outputPath('material-home.png'), fullPage: true });
  const title = `构建一个产品官网 ${user.username}`;
  await page.locator('#request').fill(title);
  await page.locator('#submit').click();
  await expect(page).toHaveURL(/\/tasks\/[^/]+$/);
  const taskURL = page.url();
  const taskId = new URL(taskURL).pathname.split('/').at(-1)!;
  await expect(page.locator('#task-title')).toHaveText(title);
  await expect(page.locator('#preview')).toBeVisible({ timeout: 120_000 });
  const first = await page.request.get(`/api/tasks/${taskId}`).then(response => response.json());
  expect(first.phase).toBe('succeeded');
  expect(first.runs).toHaveLength(1);
  expect(first.result.versionId).toBe(first.currentVersionId);
  expect(first.previewHtml).toContain(user.username);

  await page.reload();
  await expect(page.locator('#task-title')).toHaveText(title);
  await expect(page.locator('#preview')).toBeVisible();
  expect(await page.locator('#preview').getAttribute('sandbox')).toBe('allow-scripts');
  expect(await page.frameLocator('#preview').locator('body').evaluate(() => {
    try { return window.parent.document === document; } catch { return false; }
  })).toBe(false);

  await expect.poll(() => page.frameLocator('#preview').locator('body').evaluate(() => document.readyState)).toBe('complete');
  const previewButton = page.frameLocator('#preview').getByRole('button').first();
  // Exercise the preview with trusted keyboard input. Headless Chrome can report
  // stale pointer hit regions for a newly loaded opaque-origin iframe.
  await previewButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.frameLocator('#preview').locator('body')).toBeVisible();
  await page.locator('#expand-preview').click();
  await expect(page.locator('#preview-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#preview-dialog')).not.toBeVisible();
  await expect(page.frameLocator('#preview').locator('body')).toBeVisible();
  await page.locator('#expand-preview').click();
  await page.locator('#close-preview').click();
  await expect(page.locator('#preview-dialog')).not.toBeVisible();
  await page.locator('#reload-preview').focus();
  await page.keyboard.press('Enter');
  await expect(page.frameLocator('#preview').locator('body')).toBeVisible();
  const afterReload = await page.request.get(`/api/tasks/${taskId}`).then(response => response.json());
  expect(afterReload.runs).toHaveLength(1);
  expect(afterReload.currentVersionId).toBe(first.currentVersionId);

  await page.goto('/tasks');
  await expect(page.getByRole('heading', { name: '历史任务', exact: true })).toBeVisible();
  await page.getByRole('link', { name: `继续编辑 ${title}` }).click();
  await expect(page).toHaveURL(taskURL);
  await page.locator('#followup-request').fill('在原项目增加 FAQ 区块');
  await page.locator('#followup-submit').click();
  await expect.poll(async () => {
    const result = await page.request.get(`/api/tasks/${taskId}`).then(response => response.json());
    return result.phase === 'succeeded' ? result.runs.length : 0;
  }, { timeout: 120_000 }).toBe(2);
  await page.reload();
  await expect(page.locator('#preview')).toBeVisible();
  await expect(page.frameLocator('#preview').locator('body')).toBeVisible();
  await page.screenshot({ path: info.outputPath('material-task.png'), fullPage: true });

  await page.getByRole('button', { name: `账号 ${user.username}` }).click();
  await page.locator('#logout').click();
  await expect(page.locator('#login-username')).toBeVisible();
  expect((await page.request.get(`/api/tasks/${taskId}`)).status()).toBe(401);
  await page.locator('#login-username').fill(user.username.toUpperCase());
  await page.locator('#login-password').fill(user.password);
  await page.locator('#login-submit').click();
  await expect(page.getByRole('button', { name: `账号 ${user.username}` })).toBeVisible();
  await page.goto(taskURL);
  await expect(page.locator('#task-title')).toHaveText(title);
  await expect(page.locator('#preview')).toBeVisible();
  expect(errors).toEqual([]);
});

test('one user cannot read or modify another user task; session cookie is HttpOnly', async ({ browser, page }) => {
  const owner = account();
  await register(page, owner);
  const response = await page.request.post('/api/tasks', { data: { request: '私有任务', idempotencyKey: randomUUID() } });
  expect(response.status()).toBe(202);
  const task = await response.json();
  const cookies = await page.context().cookies();
  expect(cookies.find(cookie => cookie.name === 'atoms_session')?.httpOnly).toBe(true);
  expect(await page.evaluate(() => document.cookie.includes('atoms_session'))).toBe(false);
  const outsider = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const otherUser = account();
    expect((await outsider.request.post('/api/auth/register', { data: otherUser })).status()).toBe(201);
    expect((await outsider.request.get(`/api/tasks/${task.id}`)).status()).toBe(404);
    expect((await outsider.request.post(`/api/tasks/${task.id}/runs`, { data: { request: '非法修改', idempotencyKey: randomUUID() } })).status()).toBe(404);
    const history = await outsider.request.get('/api/tasks').then(result => result.json());
    expect(history.tasks).toEqual([]);
    const otherPage = await outsider.newPage();
    await otherPage.goto(`/tasks/${task.id}`);
    await expect(otherPage.getByRole('heading', { name: '找不到这个任务' })).toBeVisible();
    await otherPage.goto('/tasks');
    await expect(otherPage.getByText('私有任务', { exact: true })).not.toBeVisible();
  } finally { await outsider.close(); }
});

test('protected deep links and mobile Material forms recover through account login', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tasks/nonexistent-project');
  await expect(page.locator('#login-username')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/register');
  const user = account();
  await page.locator('#register-username').fill(user.username);
  await page.locator('#register-password').fill(user.password);
  await page.locator('#register-submit').click();
  await expect(page.locator('#home-view')).toBeVisible();
  await page.goto('/tasks/nonexistent-project');
  await expect(page.getByRole('heading', { name: '找不到这个任务' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/does-not-exist');
  await expect(page.getByRole('heading', { name: '页面不存在' })).toBeVisible();
});
