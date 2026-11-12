import type { IAgentContextMemoryService } from '#/agent/contextMemory/contextMemory';
import type { ContextMessage } from '#/agent/contextMemory/types';
import type { ContentPart } from '#human/llm/message';

export interface AutoModeContext {
  readonly hasUserMessage: boolean;
  readonly latestUserText: string;
  readonly editIntent: boolean;
  readonly recentToolNames: readonly string[];
}

const EDIT_INTENT = /\b(?:add|adjust|build|change|correct|create|delete|edit|fix|format|implement|make|modify|move|patch|refactor|remove|rename|replace|update|write)\b/i;
const CHINESE_EDIT_INTENT = /(?:添加|修改|编辑|修复|重构|实现|删除|创建|更新|写入|格式化|移动|改动|改)/;
const NO_EDIT_INTENT = /\b(?:do not (?:edit|change|modify|write)|don't (?:edit|change|modify|write)|explain only|just explain|read[- ]only|no edits?)\b|(?:不要|别)(?:修改|编辑|改|写|动)|只(?:解释|读)/i;

export function buildAutoModeContext(messages: readonly ContextMessage[]): AutoModeContext {
  const latest = latestUserMessage(messages);
  const latestUserText = latest === undefined ? '' : messageText(latest);
  return {
    hasUserMessage: latest !== undefined,
    latestUserText,
    editIntent:
      latest !== undefined &&
      (EDIT_INTENT.test(latestUserText) || CHINESE_EDIT_INTENT.test(latestUserText)) &&
      !NO_EDIT_INTENT.test(latestUserText),
    recentToolNames: recentToolNames(messages),
  };
}

export function readAutoModeContext(memory: IAgentContextMemoryService): AutoModeContext {
  return buildAutoModeContext(memory.get());
}

function latestUserMessage(messages: readonly ContextMessage[]): ContextMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user') continue;
    if (message.origin !== undefined && message.origin.kind !== 'user') continue;
    return message;
  }
  return undefined;
}

function messageText(message: ContextMessage): string {
  return message.content
    .map((part) => textPart(part))
    .filter((part): part is string => part !== undefined)
    .join('\n')
    .trim();
}

function textPart(part: ContentPart): string | undefined {
  return part.type === 'text' ? part.text : undefined;
}

function recentToolNames(messages: readonly ContextMessage[], limit = 12): readonly string[] {
  const names: string[] = [];
  for (let index = messages.length - 1; index >= 0 && names.length < limit; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'assistant') continue;
    for (let callIndex = message.toolCalls.length - 1; callIndex >= 0 && names.length < limit; callIndex -= 1) {
      const name = message.toolCalls[callIndex]?.name;
      if (name !== undefined) names.push(name);
    }
  }
  return names;
}
