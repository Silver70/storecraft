/**
 * The unwrapping, exercised as a unit because the failure mode is silence: a
 * check that misses the code does not throw, it just declines to retry, and the
 * conflict it was guarding surfaces as a 500 to the merchant instead.
 */
import { isUniqueViolation } from './db-error.util';

/** What Drizzle throws: the driver's error carried as `cause`. */
function wrapped(cause: unknown): Error {
  const error = new Error('Failed query');
  (error as Error & { cause?: unknown }).cause = cause;
  return error;
}

describe('isUniqueViolation', () => {
  it('recognises a unique violation the driver raised directly', () => {
    expect(
      isUniqueViolation(Object.assign(new Error('dup'), { code: '23505' })),
    ).toBe(true);
  });

  it('recognises one the query layer wrapped', () => {
    expect(
      isUniqueViolation(
        wrapped(Object.assign(new Error('dup'), { code: '23505' })),
      ),
    ).toBe(true);
  });

  it('recognises one wrapped more than once', () => {
    expect(
      isUniqueViolation(
        wrapped(wrapped(Object.assign(new Error('dup'), { code: '23505' }))),
      ),
    ).toBe(true);
  });

  it('does not claim any other database error', () => {
    expect(
      isUniqueViolation(
        wrapped(Object.assign(new Error('fk'), { code: '23503' })),
      ),
    ).toBe(false);
  });

  it('does not claim an error carrying no code at all', () => {
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation(wrapped(new Error('boom')))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
  });

  it('survives an error whose cause chain loops back on itself', () => {
    const looped = new Error('boom') as Error & { cause?: unknown };
    looped.cause = looped;
    expect(isUniqueViolation(looped)).toBe(false);
  });
});
