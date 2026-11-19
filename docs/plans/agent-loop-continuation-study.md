# Agent Loop / Prompt / Lifecycle Study — Reference CLIs

Status: proposed
Scope: comparative study of the agent loop, prompt assembly, session lifecycle,
and — the focus — **autonomous continuation** in every agent implementation under
`/mnt/sda3/work/projects.old/cli`, with a concrete fix design for OmniCode's
reported "agent pauses mid-task until I say continue" behavior. Evidence is
file-level; no reference tree was modified.

Trees studied:

| Tree | Shape | Source availability |
|---|---|---|
| `codex` | OpenAI Codex CLI, Rust `codex-rs` (~7.2k files) | full source |
| `qwen-code` | Qwen Code (gemini-cli fork), TS (~9.2k files) | full source |
| `opencode` | OpenCode runtime, TS + Effect (~7k files) | full source |
| `hermes-agent` | Hermes Agent, Python (~18.4k files) | full source |
| `minimax-code` | MiniMax Code, TS + vendored Pi agent (~3.6k files) | full source |
| `claude-code` | Anthropic Claude Code | **docs/checkout only** — no CLI source; evidence from `CHANGELOG.md`, `mods/types/claude-code.d.ts`, release feed |
| `DeepSeek-Coder` | model/finetuning repo (Evaluation, finetune, demo) | not an agent — out of scope |

---

## 1. The one universal finding

**Every base loop ends a turn when the model emits a final text response with no tool calls.** None of the six has an intrinsic "keep working until the task is done" loop. Continuation is always supplied by a *separate layer*:

- Codex: `turn.rs:852` breaks the sampling loop when `!needs_follow_up`; `tasks/regular.rs:164-175` ends the task without pending input.
- qwen-code: `agent-loop.ts:331` `if (calls.length === 0) return { reason: 'completed' }`.
- OpenCode: `llm.ts:177-190` `DrainResult.Complete()` when inbox empty; text-only step → `needsContinuation:false` (`publish-llm-event.ts:610-619`).
- Hermes: `turn_final_response.py:417` returns `break` on text-only response.
- minimax/Pi: `agent-loop.ts:276-282` breaks with no follow-up messages.
- Claude Code: turn ends → Stop hook (`claude-code.d.ts` `turn.start/step/complete`, Stop/SubagentStop).

**Therefore the user's symptom is expected base-loop behavior** — a model that emits a coherent progress message ("I've done X; next I'll do Y") with no tool call sails through to idle in all six. The question is which anti-stall layers they add on top.

## 2. Comparative matrix

| Dimension | Codex | qwen-code | OpenCode | Hermes | minimax/Pi | Claude Code (docs) |
|---|---|---|---|---|---|---|
| Auto-continue on tool calls | yes (`needs_follow_up`) | yes | yes (`needsContinuation`) | yes | yes (inner loop) | yes |
| Generic "please continue" after final text | **no** | **no** (`skipNextSpeakerCheck` defaults `true`) | **no** | **no** | **no** | Stop-hook feedback (opt-in) |
| Goal driver on idle | **yes, default-on** (`Feature::Goals`) | **yes** (`GoalRuntime.finishTurn → queueContinuation`) | **yes** (`experimental.idle` hook + judge) | **yes** (`/goal` Ralph + aux judge) | **yes** (`thread-goal/orchestrator`, no max turns) | **yes** (`/goal`, all surfaces) |
| Prompt-level persistence text | **yes** (`# Autonomy and persistence`) | continuation prompts | goal prompts only | goal prompts only | coding SYSTEM.md + goal contract | goal + persistent-mode prompts |
| Intent-ack / progress-message stall guard | — | no-progress streak (3 turns) | goal stall detection (3) | **yes, within-turn, cap 2** | NO_TOOL_NUDGE / runaway guard (3) | runaway caps |
| Stop-hook can force continuation | yes (`HookPrompt`, cap 8) | yes (cap 8) | plugin idle hook | — | plugin Stop continuations (cap 8) | `additionalContext` (cap 8) |
| Restart of active goal | `restore_after_resume` → continuation | active auto-continues, paused needs `/goal resume` | restart nudge (10 attempts) | idle barrier hook; no watchdog on restart | abort leaves goal active | `CLAUDE_CODE_RESUME_INTERRUPTED_TURN` |
| Headless awaiting-user | approvals auto-rejected | goal paused with reason | question cancel feedback | — | **normalized to failure (non-zero exit)** | prompts time out / fail `-p` |
| Step caps | goal token budget; no max-turn flag | `maxSessionTurns`, goal budgets | `agent.steps`, output-limit 2 | iteration/wall-clock budget | `maxSteps`/`timeout` | `--max-turns`, `--max-budget-usd` |

## 3. The continuation mechanisms, concretely

