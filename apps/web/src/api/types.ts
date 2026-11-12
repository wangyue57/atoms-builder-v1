import { applicationUserSchema } from '@atoms-builder/contracts';
import type { accountInputSchema } from '@atoms-builder/contracts';
import { z } from 'zod';

export type {
  ApplicationUser,
  ApplicationTask,
  ApplicationTaskSummary,
  ApplicationTaskList,
  ApplicationRunResult,
  ApplicationCreateTask,
} from '@atoms-builder/contracts';

export const sessionSchema = z.object({ user: applicationUserSchema.nullable() });
export const authenticatedSessionSchema = z.object({ user: applicationUserSchema });
export type AccountInput = z.input<typeof accountInputSchema>;
