import type { Register } from 'claude-code'

// agent-deck keeps every subagent (finished ones too) and the "Blocked on you" items.
const agentsRef = { plugin: 'agent-deck', key: 'agents' } as const
const blockersRef = { plugin: 'agent-deck', key: 'blockers' } as const

export type AgentFact = {
  name: string
  description: string
  type: string
  status: string
  startedAt: number
  endedAt: number | null
  costUsd: number
  files: string[]
  result: string
}

export type BlockerFact = { id: string; kind: string; what: string; command: string }

export type Facts = {
  now: number
  startedAt?: number
  costUsd?: number
  model: string
  turns: number
  cwd: string
  agents: AgentFact[]
  blockers: BlockerFact[]
}

// The skill as the engine names it: `report`, or `status-report:report` when namespaced.
export const isReport = (skill: string): boolean => skill === 'report' || skill.endsWith(':report')

export const minutes = (ms: number): string => {
  const m = Math.max(0, Math.round(ms / 60_000))
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

const usd = (n: number): string => `$${n.toFixed(2)}`

const firstLine = (s: string, max = 160): string => {
  const line = (s.split('\n').find(l => l.trim()) ?? '').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

export function factsNote(f: Facts): string {
  const lines = ['Facts for the status report, from the status-report mod (use them; do not quote this list):']
  lines.push(`- Session: ${f.cwd}, model ${f.model}, ${f.turns} prompts so far` +
    (f.startedAt !== undefined ? `, started ${minutes(f.now - f.startedAt)} ago` : '') + '.')
  lines.push(f.costUsd === undefined ? '- Session cost: not recorded.' : `- Session cost so far: ${usd(f.costUsd)} (subagents included).`)

  if (f.agents.length === 0) lines.push('- Subagents: none this session.')
  else {
    const total = f.agents.reduce((s, a) => s + a.costUsd, 0)
    lines.push(`- Subagents (${f.agents.length}, estimated ${usd(total)} in all), newest first:`)
    for (const a of [...f.agents].sort((x, y) => y.startedAt - x.startedAt)) {
      const took = minutes((a.endedAt ?? f.now) - a.startedAt)
      const files = a.files.length ? `; ${a.files.length} files: ${a.files.slice(0, 6).join(', ')}${a.files.length > 6 ? ', …' : ''}` : ''
      const result = a.result ? `; result: ${firstLine(a.result)}` : ''
      lines.push(`  - ${a.name} · ${a.status} · ${took} · ≈${usd(a.costUsd)} · ${a.type} · ${firstLine(a.description, 100)}${files}${result}`)
    }
  }

  if (f.blockers.length === 0) lines.push('- Blocked on the user: nothing open in the panel.')
  else {
    lines.push(`- Blocked on the user (${f.blockers.length} open):`)
    for (const b of f.blockers) lines.push(`  - ${b.id} (${b.kind}): ${b.what}${b.command ? ` — run: ${b.command}` : ''}`)
  }
  return lines.join('\n')
}

// A plugin's slash command is expanded as a skill: `skill.prompt` fires (typed or via the Skill tool), not `command.run`.
export const register: Register = (on) => {
  on('skill.prompt', async ($, e, next) => {
    if (!isReport(e.skill)) return next(e)
    const answer = await next(e)
    const [usage, model, turns, cwd, now, agents, blockers] = await Promise.all([
      $.session.usage().catch(() => undefined),
      $.session.model().catch(() => 'unknown'),
      $.session.turns().catch(() => 0),
      $.session.cwd().catch(() => 'unknown'),
      $.clock.now().catch(() => Date.now()),
      $.state.get(agentsRef).then(r => r.value ?? {}).catch(() => ({})),
      $.state.get(blockersRef).then(r => r.value ?? []).catch(() => []),
    ])
    const note = factsNote({
      now,
      startedAt: usage?.startedAt,
      costUsd: usage?.cost?.usd,
      model,
      turns,
      cwd,
      agents: Object.values(agents),
      blockers,
    })
    return { text: `${answer.text}\n\n${note}` }
  }).catch(($, e, next) => next(e))
}
