import { registerAgentToolService } from '@hilbras/omnicode-engine/agent/toolRegistry/toolContribution';
import { IAgentFullCompactionService } from '@hilbras/omnicode-engine/agent/fullCompaction/fullCompaction';
import { IAgentScopeContext } from '@hilbras/omnicode-engine/agent/scopeContext/scopeContext';
import { ISessionTokenCountingService } from '@hilbras/omnicode-engine/session/tokenCounting/sessionTokenCounting';
import { toInputJsonSchema } from '@hilbras/omnicode-engine/tool/input-schema';
import type { ToolExecution } from '@hilbras/omnicode-engine/tool/toolContract';

import {
  NEW_CONTEXT_WINDOW_TOOL_NAME,
  NewContextWindowInputSchema,
  INewContextWindowTool,
  type NewContextWindowInput,
} from './new-context-window';
import DESCRIPTION from './new-context-window.md?raw';

export class NewContextWindowTool implements INewContextWindowTool {
  declare readonly _serviceBrand: undefined;

  readonly name = NEW_CONTEXT_WINDOW_TOOL_NAME;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(NewContextWindowInputSchema);

  constructor(
    @IAgentFullCompactionService private readonly compaction: IAgentFullCompactionService,
    @ISessionTokenCountingService private readonly counting: ISessionTokenCountingService,
    @IAgentScopeContext private readonly scope: IAgentScopeContext,
  ) {}

  resolveExecution(args: NewContextWindowInput): ToolExecution {
    return {
      description: 'Requesting a fresh context window',
      approvalRule: this.name,
      execute: async () => {
        if (this.compaction.compacting !== null) {
          return {
            isError: false,
            output:
              'A compaction is already running; a fresh context window is already on its way. ' +
              'Finish the turn and let it complete before requesting another.',
          };
        }
        const before = this.counting.get(this.scope.agentContext).size;
        try {
          const started = this.compaction.begin({
            source: 'auto',
            instruction: args.instruction,
          });
          if (!started) {
            return {
              isError: false,
              output:
                'Fresh context window not scheduled: the per-turn compaction limit was reached. ' +
                'Continue with narrower reads and request the window again next turn.',
            };
          }
          return {
            isError: false,
            output:
              `Fresh context window scheduled (context was ~${String(before)} tokens). ` +
              'The compaction runs when this turn ends; the next window starts from its summary. ' +
              'Name what must survive (paths, decisions, open requirements) in the summary instruction ' +
              'or re-read it from disk after the switch.',
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            isError: true,
            output: `Fresh context window request refused: ${message}`,
          };
        }
      },
    };
  }
}

registerAgentToolService(INewContextWindowTool, NewContextWindowTool, {
  name: NEW_CONTEXT_WINDOW_TOOL_NAME,
  domain: 'context',
});
