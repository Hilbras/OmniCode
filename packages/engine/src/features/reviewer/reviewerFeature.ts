import { Feature } from '#/features/feature';
import { registerFeature } from '#/features/featureRegistry';
import {
  AgentReviewerLaneService,
  IAgentReviewerLaneService,
} from '#/agent/interaction/reviewer/reviewerLaneService';

import '#/agent/interaction/reviewer/configSection';

export class ReviewerFeature extends Feature {
  static override readonly name = 'reviewer';

  constructor() {
    super();
    this.contributeAgentService(IAgentReviewerLaneService, AgentReviewerLaneService);
  }
}

registerFeature(ReviewerFeature);