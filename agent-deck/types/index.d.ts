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
  // The work thread (topic) the agent belongs to; a subagent's children share it.
  thread: string
}

export type AgentMap = Record<string, AgentRow>

// A topic this terminal works on; its agents show under it as a dropdown. `archived` keeps the counts and spend of
// rows that left the panel, so the header and the dropdown still add up.
export type Thread = {
  id: string
  title: string
  auto: boolean
  createdAt: number
  lastAt: number
  archived: { done: number; failed: number; cost: number }
}

export type Reservation = { name: string; at: number }

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
    'agent-deck': { agents: AgentMap; expanded: string | null; now: number; opened: boolean; blockers: Blocker[]; blockerSeq: number; reserved: Reservation[]; threads: Thread[]; currentThread: string; threadOpen: Record<string, boolean> }
  }
}
