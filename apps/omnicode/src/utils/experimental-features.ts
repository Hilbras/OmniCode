import type {
  ExperimentalFeatureState,
  ExperimentalFlagMap,
} from '@hilbras/kernel-api';

export function experimentalFeatureMap(
  features: readonly Pick<ExperimentalFeatureState, 'id' | 'enabled'>[],
): ExperimentalFlagMap {
  return Object.fromEntries(features.map((feature) => [feature.id, feature.enabled]));
}
