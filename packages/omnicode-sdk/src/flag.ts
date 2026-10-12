import type {
  FlagDefinitionInput,
  FlagId,
} from '@hilbras/omnicode-core/app/flag/flagRegistry';

export type {
  ExperimentalFeatureState,
  ExperimentalFlagMap,
  ExperimentalFlagSource,
} from '@hilbras/omnicode-core/app/flag/flag';
export type {
  FlagDefinitionInput,
  FlagId,
  FlagSurface,
} from '@hilbras/omnicode-core/app/flag/flagRegistry';

export type FlagDefinition = FlagDefinitionInput & { readonly id: FlagId };
