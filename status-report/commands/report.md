---
description: Write a dated HTML status report of this session (done, in progress, blocked, decisions, subagents and spend)
argument-hint: "[who it is for, or what to cover, e.g. \"for Samyak\", \"since this morning\", \"HealthifyMe only\"]"
---

Write a status report of this session as one HTML page. Who it is for or what to cover: $ARGUMENTS

Use what you know from this conversation and the facts the status-report mod lists at the end of this message (session
cost, subagents, open blockers). Check anything you are unsure of (git log, PR state, files) before you state it;
never guess.

**Where:** `~/Desktop/flow-notes/status/<YYYY-MM-DD>.html` (today's date). If that file exists, add `-2`, `-3`, ...;
never overwrite a report that may have been sent.

**Sections, in this order** (leave out a section that would be empty):
1. **In one line:** where things stand.
2. **Done:** what was finished, each with its proof (PR number, merged or deployed, file path, who it was sent to).
3. **In progress:** who or which terminal or subagent is on it, and what is left.
4. **Blocked on you:** each item, what it blocks, and the exact thing needed (a decision with its options, a command,
   access).
5. **Decisions:** made (with the date) and still open.
6. **Subagents and spend:** each subagent by name, its task, its status and estimated cost; the session's total cost.
7. **Next:** the next few steps, in order.

**Writing:** plain words, short sentences, no internal jargon the reader would not know. For a reader outside the team,
leave out customer names, vendor names and internal details unless the arguments ask for them.

**Page:** one self-contained file, no external scripts. A `<title>` of two to four words ("Status 10 Oct"). Colours as
tokens on `:root`, redefined for dark mode under `@media (prefers-color-scheme: dark)` with
`:root:not([data-theme="light"])`, and again under `:root[data-theme="dark"]`; `body` has an explicit background. A
max-width column with a 16px side gutter, readable on a phone; tables wrapped so they scroll sideways on their own.
Match the look of the other pages in `~/Desktop/flow-notes` if there are any.

Then open it (`open <path>`), and reply with the path and the one-line summary. Do not publish it anywhere.
