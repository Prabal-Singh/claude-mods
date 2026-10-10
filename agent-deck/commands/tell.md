---
description: Send a message to a subagent by name
argument-hint: "<name> <message>"
---

Send a message to one of this session's subagents: $ARGUMENTS

The first word is the subagent's name (as the Agents panel shows it); the rest is the message. Send the message word for
word with SendMessage to that agent. If SendMessage says the name is ambiguous or refers to a different agent, use the
agent id it names for the one with that name in the Agents panel. If no subagent has that name, say so and list the
names there are. Then carry on with what you were doing.
