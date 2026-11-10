declare const __OMNICODE_VERSION__: string | undefined;
declare const __OMNICODE_CHANNEL__: string | undefined;
declare const __OMNICODE_COMMIT__: string | undefined;
declare const __OMNICODE_BUILD_TARGET__: string | undefined;

export interface OmnicodeBuildInfo {
  readonly version?: string;
  readonly channel?: string;
  readonly commit?: string;
  readonly buildTarget?: string;
}

function optionalBuildString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export const OMNICODE_BUILD_INFO: OmnicodeBuildInfo = {
  version:
    typeof __OMNICODE_VERSION__ === 'string'
      ? optionalBuildString(__OMNICODE_VERSION__)
      : undefined,
  channel:
    typeof __OMNICODE_CHANNEL__ === 'string'
      ? optionalBuildString(__OMNICODE_CHANNEL__)
      : undefined,
  commit:
    typeof __OMNICODE_COMMIT__ === 'string'
      ? optionalBuildString(__OMNICODE_COMMIT__)
      : undefined,
  buildTarget:
    typeof __OMNICODE_BUILD_TARGET__ === 'string'
      ? optionalBuildString(__OMNICODE_BUILD_TARGET__)
      : undefined,
};
