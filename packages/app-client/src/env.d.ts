// The build-tool facts this package relies on, declared locally because `vite` is
// not a dependency here, so `vite/client` is not reachable (the same approach as
// app-markdown's and app-core's `env.d.ts`).
//
// `import.meta.hot`: the HMR self-accept that disposes this module's session-time
// clock and event queue on invalidation (`client/useOmnicodeWebClient.ts`).
interface ImportMetaHotContext {
  accept(): void;
  dispose(callback: () => void): void;
}

interface ImportMeta {
  readonly hot?: ImportMetaHotContext;
}

// Side-effect stylesheet imports in `lib/mediaPreview.ts` (`photoswipe/style.css`
// and the co-located `mediaPreview.css`) — no types to import, the module only has
// to exist.
declare module '*.css' {
  const css: string;
  export default css;
}
