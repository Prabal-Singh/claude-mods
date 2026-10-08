import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentMap, AgentRow, Blocker } from '../types'

const PANE = 'agents'
const TITLE = 'Agents'
const TICK_MS = 2000
const STUCK_MS = 5 * 60 * 1000
// "Blocked on you" items go away by themselves after this long: commands read from a reply, and flagged items.
const REPLY_COMMAND_TTL_MS = 2 * 60 * 60 * 1000
const FLAG_TTL_MS = 24 * 60 * 60 * 1000
// Finished agents leave the panel this long after they end (their pop-up already said how it went).
const DONE_TTL_MS = 10 * 60 * 1000
const MAY_SPAWN =
  '\n\nYou may spawn your own subagents (Agent tool) for parts of this task that split cleanly; give each a precise brief.'

// Subagents are named for Vox Machina and their friends, in this order.
export const NAMES = [
  'kiki', 'vex', 'vax', 'grog', 'pike', 'scanlan', 'percy', 'tiberius', 'trinket', 'tary',
  'kima', 'allura', 'gilmore', 'cassandra', 'zahra', 'kashaw', 'doty', 'jarett', 'wilhand', 'syldor',
]

// Told to every loop that can spawn (main or subagent), so the rule travels with the mod.
const SPAWN_RULE =
  'Subagents may spawn their own subagents (Agent tool) for parts of their task that split cleanly. ' +
  'When you brief a subagent whose work may split, pick an agent type that has the Agent tool, and give each a precise brief. ' +
  'Always give every subagent a name (the Agent tool\'s `name`): a Vox Machina character not already used in this session, ' +
  `in this order: ${NAMES.join(', ')} (past the list, add -2: grog-2). ` +
  'Refer to each subagent by that name when you talk about it or message it. ' +
  'When a subagent\'s context grows big (about 200k tokens, many rounds of fixes or rebases, or it gets slow), retire it: ' +
  'make sure its committed work is pushed, note its uncommitted changes, stop it, and hand a fresh agent in the same ' +
  'worktree a tight brief plus that leftover work (the /retire command spells out the steps).'

const BLOCK_TOOL = 'blocked_on_user'
const CLEAR_TOOL = 'unblocked'
const BLOCK_FULL = `mcp__agent-deck__${BLOCK_TOOL}`
const CLEAR_FULL = `mcp__agent-deck__${CLEAR_TOOL}`
export const KINDS = ['decision', 'command', 'access', 'review', 'other'] as const

// Told to every loop, so whatever stops on the user shows in the panel's lower half.
const BLOCK_RULE =
  `When progress needs something only the user can give, call ${BLOCK_FULL} once: kind "decision" (a choice that is theirs), ` +
  '"command" (a command only they can run, e.g. an interactive login; put it in `command`), "access" (a key, account, ' +
  'permission or invite), "review" (a sign-off before you go on) or "other"; `what` is one plain line. Still say it in your ' +
  `reply. Call ${CLEAR_FULL} with its id once it is resolved.`

const agents = atom({ plugin: 'agent-deck', key: 'agents' } as const, {})
const expanded = atom({ plugin: 'agent-deck', key: 'expanded' } as const, null)
const now = atom({ plugin: 'agent-deck', key: 'now' } as const, 0)
const opened = atom({ plugin: 'agent-deck', key: 'opened' } as const, false)
const blockers = atom({ plugin: 'agent-deck', key: 'blockers' } as const, [])
const usedNames = atom({ plugin: 'agent-deck', key: 'usedNames' } as const, [])
const blockerSeq = atom({ plugin: 'agent-deck', key: 'blockerSeq' } as const, 0)

// Estimated list prices, USD per million tokens [input, output]; cache reads 0.1x input, cache writes 1.25x.
const PRICES: [RegExp, number, number][] = [
  [/haiku/i, 1, 5],
  [/sonnet/i, 3, 15],
  [/opus|fable/i, 5, 25],
]

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

