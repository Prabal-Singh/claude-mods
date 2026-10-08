export type AgentRow = {
  id: string
  name: string
  description: string
  type: string
  parentId: string | null
  model: string
  status: string
  prompt: string
  startedAt: number
  endedAt: number | null
  lastActivity: number
  tools: number
  current: string
  recent: string[]
  files: string[]
  tokensIn: number
  tokensOut: number
  cacheRead: number
  cacheWrite: number
  costUsd: number
  result: string
  alerted: boolean
  stuckAlerted: boolean
  joinedLate: boolean
}

export type AgentMap = Record<string, AgentRow>

export type Blocker = {
  id: string
  kind: string
  what: string
  command: string
  agent: string
  since: number
  auto: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'agent-deck': { agents: AgentMap; expanded: string | null; now: number; opened: boolean; blockers: Blocker[]; blockerSeq: number; usedNames: string[] }
  }
}
