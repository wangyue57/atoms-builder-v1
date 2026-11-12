import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, applicationClient, sessionEvents } from '../../api/client';
import type { AccountInput } from '../../api/types';
import { queryKeys } from '../../app/query-client';
import { AuthContext } from './auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);
  const session = useQuery({
    queryKey: queryKeys.session,
    queryFn: async ({ signal }) => {
      const next = await applicationClient.me(signal);
      const previous = client.getQueryData<{ user: { id: string } | null }>(queryKeys.session);
      if (previous && previous.user?.id !== next.user?.id) {
        await client.cancelQueries({ queryKey: queryKeys.tasks });
        client.removeQueries({ queryKey: queryKeys.tasks });
        client.getMutationCache().clear();
      }
      return next;
    },
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: 'always',
  });
  useEffect(() => {
    function expired() {
      void client.cancelQueries();
      client.removeQueries({ queryKey: queryKeys.tasks });
      client.getMutationCache().clear();
      client.setQueryData(queryKeys.session, { user: null });
    }
    sessionEvents.addEventListener('expired', expired);
    return () => sessionEvents.removeEventListener('expired', expired);
  }, [client]);

  async function authenticate(mode: 'login' | 'register', input: AccountInput) {
    const session = await applicationClient[mode](input);
    await client.cancelQueries();
    client.removeQueries({ queryKey: queryKeys.tasks });
    client.getMutationCache().clear();
    client.setQueryData(queryKeys.session, session);
  }
  async function logout() {
    setSigningOut(true);
    try {
      await applicationClient.logout();
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) throw error;
    } finally {
      await client.cancelQueries();
      client.removeQueries({ queryKey: queryKeys.tasks });
      client.getMutationCache().clear();
      client.setQueryData(queryKeys.session, { user: null });
      setSigningOut(false);
    }
  }
  return (
    <AuthContext.Provider
      value={{
        user: session.data?.user ?? null,
        loading: session.isPending,
        error: session.error,
        signingOut,
        login: (input) => authenticate('login', input),
        register: (input) => authenticate('register', input),
        logout,
        retry: () => {
          void session.refetch();
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
