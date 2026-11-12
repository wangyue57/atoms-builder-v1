import { applicationTaskSchema, applicationTaskListSchema } from '@atoms-builder/contracts';
import type { ApplicationCreateTask } from '@atoms-builder/contracts';
import type { z } from 'zod';
import { authenticatedSessionSchema, sessionSchema } from './types';
import type { AccountInput } from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const sessionEvents = new EventTarget();

export function createApplicationClient(
  fetcher: typeof fetch = fetch,
  onUnauthorized = () => sessionEvents.dispatchEvent(new Event('expired')),
) {
  async function request<T>(
    path: string,
    schema: z.ZodType<T> | null,
    options: RequestInit = {},
    reportUnauthorized = true,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetcher(path, { credentials: 'same-origin', ...options });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new ApiError('网络连接中断，请重试。重复提交会安全复用本次请求。');
    }
    if (response.status === 401 && reportUnauthorized) onUnauthorized();
    if (response.status === 204 && response.ok && schema === null) return undefined as T;
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ApiError(
        response.status === 401
          ? '登录已过期，请重新登录。'
          : '服务返回了无法解析的响应，请稍后重试。',
        response.status,
      );
    }
    if (!response.ok) {
      const detail =
        typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
      const fallback =
        response.status === 401
          ? '登录已过期，请重新登录。'
          : response.status === 409
            ? '当前任务正在处理中，请等待完成后再提交。'
            : `请求失败（${response.status}）`;
      throw new ApiError(
        typeof detail.error === 'string' ? detail.error : fallback,
        response.status,
        typeof detail.code === 'string' ? detail.code : undefined,
      );
    }
    if (!schema) return undefined as T;
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      throw new ApiError(
        '服务响应格式不正确，请检查服务版本后重试。',
        response.status,
        'INVALID_PAYLOAD',
      );
    return parsed.data;
  }
  const post = (body: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    me: (signal?: AbortSignal) => request('/api/auth/me', sessionSchema, { signal }),
    login: (input: AccountInput) =>
      request('/api/auth/login', authenticatedSessionSchema, post(input), false),
    register: (input: AccountInput) =>
      request('/api/auth/register', authenticatedSessionSchema, post(input), false),
    logout: () => request<void>('/api/auth/logout', null, { method: 'POST' }),
    tasks: (page: number, signal?: AbortSignal) =>
      request(`/api/tasks?page=${page}&pageSize=20`, applicationTaskListSchema, { signal }),
    task: (id: string, signal?: AbortSignal) =>
      request(`/api/tasks/${encodeURIComponent(id)}`, applicationTaskSchema, { signal }),
    createTask: (input: ApplicationCreateTask) =>
      request('/api/tasks', applicationTaskSchema, post(input)),
    modifyTask: (id: string, input: ApplicationCreateTask) =>
      request(`/api/tasks/${encodeURIComponent(id)}/runs`, applicationTaskSchema, post(input)),
  };
}
export type ApplicationClient = ReturnType<typeof createApplicationClient>;
export const applicationClient = createApplicationClient();
