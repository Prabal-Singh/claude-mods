# claude-mods

Three mods for [Claude Code](https://claude.com/claude-code).

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
`vax`, `grog`, `pike`, `scanlan`, `percy`…, the first one not held by a running agent or one that finished in the
last 10 minutes (so the list starts over at `kiki` instead of climbing to `kiki-8`; `-2` once all are held). A call with no name takes the
one its brief gives itself ("You are tary-3"); a name already used is replaced, and the Agent result tells Claude the
name the agent got. The agent's prompt always says its name, so the agent, the panel and its report agree.

**`/agent <name>`** jumps to a subagent: it opens the panel with that agent's row expanded (task, status, files, last
actions, result). With no name it lists them. **`/tell <name> <message>`** has Claude send it a message. Both
autocomplete the name as you type it (running agents first); so does `/retire`. The full transcript is Claude Code's
own view: `/tasks`, pick the agent, Enter.

**Work threads.** One terminal can work on several topics at once. Each topic is a dropdown in the panel (▾ open,
▸ closed; click its header) with its title, how many agents run, are done or failed, and its spend; its agents and
their subagents sit under it. Claude switches threads with the `work_thread` tool when you change topic, asks you with
options when it is unclear which topic a request belongs to, and a thread it never named gets an auto title from its
first agent's task. **`/thread <title>`** switches (or starts) one yourself; `/thread` lists them. Finished agents
stay in their thread for an hour (the newest 8), then only count in its header.

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

## status-report: a status report you can send

```
/plugin install status-report --marketplace Prabal-Singh/claude-mods
```

`/report` writes a dated HTML page of where the session stands, then opens it: in one line, done (with proof: PR,
deploy, file), in progress, blocked on you, decisions made and open, subagents and spend, next. It goes to
`~/Desktop/flow-notes/status/<date>.html` (`-2`, `-3` on the same day; a report is never overwritten). Add who it is for
or what to cover: `/report for Samyak`, `/report HealthifyMe only`. For a reader outside the team it leaves out
customer and vendor names unless you ask.

The mod hands Claude what it cannot see in the conversation: the session's cost so far, and from agent-deck (installed
with it) every subagent's status, time, cost and files, plus the open "Blocked on you" items.

## License

MIT
