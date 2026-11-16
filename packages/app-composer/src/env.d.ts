// Vite's `import.meta.env`, as far as this package uses it: one dev-only guard in
// `composerEditor.ts`. Declared here because `vite` is not a dependency of this
// package, so `vite/client` is not reachable — same approach as app-core's own
// `env.d.ts`.
interface ImportMetaEnv {
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
