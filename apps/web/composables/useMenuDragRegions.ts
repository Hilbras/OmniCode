import { onScopeDispose, watch } from 'vue';
import { anyMenuOpen } from '@vendor/app-ui';

export function useMenuDragRegions(): void {
  const root = document.documentElement;
  const stop = watch(anyMenuOpen, open => {
    root.toggleAttribute('data-menu-open', open);
  }, { immediate: true, flush: 'sync' });
  onScopeDispose(() => {
    stop();
    root.removeAttribute('data-menu-open');
  });
}
