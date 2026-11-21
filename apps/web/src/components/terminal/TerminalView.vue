<script setup lang="ts">
import '@xterm/xterm/css/xterm.css';

import type { FitAddon as FitAddonType } from '@xterm/addon-fit';
import type { Terminal as XTerm } from '@xterm/xterm';
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type { AppTerminal } from '@hilbras/app-core/api';
import type { SessionTerminalBridgeLike } from '../../api/terminalBridge';

const props = defineProps<{
  terminal: AppTerminal;
  bridge: SessionTerminalBridgeLike;
  active: boolean;
}>();

const TERMINAL_FONT =
  'ui-monospace, "JetBrains Mono Variable", "SF Mono", SFMono-Regular, Menlo, Consolas, monospace';

const hostRef = ref<HTMLElement | null>(null);
const exited = ref<number | null | undefined>(undefined);

let term: XTerm | null = null;
let fitAddon: FitAddonType | null = null;
let resizeObserver: ResizeObserver | null = null;
let resizeTimer: ReturnType<typeof setTimeout> | null = null;
let disposeOutput: (() => void) | null = null;
let disposeExit: (() => void) | null = null;
let unmounted = false;

function tokenColor(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === '' ? fallback : value;
}

function applyTheme(): Record<string, string> {
  return {
    background: tokenColor('--bg', '#0d0b08'),
    foreground: tokenColor('--text', '#e6edf3'),
    cursor: tokenColor('--gold', '#e2bd52'),
    cursorAccent: tokenColor('--gold-ink', '#1a1503'),
    selectionBackground: tokenColor('--gold-soft', '#264f78'),
    red: tokenColor('--danger', '#ff7b72'),
    green: tokenColor('--success', '#7ee787'),
    yellow: tokenColor('--gold-bright', '#f2cc60'),
    blue: tokenColor('--gold-text', '#7aa2ff'),
  };
}

function fitAndResize(): void {
  if (!term || !fitAddon || !hostRef.value) return;
  if (hostRef.value.clientWidth <= 0 || hostRef.value.clientHeight <= 0) return;
  try {
    fitAddon.fit();
    props.bridge.resize(props.terminal.id, term.cols, term.rows);
  } catch {
    // xterm-fit can throw while layout is settling; the next resize retries.
  }
}

function scheduleFit(): void {
  if (resizeTimer !== null) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    resizeTimer = null;
    fitAndResize();
  }, 100);
}

async function initTerminal(): Promise<void> {
  if (!hostRef.value || term) return;
  const [{ Terminal: XTermCtor }, { FitAddon: FitAddonCtor }] = await Promise.all([
    import('@xterm/xterm'),
    import('@xterm/addon-fit'),
  ]);
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // fonts API unavailable — proceed with the fallback metric
    }
  }
  if (unmounted || !hostRef.value || term) return;
  const next = new XTermCtor({
    cursorBlink: true,
    convertEol: true,
    fontFamily: TERMINAL_FONT,
    fontSize: 13,
    lineHeight: 1.1,
    scrollback: 4000,
    theme: applyTheme(),
  });
  const fit = new FitAddonCtor();
  next.loadAddon(fit);
  next.open(hostRef.value);
  next.onData((data) => props.bridge.write(props.terminal.id, data));
  next.onResize(({ cols, rows }) => props.bridge.resize(props.terminal.id, cols, rows));
  term = next;
  fitAddon = fit;

  disposeOutput = props.bridge.onOutput((terminalId, data) => {
    if (terminalId !== props.terminal.id) return;
    term?.write(data);
  });
  disposeExit = props.bridge.onExit((terminalId, code) => {
    if (terminalId !== props.terminal.id) return;
    exited.value = code;
  });

  props.bridge.attach(props.terminal.id);
  await nextTick();
  fitAndResize();
}

onMounted(() => {
  void initTerminal();
  if (hostRef.value !== null && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => scheduleFit());
    resizeObserver.observe(hostRef.value);
  }
});

onUnmounted(() => {
  unmounted = true;
  disposeOutput?.();
  disposeExit?.();
  resizeObserver?.disconnect();
  if (resizeTimer !== null) clearTimeout(resizeTimer);
  term?.dispose();
  term = null;
  fitAddon = null;
});

watch(
  () => props.active,
  (active) => {
    if (!active) return;
    scheduleFit();
    term?.focus();
  },
  { immediate: true },
);
</script>

<template>
  <div class="relative h-full min-h-0 w-full">
    <div ref="hostRef" class="h-full w-full px-2 py-1" data-testid="terminal-host" />
    <div
      v-if="exited !== undefined"
      class="absolute inset-x-0 bottom-0 flex items-center justify-center px-3 py-1"
      style="background: var(--surface-2)"
    >
      <span class="mono-label">
        {{ exited === null ? 'terminal exited' : `terminal exited (${String(exited)})` }}
      </span>
    </div>
  </div>
</template>
