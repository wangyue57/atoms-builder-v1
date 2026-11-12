import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { ApplicationTask } from '@atoms-builder/contracts';

// UI-only acceptance: deterministic HTTP fixtures exercise the real React app in
// Chrome. Every API request is intercepted; no database writes or model calls occur.
const previewHtml = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>
body{margin:0;padding:40px;font-family:system-ui;background:#f7f9ff;color:#162544}
h1{font-size:32px}button{border:0;border-radius:8px;padding:12px 20px;background:#4266ef;color:white}
</style></head><body><h1>已保存的作品</h1><p>这是确定性 UI 验收预览。</p>
<button onclick="this.textContent='已点击'">体验产品</button></body></html>`;

function taskFixture(phase: ApplicationTask['phase'] = 'succeeded'): ApplicationTask {
  const createdAt = new Date(Date.now() - 95_000).toISOString();
  const succeeded = phase === 'succeeded';
  return {
    id: 'ui-fixture-task',
    title: '为 Northstar 创建一个简洁的产品官网',
    phase,
    lastRequest: '创建产品官网，包含功能介绍与联系入口。',
    error: phase === 'failed' ? '页面生成暂时失败，请重试。' : null,
    currentVersionId: succeeded ? 'ui-version-1' : null,
    createdAt,
    updatedAt: createdAt,
    previewHtml: succeeded ? previewHtml : '',
    result: succeeded ? {
      runId: 'ui-run-1', mode: 'deepseek', status: 'completed', versionId: 'ui-version-1',
      repairAttempts: 0, review: { status: 'pass', score: 92, mustFix: [], risks: [] },
    } : null,
    runs: [{
      id: 'ui-run-1', request: '创建产品官网，包含功能介绍与联系入口。',
      status: succeeded ? 'completed' : phase,
      error: phase === 'failed' ? '页面生成暂时失败，请重试。' : null,
      versionId: succeeded ? 'ui-version-1' : null,
      createdAt,
      finishedAt: succeeded || phase === 'failed' ? createdAt : null,
    }],
  };
}

type SubmittedRequest = { request: string; idempotencyKey: string };
async function fixtureApi(page: Page, initial = taskFixture()) {
  const state = {
    task: initial,
    signedIn: true,
    posts: [] as SubmittedRequest[],
    unexpected: [] as string[],
    errors: [] as string[],
    failSubmission: false,
    holdSubmission: null as Promise<void> | null,
  };
  page.on('pageerror', (error) => state.errors.push(error.message));
  const user = { id: 'ui-user', username: 'design_team', createdAt: initial.createdAt };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (path === '/api/auth/me') {
      await route.fulfill({ json: { user: state.signedIn ? user : null } });
    } else if (path === '/api/auth/login' || path === '/api/auth/register') {
      state.signedIn = true;
      await route.fulfill({ json: { user } });
    } else if (path === '/api/auth/logout') {
      state.signedIn = false;
      await route.fulfill({ status: 204 });
    } else if (path === '/api/tasks' && method === 'GET') {
      await route.fulfill({ json: { tasks: [state.task], total: 1, page: 1, pageSize: 20 } });
    } else if (path === `/api/tasks/${state.task.id}` && method === 'GET') {
      await route.fulfill({ json: state.task });
    } else if ((path === '/api/tasks' || path === `/api/tasks/${state.task.id}/runs`) && method === 'POST') {
      const input = request.postDataJSON() as SubmittedRequest;
      state.posts.push(input);
      if (state.holdSubmission) await state.holdSubmission;
      if (state.failSubmission) {
        await route.fulfill({ status: 503, json: { error: '连接暂时中断，请重试。' } });
        return;
      }
      if (path === '/api/tasks') state.task = taskFixture('queued');
      state.task = {
        ...state.task,
        phase: 'queued',
        error: null,
        lastRequest: input.request,
        runs: [{
          id: `ui-run-${state.posts.length + 1}`, request: input.request, status: 'queued',
          error: null, versionId: null, createdAt: new Date().toISOString(), finishedAt: null,
        }, ...(path === '/api/tasks' ? [] : state.task.runs)],
      };
      await route.fulfill({ status: 202, json: state.task });
    } else {
      state.unexpected.push(`${method} ${path}`);
      await route.fulfill({ status: 501, json: { error: 'Unhandled UI fixture API request' } });
    }
  });
  return state;
}

async function compositionEnterMustNotSubmit(input: Locator) {
  await input.dispatchEvent('compositionstart');
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter' });
  await input.dispatchEvent('compositionend');
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, which: 229 });
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
}

async function expectSource(editor: Locator, value: string) {
  // These short fixtures fit in the editor viewport, including the empty final line.
  await expect.poll(() => editor.locator('.cm-line').allTextContents()).toEqual(value.split('\n'));
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function selectMobileTab(page: Page, name: string) {
  const tab = page.getByRole('tab', { name, exact: true });
  await expect(tab).toBeVisible();
  await tab.click();
}

test.describe('interaction redesign — deterministic HTTP fixtures', () => {
  test('home: Enter sends once, Shift+Enter inserts a line, IME and whitespace never submit', async ({ page }, info) => {
    const state = await fixtureApi(page);
    await page.goto('/');
    const input = page.locator('#request');
    const submit = page.locator('#submit');
    await expect(page.locator('#home-view')).toBeVisible();
    await page.screenshot({ path: info.outputPath('home-desktop.png'), fullPage: true, animations: 'disabled' });
    await expect(submit).toBeDisabled();
    await input.fill('   ');
    await input.press('Enter');
    await expect(submit).toBeDisabled();
    expect(state.posts).toHaveLength(0);

    await input.fill('创建一个官网');
    await input.press('End');
    await input.press('Shift+Enter');
    await input.pressSequentially('FAQ');
    await expect(input).toHaveValue('创建一个官网\nFAQ');
    await compositionEnterMustNotSubmit(input);
    await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', repeat: true });
    expect(state.posts).toHaveLength(0);

    let release!: () => void;
    state.holdSubmission = new Promise<void>((resolve) => { release = resolve; });
    try {
      await input.press('Enter');
      await expect.poll(() => state.posts.length).toBe(1);
      await expect(submit).toBeDisabled();
      // Re-entrant submit events cannot bypass the mutation's synchronous lock.
      await input.evaluate((element) => {
        element.closest('form')?.requestSubmit();
        element.closest('form')?.requestSubmit();
      });
      expect(state.posts).toHaveLength(1);
    } finally { release(); }
    await expect(page).toHaveURL(/\/tasks\/ui-fixture-task$/);
    expect(state.posts[0].request).toBe('创建一个官网\nFAQ');
    expect(state.posts[0].idempotencyKey.length).toBeGreaterThanOrEqual(8);
    expect(state.unexpected).toEqual([]);
    expect(state.errors).toEqual([]);
  });

  test('follow-up: draft survives failure, retry reuses identity, acceptance clears draft and preserves preview', async ({ page }, info) => {
    const state = await fixtureApi(page);
    await page.goto(`/tasks/${state.task.id}`);
    await expect(page.locator('#preview')).toBeVisible();
    const input = page.locator('#followup-request');
    const submit = page.locator('#followup-submit');
    await expect(submit).toBeDisabled();
    await input.fill('增加 FAQ');
    await input.press('End');
    await input.press('Shift+Enter');
    await input.pressSequentially('Contact');
    await compositionEnterMustNotSubmit(input);
    await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', repeat: true });
    expect(state.posts).toHaveLength(0);
    state.failSubmission = true;
    await input.press('Enter');
    await expect(page.getByRole('alert')).toContainText('连接暂时中断');
    await expect(input).toHaveValue('增加 FAQ\nContact');
    expect(state.posts).toHaveLength(1);
    state.failSubmission = false;
    await input.press('Enter');
    await expect.poll(() => state.posts.length).toBe(2);
    await expect(input).toHaveValue('');
    await expect(submit).toBeDisabled();
    expect(state.posts[1].idempotencyKey).toBe(state.posts[0].idempotencyKey);
    await expect(page.frameLocator('#preview').getByRole('heading', { name: '已保存的作品' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    // Drafting the next change remains available during a run, while submission
    // stays locked until the server reports a terminal phase.
    await input.fill('下一轮修改：增加客户案例');
    await input.press('Enter');
    expect(state.posts).toHaveLength(2);
    await expect(input).toHaveValue('下一轮修改：增加客户案例');
    await expect(submit).toBeDisabled();
    state.task = { ...state.task, phase: 'running', runs: [{ ...state.task.runs[0], status: 'running' }, ...state.task.runs.slice(1)] };
    await expect(page.locator('#task-progress').getByRole('status')).toHaveText('正在构建你的作品');
    await expect(submit).toBeDisabled();
    await page.screenshot({ path: info.outputPath('task-updating-desktop.png'), fullPage: true, animations: 'disabled' });
    state.task = {
      ...state.task,
      phase: 'succeeded',
      currentVersionId: 'ui-version-2',
      result: { ...taskFixture().result!, runId: state.task.runs[0].id, versionId: 'ui-version-2' },
      runs: [{ ...state.task.runs[0], status: 'completed', versionId: 'ui-version-2', finishedAt: new Date().toISOString() }, ...state.task.runs.slice(1)],
    };
    await expect(page.locator('#task-progress').getByRole('status')).toHaveText('作品已就绪');
    await expect(submit).toBeEnabled();
    await expect(input).toHaveValue('下一轮修改：增加客户案例');
    expect(state.posts).toHaveLength(2);
    expect(state.unexpected).toEqual([]);
    expect(state.errors).toEqual([]);
  });

  test('progress follows server queued/running/failed states and keeps the saved version', async ({ page }, info) => {
    const state = await fixtureApi(page, taskFixture('queued'));
    await page.goto(`/tasks/${state.task.id}`);
    const progress = page.locator('#task-progress');
    await expect(progress.getByRole('status')).toHaveText('已收到，正在等待开始');
    await expect(page.locator('#followup-submit')).toBeDisabled();
    await expect(page.locator('#preview')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: '代码', exact: true })).toBeDisabled();
    await page.screenshot({ path: info.outputPath('task-queued-desktop.png'), fullPage: true, animations: 'disabled' });
    state.task = { ...state.task, phase: 'running', runs: [{ ...state.task.runs[0], status: 'running' }] };
    await expect(progress.getByRole('status')).toHaveText('正在构建你的作品');
    await expect(progress.locator('.progress-steps .active')).toContainText('生成与审查');
    await expect(progress).toContainText(/分|秒/);
    await expect(progress.locator('[aria-valuenow]')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('task-running-desktop.png'), fullPage: true, animations: 'disabled' });

    const completed = taskFixture();
    state.task = completed;
    await expect(page.locator('#preview')).toBeVisible();
    await expect(page.getByRole('tab', { name: '代码', exact: true })).toBeEnabled();
    await expect(progress).toContainText(/完成|已就绪/);
    await page.screenshot({ path: info.outputPath('task-completed-desktop.png'), fullPage: true, animations: 'disabled' });
    const failedRun = { ...completed.runs[0], id: 'ui-run-2', status: 'failed' as const, error: '修改请求超时，请重试。', versionId: null };
    state.task = { ...completed, phase: 'failed', error: failedRun.error, runs: [failedRun, ...completed.runs] };
    // Completed tasks intentionally stop polling. A revisit loads the later failure.
    await page.reload();
    await expect(progress.getByRole('status')).toHaveText('这次构建未能完成');
    await expect(page.getByRole('alert').first()).toContainText('修改请求超时');
    await expect(page.frameLocator('#preview').getByRole('heading', { name: '已保存的作品' })).toBeVisible();
    await expect(page.locator('#followup-submit')).toBeEnabled();
    await page.screenshot({ path: info.outputPath('task-failed-desktop.png'), fullPage: true, animations: 'disabled' });
    expect(state.unexpected).toEqual([]);
    expect(state.errors).toEqual([]);
  });

  test('isolated preview preserves interaction across fullscreen, Escape restores focus and reload resets only preview', async ({ page }) => {
    const state = await fixtureApi(page);
    await page.goto(`/tasks/${state.task.id}`);
    const preview = page.locator('#preview');
    await expect(preview).toBeVisible();
    expect(await preview.getAttribute('sandbox')).toBe('allow-scripts');
    expect(await page.frameLocator('#preview').locator('body').evaluate(() => {
      try { return window.parent.document === document; } catch { return false; }
    })).toBe(false);
    const button = page.frameLocator('#preview').getByRole('button');
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toHaveText('已点击');
    await page.locator('#expand-preview').click();
    await expect(page.locator('#preview-dialog')).toBeVisible();
    await expect(button).toHaveText('已点击');
    await page.keyboard.press('Escape');
    await expect(page.locator('#preview-dialog')).not.toBeVisible();
    await expect(page.locator('#expand-preview')).toBeFocused();
    await expect(button).toHaveText('已点击');
    await page.locator('#reload-preview').click();
    await expect(button).toHaveText('体验产品');
    expect(state.posts).toHaveLength(0);
    expect(state.unexpected).toEqual([]);
    expect(state.errors).toEqual([]);
  });

  test('artifact code edits update the sandbox, survive tab switches and restore the saved HTML', async ({ page }, info) => {
    const state = await fixtureApi(page);
    await page.goto(`/tasks/${state.task.id}`);
    const sourceTab = page.getByRole('tab', { name: '代码', exact: true });
    const previewTab = page.getByRole('tab', { name: '预览', exact: true });
    await sourceTab.click();
    const editor = page.getByRole('textbox', { name: '产物 HTML 源代码' });
    await expectSource(editor, previewHtml);
    const editedHtml = previewHtml.replace('已保存的作品', '直接编辑的作品').replace('#f7f9ff', '#ffeecc');
    await editor.fill(editedHtml);
    // The same iframe receives changes even while the code panel is selected.
    const frame = page.frameLocator('#preview');
    await expect(frame.locator('h1')).toHaveText('直接编辑的作品');
    await expect(frame.locator('body')).toHaveCSS('background-color', 'rgb(255, 238, 204)');
    await expect(page.locator('#preview-label')).toHaveText('本页编辑草稿');
    await expect(page.locator('#source-editing-hint')).toContainText('草稿仅本页有效');
    await page.screenshot({ path: info.outputPath('source-editor-desktop.png'), fullPage: true });
    await previewTab.click();
    await expect(frame.getByRole('heading')).toBeVisible();
    const button = frame.getByRole('button');
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toHaveText('已点击');
    await sourceTab.click();
    await expectSource(editor, editedHtml);
    await previewTab.click();
    await expect(button).toHaveText('已点击');
    expect(await page.locator('#preview').getAttribute('sandbox')).toBe('allow-scripts');
    expect(await frame.locator('body').evaluate(() => {
      try { return window.parent.document === document; } catch { return false; }
    })).toBe(false);
    await page.locator('#expand-preview').click();
    await expect(frame.locator('h1')).toHaveText('直接编辑的作品');
    await page.keyboard.press('Escape');
    await sourceTab.click();
    await editor.fill('');
    await previewTab.click();
    await expect(page.getByRole('heading', { name: 'HTML 草稿为空' })).toBeVisible();
    await sourceTab.click();
    await page.getByRole('button', { name: '恢复原始代码' }).click();
    await page.getByRole('button', { name: '保留草稿' }).click();
    await expectSource(editor, '');
    await page.getByRole('button', { name: '恢复原始代码' }).click();
    await page.getByRole('button', { name: '确认恢复' }).click();
    await expectSource(editor, previewHtml);
    await previewTab.click();
    await expect(frame.getByRole('heading')).toHaveText('已保存的作品');
    expect(state.posts).toHaveLength(0);
    expect(state.task.previewHtml).toBe(previewHtml);
    expect(state.unexpected).toEqual([]);
    expect(state.errors).toEqual([]);
  });

  test('new server versions preserve an open code draft until the user loads the new version', async ({ page }) => {
    const initial = { ...taskFixture(), phase: 'running' as const };
    const state = await fixtureApi(page, initial);
    await page.goto(`/tasks/${state.task.id}`);
    await page.getByRole('tab', { name: '代码', exact: true }).click();
    const editor = page.getByRole('textbox', { name: '产物 HTML 源代码' });
    const draft = previewHtml.replace('已保存的作品', '我的草稿');
    await editor.fill(draft);
    state.task = {
      ...taskFixture(), currentVersionId: 'ui-version-2',
      previewHtml: previewHtml.replace('已保存的作品', '后台的新版本'),
      result: { ...taskFixture().result!, versionId: 'ui-version-2' },
    };
    await expect(page.getByRole('button', { name: '载入新版本' })).toBeVisible();
    await expectSource(editor, draft);
    await expect(page.frameLocator('#preview').locator('h1')).toHaveText('我的草稿');
    await page.getByRole('button', { name: '载入新版本' }).click();
    await page.getByRole('button', { name: '确认恢复' }).click();
    await expectSource(editor, state.task.previewHtml);
    await expect(page.frameLocator('#preview').locator('h1')).toHaveText('后台的新版本');
    expect(state.posts).toHaveLength(0);
    expect(state.errors).toEqual([]);
  });

  test('CodeMirror loads on demand and supports highlighting, history, indentation, completion and search', async ({ page }, info) => {
    const state = await fixtureApi(page);
    const editorAssets: string[] = [];
    page.on('request', (request) => {
      if (/\/SourceEditor-[^/]+\.js/.test(request.url())) editorAssets.push(request.url());
    });
    await page.goto(`/tasks/${state.task.id}`);
    expect(editorAssets).toHaveLength(0);
    await expect(page.locator('.cm-editor')).toHaveCount(0);
    const sourceTab = page.getByRole('tab', { name: '代码', exact: true });
    const previewTab = page.getByRole('tab', { name: '预览', exact: true });
    await sourceTab.click();
    const editor = page.getByRole('textbox', { name: '产物 HTML 源代码' });
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    await expectSource(editor, previewHtml);
    expect(editorAssets).toHaveLength(1);
    await expect.poll(() => editor.locator('.cm-line span').count()).toBeGreaterThan(3);
    await expect(page.locator('.cm-lineNumbers .cm-gutterElement').filter({ hasText: /^1$/ })).toBeVisible();

    const code = '<html>\n  <body>\n    <h1>编辑器测试</h1>\n  </body>\n</html>';
    await editor.fill(code);
    await expect(page.frameLocator('#preview').locator('h1')).toHaveText('编辑器测试');
    await page.locator('.cm-foldGutter [title="折叠代码"]').first().click();
    await expect(page.locator('.cm-foldPlaceholder')).toBeVisible();
    await page.locator('.cm-foldPlaceholder').click();
    await expectSource(editor, code);
    await editor.press('ControlOrMeta+z');
    await expectSource(editor, previewHtml);
    await page.getByRole('button', { name: '重做代码修改' }).click();
    await expectSource(editor, code);
    await editor.press('ControlOrMeta+Home');
    await editor.press('Tab');
    await expectSource(editor, '  ' + code);
    await editor.press('Escape');
    await editor.press('Tab');
    await expect(editor).not.toBeFocused();
    await page.getByRole('button', { name: '撤销代码修改' }).click();
    await expectSource(editor, code);

    await page.getByRole('button', { name: '查找和替换代码' }).click();
    await page.getByRole('textbox', { name: '查找', exact: true }).fill('编辑器测试');
    await page.getByRole('textbox', { name: '替换', exact: true }).fill('替换后的作品');
    await page.getByRole('button', { name: '全部替换', exact: true }).click();
    await expect(page.frameLocator('#preview').locator('h1')).toHaveText('替换后的作品');
    await page.screenshot({ path: info.outputPath('codemirror-search-desktop.png'), fullPage: true });
    await page.locator('.cm-search button[name="close"]').click();
    await previewTab.click();
    await sourceTab.click();
    await page.getByRole('button', { name: '撤销代码修改' }).click();
    await expectSource(editor, code);
    expect(editorAssets).toHaveLength(1);

    await editor.fill('<di');
    await editor.press('Control+Space');
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.getByRole('option').filter({ hasText: /^div$/ }).click();
    await expectSource(editor, '<div');
    expect(state.posts).toHaveLength(0);
    expect(state.unexpected).toEqual([]);
    expect(state.errors).toEqual([]);
  });

  test('conversation shows chronological rounds, keeps the composer visible and respects reading position', async ({ page }, info) => {
    const initial = taskFixture('running');
    initial.runs = Array.from({ length: 12 }, (_, index) => ({
      ...initial.runs[0], id: `conversation-${12 - index}`,
      request: `第 ${12 - index} 条需求：完善页面内容和交互`,
      status: index === 0 ? 'running' : 'completed',
    }));
    const state = await fixtureApi(page, initial);
    await page.goto(`/tasks/${state.task.id}`);
    const turns = page.locator('.conversation-turn');
    await expect(turns).toHaveCount(12);
    await expect(turns.first()).toContainText('第 1 条需求');
    await expect(turns.last()).toContainText('第 12 条需求');
    await expect(page.locator('#task-progress')).toBeInViewport();
    await expect(page.locator('#followup-request')).toBeInViewport();
    await page.screenshot({ path: info.outputPath('conversation-desktop.png'), fullPage: true });
    await page.locator('.activity-scroll').evaluate((element) => { element.scrollTop = 0; });
    await expect(turns.first()).toBeInViewport();
    state.task = { ...state.task, phase: 'failed', error: '本轮暂时失败', runs: [{ ...state.task.runs[0], status: 'failed' }, ...state.task.runs.slice(1)] };
    await expect(page.locator('#task-progress')).toContainText('本轮暂时失败');
    await expect(turns.first()).toBeInViewport();
    await expect(page.locator('#followup-request')).toBeInViewport();
    expect(state.unexpected).toEqual([]);
    expect(state.errors).toEqual([]);
  });

  for (const width of [320, 390]) {
    test(`responsive ${width}px: home, history and task tabs remain usable without overflow`, async ({ page }, info) => {
      const state = await fixtureApi(page);
      state.task.title = '为国际化设计团队创建具有完整品牌介绍、产品功能及联系入口的商业网站';
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/');
      await expect(page.locator('#request')).toBeVisible();
      await expectNoOverflow(page);
      await page.screenshot({ path: info.outputPath(`home-${width}.png`), fullPage: true, animations: 'disabled' });
      await page.goto('/tasks');
      await expect(page.getByRole('heading', { name: '历史任务', exact: true })).toBeVisible();
      await expectNoOverflow(page);
      await page.screenshot({ path: info.outputPath(`history-${width}.png`), fullPage: true, animations: 'disabled' });
      await page.getByRole('link', { name: `继续编辑 ${state.task.title}` }).click();
      await expect(page.locator('#task-title')).toHaveText(state.task.title);
      await selectMobileTab(page, '需求与进展');
      await expect(page.locator('#followup-request')).toBeVisible();
      await expectNoOverflow(page);
      await page.screenshot({ path: info.outputPath(`task-conversation-${width}.png`), fullPage: true, animations: 'disabled' });
      await selectMobileTab(page, '作品预览');
      await expect(page.locator('#preview')).toBeVisible();
      await expectNoOverflow(page);
      await page.screenshot({ path: info.outputPath(`task-preview-${width}.png`), fullPage: true, animations: 'disabled' });
      await page.locator('#expand-preview').click();
      await expect(page.locator('#preview-dialog')).toBeVisible();
      await expectNoOverflow(page);
      await page.keyboard.press('Escape');
      await expect(page.locator('#preview-dialog')).not.toBeVisible();
      await page.getByRole('tab', { name: '代码', exact: true }).click();
      const editor = page.getByRole('textbox', { name: '产物 HTML 源代码' });
      await expect(editor).toBeInViewport();
      await editor.fill(previewHtml.replace('已保存的作品', '手机编辑作品'));
      await expectNoOverflow(page);
      await page.screenshot({ path: info.outputPath(`task-source-${width}.png`), fullPage: true });
      await selectMobileTab(page, '需求与进展');
      await expect(page.locator('#followup-request')).toBeInViewport();
      await selectMobileTab(page, '作品预览');
      await expectSource(editor, previewHtml.replace('已保存的作品', '手机编辑作品'));
      await page.getByRole('tab', { name: '预览', exact: true }).click();
      await expect(page.frameLocator('#preview').getByRole('heading')).toHaveText('手机编辑作品');
      expect(state.unexpected).toEqual([]);
      expect(state.errors).toEqual([]);
    });
  }

  test('account form submits with Enter and returns to the protected page', async ({ page }, info) => {
    const state = await fixtureApi(page);
    state.signedIn = false;
    await page.goto('/tasks');
    await expect(page.locator('#login-username')).toBeVisible();
    await page.screenshot({ path: info.outputPath('login-desktop.png'), fullPage: true, animations: 'disabled' });
    await page.locator('#login-username').fill('design_team');
    await page.locator('#login-password').fill('fixture-password');
    await page.getByRole('button', { name: '显示密码', exact: true }).click();
    await expect(page.locator('#login-password')).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: '隐藏密码', exact: true }).click();
    await expect(page.locator('#login-password')).toHaveAttribute('type', 'password');
    await page.locator('#login-password').press('Enter');
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByRole('heading', { name: '历史任务', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('history-desktop.png'), fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: '账号 design_team', exact: true }).click();
    await expect(page.locator('#account-menu')).toBeVisible();
    await page.locator('#logout').click();
    await expect(page.locator('#login-username')).toBeVisible();
    expect(state.signedIn).toBe(false);
    expect(state.unexpected).toEqual([]);
    expect(state.errors).toEqual([]);
  });
});
