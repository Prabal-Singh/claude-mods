import { test, expect, mock } from 'claude-code/testing'

import { NAMES, autoTitle, clearThreads, findThread, threadOrder, threadsNote, actionLabel, adoptRows, agentSuggestions, agentsByName, claimedName, commandKey, namedPrompt, heldNames, pickName, nextNames, newestId, renameIn, openItemsNote, pruneFinished, ranCommand, userCommands, costOf, editedPath, elapsed, glyph, treeLines } from './register'
import type { AgentRow } from '../types'

const base = (id: string, over: Partial<AgentRow> = {}): AgentRow => ({
  id, name: id, description: `task ${id}`, type: 'general-purpose', parentId: null, model: 'claude-opus-5-5', status: 'running',
  prompt: 'do it', startedAt: 0, endedAt: null, lastActivity: 0, tools: 0, current: '', recent: [], files: [],
  tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, result: '', alerted: false, stuckAlerted: false, joinedLate: false, thread: '',
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
  expect(pickName(new Set(), {})).toBe('kiki')
  expect(pickName(new Set(['kiki', 'vex']), {})).toBe('vax')
  expect(pickName(new Set(NAMES), {})).toBe('kiki-2')
})

test('names: unnamed calls get the next free character, parallel calls never share one, a taken name is replaced', async ($, on) => {
  mock.clock(on, { now: 1000 })
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
  // The question reaches the engine only after the mod has flagged it: mount once it has.
  let reached = () => {}
  const atAsk = new Promise<void>(done => { reached = done })
  on('tool.call', ($, e) => {
    if (e.tool === 'AskUserQuestion') {
      reached()
      return new Promise(done => { release = () => done({ result: 'Yes' }) })
    }
    return { result: 'ok' }
  })
  const flagged = await $.tool.call({ tool: 'mcp__agent-deck__blocked_on_user', kind: 'command', what: 'gcloud login expired', command: 'gcloud auth login' } as never)
  expect(JSON.stringify(flagged)).toContain('b1')
  const asking = $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Merge PR 467?' }] } as never)
  await atAsk
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

test('many agents in a small panel: whole rows, no squeezing, the rest counted', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `a${++n}` }))
  for (let i = 0; i < 15; i++) {
    await $.agent.spawn({ prompt: 'x', description: `Task ${i}`, name: `agent${i}` } as never)
    await clock.advance(1000)
  }
  const ui = await $.ui.mount({
    plugin: 'agent-deck', surface: 'terminal', component: 'Pane', requestId: 'agents',
    props: { title: 'Agents', isFocused: true, bodyColumns: 56, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  expect(await ui.find({ type: 'Text', text: /15 running/ })).toBeDefined()
  expect(await ui.find({ key: 'row-a15' })).toBeDefined()
  const head = (await ui.findAll({ type: 'Button' })).map(b => String(b.props.label ?? '')).find(l => l.startsWith('Task 0'))
  expect(head).toContain('+11 hidden')
  expect(await ui.find({ key: 'row-a1' })).toBeUndefined()
})

test('finished agents leave the panel 10 minutes after they end, unless a child still runs', () => {
  const map = {
    old: base('old', { status: 'completed', endedAt: 0 }),
    fresh: base('fresh', { status: 'completed', endedAt: 9 * 60 * 1000 }),
    parent: base('parent', { status: 'completed', endedAt: 0 }),
    kid: base('kid', { parentId: 'parent' }),
    live: base('live'),
  }
  expect(Object.keys(pruneFinished(map, 11 * 60 * 1000)).sort()).toEqual(['fresh', 'kid', 'live', 'parent'])
})

test('a long finished row is cut to the panel width, never squeezed to nothing; idle counts as done', async ($, on) => {
  mock.clock(on, { now: 1000 })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'c1' }))
  await $.agent.spawn({ prompt: 'x', description: 'Full iMessage real-line checklist script with many words', name: 'cassandra' } as never)
  expect(glyph(base('i', { status: 'idle' }), 0)).toBe('✓')
  const ui = await $.ui.mount({
    plugin: 'agent-deck', surface: 'terminal', component: 'Pane', requestId: 'agents',
    props: { title: 'Agents', isFocused: true, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  })
  const row = await ui.find({ key: 'row-c1' })
  expect(String(row?.props.label ?? '')).toContain('cassandra')
  expect(String(row?.props.label ?? '').length).toBeLessThanOrEqual(38)
})

