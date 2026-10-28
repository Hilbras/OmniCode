import type { Model } from '#/llm-adapter/model/catalog';
import { resolveThinkingEffortForModel } from '#/llm-adapter/model/thinking';

import type { ProfileModelContext } from './profile';

export function profileModelContextFor(model: Model, modelAlias: string): ProfileModelContext {
  return {
    modelAlias,
    modelCapabilities: model.capabilities,
    maxOutputSize: model.maxOutputSize,
    alwaysThinking: model.alwaysThinking || undefined,
    thinkingLevel: resolveThinkingEffortForModel(undefined, undefined, model, false),
    reservedContextSize: undefined,
    compactionTriggerRatio: undefined,
    compactionMaxAttempts: undefined,
  };
}