export function costOf(model: string, u: Usage): number {
  const [, inp, out] = PRICES.find(([re]) => re.test(model)) ?? [/opus/, 5, 25]
  return (u.input_tokens * inp + u.cache_read_input_tokens * inp * 0.1 + u.cache_creation_input_tokens * inp * 1.25 + u.output_tokens * out) / 1e6
}

function short(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

function tail(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : path
}

// The first character not already taken this session; past the list, grog-2, kiki-2, ...
export function nameFor(taken: readonly string[]): string {
  for (let round = 1; ; round++) {
    for (const base of NAMES) {
      const name = round === 1 ? base : `${base}-${round}`
      if (!taken.includes(name)) return name
    }
  }
}

const WRITES = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])

export function editedPath(tool: string, input: Record<string, unknown>): string | null {
  if (!WRITES.has(tool)) return null
  const p = input.file_path ?? input.notebook_path ?? input.path
  return typeof p === 'string' ? p : null
}

export function actionLabel(tool: string, input: Record<string, unknown>): string {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  if (tool === 'Bash') return `Bash ${short(s('description') || s('command'), 48)}`
  if (tool === 'Agent') return `Agent: spawn ${s('name') || short(s('description'), 40)}`
  const path = s('file_path') || s('notebook_path') || s('path')
  if (path) return `${tool} ${tail(path)}`
  const q = s('pattern') || s('query') || s('url')
  return q ? `${tool} ${short(q, 40)}` : tool
}

export function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

export function isLive(row: AgentRow): boolean {
  return row.status === 'running' || row.status === 'pending' || row.status === 'waiting'
}

export function glyph(row: AgentRow, at: number): string {
  if (isLive(row) && at - row.lastActivity > STUCK_MS) return '⚠'
  return (
    { running: '◐', pending: '○', waiting: '⏸', idle: '⏸', completed: '✓', failed: '✗', killed: '■' } as Record<string, string>
  )[row.status] ?? '·'
}

export type TreeLine = { row: AgentRow; lead: string; cont: string; subtreeCost: number }

// Depth-first rows: live roots first, then newest; children under their parent with ├─ └─ guides.
export function treeLines(map: AgentMap): TreeLine[] {
  const all = Object.values(map)
  const kids = new Map<string | null, AgentRow[]>()
  for (const row of all) {
    const parent = row.parentId && map[row.parentId] ? row.parentId : null
    kids.set(parent, [...(kids.get(parent) ?? []), row])
  }
  const order = (a: AgentRow, b: AgentRow) => Number(isLive(b)) - Number(isLive(a)) || b.startedAt - a.startedAt
  const cost = (row: AgentRow): number => row.costUsd + (kids.get(row.id) ?? []).reduce((sum, k) => sum + cost(k), 0)
  const out: TreeLine[] = []
  const walk = (parent: string | null, indent: string) => {
    const list = [...(kids.get(parent) ?? [])].sort(order)
    list.forEach((row, i) => {
      const last = i === list.length - 1
      const lead = parent === null ? '' : `${indent}${last ? '└─ ' : '├─ '}`
      const next = parent === null ? '' : `${indent}${last ? '   ' : '│  '}`
      out.push({ row, lead, cont: next, subtreeCost: cost(row) })
      walk(row.id, next)
    })
  }
  walk(null, '')
  return out
}

function money(usd: number): string {
  return usd < 0.005 ? '' : `≈$${usd.toFixed(2)}`
}

function tokens(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n)
}

// Drops finished agents that ended more than DONE_TTL_MS ago, keeping any with a running agent under them.
export function pruneFinished(map: AgentMap, at: number): AgentMap {
  const liveUnder = (id: string): boolean =>
    Object.values(map).some(r => r.parentId === id && (isLive(r) || liveUnder(r.id)))
  return Object.fromEntries(
    Object.entries(map).filter(([id, r]) => isLive(r) || r.endedAt === null || at - r.endedAt <= DONE_TTL_MS || liveUnder(id)),
  )
}

export function newRow(over: Partial<AgentRow> & { id: string }, at: number): AgentRow {
  return {
    name: '', description: '', type: '', parentId: null, model: '', status: 'running', prompt: '',
    startedAt: at, endedAt: null, lastActivity: at, tools: 0, current: '', recent: [], files: [],
    tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, result: '',
    alerted: false, stuckAlerted: false, joinedLate: false, ...over,
  }
}