### Codex — prompt first, goal driver second
- System prompt (`codex-rs/models-manager/models.json` → `prompts/src/model_instructions.rs`): `# Autonomy and persistence` — "continue working autonomously … until the desired user outcome is achieved", "do not stop at an intermediate result".
- Wire-level `end_turn:false` keeps the same turn alive (`session/turn.rs:3752`).
- Goal driver: `ext/goal/extension.rs:179-202` `on_thread_idle → continue_if_idle()` → `runtime.rs:488-493` `start_turn_if_idle(turn_trigger:"goal")` with `templates/goals/continuation.md`. Default-on (`features/src/lib.rs:2306`).
- 3-strike detectors: empty-response goal (`accounting.rs:229-246`) and failed-exec (`accounting.rs:155-173`).
- Sleep tool (`tools/handlers/sleep.rs`, max 12 h) forces re-sampling for long-horizon monitoring.

### qwen-code — the most precise anti-stall contract
- `goal-runtime.ts:1247` `finishTurn()` → `queueContinuation()` → new synthetic turn; `goal-protocol.ts:27` `GOAL_NO_PROGRESS_TURN_LIMIT = 3`.
- Progress is **evidence-bearing tool results**, excluding goal self-talk (`chatRecordingService.ts:3250-3263`, `goal-tool-result-provenance.ts`).
- `goal-continuation-prompt.ts:73-78,159-174`: on every continuation, "Judge your previous Goal turn before acting… if it did not make progress, take a different concrete action now instead of restating status"; completion/verifier audit lines.
- Paused-goal reminder (`client.ts:5381-5386`): a paused goal must not silently restart when a normal user message arrives.
- `skipNextSpeakerCheck` defaults `true` (`config.ts:3880`) — the generic "Please continue." query is **off** by default.

### OpenCode — idle hook + judge
- `runner/llm.ts:180-189`: before idle, trigger `experimental.idle` hook with outstanding background state; a plugin may admit input → drain continues.
- Goal plugin (`plugin/goal.ts:140-220`, caps `MAX_ROUNDS=50`, `MAX_STALLS=3`, `WAIT_LIMIT=30min`): judge model returns `done|continue|blocked|paused|wait`; `continue` injects `goal/continuation.txt` as a synthetic user message.
- Restart continuation (`execution/restart.ts:30-31,101-123`): "The server restarted while you were working. Continue from where you left off without repeating completed work."; per-turn durable counter, max 10 attempts.
- Compaction summary captures **Work State** and **Next Move** (`session/compaction.ts:170-201`).

### Hermes — the within-turn stall guard (most relevant to the reported symptom)
- `agent/turn_final_response.py:218-295`: `_looks_like_codex_intermediate_ack` / stall guard detects a final text that announces a next action or repeats status with no tool call and injects a continuation nudge **inside the same turn**, capped at **2 per turn**; dropped-tool-call and truncation nudges likewise bounded.
- Verification stop gate (`agent/turn_stop_gates.py`): edited code but no fresh evidence → nudge to verify.
- `/goal` Ralph loop (`hermes_cli/goals.py`): aux-model judge, continuation prompt as an ordinary user message, state in session meta, `MAX_TURNS=20`.
- Byte-stable system prompt (`agent/AGENTS.md:55-73`): every mid-conversation injection rides a user message or tool result — never the system prompt.

### minimax/Pi — host-level orchestrator
- `agent-loop.ts:190` inner loop on tool calls; host `pi-turn-runner/events.ts:204,245` polls steering and `agent.continue()` at boundaries.
- `thread-goal/orchestrator.ts`: `while (true)` — active goal → render continuation prompt with a fresh turnId; header says explicitly "so the model can keep working across turns without the user having to keep typing prompts", **no max-turn limit, no token budget**.
- `continuation.ts`: `NO_TOOL_NUDGE`, `NO_PROGRESS_NUDGE`, 3-turn blocked threshold, 5-turn terminal audit.
- `DEFAULT_RETRY_CONTINUATION_PROMPT`: "Continue working on the user's outstanding request from the last completed action. Do not restart, do not greet the user, and do not ask what to do next — resume the task in progress."
- Runaway guard (`agent-modules/runaway-guard/`): 3-occurrence signals → one `<system-reminder>` steering the model to change strategy.

### Claude Code — docs evidence
- `/goal` (CHANGELOG 7735): "set a completion condition and Claude keeps working across turns until it's met — interactive, `-p`, Remote Control".
- Stop hooks: `additionalContext` feedback to continue (7164), `preventContinuation:true` to stop (8648), block cap 8 (7599).
- Auto-continue on mid-stream truncation (5548) and output-token limit (10176).
- Headless `-p`: `--max-turns`, `--max-budget-usd`; AskUserQuestion no longer auto-continues by default (6662).

## 4. Root-cause analysis for OmniCode

OmniCode already has the pieces the references consider essential:

- **Tool-call stepping** — xstate `llm.done` with tool calls → `acting` → next step (equivalent to Codex `needs_follow_up`, OpenCode `needsContinuation`).
- **Goal continuation** — `goalService.launchContinuationTurn` submits a fresh user-origin turn with `GOAL_CONTINUATION_ORIGIN` (equivalent to Codex `turn_trigger:"goal"`, qwen `queueContinuation`).
- **Restart semantics** — just landed: `handleTurnLaunched` auto-resumes a goal paused with `Paused after agent closed` (matches Codex `restore_after_resume` and qwen active-goal restore).
- **Loop/stagnation reminders** — `textLoopWatchService` handles repetition (like runaway guard).

What is missing, and maps directly to the symptom:

1. **No prompt-level persistence directive** in OmniCode's default system prompt. Codex's first line of defense is telling the model not to stop at an intermediate result. Grep found no such text in `packages/engine/src/agent/prompt/` — the persistence language lives only in goal continuation prompts.
2. **No intent-ack / stall guard.** A final text that says "I've done X; next I'll do Y" with no tool call ends the turn in OmniCode just as in the base loops; only Hermes (within-turn, cap 2) and the goal-runner nudges (qwen/minimax) catch this shape. OmniCode's `textLoopWatch` detects *repetition*, not *premature final text*.
3. **No goal no-progress streak.** qwen pauses after 3 continuation turns with zero evidence-bearing tool results; Codex after 3 empty goal turns. OmniCode continues indefinitely while a goal is active, with no progress check — the opposite failure mode, but the same missing concept.
4. **No stop-hook continuation seam.** Codex/qwen/Claude allow a Stop hook to inject `additionalContext` and force the turn to continue; OmniCode's `externalHooks` has hook events but no "block stop → inject prompt → continue" path.
5. **Headless awaiting-user policy.** minimax normalizes `awaiting-user-continuation` to failure with a non-zero exit; OmniCode's `-p` path should be checked for the equivalent.

## 5. Recommended fix design (tiered)

### Tier 1 — prompt-level persistence (cheap, highest leverage)
Add explicit "autonomy and persistence" text to the default system prompt at its owning seam (`IAgentProfileService.getSystemPrompt()` / the profile default): continue autonomously until the user's outcome is achieved; do not stop at an intermediate result; verify before declaring completion. Keep it in the **system prompt** (stable across the conversation), not a mid-turn injection.

### Tier 2 — within-turn intent-ack stall guard (the core fix for the reported symptom)
At the settle boundary (`AgentLoopService.evaluateSettle` / the machine's `llm.done` no-tool branch): when a step ends with a text-only final response that matches a progress/intent-ack shape — announces a next action ("next I'll…", "now I'll…"), reports partial status without evidence, or is a bare acknowledgment — do **not** settle the turn. Inject a short bounded reminder as a user-origin context message ("Continue the task now: take the next concrete step and use a tool; do not restate status") and let the machine run another step. Cap at **2 nudges per turn** (Hermes' bound) and disable via an env flag. Pair with a verification stop gate: if the turn wrote files but no verification tool ran, nudge to verify (Hermes `turn_stop_gates.py`).

### Tier 3 — goal no-progress + continuation prompts
Add a no-progress streak to `goalService.handleTurnEnded`: a continuation turn with **zero evidence-bearing tool results** (exclude goal-tool self-talk, per qwen) increments the streak; 3 consecutive idle turns pause the goal with an explicit reason instead of spinning. Enrich `GOAL_CONTINUATION_PROMPT` with qwen's "judge your previous goal turn — take a different concrete action instead of restating status" line. Add a paused-goal reminder so an intentionally paused goal is not silently resumed by ordinary user messages (the positive auto-resume fix from §4 must stay limited to the close-specific reason).

### Tier 4 — optional seams
Add a stop-hook continuation path (hook returns a blocking decision + continuation text → inject as `HookPrompt` and continue the step, cap 8), and a headless policy where an awaiting-user approval/question fails the run with a clear exit code instead of appearing to pause.

## 6. What not to copy

- Infinite goal loops without progress/budget bounds (Codex and qwen both cap tokens/turns and add 3-strike detectors; minimax's "no max turns" is acceptable only because it has runaway guards).
- Next-speaker "Please continue" as a default generic mechanism — qwen disables it by default because it misclassifies finished answers.
- Model-authored goal state that can promote itself: keep OmniCode's existing trust-gated evidence rules.
- Sleep-based wakeups as a replacement for real background task notifications — OmniCode already has a durable notification queue.

## 7. Verification for the fix

- A test that drives the real loop with a scripted model emitting "I did X; next I'll do Y" as its first response with no tool call: base fails (1 request, turn ends), fix passes (second request with nudge, work continues).
- A cap test: 3 intent-ack responses → exactly 2 nudges, then settle.
- A goal test: 3 continuation turns with zero tool results → goal paused with reason.
- A prompt test: the default system prompt contains the persistence directive.
- Existing suites untouched: loop, goal, feature-assembly, headless print.
