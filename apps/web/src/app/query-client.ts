import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';

export const queryKeys = {
  session: ['session'] as const,
  tasks: ['tasks'] as const,
  list: (page: number) => ['tasks', 'list', page] as const,
  detail: (id: string) => ['tasks', 'detail', id] as const,
};

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        retry: (count, error) =>
          count < 1 && !(error instanceof ApiError && error.status && error.status < 500),
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
}