// Agents this mod never saw spawn (they started before it loaded): add them from the engine's list.
export function adoptRows(map: AgentMap, listed: readonly AgentInfoLike[], at: number): AgentRow[] {
  return listed
    .filter(info => !map[info.id] && ['running', 'pending', 'waiting', 'idle'].includes(info.status))
    .map(info =>
      newRow(
        {
          id: info.id,
          name: info.name ?? '',
          description: info.description,
          type: info.type,
          parentId: info.parentId ?? null,
          status: info.status,
          current: 'started before the panel loaded',
          alerted: !['running', 'pending', 'waiting', 'idle'].includes(info.status),
          joinedLate: true,
        },
        at,
      ),
    )
}

export type AgentInfoLike = { id: string; name?: string; description: string; type: string; status: string; parentId?: string }

// Commands a reply hands the user to run themselves: lines that start with "! " (Claude Code's run-it-yourself prefix),
// in prose or in code blocks. Inside a code block the lines after a "! " line, up to a blank line, the fence or the
// next "! " line, belong to the same command; outside one, only after a line ending in a backslash. Each command's
// "what" is the nearest real line above it (a heading or a numbered step), never a fence.
const FENCE = /^\s*(```|~~~)/

function labelLine(raw: string): string {
  if (FENCE.test(raw) || /^[\s`~>#*_-]*$/.test(raw)) return ''
  return raw.replace(/^[\s>#*-]+/, '').replace(/\*\*/g, '').replace(/[:：]\s*$/, '').trim()
}

export function userCommands(text: string): { command: string; what: string }[] {
  const out: { command: string; what: string }[] = []
  const lines = text.split('\n')
  let inFence = false
  let lastLabel = ''
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (FENCE.test(line)) {
      inFence = !inFence
      continue
    }
    const m = /^\s*(?:[-*]\s+|\d+[.)]\s+)?`?!\s+(.+?)`?\s*$/.exec(line)
    if (!m || !m[1] || m[1].length < 2) {
      const label = labelLine(line)
      if (label) lastLabel = label
      continue
    }
    const parts = [m[1]]
    while (i + 1 < lines.length) {
      const nextLine = lines[i + 1] ?? ''
      const prev = parts[parts.length - 1] ?? ''
      const continues = inFence
        ? nextLine.trim() !== '' && !FENCE.test(nextLine) && !/^\s*!\s/.test(nextLine)
        : /\\\s*$/.test(prev) && nextLine.trim() !== ''
      if (!continues) break
      parts.push(nextLine.trim())
      i++
    }
    out.push({ command: parts.join('\n').trim(), what: short(lastLabel || 'Run this command', 140) })
  }
  return out
}

export function commandKey(command: string): string {
  let h = 0
  for (const ch of command.replace(/\s+/g, ' ').trim()) h = (h * 31 + ch.charCodeAt(0)) | 0
  return `cmd-${(h >>> 0).toString(36)}`
}

// What the user ran with "!" (bash mode), however the prompt carries it.
export function ranCommand(text: string): string | null {
  const tagged = /<bash-input>([\s\S]*?)<\/bash-input>/.exec(text)
  if (tagged && tagged[1]) return tagged[1].trim()
  const bang = /^\s*!\s*([\s\S]+)$/.exec(text)
  return bang && bang[1] ? bang[1].trim() : null
}

export function openItemsNote(open: readonly Blocker[]): string {
  const lines = open.map(b => `- ${b.id} (${b.kind}): ${b.what}${b.command ? ` — command: ${short(b.command.replace(/\s+/g, ' '), 120)}` : ''}`)
  return (
    'Open items in the user\'s "Blocked on you" panel:\n' + lines.join('\n') + '\n' +
    `If this message settles any of them (an answer, a choice, pasted output, "done", or something you can now see is ` +
    `done), call ${CLEAR_FULL} with each settled id before you go on. Leave the rest. Do not mention this list.`
  )
}

