import { test, expect, mock } from 'claude-code/testing'

import { NAMES, actionLabel, adoptRows, commandKey, openItemsNote, ranCommand, userCommands, costOf, editedPath, elapsed, glyph, nameFor, treeLines } from './register'
import type { AgentRow } from '../types'

const base = (id: string, over: Partial<AgentRow> = {}): AgentRow => ({
  id, name: id, description: `task ${id}`, type: 'general-purpose', parentId: null, model: 'claude-opus-5-5', status: 'running',
  prompt: 'do it', startedAt: 0, endedAt: null, lastActivity: 0, tools: 0, current: '', recent: [], files: [],
  tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, result: '', alerted: false, stuckAlerted: false, joinedLate: false,
  ...over,
})

test('labels: what an agent is doing, in a few words', () => {
  expect(actionLabel('Bash', { command: 'pytest -q tests/x.py', description: 'Run tests' })).toBe('Bash Run tests')
  expect(actionLabel('Edit', { file_path: '/a/b/c/d/e.py' })).toBe('Edit …/c/d/e.py')
  expect(actionLabel('Agent', { description: 'Fix the login' })).toBe('Agent: spawn Fix the login')
  expect(actionLabel('Grep', { pattern: 'foo' })).toBe('Grep foo')
  expect(editedPath('Write', { file_path: '/x.ts' })).toBe('/x.ts')
  expect(editedPath('Read', { file_path: '/x.ts' })).toBe(null)
})

test('names: the first free Vox Machina character, then -2', () => {
  expect(nameFor([])).toBe('kiki')
  expect(nameFor(['kiki', 'vex'])).toBe('vax')
  expect(nameFor([...NAMES])).toBe('kiki-2')
})

test('names: unnamed calls get the next free character, parallel calls never share one, a taken name is replaced', async ($, on) => {
  const seen: unknown[] = []
  on('tool.call', ($, e) => {
    seen.push((e as unknown as Record<string, unknown>).name)
    return { result: 'ok' }
  })
  await $.tool.call({ tool: 'Agent', description: 'Fix the login page', prompt: 'x' } as never)
  await $.tool.call({ tool: 'Agent', description: 'Fix the login page', prompt: 'x', name: 'login-fix' } as never)
  await Promise.all([
    $.tool.call({ tool: 'Agent', description: 'a', prompt: 'x' } as never),
    $.tool.call({ tool: 'Agent', description: 'b', prompt: 'x' } as never),
  ])
  await $.tool.call({ tool: 'Agent', description: 'c', prompt: 'x', name: 'kiki' } as never)
  expect(seen).toEqual(['kiki', 'login-fix', 'vex', 'vax', 'grog'])
})

test('agents started before the mod loaded are adopted from the list, once', () => {
  const listed = [
    { id: 'x', name: 'imessage-fix', description: 'Fix iMessage', type: 'general-purpose', status: 'running' },
    { id: 'y', description: 'Old one', type: 'Explore', status: 'completed' },
    { id: 'a', description: 'known', type: 'Explore', status: 'running' },
  ]
  const rows = adoptRows({ a: base('a') }, listed, 50)
  expect(rows.map(r => [r.id, r.name, r.joinedLate, r.startedAt])).toEqual([['x', 'imessage-fix', true, 50]])
})

test('cost, time and stuck', () => {
  const u = { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  expect(costOf('claude-sonnet-5-5', u)).toBe(18)
  expect(costOf('claude-haiku-5-5', u)).toBe(6)
  expect(elapsed(65_000)).toBe('1m05s')
  expect(glyph(base('a', { lastActivity: 0 }), 6 * 60 * 1000)).toBe('⚠')
  expect(glyph(base('a', { status: 'completed' }), 0)).toBe('✓')
})

test('tree: children under parents, live roots first, subtree cost', () => {
  const map = {
    a: base('a', { status: 'completed', startedAt: 5, costUsd: 1 }),
    b: base('b', { startedAt: 1 }),
    c: base('c', { parentId: 'a', startedAt: 6, costUsd: 0.5 }),
    d: base('d', { parentId: 'a', startedAt: 7 }),
    e: base('e', { parentId: 'c', startedAt: 8, costUsd: 0.25 }),
  }
  const lines = treeLines(map)
  expect(lines.map(l => `${l.lead}${l.row.id}`)).toEqual(['b', 'a', '├─ d', '└─ c', '   └─ e'])
  expect(lines[1]!.subtreeCost).toBe(1.75)
})

test('a spawn opens the pane, adds the may-spawn line, and a press expands the row', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const prompts: string[] = []
  on('agent.spawn', ($, e) => {
    prompts.push(e.prompt)
    return { model: 'claude-opus-5-5', agentId: 'p' }
  })
  on('tool.call', () => ({ result: 'ok' }))
  await $.agent.spawn({ prompt: 'Build it', description: 'Build the export', name: 'export' } as never)
  expect(prompts[0]).toContain('You may spawn your own subagents')
  await $.tool.call({ tool: 'Edit', file_path: '/repo/app/x.py', old_string: 'a', new_string: 'b', agentId: 'p' } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'agent-deck', surface, component: 'Pane', requestId: 'agents',
      props: { title: 'Agents', isFocused: true, bodyColumns: 56, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
    })
    expect(await ui.find({ type: 'Text', text: /1 running/ })).toBeDefined()
    expect(await ui.find({ key: 'row-p' })).toBeDefined()
    await ui.press({ key: 'row-p' })
    expect(await ui.find({ type: 'Text', text: /Task: Build it/ })).toBeDefined()
    await ui.press({ key: 'row-p' })
  }
})

