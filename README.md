# claude-mods

Two mods for [Claude Code](https://claude.com/claude-code).

## agent-deck: your subagents, live, in a panel on the right

```
/plugin install agent-deck --marketplace Prabal-Singh/claude-mods
```

Type `y` to add the marketplace, then pick a scope (user = every session).

**Top half: the agent tree.** Every subagent shows as a row. Agents that subagents start sit under them, as deep as
they go.
- Status: ◐ running, ✓ done, ✗ failed, ■ stopped, ⚠ stuck (5 minutes with no activity).
- Task, type and model, elapsed time, tool calls, files changed, and estimated cost for the agent and everything
  under it.
- What it is doing right now (`Edit …/app/x.py`, `Bash pytest -q`).
- Click a row for the task it was given, tokens in and out, files changed, its last actions and its result.
- A pop-up when an agent finishes or fails. Finished agents take one line and leave the panel 10 minutes later.
- Many agents: rows are cut whole, never squeezed. Running agents come first, then "+N more not shown".

**Bottom half: Blocked on you.** Everything that stops progress until you act:
- Things Claude flags itself through the mod's `blocked_on_user` tool: a decision, a command only you can run (with
  Copy), access or credentials, a review.
- Any `! command` a reply hands you to run.
- Open questions, plans waiting for approval and permission prompts (an agent waiting on its own subagents is not
  blocked on you, so it is not listed).

Items clear when they are resolved, when you run the command, or when you press Done. Each message you send carries
the open items (unseen), so when your message settles one ("go with B", pasted output, "done") Claude clears it. A newer reply's commands
replace the previous reply's, commands read from replies expire after 2 hours, and flagged items after 24 hours.

**Names.** Every subagent gets a name, so you can refer to it and message it: Vox Machina, in order. `kiki`, `vex`,
`vax`, `grog`, `pike`, `scanlan`, `percy`…, the first one no running agent holds (a finished agent frees its name;
`-2` only when all are busy). Two running agents never share a name, even when they start in
the same message.

**Subagents may spawn subagents.** Every subagent prompt says so, and agents are told to hand off parts that split
cleanly.

**`/retire [name]`.** When an agent's context gets big, it is retired and replaced. Its committed work is pushed and
its uncommitted changes are noted. A fresh agent, with the next name, takes over in the same worktree with a tight
brief plus the leftover work. Claude also does this by itself once an agent's context passes about 200k tokens.

**`/deck`** shows or hides the panel. It opens by itself on the first subagent; it docks on the right in fullscreen
on a wide terminal, and sits above the prompt otherwise.

Costs are estimates from list prices set in `agent-deck/hooks/register.tsx` (`PRICES`). Edit them if yours differ.

## cache-clock: compact before the prompt cache goes cold

```
/plugin install cache-clock --marketplace Prabal-Singh/claude-mods
```

Claude Code's prompt cache lasts an hour after the last reply. After that, your next message re-reads the whole
context at full price. cache-clock compacts the session 3 minutes before the cache expires, while compacting is
still cheap, and says so in the transcript. It compacts once per reply, so an idle session isn't summarised over and
over. It assumes the one-hour cache, not the five-minute one.

## License

MIT
