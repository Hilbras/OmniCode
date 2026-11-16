// `~icons/*` typing for consumers of this preset.
//
// unplugin-icons also ships `unplugin-icons/types/vue` for this, but it is not a
// dependency of the packages that consume the preset, so leaving the component form
// undeclared made every `~icons/...` import an unresolved module for them (225 errors
// in `app-markdown`'s program alone, which compiles `app-client`'s icon registry).
//
// Two declarations, not one: the plain form is a Vue component, and the `?raw` query
// re-exports the raw SVG source, which must type as `string`. The more specific
// pattern wins for `?raw` imports.
//
// This file must stay a **global script** — no top-level `import`/`export`, hence
// `import('vue')` in the type positions. Adding a top-level import turns it into a
// module, and `declare module '~icons/*'` inside a module is an *augmentation* of a
// module that does not exist, so every declaration here silently stops applying.
declare module '~icons/*' {
  const component: import('vue').FunctionalComponent<import('vue').SVGAttributes>;
  export default component;
}

declare module '~icons/*?raw' {
  const src: string;
  export default src;
}
