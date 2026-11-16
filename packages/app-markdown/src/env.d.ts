// The build-tool facts this package relies on, declared locally because `vite` is
// not a dependency here, so `vite/client` is not reachable (the same approach as
// app-core's `env.d.ts`).
//
// `import.meta.hot`: the HMR self-accept in `lib/markdownWorkers.ts`, which
// terminates the superseded worker pair on invalidation.
interface ImportMetaHotContext {
  accept(): void;
  dispose(callback: () => void): void;
}

interface ImportMeta {
  readonly hot?: ImportMetaHotContext;
}

// Side-effect stylesheet imports in `Markdown.vue` (`markstream-vue/index.px.css`,
// `katex/dist/katex.min.css`) — no types to import, the module just has to exist.
declare module '*.css' {
  const css: string;
  export default css;
}
