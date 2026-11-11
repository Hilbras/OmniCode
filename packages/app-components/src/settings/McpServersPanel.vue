<!-- Settings → MCP Servers: view every configured MCP server (user, plugin
     and project layers), add a user-level stdio/HTTP/SSE server, import a
     standard `{ "mcpServers": … }` JSON file and export the catalog with every
     secret value removed (credentials must be re-entered after import). -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { getOmnicodeWebApi, useOmnicodeWebClient } from '@hilbras/app-client/client';
import { Badge, Button, Dialog, EmptyState, Field, Icon, Input, SegmentedControl, Spinner, Textarea, Tooltip } from '@hilbras/app-ui';

import type { AppMcpServerEntry } from '@hilbras/app-core/api';
import { errorText, saveDownload } from './catalogManagement';

type ManagedServer = AppMcpServerEntry;

const { t } = useI18n();
const client = useOmnicodeWebClient();

const servers = ref<ManagedServer[]>([]);
const loading = ref(true);
const error = ref('');
const summary = ref<{ imported: string[]; skipped: string[]; errors: string[] } | null>(null);
const importInput = ref<HTMLInputElement | null>(null);
const exporting = ref(false);

const formOpen = ref(false);
const saving = ref(false);
const formError = ref('');
const transport = ref<'stdio' | 'http' | 'sse'>('stdio');
const form = ref({ name: '', command: '', args: '', url: '', env: '', headers: '' });

const cwd = computed(() => client.visibleWorkspace.value?.root ?? undefined);
const sorted = computed(() =>
  [...servers.value].toSorted((a, b) => Number(a.mutable) - Number(b.mutable) || a.name.localeCompare(b.name)),
);
const transportOptions = computed(() => [
  { value: 'stdio', label: t('settings.mcp.transportStdio') },
  { value: 'http', label: t('settings.mcp.transportHttp') },
  { value: 'sse', label: t('settings.mcp.transportSse') },
]);

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    servers.value = await getOmnicodeWebApi().listMcpServers(cwd.value);
  } catch (err) {
    error.value = errorText(err);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load();
});

function openCreate(): void {
  form.value = { name: '', command: '', args: '', url: '', env: '', headers: '' };
  transport.value = 'stdio';
  formError.value = '';
  formOpen.value = true;
}

function pairs(raw: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const at = trimmed.indexOf('=');
    if (at <= 0) throw new Error(t('settings.mcp.invalidPair', { line: trimmed }));
    out[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1);
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

async function submitCreate(): Promise<void> {
  const name = form.value.name.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
    formError.value = t('settings.mcp.invalidName');
    return;
  }
  saving.value = true;
  formError.value = '';
  try {
    const config: Record<string, unknown> = { transport: transport.value };
    if (transport.value === 'stdio') {
      if (form.value.command.trim() === '') throw new Error(t('settings.mcp.commandRequired'));
      config['command'] = form.value.command.trim();
      const args = form.value.args.split(/\s+/).filter((arg) => arg !== '');
      if (args.length > 0) config['args'] = args;
      const env = pairs(form.value.env);
      if (env !== undefined) config['env'] = env;
    } else {
      if (!/^https?:\/\//.test(form.value.url.trim())) throw new Error(t('settings.mcp.urlRequired'));
      config['url'] = form.value.url.trim();
      const headers = pairs(form.value.headers);
      if (headers !== undefined) config['headers'] = headers;
    }
    await getOmnicodeWebApi().addMcpServer({ ...config, name }, cwd.value);
    formOpen.value = false;
    await load();
  } catch (err) {
    formError.value = errorText(err);
  } finally {
    saving.value = false;
  }
}

async function onImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file === undefined) return;
  summary.value = null;
  error.value = '';
  try {
    const parsed = JSON.parse(await file.text()) as { mcpServers?: Record<string, Record<string, unknown>> };
    if (parsed.mcpServers === undefined || typeof parsed.mcpServers !== 'object') {
      throw new Error(t('settings.mcp.invalidFile'));
    }
    summary.value = await getOmnicodeWebApi().importMcpServers({ mcpServers: parsed.mcpServers, cwd: cwd.value });
    await load();
  } catch (err) {
    error.value = errorText(err);
  }
}

async function onExport(): Promise<void> {
  if (exporting.value) return;
  exporting.value = true;
  error.value = '';
  try {
    saveDownload(await getOmnicodeWebApi().exportMcpServers(cwd.value));
  } catch (err) {
    error.value = errorText(err);
  } finally {
    exporting.value = false;
  }
}

function summaryText(config: Record<string, unknown>): string {
  const transportValue = typeof config['transport'] === 'string' ? config['transport'] : 'stdio';
  if (transportValue === 'stdio') {
    const command = typeof config['command'] === 'string' ? config['command'] : '';
    const args = Array.isArray(config['args']) ? config['args'].filter((arg) => typeof arg === 'string') : [];
    return [command, ...args].join(' ');
  }
  return typeof config['url'] === 'string' ? config['url'] : '';
}

function transportLabel(config: Record<string, unknown>): string {
  const value = typeof config['transport'] === 'string' ? config['transport'] : 'stdio';
  return value.toUpperCase();
}
</script>

