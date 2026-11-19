Request a fresh context window for this conversation.

Starting a new context window summarizes the current conversation and continues in a new window with room to work. Use it when `GetContextRemaining` reports little budget left and the task is not finished: summarizing early keeps the important state (decisions, open requirements, file locations) while discarding stale detail, which is better than being cut off mid-task or working with evicted fragments.

The compaction runs when the current turn ends — it never interrupts running tools. Anything you still need after the switch must be either stated in `instruction` or re-readable from disk: the summary is what the next window starts from, so name the durable artifacts (paths, test commands, decisions) rather than the reasoning that produced them.

Optional `instruction` (short) tells the summary what to preserve, in your words.