test('names rotate: every character is used before one comes back, and the one free longest comes back first', () => {
  const min = 60 * 1000
  const used = (name: string, startedAt: number, endedAt: number | null) => ({ name, startedAt, endedAt })
  // kiki and vex were used and are long done: the 18 never-used names still come first.
  const names = { a: used('kiki', 0, 5 * min), b: used('vex', 0, 2 * min) }
  expect(pickName(heldNames({}, [], [], names, 60 * min), names)).toBe('vax')
  // All 20 used and free: the one whose agent finished longest ago.
  const all = Object.fromEntries(NAMES.map((n, i) => [n, used(n, 0, (30 - i) * min)]))
  expect(pickName(heldNames({}, [], [], all, 60 * min), all)).toBe('syldor')
  expect(nextNames(heldNames({}, [], [], all, 60 * min), all, 3)).toEqual(['syldor', 'wilhand', 'jarett'])
  // Held: running in the panel or the engine's list, just handed out, or ended under 10 minutes ago.
  const held = heldNames(
    { r: base('r', { name: 'kiki' }), d: base('d', { name: 'vex', status: 'completed', endedAt: 55 * min }) },
    [{ name: 'vax', at: 0 }],
    [{ name: 'grog', status: 'running' }, { name: 'pike', status: 'completed' }],
    { x: used('scanlan', 0, 52 * min), y: used('percy', 0, 40 * min) },
    60 * min,
  )
  expect([...held].sort()).toEqual(['grog', 'kiki', 'scanlan', 'vax', 'vex'])
  // An agent known only from before a restart, never seen to end, holds its name 10 minutes from its start.
  expect(heldNames({}, [], [], { z: used('tary', 55 * min, null) }, 60 * min).has('tary')).toBe(true)
  expect(heldNames({}, [], [], { z: used('tary', 0, null) }, 60 * min).has('tary')).toBe(false)
})

test('SendMessage by name: the newest agent given it; mentions of a wanted name are swapped whole-word', () => {
  const names = { a1: { name: 'kiki', startedAt: 1, endedAt: 2 }, a2: { name: 'kiki', startedAt: 9, endedAt: null }, a3: { name: 'vex', startedAt: 5, endedAt: null } }
  expect(newestId(names, 'Kiki')).toBe('a2')
  expect(newestId(names, 'grog')).toBeUndefined()
  expect(renameIn('kiki: deploy. Report as kiki, not kikis or kiki-2.', 'kiki', 'vax')).toBe('vax: deploy. Report as vax, not kikis or kiki-2.')
  expect(claimedName('Deploy it', 'kiki: deploy Vingo agent')).toBe('kiki')
  expect(claimedName('Deploy it', 'Pike the agent')).toBe('')
})

test('a SendMessage to a name is sent to the newest agent with it, by id', async ($, on) => {
  mock.clock(on, { now: 1000 })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `a${String(++n).padStart(16, '0')}` }))
  const sent: unknown[] = []
  on('tool.call', ($, e) => {
    if (e.tool === 'SendMessage') sent.push((e as unknown as Record<string, unknown>).to)
    return { result: 'ok' }
  })
  await $.agent.spawn({ prompt: 'x', description: 'one', name: 'kiki' } as never)
  await $.agent.spawn({ prompt: 'x', description: 'two', name: 'kiki' } as never)
  await $.tool.call({ tool: 'SendMessage', to: 'kiki', message: 'hi' } as never)
  await $.tool.call({ tool: 'SendMessage', to: 'a0000000000000001', message: 'hi' } as never)
  await $.tool.call({ tool: 'SendMessage', to: 'someone-else', message: 'hi' } as never)
  expect(sent).toEqual(['a0000000000000002', 'a0000000000000001', 'someone-else'])
})

