// @hilbras/app-markdown — chat Markdown renderer (markstream-vue) with
// KaTeX / Mermaid / Shiki workers. Source-only package: the consumer's bundler
// transpiles these (`exports` points at ./src/*), so the `?worker` imports and
// markstream-vue CSS are resolved by the consumer's Vite config.

import { defineAsyncComponent, h } from 'vue';

const MarkdownLoading = {
  render: () => h('div', { class: 'md-loading', 'aria-hidden': 'true' }),
};

export const Markdown = defineAsyncComponent({
  loader: () => import('./Markdown.vue'),
  loadingComponent: MarkdownLoading,
  delay: 120,
});
