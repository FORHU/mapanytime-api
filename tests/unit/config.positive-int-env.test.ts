import { positiveIntEnv } from '../../src/config';

const NAME = 'TEST_POSITIVE_INT_ENV';

afterEach(() => {
  delete process.env[NAME];
});

describe('positiveIntEnv', () => {
  it('falls back when unset or blank', () => {
    expect(positiveIntEnv(NAME, 7)).toBe(7);
    process.env[NAME] = '  ';
    expect(positiveIntEnv(NAME, 7)).toBe(7);
  });

  it('reads a positive whole number', () => {
    process.env[NAME] = ' 250 ';
    expect(positiveIntEnv(NAME, 7)).toBe(250);
  });

  it.each(['abc', '0', '-1', '1.5', '10abc'])('refuses %p instead of weakening a limit', (raw) => {
    process.env[NAME] = raw;
    expect(() => positiveIntEnv(NAME, 7)).toThrow(NAME);
  });
});
