<!-- Full-screen splash shown on first load until the client has talked to the
     daemon, so a page refresh doesn't flash a half-rendered, not-yet-connected
     app. Hidden once useOmnicodeWebClient.initialized flips true.
     The mark is the same Omnicode tile as the sidebar logo (rounded rect with
     the two eye cutouts), drawn inline so it inherits currentColor and needs
     no asset request while the app is still connecting. -->
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { Spinner } from '@hilbras/app-ui';
const { t } = useI18n();
</script>

<template>
  <div class="gload" role="status" :aria-label="t('app.connecting')">
    <div class="gload-box">
      <svg class="gload-logo" viewBox="0 0 32 22" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <mask id="gloadEyes" maskUnits="userSpaceOnUse">
            <rect x="0" y="0" width="32" height="22" fill="#fff" />
            <rect x="11.8" y="7" width="2.8" height="8" rx="1.4" fill="#000" />
            <rect x="17.4" y="7" width="2.8" height="8" rx="1.4" fill="#000" />
          </mask>
        </defs>
        <rect x="1" y="1" width="30" height="20" rx="6" fill="currentColor" mask="url(#gloadEyes)" />
      </svg>
      <Spinner size="md" :label="t('app.connecting')" />
      <div class="gload-text">{{ t('app.connecting') }}</div>
    </div>
  </div>
</template>

<style scoped>
.gload {
  position: fixed;
  top: 0;
  left: 0;
  /* Viewport units for size + position so the splash always fills the screen,
     even if a transformed/collapsed <html> would otherwise shrink a fixed box. */
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  min-width: 100vw;
  min-height: 100dvh;
  z-index: var(--z-toast);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  /* The splash is informational: it covers the app while the first load runs,
     but a click during the fade-out must reach the UI underneath instead of
     being swallowed by an invisible full-screen box (this was why the sidebar
     looked unclickable for a moment after a session opened). */
  pointer-events: none;
}
.gload-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 22px;
  /* nudge slightly above center — feels more intentional than dead-center */
  transform: translateY(-6%);
}
.gload-logo {
  /* The tile is 32x22; 96px wide reads at roughly the old wordmark's height. */
  width: 96px;
  height: auto;
  color: var(--color-text);
  animation: gload-pop 0.55s cubic-bezier(0.22, 1, 0.36, 1) both;
}
.gload-text {
  font-family: var(--mono);
  font-size: var(--text-base);
  color: var(--muted);
  letter-spacing: 0.04em;
}
@keyframes gload-pop {
  from { opacity: 0; transform: translateY(6px) scale(0.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .gload-logo { animation: none; }
}
</style>