import { registerAgentToolService } from '@hilbras/omnicode-engine/agent/toolRegistry/toolContribution';

import { toInputJsonSchema } from '@hilbras/omnicode-engine/tool/input-schema';
import { IAgentScopeContext } from '@hilbras/omnicode-engine/agent/scopeContext/scopeContext';
import { GOAL_MAIN_AGENT_ONLY, mainAgentOnlyExecution } from '@hilbras/omnicode-engine/agent/tools/mainAgentOnly';
import { type ToolExecution } from '@hilbras/omnicode-engine/tool/toolContract';

import { IAgentGoalService } from '@hilbras/omnicode-engine/features/goal/goalService';
import { goalResultForModel } from '@hilbras/omnicode-tools/features/goal/tools/serialize';

import DESCRIPTION from './get-goal.md?raw';
import { GetGoalToolInputSchema, IGetGoalTool, type GetGoalToolInput } from './get-goal';

export class GetGoalTool implements IGetGoalTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'GetGoal' as const;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(GetGoalToolInputSchema);

  constructor(
    @IAgentGoalService private readonly goal: IAgentGoalService,
    @IAgentScopeContext private readonly scopeContext: IAgentScopeContext,
  ) {}

  resolveExecution(_args: GetGoalToolInput): ToolExecution {
    const denied = mainAgentOnlyExecution(this.scopeContext, GOAL_MAIN_AGENT_ONLY);
    if (denied !== undefined) return denied;
    return {
      description: 'Reading the current goal',
      approvalRule: this.name,
      execute: async () => {
        const result = this.goal.getGoal();
        return { output: JSON.stringify(goalResultForModel(result), null, 2) };
      },
    };
  }
}

registerAgentToolService(IGetGoalTool, GetGoalTool, { name: 'GetGoal', domain: 'goal' });
