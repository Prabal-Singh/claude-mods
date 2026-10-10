import { test, expect } from 'claude-code/testing'

import { factsNote, isReport, minutes } from './register'

const agent = (name: string, over: Record<string, unknown> = {}) => ({
  name, description: `task ${name}`, type: 'general-purpose', status: 'completed', startedAt: 0, endedAt: 600_000,
  costUsd: 0.5, files: [], result: '', ...over,
})

test('matches /report however the engine names it', () => {
  expect(isReport('report')).toBe(true)
  expect(isReport('status-report:report')).toBe(true)
  expect(isReport('compact')).toBe(false)
  expect(isReport('reports')).toBe(false)
})

test('minutes and hours', () => {
  expect(minutes(90_000)).toBe('2m')
  expect(minutes(65 * 60_000)).toBe('1h05m')
})

test('the facts note: session, subagents newest first, blockers', () => {
  const note = factsNote({
    now: 3_600_000, startedAt: 0, costUsd: 12.345, model: 'claude-opus-5-5', turns: 7, cwd: '/repo',
    agents: [
      agent('kiki', { files: ['a.py', 'b.py'], result: '\nOpened PR #12\nmore' }),
      agent('vex', { startedAt: 1_000_000, endedAt: null, status: 'running', costUsd: 0.25 }),
    ],
    blockers: [{ id: 'b1', kind: 'command', what: 'Log in to gcloud', command: 'gcloud auth login' }],
  })
  expect(note).toContain('model claude-opus-5-5, 7 prompts so far, started 1h00m ago.')
  expect(note).toContain('Session cost so far: $12.35')
  expect(note).toContain('Subagents (2, estimated $0.75 in all)')
  expect(note.indexOf('vex · running · 43m')).toBeLessThan(note.indexOf('kiki · completed · 10m'))
  expect(note).toContain('2 files: a.py, b.py; result: Opened PR #12')
  expect(note).toContain('b1 (command): Log in to gcloud — run: gcloud auth login')
})

test('an empty session says so plainly', () => {
  const note = factsNote({ now: 0, model: 'm', turns: 0, cwd: '/r', agents: [], blockers: [] })
  expect(note).toContain('Session cost: not recorded.')
  expect(note).toContain('Subagents: none this session.')
  expect(note).toContain('nothing open in the panel')
})
