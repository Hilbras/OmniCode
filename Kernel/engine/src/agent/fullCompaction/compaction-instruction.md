You are about to run out of context. Create a handoff summary for the model
that will resume this task after the earlier conversation is cleared.

--- This message is a direct task, not part of the above conversation ---

Write the summary in the same language the conversation has been using — do not
switch to English just because these instructions happen to be in English.

Make the summary self-sufficient: the next turn will see only the preserved
messages, this summary, and a short verbatim slice of the most recent
exchanges — every other assistant message, tool call, and tool result above
will be gone. Use the section headings below, in this order. Omit a section
only when it genuinely does not apply; write "(none)" when it applies but is
empty.

## Objective
- [one or two brief sentences describing what the user is trying to accomplish]

## Requirements
- [constraints, preferences, requirements, and scope boundaries stated by the user, or "(none)"]

## Decisions
- [decisions already made and why, or "(none)"]

## Work State
Break the objective into smaller goals and report which are completed, which are being worked on, and which are blocked.
### Completed
- [goals that have been completed; otherwise "(none)"]

### Active
- [goals currently being worked on; otherwise "(none)"]

### Blocked
- [anything blocking progress, and why; otherwise "(none)"]

## Next Move
1. [ordered list of next actions, or "(none)"]

## Relevant Files
List the files and directories, other than the current working directory, that another agent would need to open to continue this work. Include at most 15, most important first. Do not list every file that was read or changed. Include paths outside the current working directory when relevant. If none, write "(none)".
- `[file or directory path]`: [brief reason it matters]

## Important Context
- [facts the next agent cannot continue without and cannot easily find on its own; or "(none)"]

Rules:
- Keep each section concise. Use terse, single-line bullets, not prose paragraphs or nested lists.
- Prefer short references over detailed restatement. It is fine to leave out information the next agent can recover from the code or the files listed above.
- Preserve exact file paths, symbols, commands, error strings, URLs, and identifiers.
- Carry forward only user questions or requests that remain unanswered or require further action. Do not repeat ones that newer history has answered or resolved. Preserve exact wording when carrying one forward.
- Preserve consequential workflow state, including whether changes are uncommitted, committed, pushed, under review, or merged.
- What the latest request is actually asking for: your reading of its intent and any ambiguity you have already resolved — not a re-transcription, since what fits is kept verbatim in the preserved messages. But those kept messages are size-capped, so a long request is truncated there: if the latest request is large (a big paste or file), preserve the parts at risk of being dropped — above all the actual ask.
- What has actually been done, at high fidelity: keep the exact commands that were run, the exact file paths touched, and whether each succeeded or failed — and the results themselves, not just the commands. Keep only the final working version of any code; drop intermediate attempts and already-resolved errors.
- What you still don't know: context the next step depends on that this conversation never established — files or paths referenced but not yet read, schemas or APIs assumed but unseen, questions the user has not answered. Name these gaps so the next turn goes and checks them instead of assuming.
- The forward plan — and this is the moment to invest in it. Right now you hold more context on this task than you ever will again; the next turn resumes with less, so the plan you commit here is the one it will follow. Give the exact next command or tool call, but don't stop at the next step: set out the remaining sequence, the decisions you have already made for those steps, the obstacles you can foresee, and any work you can commit to now. Include any required format for the final answer.
- This conversation's event log stays on disk and a recovery pointer is appended below this summary automatically, so you need not reproduce long outputs verbatim — keep exact identifiers, key values and error lines, and name anything the next turn should look up.
- Your TODO list is re-attached automatically below this summary from its live source, so do not transcribe it. What that list cannot hold is the reasoning between tasks — why one was reordered or dropped, or a decision on one that constrains another — so record that instead.
- Be honest about uncertainty. If an earlier step claimed something was done but was never verified (tests "passing", a fix "working", a file "created"), say so plainly and treat it as unverified rather than fact — re-check before relying on it.
- Be concise, and keep the summary proportional to the task: a long multi-step task warrants detail, but a trivial or nearly finished exchange needs only a sentence or two — do not pad it out.
- Do not mention the summary process or that context was compacted.

Respond with text only. Do not call any tools — you already have everything you need in the conversation history.

${custom_instruction_block}
