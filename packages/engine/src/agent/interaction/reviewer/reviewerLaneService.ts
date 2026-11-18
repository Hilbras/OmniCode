import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';
import { toDisposable } from '@hilbras/omnicode-base/di/lifecycle';
import { Service } from '@hilbras/omnicode-base/di/service';
import { IAgentLLMRequesterService } from '#/agent/llmRequester/llmRequester';
import { IAgentToolApprovalService } from '#/agent/toolApproval/toolApproval';
import { IConfigService } from '#/app/config/config';
import { createUserMessage } from '#/llm-adapter/contract/message';

import {
  REVIEWER_SECTION,
  resolveReviewerConfig,
  type ReviewerSectionConfig,
  type ResolvedReviewerConfig,
} from './configSection';
import { DEFAULT_MAX_REVIEWS, type ReviewerLane } from './reviewerLane';
import { LlmReviewerLane, type ReviewerModel } from './llmReviewerLane';

/**
 * Composes the reviewer lane once per agent and installs it into the approval
 * service.
 *
 * Disabled (the default) installs nothing, so the approval path is byte-for-byte
 * the previous "always ask the user" behaviour. Enabled builds one isolated
 * lane: its own model alias, prompt budget, timeout, and sample budget.
 *
 * The requester call is marked `isolated`, which keeps the main conversation's
 * world state out of the reviewer prompt and stops the reviewer request from
 * consuming the section the next turn was going to receive.
 */
export interface IAgentReviewerLaneService {
  readonly _serviceBrand: undefined;
  /** The installed lane, or `undefined` when the reviewer is disabled. */
  readonly lane: ReviewerLane | undefined;
  /** Concrete lane for status/checkpoint reads, or `undefined` when disabled. */
  readonly llm: LlmReviewerLane | undefined;
  settings(): ResolvedReviewerConfig;
}

export const IAgentReviewerLaneService = createDecorator<IAgentReviewerLaneService>(
  'agentReviewerLaneService',
);

export function reviewerModelFromRequester(
  requester: IAgentLLMRequesterService,
  options: {
    readonly modelAlias?: string;
    readonly maxOutputTokens?: number;
  },
): ReviewerModel {
  return {
    async complete(request) {
      const finish = await requester.request(
        {
          messages: [createUserMessage(request.userPrompt)],
          systemPrompt: request.systemPrompt,
          tools: [],
          isolated: true,
          modelAlias: options.modelAlias,
          maxOutputSize: options.maxOutputTokens,
          source: { type: 'operation', requestKind: 'reviewer' },
        },
        undefined,
        request.signal,
      );
      return finish.message.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('')
        .trim();
    },
  };
}

export class AgentReviewerLaneService extends Service implements IAgentReviewerLaneService {
  declare readonly _serviceBrand: undefined;

  private readonly resolved: ResolvedReviewerConfig;
  private readonly laneImpl: LlmReviewerLane | undefined;

  constructor(
    @IConfigService config: IConfigService,
    @IAgentLLMRequesterService requester: IAgentLLMRequesterService,
    @IAgentToolApprovalService approval: IAgentToolApprovalService,
  ) {
    super();
    this.resolved = resolveReviewerConfig(config.get<ReviewerSectionConfig>(REVIEWER_SECTION));
    if (!this.resolved.enabled) {
      this.laneImpl = undefined;
      approval.setReviewerLane(undefined);
      return;
    }
    const lane = new LlmReviewerLane({
      model: reviewerModelFromRequester(requester, {
        modelAlias: this.resolved.model,
        maxOutputTokens: this.resolved.maxOutputTokens,
      }),
      modelAlias: this.resolved.model,
      timeoutMs: this.resolved.timeoutMs,
      samples: this.resolved.samples,
      maxPromptChars: this.resolved.maxPromptChars,
      maxReviews: DEFAULT_MAX_REVIEWS,
      allowAutoMode: this.resolved.autoMode,
    });
    this.laneImpl = lane;
    approval.setReviewerLane(lane);
    this._register(toDisposable(() => approval.setReviewerLane(undefined)));
  }

  get lane(): ReviewerLane | undefined {
    return this.laneImpl;
  }

  get llm(): LlmReviewerLane | undefined {
    return this.laneImpl;
  }

  settings(): ResolvedReviewerConfig {
    return this.resolved;
  }
}