import { test, expect } from 'claude-code/testing'

import { compactDue } from './register'

test('compaction: due 3 min before expiry and after it, once per reply', () => {
  const hour = 60 * 60 * 1000
  expect(compactDue(0, null, null)).toBe(false)
  expect(compactDue(hour - 4 * 60 * 1000, 0, null)).toBe(false)
  expect(compactDue(hour - 3 * 60 * 1000, 0, null)).toBe(true)
  expect(compactDue(5 * hour, 0, null)).toBe(true)
  expect(compactDue(hour, 0, 0)).toBe(false)
})
