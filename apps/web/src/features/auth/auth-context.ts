import { createContext, useContext } from 'react';
import type { ApplicationUser } from '@atoms-builder/contracts';
import type { AccountInput } from '../../api/types';

export interface AuthState {
  user: ApplicationUser | null;
  loading: boolean;
  error: Error | null;
  signingOut: boolean;
  login: (input: AccountInput) => Promise<void>;
  register: (input: AccountInput) => Promise<void>;
  logout: () => Promise<void>;
  retry: () => void;
}
export const AuthContext = createContext<AuthState | null>(null);
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider is required.');
  return value;
}

export function safeReturnPath(value: unknown): string {
  return typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\') &&
    !value.startsWith('/login') &&
    !value.startsWith('/register')
    ? value
    : '/';
}