const KIND_LABEL: Record<string, string> = {
  decision: 'Decide', command: 'Run', access: 'Access', review: 'Review', other: 'Needs you',
  question: 'Answer', plan: 'Approve plan', permission: 'Allow', waiting: 'Waiting',
}

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? 'Needs you'
}

async function addBlocker($: EngineInterface, item: Omit<Blocker, 'id' | 'since'> & { id?: string }): Promise<Blocker> {
  const seq = (await read($, blockerSeq)) + 1
  await update($, blockerSeq, () => seq)
  const id = item.id ?? `b${seq}`
  const existing = (await read($, blockers)).find(b => b.id === id)
  const full: Blocker = { ...item, id, since: existing?.since ?? (await $.clock.now()) }
  await update($, blockers, list => (existing ? list.map(b => (b.id === id ? full : b)) : [...list, full]))
  if (!(await read($, opened))) await openPane($)
  return full
}

async function dropBlocker($: EngineInterface, test: (b: Blocker) => boolean): Promise<number> {
  const before = (await read($, blockers)).length
  await update($, blockers, list => list.filter(b => !test(b)))
  return before - (await read($, blockers)).length
}

// Setup steps that fail go to the debug log (claude --debug), never stop the rest.
async function note($: EngineInterface, line: string): Promise<void> {
  $.ui.log(`agent-deck: ${line}`, { to: 'debug' })
}

async function patch($: EngineInterface, id: string, fn: (row: AgentRow) => AgentRow): Promise<void> {
  await update($, agents, map => (map[id] ? { ...map, [id]: fn(map[id]) } : map))
}

async function openPane($: EngineInterface): Promise<void> {
  await update($, opened, () => true)
  let result
  try {
    result = await $.ui.open({ id: PANE, title: TITLE, columns: 56 })
  } catch {
    return
  }
  // Opened by itself (not by /deck) a pane only docks on a wide terminal; say how to see it.
  if (!result.isPlaced) $.ui.toast('Subagents are being tracked: type /deck to show the panel')
}

async function alert($: EngineInterface, row: AgentRow, at: number): Promise<void> {
  if (row.alerted || isLive(row)) return
  await patch($, row.id, r => ({ ...r, alerted: true }))
  const mark = row.status === 'completed' ? '✓' : row.status === 'killed' ? '■ stopped' : '✗ failed'
  const cost = money(row.costUsd)
  $.ui.toast(`${mark} ${row.name || short(row.description, 50)} · ${elapsed((row.endedAt ?? at) - row.startedAt)}${cost ? ` · ${cost}` : ''}`)
}