test('a brief that names itself: the name is read from it, and the prompt always says the name the agent got', () => {
  expect(claimedName('You are tary-3. The public sdk repo ...')).toBe('tary-3')
  expect(claimedName('  You are Grog, a reviewer')).toBe('grog')
  expect(claimedName('You are a reviewer')).toBe('')
  expect(namedPrompt('You are tary-3. Rebase it.', 'kiki')).toBe('You are kiki. Rebase it.\n\nYour name in this session is kiki.')
  expect(namedPrompt('Rebase it.', 'vex')).toBe('Rebase it.\n\nYour name in this session is vex.')
  expect(namedPrompt(namedPrompt('Rebase it.', 'vex'), 'vex')).toBe('Rebase it.\n\nYour name in this session is vex.')
})

test('an Agent call: the prompt\'s own name is used when free, a taken name is replaced and the result says so', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const seen: Record<string, unknown>[] = []
  on('tool.call', ($, e) => {
    seen.push(e as unknown as Record<string, unknown>)
    return { result: 'launched' }
  })
  const first = await $.tool.call({ tool: 'Agent', description: 'Rebase', prompt: 'You are tary-3. Rebase the sdk.' } as never)
  expect(seen[0]!.name).toBe('tary-3')
  expect(String(seen[0]!.prompt)).toContain('Your name in this session is tary-3.')
  expect(JSON.stringify(first)).toContain('taken from its brief')
  const second = await $.tool.call({ tool: 'Agent', description: 'Again', prompt: 'You are tary-3. Again.', name: 'tary-3' } as never)
  expect(seen[1]!.name).toBe('kiki')
  expect(String(seen[1]!.prompt)).toMatch(/^You are kiki\. Again\./)
  expect(JSON.stringify(second)).toContain('named kiki (not tary-3')
  const third = await $.tool.call({ tool: 'Agent', description: 'Fresh', prompt: 'Do it', name: 'vex' } as never)
  expect(seen[2]!.name).toBe('vex')
  expect(JSON.stringify(third)).not.toContain('already used')
})

