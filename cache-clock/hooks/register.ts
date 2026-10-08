import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

// The prompt cache lives 1 hour from the last API response (5 minutes in usage overage).
const TTL_MS = 60 * 60 * 1000
// Compaction is itself a model call over the whole context: start it early enough to finish
// while that context is still cached.
const COMPACT_LEAD_MS = 3 * 60 * 1000
const TICK_MS = 30 * 1000

const lastReplyAt = atom({ plugin: 'cache-clock', key: 'lastReplyAt' } as const, null)
const compactedFor = atom({ plugin: 'cache-clock', key: 'compactedFor' } as const, null)

let compacting = false

// Once per reply: from COMPACT_LEAD_MS before the cache expires, and also after it (a sleeping
// laptop missed the window), never twice for the same reply.
export function compactDue(now: number, last: number | null, done: number | null): boolean {
  if (last === null || done === last) return false
  return last + TTL_MS - now <= COMPACT_LEAD_MS
}

async function tick($: EngineInterface): Promise<void> {
  if (compacting) return
  const last = await read($, lastReplyAt)
  if (last === null || !compactDue(await $.clock.now(), last, await read($, compactedFor))) return
  compacting = true
  try {
    const before = (await $.session.usage()).context.tokens
    const result = await $.session.compact()
    await update($, compactedFor, () => last)
    if (result.skip !== undefined) {
      $.ui.log(`cache-clock: auto-compact before the prompt cache expired was skipped: ${result.skip}`)
    } else {
      const from = result.tokensBefore ?? before
      const sizes = from !== undefined && result.tokensAfter !== undefined ? ` (${Math.round(from / 1000)}k → ${Math.round(result.tokensAfter / 1000)}k tokens)` : ''
      $.ui.log(`cache-clock: compacted before the prompt cache expired${sizes}`)
    }
  } catch {
    // A turn is running: its reply resets the clock, or the next tick tries again.
  } finally {
    compacting = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    $.ui.status(undefined)
    $.clock.every(TICK_MS, () => {
      void tick($)
    })
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const now = await $.clock.now()
    await update($, lastReplyAt, () => now)
    return result
  })
}