async function tick($: EngineInterface): Promise<void> {
  let listed: AgentInfoLike[] = []
  try {
    listed = await $.agent.list()
  } catch {
    return
  }
  const map = await read($, agents)
  const at = await $.clock.now()
  const adopted = adoptRows(map, listed, at)
  if (adopted.length) {
    await update($, agents, cur => ({ ...cur, ...Object.fromEntries(adopted.map(r => [r.id, r])) }))
    if (!(await read($, opened))) await openPane($)
  }
  const waitingOn = await read($, blockers)
  if (waitingOn.length) {
    await dropBlocker($, b => !b.auto && at - b.since > (b.id.startsWith('cmd-') ? REPLY_COMMAND_TTL_MS : FLAG_TTL_MS))
    await update($, now, () => at)
  }
  const before = await read($, agents)
  const kept = pruneFinished(before, at)
  if (Object.keys(kept).length !== Object.keys(before).length) {
    await update($, agents, () => kept)
    await update($, now, () => at)
  }
  const rows = Object.values(await read($, agents))
  if (!rows.some(isLive)) return
  await update($, now, () => at)
  for (const info of listed) {
    const row = (await read($, agents))[info.id]
    if (!row || row.status === info.status) continue
    await patch($, info.id, r => ({ ...r, status: info.status, endedAt: isLive({ ...r, status: info.status }) ? null : r.endedAt ?? at }))
  }
  for (const row of Object.values(await read($, agents))) {
    await alert($, row, at)
    if (isLive(row) && !row.stuckAlerted && at - row.lastActivity > STUCK_MS) {
      await patch($, row.id, r => ({ ...r, stuckAlerted: true }))
      $.ui.toast(`⚠ ${row.name || short(row.description, 50)}: no activity for ${elapsed(at - row.lastActivity)}`)
    }
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await note($, 'session.start')
    const step = async (name: string, fn: () => Promise<unknown>) => {
      try {
        await fn()
        await note($, `ok ${name}`)
      } catch (err) {
        await note($, `FAIL ${name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    await step('command deck', () => $.command.register({ name: 'deck', description: 'Show or hide the Agents panel (subagents and what is blocked on you)' }))
    await step('tool blocked_on_user', () => $.tool.register({
      name: BLOCK_TOOL,
      description:
        'Show the user, in the Agents panel under "Blocked on you", something only they can give before work can go on: ' +
        'a decision, a command only they can run, access or credentials, or a review. Returns the item id.',
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: [...KINDS] },
          what: { type: 'string', description: 'One plain line: what you need from the user and why.' },
          command: { type: 'string', description: 'For kind "command": the exact command for them to run.' },
        },
        required: ['kind', 'what'],
      },
      isDeferred: false,
    }))
    await step('tool unblocked', () => $.tool.register({
      name: CLEAR_TOOL,
      description: 'Remove an item from "Blocked on you" in the Agents panel once it is resolved.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      isDeferred: false,
    }))
    $.clock.every(TICK_MS, () => {
      void tick($)
    })
    if (await read($, opened)) void openPane($)
    void tick($)
    return result
  })

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    const added = [{ id: 'agent-deck:blocked', text: BLOCK_RULE, scope: 'session' as const }]
    if (e.tools.includes('Agent')) added.unshift({ id: 'agent-deck:spawn', text: SPAWN_RULE, scope: 'session' as const })
    return { sections: [...result.sections, ...added] }
  })

  on('prompt.submit', async ($, e, next) => {
    const ran = ranCommand(e.text)
    if (ran) {
      const norm = (t: string) => t.replace(/\s+/g, ' ').trim()
      const head = norm(ran).slice(0, 60)
      await dropBlocker($, b => b.kind === 'command' && !!b.command && (norm(b.command) === norm(ran) || norm(b.command).startsWith(head)))
      return next(e)
    }
    // Anything the user's message settles (an answer, pasted output, "done") is cleared by the model: it gets the
    // open items beside the prompt, unseen by the user.
    const open = (await read($, blockers)).filter(b => !b.auto)
    if (!open.length) return next(e)
    return next({ ...e, context: [...(e.context ?? []), openItemsNote(open)] })
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'deck' }, async $ => {
    const open = (await $.ui.panes()).some(p => p.id === PANE)
    if (open) {
      await update($, opened, () => false)
      await $.ui.close({ id: PANE })
      return { text: 'Agents pane closed.' }
    }
    await openPane($)
    return { text: 'Agents pane opened.' }
  }).catch(() => ({ text: 'Agents pane: could not toggle.' }))

  on('agent.spawn', async ($, e, next) => {
    const prompt = e.prompt.includes(MAY_SPAWN.trim()) ? e.prompt : e.prompt + MAY_SPAWN
    const result = await next({ ...e, prompt })
    if (!result.agentId) return result
    const at = await $.clock.now()
    const row = newRow(
      {
        id: result.agentId,
        name: e.name ?? '',
        description: e.description,
        type: e.subagentType,
        parentId: e.parentAgentId ?? null,
        model: result.model ?? e.model ?? '',
        prompt: short(e.prompt, 300),
        current: 'starting',
      },
      at,
    )
    await update($, agents, map => ({ ...map, [row.id]: row }))
    await update($, now, () => at)
    if (!(await read($, opened))) await openPane($)
    return result
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: BLOCK_FULL }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string).trim() : '')
    const kind = (KINDS as readonly string[]).includes(str('kind')) ? str('kind') : 'other'
    const who = e.agentId ? (await read($, agents))[e.agentId]?.name ?? '' : ''
    const item = await addBlocker($, { kind, what: short(str('what') || 'Needs you', 200), command: str('command'), agent: who, auto: false })
    $.ui.toast(`Needs you: ${kindLabel(kind)} — ${short(item.what, 60)}`)
    return { result: `Shown to the user under "Blocked on you" as ${item.id}. Call ${CLEAR_FULL} with that id once it is resolved.` }
  })

  on('tool.call', { tool: CLEAR_FULL }, async ($, e) => {
    const id = String((e as unknown as Record<string, unknown>).id ?? '')
    const n = await dropBlocker($, b => b.id === id && !b.auto)
    return { result: n ? `Removed ${id}.` : `No open item ${id}.` }
  })

  on('tool.call', async ($, e, next) => {
    const map0 = await read($, agents)
    let call = e
    const input = e as unknown as Record<string, unknown>
    if (e.tool === 'Agent') {
      // Reserve the name now: parallel Agent calls in one message all reach here before any spawn is recorded.
      const given = typeof input.name === 'string' ? input.name.trim() : ''
      let name = given
      await update($, usedNames, used => {
        const taken = [...used, ...Object.values(map0).map(r => r.name)]
        if (!name || taken.includes(name)) name = nameFor(taken)
        return [...used, name]
      })
      if (name !== given) call = { ...e, name } as typeof e
    }
    const id = e.agentId
    if (id && (await read($, agents))[id]) {
      const args = call as unknown as Record<string, unknown>
      const label = actionLabel(e.tool, args)
      const path = editedPath(e.tool, args)
      const at = await $.clock.now()
      await patch($, id, r => ({
        ...r,
        tools: r.tools + 1,
        current: label,
        recent: [...r.recent, label].slice(-5),
        files: path && !r.files.includes(path) ? [...r.files, path] : r.files,
        lastActivity: at,
        stuckAlerted: false,
      }))
    }
    const who = id ? (await read($, agents))[id]?.name ?? '' : ''
    const asks = e.tool === 'AskUserQuestion' ? 'question' : e.tool === 'ExitPlanMode' ? 'plan' : ''
    if (asks && e.tool_use_id) {
      const qs = (call as unknown as { questions?: { question?: string }[] }).questions
      const what = asks === 'plan' ? 'A plan is waiting for your approval' : short(qs?.[0]?.question ?? 'A question is waiting for you', 160)
      await addBlocker($, { id: `ask-${e.tool_use_id}`, kind: asks, what, command: '', agent: who, auto: true })
      try {
        return await next(call)
      } finally {
        await dropBlocker($, b => b.id === `ask-${e.tool_use_id}`)
      }
    }
    try {
      return await next(call)
    } finally {
      // The call ran (or was refused): a permission prompt for this tool is over.
      await dropBlocker($, b => b.kind === 'permission' && b.id === `perm-${e.tool}${who ? `-${who}` : ''}`)
    }
  }).catch(($, e, next) => next(e))

  on('classic.PermissionRequest', async ($, e, next) => {
    const input = (e.tool_input ?? {}) as Record<string, unknown>
    const who = e.agent_id ? (await read($, agents))[e.agent_id]?.name ?? '' : ''
    await addBlocker($, {
      id: `perm-${e.tool_name}${who ? `-${who}` : ''}`,
      kind: 'permission',
      what: actionLabel(e.tool_name, input),
      command: '',
      agent: who,
      auto: true,
    })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const id = e.agentId
    if (!id) {
      await dropBlocker($, b => b.kind === 'permission' && !b.agent)
      // Fallback for replies that hand the user commands without flagging them.
      const found = userCommands(e.answer)
      if (found.length) {
        const keep = new Set(found.map(c => commandKey(c.command)))
        await dropBlocker($, b => b.id.startsWith('cmd-') && !keep.has(b.id))
      }
      const flagged = new Set((await read($, blockers)).filter(b => !b.id.startsWith('cmd-')).map(b => b.command.replace(/\s+/g, ' ').trim()))
      for (const c of found) {
        if (flagged.has(c.command.replace(/\s+/g, ' ').trim())) continue
        await addBlocker($, { id: commandKey(c.command), kind: 'command', what: c.what, command: c.command, agent: '', auto: false })
      }
    }
    if (!id || !(await read($, agents))[id]) return result
    const at = await $.clock.now()
    const u = e.usage
    const status = e.reason === 'error' ? 'failed' : e.isAborted ? 'killed' : 'completed'
    await patch($, id, r => ({
      ...r,
      status,
      endedAt: at,
      lastActivity: at,
      current: '',
      model: u?.model ?? r.model,
      tokensIn: r.tokensIn + (u?.input_tokens ?? 0),
      tokensOut: r.tokensOut + (u?.output_tokens ?? 0),
      cacheRead: r.cacheRead + (u?.cache_read_input_tokens ?? 0),
      cacheWrite: r.cacheWrite + (u?.cache_creation_input_tokens ?? 0),
      costUsd: r.costUsd + (u ? costOf(u.model, u) : 0),
      result: short(e.answer, 400),
    }))
    await update($, now, () => at)
    const row = (await read($, agents))[id]
    if (row) await alert($, row, at)
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const map = await read($, agents)
    const open = await read($, expanded)
    const at = Math.max(await read($, now), ...Object.values(map).map(r => r.lastActivity))
    const rows = Object.values(map)
    const lines = treeLines(map)
    const total = rows.reduce((sum, r) => sum + r.costUsd, 0)
    const count = (s: string[]) => rows.filter(r => s.includes(r.status)).length
    const head = [
      `${count(['running', 'pending', 'waiting'])} running`,
      `${count(['completed'])} done`,
      count(['failed', 'killed']) ? `${count(['failed', 'killed'])} failed` : '',
      money(total),
    ].filter(Boolean).join(' · ')
    const blocked = await read($, blockers)
    const ORDER = ['decision', 'access', 'review', 'question', 'plan', 'permission', 'command', 'other', 'waiting']
    const rank = (b: Blocker) => (ORDER.indexOf(b.kind) + 1 || ORDER.length) * 2 + Number(b.auto)
    const waiting = rows.filter(r => r.status === 'waiting' && !blocked.some(b => b.agent && b.agent === r.name))
    const needs: Blocker[] = [
      ...[...blocked].sort((a, b) => rank(a) - rank(b) || a.since - b.since),
      ...waiting.map(r => ({ id: `wait-${r.id}`, kind: 'waiting', what: `${r.name || short(r.description, 40)} is waiting`, command: '', agent: r.name, since: r.lastActivity, auto: true })),
    ]
    const half = Math.max(6, Math.floor((e.props.scroll?.bodyRows ?? 24) / 2))
    // Rows never shrink: they are cut whole. Running agents take two lines, finished ones one, an open row its details.
    const budget = half - 2
    const cost = (r: AgentRow) =>
      (isLive(r) ? 2 : 1) + (open === r.id ? 4 + r.files.length + (r.result ? 2 : 0) : 0)
    const shown: TreeLine[] = []
    let used = 0
    let hidden = 0
    for (const line of lines) {
      const need = cost(line.row)
      if (used + need > budget && !(isLive(line.row) && used + need <= budget + 2)) {
        hidden++
        continue
      }
      shown.push(line)
      used += need
    }
    const color = (r: AgentRow) => {
      const g = glyph(r, at)
      return g === '⚠' ? 'warning' : g === '✓' ? 'success' : g === '✗' || g === '■' ? 'error' : 'claude'
    }

    return (
      <Box flexDirection="column">
       <Box flexDirection="column" height={half} overflow="hidden" flexShrink={0}>
        {rows.length === 0 ? (
          <Text dimColor>No subagents yet. They show here as a tree when one starts.</Text>
        ) : (
          <Text bold>{head}</Text>
        )}
        {shown.map(({ row, lead, cont, subtreeCost }) => {
          const isOpen = open === row.id
          const took = `${row.joinedLate ? '≥' : ''}${elapsed((row.endedAt ?? at) - row.startedAt)}`
          const files = row.files.length ? `${row.files.length} file${row.files.length === 1 ? '' : 's'}` : ''
          const label = row.name ? `${row.name} — ${short(row.description, 44)}` : short(row.description, 56)
          const live = isLive(row)
          const stats = live
            ? [took, `${row.tools} tools`, files, money(subtreeCost), row.current].filter(Boolean).join(' · ')
            : [took, files, money(subtreeCost)].filter(Boolean).join(' · ')
          return (
            <Box key={row.id} flexDirection="column" flexShrink={0}>
              <Box flexDirection="row" flexShrink={0}>
                <Text dimColor>{lead}</Text>
                <Text color={color(row)}>{glyph(row, at)} </Text>
                <Button key={`row-${row.id}`} plain dimColor={!live} label={label} onPress={() => update($, expanded, cur => (cur === row.id ? null : row.id))} />
                {!live && (
                  <Text dimColor wrap="truncate-end">
                    {' '}· {stats}
                  </Text>
                )}
              </Box>
              {live && (
                <Text dimColor wrap="truncate-end">
                  {cont}  {stats}
                </Text>
              )}
              {isOpen && (
                <Box flexDirection="column" flexShrink={0}>
                  <Text dimColor wrap="truncate-end">{cont}  {[row.type, row.model.replace(/^claude-/, '')].filter(Boolean).join(' · ')} · {row.tools} tools</Text>
                  <Text wrap="wrap">{cont}  Task: {short(row.prompt.replace(MAY_SPAWN, ''), 200)}</Text>
                  <Text dimColor>
                    {cont}  Tokens: {tokens(row.tokensIn + row.cacheRead + row.cacheWrite)} in · {tokens(row.tokensOut)} out
                  </Text>
                  {row.files.length > 0 && <Text>{cont}  Files changed:</Text>}
                  {row.files.map(f => (
                    <Text key={`${row.id}-${f}`} color="diffAdded" wrap="truncate-start">
                      {cont}    {tail(f)}
                    </Text>
                  ))}
                  {row.recent.length > 0 && <Text dimColor wrap="truncate-end">{cont}  Last: {row.recent.slice(-3).join(' → ')}</Text>}
                  {row.result && <Text wrap="wrap">{cont}  Result: {short(row.result, 300)}</Text>}
                </Box>
              )}
            </Box>
          )
        })}
        {hidden > 0 && <Text dimColor>+{hidden} more not shown (oldest first) · click a row for details</Text>}
       </Box>
       <Text bold color={needs.length ? 'warning' : undefined}>
         {needs.length ? `Blocked on you (${needs.length})` : 'Blocked on you'}
       </Text>
       {needs.length === 0 && <Text dimColor>Nothing. Claude can keep going.</Text>}
       {needs.map(b => {
         const lines = b.command.split('\n')
         const first = lines[0] ?? ''
         const more = lines.length > 1 ? ` (+${lines.length - 1} lines)` : ''
         return (
           <Box key={b.id} flexDirection="column" marginTop={1}>
             <Box flexDirection="row" justifyContent="space-between">
               <Text wrap="truncate-end">
                 <Text color="warning" bold>{kindLabel(b.kind)}</Text>
                 {b.agent ? <Text dimColor> · {b.agent}</Text> : null}
               </Text>
               <Text dimColor>{elapsed(at - b.since)} ago</Text>
             </Box>
             <Text wrap="wrap">{b.what}</Text>
             {b.command ? (
               <Text dimColor wrap="truncate-end">
                 $ {first}
                 {more}
               </Text>
             ) : null}
             {!b.auto || b.command ? (
               <Box flexDirection="row" gap={2}>
                 {b.command ? (
                   <Button key={`copy-${b.id}`} label="Copy" onPress={() => void $.ui.copy({ text: `! ${b.command}`, surface: e.surface })} />
                 ) : null}
                 {!b.auto ? (
                   <Button key={`done-${b.id}`} label="Done" onPress={() => void dropBlocker($, x => x.id === b.id)} />
                 ) : null}
               </Box>
             ) : null}
           </Box>
         )
       })}
      </Box>
    )
  })
}
