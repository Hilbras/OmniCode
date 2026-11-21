<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import type { AppTerminal } from '@hilbras/app-core/api';
import { Icon } from '@hilbras/app-ui';
import { getOmnicodeWebApi } from '../../api/bootstrap';
import { SessionTerminalBridge } from '../../api/terminalBridge';
import TerminalView from './TerminalView.vue';

const props = defineProps<{
  sessionId: string;
  /** Docked inside ChatDock's work panel: the head lives there. */
  embedded?: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const bridge = ref<SessionTerminalBridge | null>(null);
const terminals = ref<AppTerminal[]>([]);
const activeId = ref<string | null>(null);
const loading = ref(false);
const creating = ref(false);

function pickNext(currentId: string | null): string | null {
  const remaining = terminals.value.filter((t) => t.id !== currentId);
  const running = remaining.find((t) => t.status === 'running');
  return (running ?? remaining[0])?.id ?? null;
}

async function loadExisting(): Promise<void> {
  if (bridge.value === null) return;
  loading.value = true;
  try {
    terminals.value = [...(await bridge.value.list())];
    if (activeId.value === null) {
      activeId.value = terminals.value[0]?.id ?? null;
    }
  } finally {
    loading.value = false;
  }
}

async function createTerminal(): Promise<void> {
  if (bridge.value === null) return;
  creating.value = true;
  try {
    const terminal = await bridge.value.create({ cols: 100, rows: 28 });
    terminals.value = [...terminals.value, terminal];
    activeId.value = terminal.id;
  } finally {
    creating.value = false;
  }
}

async function closeTerminal(terminalId: string): Promise<void> {
  if (bridge.value === null) return;
  await bridge.value.close(terminalId);
  terminals.value = terminals.value.filter((t) => t.id !== terminalId);
  if (activeId.value === terminalId) {
    activeId.value = pickNext(terminalId);
  }
}

function selectTerminal(terminalId: string): void {
  activeId.value = terminalId;
  bridge.value?.attach(terminalId);
}

onMounted(() => {
  bridge.value = new SessionTerminalBridge(getOmnicodeWebApi(), props.sessionId);
  void loadExisting();
});

onUnmounted(() => {
  bridge.value?.dispose();
  bridge.value = null;
});
</script>

<template>
  <div
    class="flex h-full min-h-0 flex-col"
    :style="embedded ? undefined : { borderTop: '1px solid var(--line)' }"
  >
    <div
      v-if="!embedded"
      class="nav-blur flex h-10 shrink-0 items-center gap-1 px-2"
    >
      <Icon name="terminal" size="sm" />
      <span class="mono-label mr-1">Terminals</span>
      <template v-for="terminal in terminals" :key="terminal.id">
        <button
          type="button"
          class="btn-quiet max-w-[180px] truncate"
          :style="
            activeId === terminal.id
              ? { background: 'var(--gold-soft)', color: 'var(--gold-text)' }
              : undefined
          "
          @click="selectTerminal(terminal.id)"
        >
          <Icon name="terminal" size="sm" />
          {{ terminal.id.slice(0, 8) }}
        </button>
      </template>
      <button
        type="button"
        aria-label="New terminal"
        class="btn-quiet"
        :disabled="creating"
        @click="createTerminal"
      >
        <Icon name="plus" size="sm" />
      </button>
      <template v-if="!embedded">
        <span class="flex-1" />
        <button
          type="button"
          aria-label="Close terminal panel"
          class="btn-quiet"
          @click="emit('close')"
        >
          <Icon name="close" size="sm" />
        </button>
      </template>
    </div>
    <div v-if="embedded" class="flex shrink-0 items-center gap-1 overflow-x-auto px-2 pb-1">
      <template v-for="terminal in terminals" :key="terminal.id">
        <button
          type="button"
          class="btn-quiet max-w-[180px] truncate"
          :style="
            activeId === terminal.id
              ? { background: 'var(--gold-soft)', color: 'var(--gold-text)' }
              : undefined
          "
          @click="selectTerminal(terminal.id)"
        >
          <Icon name="terminal" size="sm" />
          {{ terminal.id.slice(0, 8) }}
        </button>
      </template>
      <button
        type="button"
        aria-label="New terminal"
        class="btn-quiet"
        :disabled="creating"
        @click="createTerminal"
      >
        <Icon name="plus" size="sm" />
      </button>
    </div>

    <div class="relative min-h-0 flex-1 bg-surface">
      <template v-if="activeId !== null && bridge !== null">
        <template v-for="terminal in terminals" :key="terminal.id">
          <TerminalView
            v-if="terminal.id === activeId"
            :terminal="terminal"
            :bridge="bridge"
            :active="terminal.id === activeId"
          />
        </template>
        <button
          type="button"
          aria-label="Close terminal"
          class="btn-quiet absolute right-2 top-1"
          @click="closeTerminal(activeId)"
        >
          <Icon name="trash" size="sm" />
        </button>
      </template>
      <div v-else class="flex h-full flex-col items-center justify-center gap-3">
        <p class="text-sm muted">
          {{ loading ? 'Loading terminals…' : 'No terminal yet' }}
        </p>
        <button type="button" class="btn-gold" :disabled="creating" @click="createTerminal">
          <Icon name="plus" size="sm" />
          {{ creating ? 'Creating…' : 'New terminal' }}
        </button>
      </div>
    </div>
  </div>
</template>
