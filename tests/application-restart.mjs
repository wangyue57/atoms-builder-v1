import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

const origin = 'http://127.0.0.1:8792';
const environment = { ...process.env, PORT: '8792', HOST: '127.0.0.1', APP_ORIGIN: origin, COOKIE_SECURE: 'false', WORKER_POLL_MS: '100' };
let child;
let cookie = '';

async function waitUntil(action, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { const result = await action(); if (result) return result; } catch { /* Startup may still be connecting. */ }
    await delay(100);
  }
  throw new Error('Persistent application restart check timed out.');
}
async function start() {
  child = spawn(process.execPath, ['scripts/application.mjs', 'start'], { env: environment, stdio: ['ignore', 'inherit', 'inherit'] });
  await waitUntil(async () => (await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(1000) })).ok);
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await exited;
  child = undefined;
}
async function api(path, data) {
  const response = await fetch(`${origin}${path}`, { method: data ? 'POST' : 'GET', headers: { cookie, origin, 'content-type': 'application/json' }, body: data ? JSON.stringify(data) : undefined });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const body = await response.json();
  assert.ok(response.ok, `${path}: ${response.status}`);
  return body;
}
async function completed(id, runCount) {
  return waitUntil(async () => {
    const task = await api(`/api/tasks/${id}`);
    if (task.phase === 'failed') throw new Error(task.error ?? 'Run failed.');
    return task.phase === 'succeeded' && task.runs.length === runCount ? task : null;
  }, 180000);
}

try {
  await start();
  const username = `restart_${randomUUID().replaceAll('-', '').slice(0, 18)}`;
  const identity = await api('/api/auth/register', { username, password: randomUUID() });
  assert.equal(identity.user.username, username);
  const created = await api('/api/tasks', { request: '重启恢复与源码持久化验收', idempotencyKey: randomUUID() });
  const first = await completed(created.id, 1);
  const versionId = first.currentVersionId;
  assert.ok(versionId);
  await stop();
  if (process.argv.includes('--restart-database')) {
    const restarted = spawnSync('docker', ['compose', 'restart', 'postgres'], { stdio: 'inherit' });
    assert.equal(restarted.status, 0);
  }
  await start();
  const me = await api('/api/auth/me');
  assert.equal(me.user.id, identity.user.id, 'database session must survive application restart');
  const restored = await api(`/api/tasks/${created.id}`);
  assert.equal(restored.currentVersionId, versionId);
  assert.equal(restored.previewHtml, first.previewHtml);
  await api(`/api/tasks/${created.id}/runs`, { request: '从持久化源码继续增加 FAQ', idempotencyKey: randomUUID() });
  const modified = await completed(created.id, 2);
  assert.notEqual(modified.currentVersionId, versionId);
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const snapshot = await client.query('select source_files,preview_html from project_versions where id=$1 and project_id=$2', [versionId, created.id]);
    assert.equal(typeof snapshot.rows[0].source_files['app/page.tsx'], 'string');
    assert.equal(snapshot.rows[0].preview_html, first.previewHtml, 'previous version stays immutable');
  } finally { await client.end(); }
  console.log('PASSED: PostgreSQL task, full source, session and continued modification survive application restart.');
} finally { await stop(); }