<template>
  <section class="sec">
    <div class="sec-head">
      <div>
        <h3 class="sec-title">{{ t('settings.mcp.title') }}</h3>
        <p class="sec-desc">{{ t('settings.mcp.desc') }}</p>
      </div>
      <div class="actions">
        <Button variant="secondary" size="sm" :loading="exporting" @click="onExport">
          <Icon name="download" size="sm" />
          <span>{{ t('settings.catalog.exportAll') }}</span>
        </Button>
        <Button variant="secondary" size="sm" @click="importInput?.click()">
          <Icon name="file-plus" size="sm" />
          <span>{{ t('settings.catalog.import') }}</span>
        </Button>
        <Button variant="primary" size="sm" @click="openCreate">
          <Icon name="plus" size="sm" />
          <span>{{ t('settings.catalog.add') }}</span>
        </Button>
        <input
          ref="importInput"
          type="file"
          accept=".json,application/json"
          class="visually-hidden"
          :aria-label="t('settings.catalog.import')"
          @change="onImportFile"
        />
      </div>
    </div>

    <p class="catalog-note">{{ t('settings.mcp.exportNote') }}</p>

    <div v-if="summary" class="catalog-summary" role="status">
      <span>{{ t('settings.catalog.importedCount', { n: summary.imported.length }) }}</span>
      <span v-if="summary.skipped.length > 0">{{ t('settings.catalog.skippedCount', { n: summary.skipped.length }) }}</span>
      <span v-if="summary.errors.length > 0" class="is-error">{{ t('settings.catalog.errorCount', { n: summary.errors.length }) }}</span>
    </div>
    <div v-if="summary && summary.errors.length > 0" class="catalog-errors" role="alert">
      <div v-for="message in summary.errors" :key="message">{{ message }}</div>
    </div>
    <div v-if="error" class="catalog-errors" role="alert">{{ error }}</div>

    <div v-if="loading" class="catalog-loading"><Spinner size="sm" /><span>{{ t('settings.catalog.loading') }}</span></div>

    <EmptyState
      v-else-if="sorted.length === 0"
      :title="t('settings.mcp.emptyTitle')"
      :hint="t('settings.mcp.emptyHint')"
    />

    <div v-else class="settings-group">
      <div v-for="server in sorted" :key="server.name" class="catalog-row">
        <span class="catalog-main">
          <span class="catalog-name">
            {{ server.name }}
            <span class="catalog-transport">{{ transportLabel(server.config) }}</span>
          </span>
          <Tooltip :text="summaryText(server.config)">
            <span class="catalog-path">{{ summaryText(server.config) }}</span>
          </Tooltip>
          <Tooltip :text="server.origin">
            <span class="catalog-origin">{{ server.origin }}</span>
          </Tooltip>
        </span>
        <Badge :variant="server.mutable ? 'success' : 'neutral'" size="sm">
          {{ server.mutable ? t('settings.mcp.editable') : t('settings.mcp.readOnly') }}
        </Badge>
      </div>
    </div>
  </section>

  <Dialog
    :open="formOpen"
    :title="t('settings.mcp.createTitle')"
    :description="t('settings.mcp.createDesc')"
    size="lg"
    @update:open="formOpen = $event"
  >
    <div class="catalog-form">
      <SegmentedControl v-model="transport" :options="transportOptions" />
      <Field :label="t('settings.catalog.name')" :hint="t('settings.mcp.nameHint')">
        <Input v-model="form.name" placeholder="my-server" />
      </Field>
      <template v-if="transport === 'stdio'">
        <Field :label="t('settings.mcp.command')">
          <Input v-model="form.command" placeholder="npx" />
        </Field>
        <Field :label="t('settings.mcp.args')" :hint="t('settings.mcp.argsHint')">
          <Input v-model="form.args" placeholder="-y @modelcontextprotocol/server-filesystem /path" />
        </Field>
        <Field :label="t('settings.mcp.env')" :hint="t('settings.mcp.envHint')">
          <Textarea v-model="form.env" :rows="3" placeholder="API_KEY=…" />
        </Field>
      </template>
      <template v-else>
        <Field :label="t('settings.mcp.url')">
          <Input v-model="form.url" placeholder="https://example.com/mcp" />
        </Field>
        <Field :label="t('settings.mcp.headers')" :hint="t('settings.mcp.headersHint')">
          <Textarea v-model="form.headers" :rows="3" placeholder="Authorization=Bearer …" />
        </Field>
      </template>
      <p v-if="formError" class="catalog-errors" role="alert">{{ formError }}</p>
    </div>
    <template #foot>
      <Button variant="secondary" size="sm" @click="formOpen = false">{{ t('common.cancel') }}</Button>
      <Button variant="primary" size="sm" :loading="saving" @click="submitCreate">{{ t('settings.catalog.create') }}</Button>
    </template>
  </Dialog>
</template>

<style scoped>
.sec-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}
.sec-title {
  margin: 0;
  font-family: var(--font-ui);
  font-size: var(--text-base);
  font-weight: var(--weight-medium);
  color: var(--color-text);
}
.sec-desc {
  margin: var(--space-1) 0 0;
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  line-height: var(--leading-tight);
  color: var(--color-text-faint);
  max-width: 52ch;
}
.actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: none;
}
.actions :deep(.ui-button) {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}
.catalog-note {
  margin: 0 0 var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  border: 0.5px solid var(--color-line);
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
.settings-group {
  overflow: hidden;
  border-radius: var(--radius-xl);
  background: var(--color-surface);
}
.catalog-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-top: 0.5px solid var(--color-line);
}
.catalog-row:first-child {
  border-top: none;
}
.catalog-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.catalog-name {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  font-weight: var(--weight-option-label);
  color: var(--color-text);
}
.catalog-transport {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: 400;
  color: var(--color-text-faint);
}
.catalog-path {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.catalog-origin {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.catalog-loading {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-4);
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
.catalog-summary {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-bottom: var(--space-2);
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
.catalog-summary .is-error {
  color: var(--color-danger);
}
.catalog-note,
.catalog-errors {
  margin: 0 0 var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  border: 0.5px solid var(--color-line);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-danger);
  white-space: pre-wrap;
  word-break: break-word;
}
.catalog-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
</style>