test('blocked on you: flagged items and open questions show in the lower half; Done clears a flag', async ($, on) => {
  mock.clock(on, { now: 1000 })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  let release = () => {}
  on('tool.call', ($, e) => {
    if (e.tool === 'AskUserQuestion') return new Promise(done => { release = () => done({ result: 'Yes' }) })
    return { result: 'ok' }
  })
  const flagged = await $.tool.call({ tool: 'mcp__agent-deck__blocked_on_user', kind: 'command', what: 'gcloud login expired', command: 'gcloud auth login' } as never)
  expect(JSON.stringify(flagged)).toContain('b1')
  const asking = $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Merge PR 467?' }] } as never)
  const mounted = []
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'agent-deck', surface, component: 'Pane', requestId: 'agents',
      props: { title: 'Agents', isFocused: true, bodyColumns: 56, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
    })
    expect(await ui.find({ type: 'Text', text: /Blocked on you \(2\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$ gcloud auth login/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Merge PR 467\?/ })).toBeDefined()
    mounted.push(ui)
  }
  release()
  await asking
  const ui = mounted[0]!
  expect(await ui.find({ type: 'Text', text: /Blocked on you \(1\)/ })).toBeDefined()
  await ui.press({ key: 'done-b1' })
  expect(await ui.find({ type: 'Text', text: /Nothing\. Claude can keep going\./ })).toBeDefined()
})

test('commands handed to the user are found in a reply, and running one with ! is recognised', () => {
  const reply = [
    '1. Deploy (also covers the earlier deploy):',
    '! cd ~/code/app && git pull -q && scripts/deploy.sh',
    '',
    '2. Create the key secret:',
    '```',
    '! gcloud secrets create S --project=P',
    '```',
    'Not a command: ! is shouted here in the middle',
  ].join('\n')
  const found = userCommands(reply)
  expect(found.map(f => f.command)).toEqual([
    'cd ~/code/app && git pull -q && scripts/deploy.sh',
    'gcloud secrets create S --project=P',
  ])
  expect(found[0]!.what).toBe('1. Deploy (also covers the earlier deploy)')
  expect(found[1]!.what).toBe('2. Create the key secret')
  expect(ranCommand('<bash-input>gcloud auth login</bash-input>')).toBe('gcloud auth login')
  expect(ranCommand('! gcloud auth login')).toBe('gcloud auth login')
  expect(ranCommand('please run it')).toBe(null)
  expect(commandKey('a  b')).toBe(commandKey('a b'))
})

test('multi-line commands in a code block come whole, labelled by the step above, never by a fence', () => {
  const reply = [
    '**2. Run the smoke test**',
    '```',
    "! export A=1; curl -sS https://x \\",
    '  -H "a: b"',
    '```',
    '3. Send a test message:',
    '```bash',
    '! export K=2;',
    'curl -X POST https://y',
    '',
    '! echo two',
    '```',
  ].join('\n')
  const found = userCommands(reply)
  expect(found).toEqual([
    { command: 'export A=1; curl -sS https://x \\\n-H "a: b"', what: '2. Run the smoke test' },
    { command: 'export K=2;\ncurl -X POST https://y', what: '3. Send a test message' },
    { command: 'echo two', what: '3. Send a test message' },
  ])
})

test('the open items ride beside the next prompt so the model can clear what the message settles', () => {
  const note = openItemsNote([
    { id: 'b1', kind: 'decision', what: 'Merge PR 465?', command: '', agent: '', since: 0, auto: false },
    { id: 'cmd-x', kind: 'command', what: '2. Run the smoke test', command: 'scripts/smoke.sh\n--fast', agent: '', since: 0, auto: false },
  ])
  expect(note).toContain('- b1 (decision): Merge PR 465?')
  expect(note).toContain('command: scripts/smoke.sh --fast')
  expect(note).toContain('mcp__agent-deck__unblocked')
})