test('/agent: names autocomplete after the command, running first; a name opens its row', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `g${++n}` }))
  on('prompt.autocomplete', () => ({ suggestions: [{ text: 'built-in' }] }))
  await $.agent.spawn({ prompt: 'x', description: 'Review PR 5', name: 'kiki' } as never)
  await clock.advance(1000)
  await $.agent.spawn({ prompt: 'x', description: 'Fix the poller', name: 'kima' } as never)
  const all = agentsByName(await (async () => ({ g1: base('g1', { name: 'kiki', status: 'completed', startedAt: 1 }), g2: base('g2', { name: 'kima', startedAt: 2 }) }))(), [])
  expect(all.map(a => a.name)).toEqual(['kima', 'kiki'])
  expect(agentSuggestions('/agent k', 7, 'k', all).map(s => s.label)).toEqual(['kima', 'kiki'])
  expect(agentSuggestions('/agent kik', 7, 'kik', all).map(s => s.text)).toEqual(['kiki '])
  expect(agentSuggestions('hello k', 6, 'k', all)).toEqual([])
  expect(agentSuggestions('/tell k', 6, 'k', all).map(s => s.label)).toEqual(['kima', 'kiki'])
  expect(agentSuggestions('/agent kiki do', 12, 'do', all)).toEqual([])
  const done = await $.command.run({ command: 'agent', args: 'kiki' } as never)
  expect(JSON.stringify(done)).toContain('kiki')
  const ui = await $.ui.mount({
    plugin: 'agent-deck', surface: 'terminal', component: 'Pane', requestId: 'agents',
    props: { title: 'Agents', isFocused: true, bodyColumns: 56, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  expect(await ui.find({ type: 'Text', text: /Task: x/ })).toBeDefined()
  const rows = await $.prompt.autocomplete({ text: '/agent k', cursor: 8, token: 'k', start: 7 } as never)
  expect(JSON.stringify(rows)).toContain('kima')
  const missing = await $.command.run({ command: 'agent', args: 'nobody' } as never)
  expect(JSON.stringify(missing)).toContain('No subagent named nobody')
})

test('an inline `! cmd`: description ends at the backtick and is labelled by its description', () => {
  const found = userCommands('Two items in your panel\n- `! bash /tmp/im-history.sh`: the raw webhook bodies, which unblock tapbacks.')
  expect(found).toEqual([{ command: 'bash /tmp/im-history.sh', what: 'the raw webhook bodies, which unblock tapbacks.' }])
  expect(userCommands('Run `! gcloud auth login` now')).toEqual([])
})

test('work threads: auto titles, order, loose match, and the note beside each prompt', () => {
  expect(autoTitle('Fix e2e tests group A')).toBe('Fix e2e tests group A')
  expect(autoTitle('Restore the agents.md guide redirect for every old link we still have')).toBe('Restore the agents.md guide')
  const t = (id: string, lastAt: number) => ({ id, title: `T ${id}`, auto: false, createdAt: 0, lastAt, archived: { done: 0, failed: 0, cost: 0 } })
  const list = [t('a', 3), t('b', 1), t('c', 2)]
  const map = { x: base('x', { thread: 'b' }) }
  expect(threadOrder(list, map, 'c').map(x => x.id)).toEqual(['c', 'b', 'a'])
  expect(findThread(list, 't  B')?.id).toBe('b')
  expect(threadsNote([], '')).toBe('')
  expect(threadsNote(list, 'c')).toContain('current "T c"; others "T a", "T b"')
})

test('finished rows stay in their thread an hour (newest few), but free their names after 10 minutes', () => {
  const min = 60 * 1000
  const map = {
    a: base('a', { name: 'kiki', status: 'completed', endedAt: 0, startedAt: 0, thread: 't1' }),
    b: base('b', { name: 'vex', status: 'completed', endedAt: 30 * min, startedAt: 1, thread: 't1' }),
    c: base('c', { name: 'vax', status: 'completed', endedAt: 30 * min, startedAt: 2, thread: 't1' }),
    d: base('d', { name: 'grog', status: 'completed', endedAt: 0, startedAt: 3, thread: 't2' }),
  }
  expect(Object.keys(pruneFinished(map, 61 * min, 60 * min, 1)).sort()).toEqual(['c'])
  expect(Object.keys(pruneFinished(map, 50 * min, 60 * min, 8)).sort()).toEqual(['a', 'b', 'c', 'd'])
  expect([...heldNames(map, [], [], {}, 50 * min)]).toEqual([])
  expect([...heldNames(map, [], [], {}, 35 * min)]).toEqual(['vex', 'vax'])
})

test('agents join the current thread, their children their parent\'s; the pane shows one dropdown per thread', async ($, on) => {
  mock.clock(on, { now: 1000 })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `a${++n}` }))
  await $.agent.spawn({ prompt: 'x', description: 'Fix e2e tests group A', name: 'kiki' } as never)
  await $.tool.call({ tool: 'mcp__agent-deck__work_thread', title: 'Vingo agent' } as never)
  await $.agent.spawn({ prompt: 'x', description: 'Vingo nudges', name: 'vex' } as never)
  await $.agent.spawn({ prompt: 'x', description: 'Nudge child', name: 'vax', parentAgentId: 'a1' } as never)
  const ui = await $.ui.mount({
    plugin: 'agent-deck', surface: 'terminal', component: 'Pane', requestId: 'agents',
    props: { title: 'Agents', isFocused: true, bodyColumns: 56, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  const heads = (await ui.findAll({ type: 'Button' })).map(b => String(b.props.label ?? ''))
  expect(heads.some(l => l.startsWith('Fix e2e tests group A · 2 running'))).toBe(true)
  expect(heads.some(l => l.startsWith('Vingo agent · 1 running'))).toBe(true)
})

test('a taken name: the brief and description are rewritten to the name the agent got', async ($, on) => {
  mock.clock(on, { now: 1000 })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a0000000000000001' }))
  const seen: Record<string, unknown>[] = []
  on('tool.call', ($, e) => {
    seen.push(e as unknown as Record<string, unknown>)
    return { result: 'ok' }
  })
  await $.agent.spawn({ prompt: 'x', description: 'running one', name: 'kiki' } as never)
  await $.tool.call({ tool: 'Agent', name: 'kiki', description: 'kiki: deploy Vingo', prompt: 'You are kiki. When done, report as kiki.' } as never)
  const call = seen.at(-1)!
  expect(call.name).toBe('vex')
  expect(call.description).toBe('vex: deploy Vingo')
  expect(call.prompt).toBe('You are vex. When done, report as vex.\n\nYour name in this session is vex.')
})

test('/deck clear: finished rows go at once, live ones and their parents stay', async ($, on) => {
  const map = {
    done: base('done', { status: 'completed', endedAt: 1000 }),
    live: base('live'),
    parent: base('parent', { status: 'completed', endedAt: 1000 }),
    kid: base('kid', { parentId: 'parent' }),
  }
  expect(Object.keys(pruneFinished(map, 1001, 0)).sort()).toEqual(['kid', 'live', 'parent'])
  mock.clock(on, { now: 1000 })
  const out = await $.command.run({ command: 'deck', args: 'clear' } as never)
  expect(JSON.stringify(out)).toContain('No finished agents to clear')
})

test('clearing threads keeps the current one and any with a live agent, and takes the ended rows of the rest and of "Other"', () => {
  const t = (id: string) => ({ id, title: `T ${id}`, auto: false, createdAt: 0, lastAt: 0, archived: { done: 0, failed: 0, cost: 0 } })
  const list = [t('cur'), t('busy'), t('waits'), t('old'), t('older')]
  const map = {
    a: base('a', { thread: 'busy' }),
    b: base('b', { thread: 'busy', status: 'completed', endedAt: 1 }),
    c: base('c', { thread: 'waits', status: 'waiting' }),
    d: base('d', { thread: 'old', status: 'completed', endedAt: 1 }),
    e: base('e', { thread: 'old', status: 'failed', endedAt: 1 }),
    f: base('f', { thread: 'cur', status: 'completed', endedAt: 1 }),
    g: base('g', { thread: '', status: 'completed', endedAt: 1 }),
  }
  const out = clearThreads(list, map, 'cur')
  expect(out.kept.map(x => x.id)).toEqual(['cur', 'busy', 'waits'])
  expect(out.removed.map(x => x.id)).toEqual(['old', 'older'])
  expect(out.rows.sort()).toEqual(['d', 'e', 'g'])
  expect(threadsNote(out.kept, 'cur')).toContain('current "T cur"; others "T busy", "T waits".')
})

test('work_thread clear: says what went and what is left; the next prompt\'s note lists only what is left', async ($, on) => {
  mock.clock(on, { now: 1000 })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  await $.tool.call({ tool: 'mcp__agent-deck__work_thread', title: 'Old topic' } as never)
  await $.tool.call({ tool: 'mcp__agent-deck__work_thread', title: 'Vingo agent' } as never)
  const out = await $.tool.call({ tool: 'mcp__agent-deck__work_thread', clear: true } as never)
  const text = JSON.stringify(out)
  expect(text).toContain('Cleared 1 thread (\\"Old topic\\")')
  expect(text).toContain('* Vingo agent')
  const again = await $.command.run({ command: 'thread', args: 'clear' } as never)
  expect(JSON.stringify(again)).toContain('No old threads to clear.')
  const list = await $.command.run({ command: 'thread', args: '' } as never)
  expect(JSON.stringify(list)).not.toContain('Old topic')
})

test('a subagent cannot clear threads', async ($, on) => {
  mock.clock(on, { now: 1000 })
  await $.tool.call({ tool: 'mcp__agent-deck__work_thread', title: 'Old topic' } as never)
  await $.tool.call({ tool: 'mcp__agent-deck__work_thread', title: 'Vingo agent' } as never)
  const out = await $.tool.call({ tool: 'mcp__agent-deck__work_thread', clear: true, agentId: 'sub1' } as never)
  expect(JSON.stringify(out)).toContain('nothing changed')
  const list = await $.command.run({ command: 'thread', args: '' } as never)
  expect(JSON.stringify(list)).toContain('Old topic')
})
