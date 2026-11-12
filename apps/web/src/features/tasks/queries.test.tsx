import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ApplicationTask } from '@atoms-builder/contracts';
import { applicationClient, ApiError } from '../../api/client';
import { createQueryClient, queryKeys } from '../../app/query-client';
import { AuthContext } from '../auth/auth-context';
import { isTaskActive, SubmissionIdentity, useTask, useTaskSubmission } from './queries';

const task: ApplicationTask = {
  id: 't1',
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
function setup() {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false }, mutations: { retry: false } });
  client.setQueryData(queryKeys.session, { user });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <AuthContext.Provider
        value={{
          user,
          loading: false,
          error: null,
          signingOut: false,
          login: async () => {},
          register: async () => {},
          logout: async () => {},
          retry: () => {},
        }}
      >
        {children}
      </AuthContext.Provider>
    </QueryClientProvider>
  );
  return { client, wrapper };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('persisted task server-state', () => {
  it('loads a direct task URL from the server, rather than requiring a browser session', async () => {
    vi.spyOn(applicationClient, 'task').mockResolvedValue({ ...task, phase: 'succeeded' });
    const { wrapper } = setup();
    const hook = renderHook(() => useTask('t1'), { wrapper });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(applicationClient.task).toHaveBeenCalledWith('t1', expect.any(AbortSignal));
    expect(hook.result.current.data?.id).toBe('t1');
    expect(isTaskActive(task)).toBe(true);
    expect(isTaskActive({ phase: 'running' })).toBe(true);
    expect(isTaskActive({ phase: 'succeeded' })).toBe(false);
  });
  it('reuses one idempotency key after an uncertain network response and advances after success', async () => {
    const create = vi
      .spyOn(applicationClient, 'createTask')
      .mockRejectedValueOnce(new ApiError('offline'))
      .mockResolvedValue(task);
    const { wrapper } = setup();
    const hook = renderHook(() => useTaskSubmission(), { wrapper });
    await act(async () => {
      await expect(hook.result.current.submit('Build')).rejects.toThrow('offline');
    });
    await act(async () => {
      await hook.result.current.submit('Build');
    });
    expect(create.mock.calls[0]?.[0].idempotencyKey).toBe(create.mock.calls[1]?.[0].idempotencyKey);
    await act(async () => {
      await hook.result.current.submit('Another');
    });
    expect(create.mock.calls[2]?.[0].idempotencyKey).not.toBe(
      create.mock.calls[1]?.[0].idempotencyKey,
    );
  });
  it('locks duplicate submissions and ignores late responses after the authenticated account changes', async () => {
    let resolve!: (task: ApplicationTask) => void;
    vi.spyOn(applicationClient, 'createTask').mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { client, wrapper } = setup();
    const hook = renderHook(() => useTaskSubmission(), { wrapper });
    let pending!: Promise<ApplicationTask | null>;
    act(() => {
      pending = hook.result.current.submit('Build');
    });
    await expect(hook.result.current.submit('Duplicate')).resolves.toBeNull();
    client.setQueryData(queryKeys.session, { user: { ...user, id: 'other-user' } });
    await act(async () => {
      resolve(task);
      await expect(pending).rejects.toMatchObject({ status: 401 });
    });
    expect(client.getQueryData(queryKeys.detail(task.id))).toBeUndefined();
  });
  it('invalidates persisted detail after a busy conflict without sending previous HTML', async () => {
    const modify = vi
      .spyOn(applicationClient, 'modifyTask')
      .mockRejectedValue(new ApiError('busy', 409));
    const { client, wrapper } = setup();
    const invalidated = vi.spyOn(client, 'invalidateQueries');
    const hook = renderHook(() => useTaskSubmission('t1'), { wrapper });
    await act(async () => {
      await expect(hook.result.current.submit('Update')).rejects.toMatchObject({ status: 409 });
    });
    expect(modify.mock.calls[0]?.[1]).toEqual({
      request: 'Update',
      idempotencyKey: expect.any(String),
    });
    expect(invalidated).toHaveBeenCalledWith({ queryKey: queryKeys.detail('t1') });
  });
  it('separates idempotency identities for changed input', () => {
    let count = 0;
    const identity = new SubmissionIdentity(() => String(++count));
    expect(identity.forRequest('A')).toBe('1');
    expect(identity.forRequest('A')).toBe('1');
    expect(identity.forRequest('B')).toBe('2');
    identity.complete();
    expect(identity.forRequest('B')).toBe('3');
  });
});
