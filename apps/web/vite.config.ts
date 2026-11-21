import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import Icons from 'unplugin-icons/vite';
import { FileSystemIconLoader } from 'unplugin-icons/loaders';

const root = fileURLToPath(new URL('.', import.meta.url));
const vendor = (name: string) => `${root}vendor/${name}/src/index.ts`;

const serverTarget = process.env.OMNICODE_SERVER_URL || 'http://127.0.0.1:58627';
const webPort = Number(process.env.WEB_PORT) || 5175;

export default defineConfig({
  root,
  assetsInclude: ['**/*.riv', '**/rive.wasm', '**/rive_fallback.wasm'],
  plugins: [
    vue(),
    Icons({
      compiler: 'vue3',
      autoInstall: false,
      customCollections: { kimi: FileSystemIconLoader(`${root}vendor/app-client/src/icons/kimi`) },
    }),
  ],
  resolve: {
    alias: [
      { find: '@vendor/app-composer/features/browser-reference', replacement: `${root}vendor/app-composer/src/features/browser-reference/index.ts` },
      { find: '@vendor/app-composer/features/pasted-text', replacement: `${root}vendor/app-composer/src/features/pasted-text/index.ts` },
      { find: '@vendor/app-composer/features/attachment', replacement: `${root}vendor/app-composer/src/features/attachment/index.ts` },
      { find: '@vendor/app-markdown/codeScrollbars.css', replacement: `${root}vendor/app-markdown/src/codeScrollbars.css` },
      { find: '@vendor/app-markdown/lib/codeScrollbars', replacement: `${root}vendor/app-markdown/src/lib/codeScrollbars.ts` },
      { find: '@vendor/app-markdown/lib/filePathLinks', replacement: `${root}vendor/app-markdown/src/lib/filePathLinks.ts` },
      { find: '@vendor/app-composer/features/mention', replacement: `${root}vendor/app-composer/src/features/mention/index.ts` },
      { find: '@vendor/app-core/browser-panel-state', replacement: `${root}vendor/app-core/src/client/browserPanelState.ts` },
      { find: '@vendor/app-composer/features/quote', replacement: `${root}vendor/app-composer/src/features/quote/index.ts` },
      { find: '@vendor/app-core/browser-reference', replacement: `${root}vendor/app-core/src/browserReference.ts` },
      { find: '@vendor/app-markdown/lib/tableWide', replacement: `${root}vendor/app-markdown/src/lib/tableWide.ts` },
      { find: '@vendor/app-client/package.json', replacement: `${root}vendor/app-client/package.json` },
      { find: '@vendor/app-composer/transcript', replacement: `${root}vendor/app-composer/src/transcript/index.ts` },
      { find: '@vendor/app-client/composables', replacement: `${root}vendor/app-client/src/composables/index.ts` },
      { find: '@vendor/app-components/support', replacement: `${root}vendor/app-components/src/support.ts` },
      { find: '@vendor/app-core/shortcut-keys', replacement: `${root}vendor/app-core/src/lib/shortcutKeys.ts` },
      { find: '@vendor/app-core/client/types', replacement: `${root}vendor/app-core/src/client/types.ts` },
      { find: '@vendor/app-core/conversation', replacement: `${root}vendor/app-core/src/conversation/index.ts` },
      { find: '@vendor/app-client/contracts', replacement: `${root}vendor/app-client/src/contracts.ts` },
      { find: '@vendor/app-composer/runtime', replacement: `${root}vendor/app-composer/src/runtime/index.ts` },
      { find: '@vendor/app-core/native-menu', replacement: `${root}vendor/app-core/src/nativeMenu.ts` },
      { find: '@vendor/app-client/testing', replacement: `${root}vendor/app-client/src/testing/index.ts` },
      { find: '@vendor/app-composer/model', replacement: `${root}vendor/app-composer/src/model/index.ts` },
      { find: '@vendor/app-core/contracts', replacement: `${root}vendor/app-core/src/contracts.ts` },
      { find: '@vendor/app-client/client', replacement: `${root}vendor/app-client/src/client/index.ts` },
      { find: '@vendor/app-client/stores', replacement: `${root}vendor/app-client/src/stores/index.ts` },
      { find: '@vendor/app-client/icons', replacement: `${root}vendor/app-client/src/icons/icons.ts` },
      { find: '@vendor/app-client/panel', replacement: `${root}vendor/app-client/src/panel/index.ts` },
      { find: '@vendor/app-client/trace', replacement: `${root}vendor/app-client/src/lib/trace.ts` },
      { find: '@vendor/app-core/preview', replacement: `${root}vendor/app-core/src/lib/purePreview.ts` },
      { find: '@vendor/app-i18n/browser', replacement: `${root}vendor/app-i18n/src/browser.ts` },
      { find: '@vendor/app-ui/style.css', replacement: `${root}vendor/app-ui/src/style.css` },
      { find: '@vendor/app-core/client', replacement: `${root}vendor/app-core/src/client/index.ts` },
      { find: '@vendor/app-client/lib', replacement: `${root}vendor/app-client/src/lib/index.ts` },
      { find: '@vendor/app-components', replacement: `${root}vendor/app-components/src/index.ts` },
      { find: '@vendor/app-composer', replacement: `${root}vendor/app-composer/src/public.ts` },
      { find: '@vendor/app-core/api', replacement: `${root}vendor/app-core/src/api/index.ts` },
      { find: '@vendor/app-core/lib', replacement: `${root}vendor/app-core/src/lib/index.ts` },
      { find: '@vendor/app-markdown', replacement: `${root}vendor/app-markdown/src/index.ts` },
      { find: '@vendor/app-client', replacement: `${root}vendor/app-client/src/index.ts` },
      { find: '@vendor/app-core', replacement: `${root}vendor/app-core/src/index.ts` },
      { find: '@vendor/app-i18n', replacement: `${root}vendor/app-i18n/src/index.ts` },
      { find: '@vendor/app-ui', replacement: `${root}vendor/app-ui/src/index.ts` },
      { find: /^@shared\/(.+)$/, replacement: `${root}shared/$1` },
      { find: /^~\/icons\//, replacement: `${root}node_modules/@iconify-json/ri/icons/` },
      {
        find: /^.*\/terminal\/(TerminalPanel|TerminalDropZone|TerminalResizeHandle|PanelTermTab)\.vue$/,
        replacement: `${root}web-stubs/EmptyComponent.vue`,
      },
      {
        find: /^.*\/browser\/PanelBrowserTab\.vue$/,
        replacement: `${root}web-stubs/EmptyComponent.vue`,
      },
      {
        find: /^.*\/lib\/remoteControlQr$/,
        replacement: `${root}web-stubs/remoteControlQr.ts`,
      },
    ],
  },
  define: {
    __OMNICODE_DEV_PROXY_TARGET__: JSON.stringify(serverTarget),
    __OMNICODE_CLIENT_VERSION__: JSON.stringify('1.7.4'),
    __OMNICODE_WEB_DESKTOP__: JSON.stringify(false),
    __OMNICODE_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __OMNICODE_COMMIT_SHA__: JSON.stringify(''),
    __OMNICODE_BRANCH__: JSON.stringify('release'),
    __KIMI_BRANCH__: JSON.stringify('release'),
    __KIMI_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __KIMI_COMMIT_SHA__: JSON.stringify(''),
    __KIMI_CODE_DESKTOP__: JSON.stringify(false),
    __KIMI_CORE_REF__: JSON.stringify(''),
    __KIMI_DEV_BACKENDS__: JSON.stringify({ default: serverTarget, multi: serverTarget }),
  },
  server: {
    port: webPort,
    strictPort: false,
    proxy: {
      '/api/v1': { target: serverTarget, changeOrigin: true, ws: true },
      '/api/v2': { target: serverTarget, changeOrigin: true },
      '/v1': { target: serverTarget, changeOrigin: true, ws: true },
    },
  },
  worker: { format: 'es' },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
});
