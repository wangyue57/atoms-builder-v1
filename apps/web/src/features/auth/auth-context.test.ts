import { describe, expect, it } from 'vitest';
import { safeReturnPath } from './auth-context';

describe('authentication return location', () => {
  it('keeps only local internal paths and avoids auth redirect loops', () => {
    expect(safeReturnPath('/tasks/t1?page=2')).toBe('/tasks/t1?page=2');
    for (const value of [
      'https://other.test',
      '//other.test',
      '/\\other.test',
      '/login',
      '/register?next=1',
      null,
    ])
      expect(safeReturnPath(value)).toBe('/');
  });
});
