export type Stamp = number | null

declare module 'claude-code' {
  interface PluginState {
    'cache-clock': { lastReplyAt: Stamp; compactedFor: Stamp }
  }
}
