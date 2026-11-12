import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { focusManager, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { applicationClient, sessionEvents } from '../../api/client';
import { createQueryClient, queryKeys } from '../../app/query-client';
import { AuthProvider } from './AuthProvider';
import { useAuth } from './auth-context';
const user = { id: 'u1', username: 'builder', createdAt: '2026-11-11T00:00:00.000Z' };
function setup() {
  const client = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
  return { client, wrapper };
}
afterEach(() => {
  cleanup();
  focusManager.setFocused(undefined);
  vi.restoreAllMocks();
});
describe('cookie authentication state', () => {
  it('checks the server session and clears task caches on logout', async () => {
    vi.spyOn(applicationClient, 'me').mockResolvedValue({ user });
    vi.spyOn(applicationClient, 'logout').mockResolvedValue();
    const { client, wrapper } = setup();
    const hook = renderHook(useAuth, { wrapper });
    await waitFor(() => expect(hook.result.current.user?.id).toBe('u1'));
    client.setQueryData(queryKeys.detail('secret'), { title: 'private' });
    await act(async () => {
      await hook.result.current.logout();
    });
    expect(hook.result.current.user).toBeNull();
    expect(client.getQueryData(queryKeys.detail('secret'))).toBeUndefined();
  });
  it('clears task caches when a request reports session expiry', async () => {
    vi.spyOn(applicationClient, 'me').mockResolvedValue({ user });
    const { client, wrapper } = setup();
    const hook = renderHook(useAuth, { wrapper });
    await waitFor(() => expect(hook.result.current.user?.id).toBe('u1'));
    client.setQueryData(queryKeys.list(1), { tasks: ['private'] });
    act(() => {
      sessionEvents.dispatchEvent(new Event('expired'));
    });
    await waitFor(() => expect(hook.result.current.user).toBeNull());
    expect(client.getQueryData(queryKeys.list(1))).toBeUndefined();
  });
  it('rechecks even a fresh session on window focus and clears another account cache', async () => {
    const me = vi
      .spyOn(applicationClient, 'me')
      .mockResolvedValueOnce({ user })
      .mockResolvedValue({ user: { ...user, id: 'new-user' } });
    const { client, wrapper } = setup();
    const hook = renderHook(useAuth, { wrapper });
    await waitFor(() => expect(hook.result.current.user?.id).toBe('u1'));
    client.setQueryData(queryKeys.detail('old-task'), { title: 'private' });
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(hook.result.current.user?.id).toBe('new-user'));
    expect(me).toHaveBeenCalledTimes(2);
    expect(client.getQueryData(queryKeys.detail('old-task'))).toBeUndefined();
  });

  it('replaces all previous account data after successful authentication', async () => {
    vi.spyOn(applicationClient, 'me').mockResolvedValue({ user: null });
    vi.spyOn(applicationClient, 'register').mockResolvedValue({ user });
    const { client, wrapper } = setup();
    const hook = renderHook(useAuth, { wrapper });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    client.setQueryData(queryKeys.detail('old-account-task'), { title: 'old' });
    await act(async () => {
      await hook.result.current.register({ username: 'builder', password: 'password123' });
    });
    expect(client.getQueryData(queryKeys.session)).toEqual({ user });
    await waitFor(() => expect(hook.result.current.user?.username).toBe('builder'));
    expect(client.getQueryData(queryKeys.detail('old-account-task'))).toBeUndefined();
  });
});
