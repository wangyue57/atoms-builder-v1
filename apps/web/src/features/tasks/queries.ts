import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { applicationClient, ApiError } from '../../api/client';
import type { ApplicationTask } from '@atoms-builder/contracts';
import { queryKeys } from '../../app/query-client';
import { useAuth } from '../auth/auth-context';

export function isTaskActive(task: Pick<ApplicationTask, 'phase'> | undefined) {
  return task?.phase === 'queued' || task?.phase === 'running';
}

export function useTask(id: string) {
  return useQuery({
    queryKey: queryKeys.detail(id),
    queryFn: ({ signal }) => applicationClient.task(id, signal),
    enabled: Boolean(id),
    refetchInterval: (query) => (isTaskActive(query.state.data) ? 1500 : false),
  });
}

/** Keep one key for the same request until a definitive server response arrives. */
export class SubmissionIdentity {
  private pending: { request: string; key: string } | null = null;
  constructor(private createId: () => string = () => crypto.randomUUID()) {}
  forRequest(request: string) {
    if (this.pending?.request !== request) this.pending = { request, key: this.createId() };
    return this.pending.key;
  }
  complete() {
    this.pending = null;
  }
}

export function useTaskSubmission(taskId?: string) {
  const client = useQueryClient();
  const { user } = useAuth();
  const ownerId = user?.id;
  const identity = useRef(new SubmissionIdentity());
  const lock = useRef(false);
  const mutation = useMutation({
    mutationFn: async (request: string) => {
      const input = {
        request: request.trim(),
        idempotencyKey: identity.current.forRequest(request.trim()),
      };
      const task = taskId
        ? await applicationClient.modifyTask(taskId, input)
        : await applicationClient.createTask(input);
      const active = client.getQueryData<{ user: { id: string } | null }>(queryKeys.session);
      if (!ownerId || active?.user?.id !== ownerId)
        throw new ApiError('会话已变更，请重新打开任务。', 401);
      return task;
    },
    onSuccess: (task) => {
      identity.current.complete();
      client.setQueryData(queryKeys.detail(task.id), task);
      void client.invalidateQueries({ queryKey: queryKeys.tasks, refetchType: 'inactive' });
    },
    onError: (error) => {
      // 4xx is definitive; a lost/invalid/5xx response may follow a committed write.
      if (error instanceof ApiError && error.status && error.status >= 400 && error.status < 500)
        identity.current.complete();
      if (error instanceof ApiError && error.status === 409 && taskId)
        void client.invalidateQueries({ queryKey: queryKeys.detail(taskId) });
    },
  });
  async function submit(request: string): Promise<ApplicationTask | null> {
    if (lock.current || !request.trim() || request.length > 10_000) return null;
    lock.current = true;
    try {
      return await mutation.mutateAsync(request);
    } finally {
      lock.current = false;
    }
  }
  return { ...mutation, submit };
}
