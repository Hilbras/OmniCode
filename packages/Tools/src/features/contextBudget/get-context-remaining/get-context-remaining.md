Check how much context window budget remains for this conversation.

Call this before starting work whose intermediate output is large (long builds, big file reads, broad searches, multi-file rewrites), before deciding to re-read files you already summarized, and whenever a plan spans many steps. If the remaining budget is small, prefer narrow reads over broad ones, and use `NewContextWindow` to start a fresh context window when the remaining work still needs room.

The report is an estimate, not a promise: the context token count combines measured usage from previous model responses with an estimate for messages that were not measured. Treat `remaining` as guidance for planning, and re-check it after large tool outputs.

No parameters.
