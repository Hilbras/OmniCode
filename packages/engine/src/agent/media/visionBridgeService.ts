import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';
import { ScopeActivation, registerScopedService } from '@hilbras/omnicode-base/di/scope';
import { Service } from '@hilbras/omnicode-base/di/service';
import { LifecycleScope } from '#/app/scopes';

import { VisionBridge, type VisionBridgeConfig, type VisionMedia, type VisionModel } from './visionBridge';

/**
 * Session-scoped vision bridge. No model is installed by default, so the media
 * path degrades to today's placeholder without any configuration. A provider
 * adapter can install a model through this trait seam.
 */
export interface IVisionBridgeService {
  readonly _serviceBrand: undefined;
  readonly configured: boolean;
  setModel(model: VisionModel | undefined, config?: Omit<VisionBridgeConfig, 'model'>): void;
  describe(media: VisionMedia | undefined, signal?: AbortSignal): Promise<string | undefined>;
}

export const IVisionBridgeService = createDecorator<IVisionBridgeService>('visionBridgeService');

export class VisionBridgeService extends Service implements IVisionBridgeService {
  declare readonly _serviceBrand: undefined;

  private visionModel: VisionModel | undefined;
  private bridgeConfig: Omit<VisionBridgeConfig, 'model'> = {};

  get configured(): boolean {
    return this.visionModel !== undefined;
  }

  setModel(model: VisionModel | undefined, config: Omit<VisionBridgeConfig, 'model'> = {}): void {
    this.visionModel = model;
    this.bridgeConfig = config;
  }

  describe(media: VisionMedia | undefined, signal?: AbortSignal): Promise<string | undefined> {
    return new VisionBridge({ ...this.bridgeConfig, model: this.visionModel }).describe(media, signal);
  }
}

registerScopedService(
  LifecycleScope.Agent,
  IVisionBridgeService,
  VisionBridgeService,
  ScopeActivation.OnDemand,
  'visionBridge',
);
