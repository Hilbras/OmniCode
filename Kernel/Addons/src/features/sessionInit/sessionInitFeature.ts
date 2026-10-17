import { LifecycleScope } from '@hilbras/omnicode-core/app/scopes';
import { Feature } from '@hilbras/omnicode-core/features/feature';
import { registerFeature } from '@hilbras/omnicode-core/features/featureRegistry';

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
