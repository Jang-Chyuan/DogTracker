import { getErrorMessage } from '../src/utils/errors';

test.each([
  [new Error('locked'), 'locked'],
  [{ message: 'disk full' }, 'disk full'],
  [' failed ', 'failed'],
  [null, 'fallback'],
  [undefined, 'fallback'],
  [{ code: 5 }, 'fallback'],
  [{ message: 5 }, 'fallback'],
  ['   ', 'fallback'],
])(
  'normalizes rejection %# without hiding an unknown error',
  (error, expected) => {
    expect(getErrorMessage(error, 'fallback')).toBe(expected);
  },
);
