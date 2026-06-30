import assert from 'node:assert/strict';

import { getHistoryMonths } from '../src/lib/month-history';

assert.deepEqual(getHistoryMonths('2026-05', 4), [
  '2026-05',
  '2026-04',
  '2026-03',
  '2026-02',
]);

assert.deepEqual(getHistoryMonths('2026-01', 4), [
  '2026-01',
  '2025-12',
  '2025-11',
  '2025-10',
]);

assert.deepEqual(getHistoryMonths('2026-05', 1), ['2026-05']);
assert.deepEqual(getHistoryMonths('2026-05', 0), ['2026-05']);
assert.deepEqual(getHistoryMonths('bad-month', 3), ['bad-month']);

console.log('month-history tests passed');
