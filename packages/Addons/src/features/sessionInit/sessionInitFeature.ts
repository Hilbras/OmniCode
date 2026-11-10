import { LifecycleScope } from '@hilbras/omnicode-engine/app/scopes';
import { Feature } from '@hilbras/omnicode-engine/features/feature';
import { registerFeature } from '@hilbras/omnicode-engine/features/featureRegistry';

import { ISessionInitService } from './sessionInit';
import { SessionInitService } from './sessionInitService';

export class SessionInitFeature extends Feature {
  static override readonly name = 'sessionInit';

  constructor() {
    super();
    this.contributeService(
      LifecycleScope.Session,
      ISessionInitService,
      SessionInitService,
    );
  }
}

registerFeature(SessionInitFeature);
