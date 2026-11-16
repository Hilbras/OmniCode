// The build-tool facts this package relies on, declared locally because `vite` is
// not a dependency here (same approach as app-core's, app-markdown's, and
// app-client's `env.d.ts`).
//
// `?url` imports: the Rive assets and wasm files in `OmnicodeMascot.vue` and
// `OmnicodeDoodle.vue`, which resolve to their served URL at build time.
declare module '*?url' {
  const url: string;
  export default url;
}

// Side-effect stylesheet imports: `@xterm/xterm/css/xterm.css` in `Terminal.vue`
// (and any future stylesheet) — no types to import, the module only has to exist.
declare module '*.css' {
  const css: string;
  export default css;
}
