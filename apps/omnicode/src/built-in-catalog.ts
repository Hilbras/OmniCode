// Filled by tsdown define in release builds. Source stays empty so the
// generated models.dev snapshot is not committed.
declare const __OMNICODE_BUILT_IN_CATALOG__: string | undefined;

export const BUILT_IN_CATALOG_JSON: string | undefined =
  typeof __OMNICODE_BUILT_IN_CATALOG__ === 'string'
    ? __OMNICODE_BUILT_IN_CATALOG__
    : undefined;
