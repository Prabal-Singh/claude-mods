---
description: Retire bloated subagents and hand their work to fresh ones with a tight brief
argument-hint: "[agent name, or empty for every agent whose context is too big]"
---

Retire and replace subagents whose context has grown too big: $ARGUMENTS

Which agents: the one named above; if none is named, every running subagent whose context is past about 200k
tokens, or that has gone through several rounds of fixes or rebases, or is getting slow.

For each one:

1. **Secure its work.** Check what it has committed and pushed (branch, last commit, PR). Note what is uncommitted in
   its worktree (`git -C <worktree> status --short`), and list the files touched. Delete nothing and reset nothing.
2. **Stop it** (TaskStop).
3. **Start a fresh agent in the same worktree.** Give it the next free Vox Machina name, and a brief containing only
   what it needs:
   - the goal, and what "done" means;
   - what is already committed and pushed;
   - the half-done, uncommitted changes, by file: review them, keep what is correct and finish the rest, with tests;
   - the remaining steps, in order (for example, follow-ups to add to the PR description);
   - the checks to run, writing to a log file of its own, then commit and push;
   - keep its context lean, and hand independent fixes to its own subagents.
4. **Report to me** in this shape, one short block per retired agent:
   - "I've retired <name>." Why: about <N>k tokens of context after <what it went through>, so it was slow and
     expensive.
   - Nothing is lost: what is committed and pushed, and what was uncommitted (files, still in its worktree).
   - "<new name> has taken over in that same worktree, with only the context it needs. It will:" followed by its
     numbered steps.
   - One line: when an agent's context gets big I retire it and hand a fresh agent a tight brief plus its leftover
     work, because that is cheaper than carrying the whole history.
   - Anything still waiting on me. Also flag it with `mcp__agent-deck__blocked_on_user` when that tool exists.

If no subagent qualifies, say so in one line, with each running agent's name and rough context size.
