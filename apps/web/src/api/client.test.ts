import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApplicationClient } from './client';

const task = {
  id: 'task-1',
  title: 'Build',
  phase: 'queued',
  lastRequest: 'Build',
  error: null,
  currentVersionId: null,
  createdAt: '2026-11-11T00:00:00.000Z',
  updatedAt: '2026-11-11T00:00:00.000Z',
  result: null,
  previewHtml: '',
  runs: [],
};
const user = { id: 'u1', username: 'builder', createdAt: '2026-11-11T00:00:00.000Z' };
function setup(response: Response) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
  const expired = vi.fn();
  return { client: createApplicationClient(fetcher, expired), fetcher, expired };
}

describe('Application HTTP client', () => {
  it('uses cookie credentials and validates the shared queued-task contract', async () => {
    const { client, fetcher } = setup(Response.json(task, { status: 202 }));
    const input = { request: 'Build', idempotencyKey: 'request-1' };
    expect(await client.createTask(input)).toEqual(task);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/tasks',
      expect.objectContaining({
        credentials: 'same-origin',
        method: 'POST',
        body: JSON.stringify(input),
      }),
    );
    expect(fetcher.mock.calls[0]?.[1]?.body).not.toContain('previousHtml');
  });
  it('loads persisted details and paginated summaries with abort support', async () => {
    const { client, fetcher } = setup(Response.json(task));
    const controller = new AbortController();
    await client.task('task/1', controller.signal);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/tasks/task%2F1',
      expect.objectContaining({ signal: controller.signal }),
    );
    fetcher.mockResolvedValue(Response.json({ tasks: [task], total: 1, page: 2, pageSize: 20 }));
    expect((await client.tasks(2)).page).toBe(2);
    expect(fetcher).toHaveBeenLastCalledWith('/api/tasks?page=2&pageSize=20', expect.anything());
  });
  it('supports authenticated login and 204 logout without reading or storing tokens', async () => {
    const { client, fetcher } = setup(Response.json({ user }));
    expect(await client.login({ username: 'builder', password: 'password123' })).toEqual({ user });
    fetcher.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(client.logout()).resolves.toBeUndefined();
  });
  it('reports expired sessions globally, but leaves incorrect-login errors in the form', async () => {
    const { client, expired } = setup(Response.json({ error: 'expired' }, { status: 401 }));
    await expect(client.task('1')).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledTimes(1);
    await expect(client.login({ username: 'test', password: 'password123' })).rejects.toMatchObject(
      { status: 401 },
    );
    expect(expired).toHaveBeenCalledTimes(1);
  });
  it('preserves conflict status and rejects malformed successful responses', async () => {
    const { client, fetcher } = setup(Response.json({ error: 'Task is busy' }, { status: 409 }));
    await expect(
      client.modifyTask('1', { request: 'Update', idempotencyKey: 'key-12345' }),
    ).rejects.toMatchObject({ status: 409, message: 'Task is busy' });
    fetcher.mockResolvedValue(Response.json({ ...task, phase: 'made-up' }));
    await expect(client.task('1')).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });
  });
  it('handles non-JSON, network errors, and aborts without hiding failure modes', async () => {
    const { client, fetcher } = setup(new Response('bad gateway', { status: 502 }));
    await expect(client.me()).rejects.toBeInstanceOf(ApiError);
    fetcher.mockRejectedValue(new TypeError('offline'));
    await expect(client.me()).rejects.toThrow('网络连接中断');
    fetcher.mockRejectedValue(new DOMException('cancel', 'AbortError'));
    await expect(client.me()).rejects.toMatchObject({ name: 'AbortError' });
  });
});
