import { registerAgentToolService } from '@hilbras/omnicode-engine/agent/toolRegistry/toolContribution';
import { IAgentProfileService } from '@hilbras/omnicode-engine/agent/profile/profile';
import { IAgentScopeContext } from '@hilbras/omnicode-engine/agent/scopeContext/scopeContext';
import type { Model } from '@hilbras/omnicode-engine/llm-adapter/model/catalog';
import { IModelCatalog } from '@hilbras/omnicode-engine/llm-adapter/model/catalog';
import { ISessionTokenCountingService } from '@hilbras/omnicode-engine/session/tokenCounting/sessionTokenCounting';
import { toInputJsonSchema } from '@hilbras/omnicode-engine/tool/input-schema';
import type { ToolExecution } from '@hilbras/omnicode-engine/tool/toolContract';

import {
  GET_CONTEXT_REMAINING_TOOL_NAME,
  GetContextRemainingInputSchema,
  IGetContextRemainingTool,
  type GetContextRemainingInput,
} from './get-context-remaining';
import DESCRIPTION from './get-context-remaining.md?raw';

interface ModelLimits {
  readonly maxContextSize?: number;
  readonly maxInputSize?: number;
  readonly maxOutputSize?: number;
}

export class GetContextRemainingTool implements IGetContextRemainingTool {
  declare readonly _serviceBrand: undefined;

  readonly name = GET_CONTEXT_REMAINING_TOOL_NAME;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(GetContextRemainingInputSchema);

  constructor(
    @ISessionTokenCountingService private readonly counting: ISessionTokenCountingService,
    @IAgentScopeContext private readonly scope: IAgentScopeContext,
    @IAgentProfileService private readonly profile: IAgentProfileService,
    @IModelCatalog private readonly modelCatalog: IModelCatalog,
  ) {}

  resolveExecution(_args: GetContextRemainingInput): ToolExecution {
    return {
      description: 'Checking remaining context budget',
      approvalRule: this.name,
      execute: async () => ({
        isError: false,
        output: this.renderReport(),
      }),
    };
  }

  private renderReport(): string {
    const agent = this.scope.agentContext;
    const size = this.counting.get(agent);
    const modelContext = this.profile.resolveModelContext();
    const limits = this.modelLimits(modelContext.modelAlias, modelContext.maxOutputSize);
    const lines: string[] = [
      `context_tokens: ${String(size.size)} (measured ${String(size.measured)}, estimated ${String(size.estimated)})`,
      `token_counting_strategy: ${this.counting.strategy}`,
      `model: ${modelContext.modelAlias}`,
    ];
    lines.push(this.renderLimits(limits));

    const bindingLimit = bindingContextLimit(limits);
    if (bindingLimit !== undefined) {
      const remaining = Math.max(0, bindingLimit - size.size);
      lines.push(`remaining_tokens: ${String(remaining)} (against the binding context limit)`);
    } else {
      lines.push('remaining_tokens: unknown (the model declares no context limit)');
    }
    if (modelContext.compactionTriggerRatio !== undefined) {
      lines.push(`compaction_trigger_ratio: ${String(modelContext.compactionTriggerRatio)}`);
    }
    lines.push('note: estimates, not guarantees; re-check after large tool outputs.');
    return lines.join('\n');
  }

  private renderLimits(limits: ModelLimits): string {
    const parts: string[] = [];
    if (limits.maxContextSize !== undefined) parts.push(`max_context ${String(limits.maxContextSize)}`);
    if (limits.maxInputSize !== undefined) parts.push(`max_input ${String(limits.maxInputSize)}`);
    if (limits.maxOutputSize !== undefined) parts.push(`max_output ${String(limits.maxOutputSize)}`);
    return `model_limits: ${parts.length > 0 ? parts.join(', ') : 'unknown'}`;
  }

  private modelLimits(modelAlias: string, fallbackMaxOutputSize: number | undefined): ModelLimits {
    let model: Model | undefined;
    try {
      model = this.modelCatalog.get(modelAlias);
    } catch {
      model = undefined;
    }
    if (model === undefined) return { maxOutputSize: fallbackMaxOutputSize };
    return {
      maxContextSize: model.maxContextSize,
      maxInputSize: model.maxInputSize,
      maxOutputSize: model.maxOutputSize ?? fallbackMaxOutputSize,
    };
  }
}

function bindingContextLimit(limits: ModelLimits): number | undefined {
  const candidates = [limits.maxInputSize, limits.maxContextSize].filter(
    (value): value is number => typeof value === 'number' && value > 0,
  );
  return candidates.length > 0 ? Math.min(...candidates) : undefined;
}

registerAgentToolService(IGetContextRemainingTool, GetContextRemainingTool, {
  name: GET_CONTEXT_REMAINING_TOOL_NAME,
  domain: 'context',
});
