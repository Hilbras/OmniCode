declare const __OMNICODE_BUILT_IN_CATALOG__: string | undefined;

export const BUILT_IN_MODELS_DEV_JSON: string | undefined =
  typeof __OMNICODE_BUILT_IN_CATALOG__ === 'string'
    ? __OMNICODE_BUILT_IN_CATALOG__
    : undefined;
