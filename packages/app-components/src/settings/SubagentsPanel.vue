<!-- Settings → Subagents: view every agent profile (subagent definition) the
     catalog can load — user, project, extra and plugin — create a user-level
     profile, import an agents ZIP and export all user profiles. -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { getOmnicodeWebApi, useOmnicodeWebClient } from '@hilbras/app-client/client';
import { Badge, Button, Dialog, EmptyState, Field, Icon, Input, Spinner, Textarea, Tooltip } from '@hilbras/app-ui';
import type { AppCatalogEntry } from '@hilbras/app-core/api';

import {
  emptyCreateInput,
  errorText,
  saveDownload,
  sourceTone,
  validateCreateInput,
} from './catalogManagement';

const { t } = useI18n();
const client = useOmnicodeWebClient();

const agents = ref<AppCatalogEntry[]>([]);
const loading = ref(true);
const error = ref('');
const summary = ref<{ imported: string[]; skipped: string[]; errors: string[] } | null>(null);
const importInput = ref<HTMLInputElement | null>(null);
const exporting = ref(false);

const formOpen = ref(false);
const saving = ref(false);
const formError = ref('');
const form = ref(emptyCreateInput());

const validationKeys = new Set(['name', 'description', 'content'].map((field) => t(`settings.catalog.invalid.${field}`)));
const generalFormError = computed(() => (validationKeys.has(formError.value) ? '' : formError.value));
const cwd = computed(() => client.visibleWorkspace.value?.root ?? undefined);
const sorted = computed(() =>
  [...agents.value].toSorted((a, b) => {
    const tone = (source: string): number => (source === 'user' ? 0 : source === 'project' ? 1 : 2);
    return tone(a.source) - tone(b.source) || a.name.localeCompare(b.name);
  }),
);

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    agents.value = await getOmnicodeWebApi().listCatalogAgents(cwd.value);
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
  form.value = emptyCreateInput();
  formError.value = '';
  formOpen.value = true;
}

async function submitCreate(): Promise<void> {
  const invalid = validateCreateInput(form.value);
  if (invalid !== undefined) {
    formError.value = t(`settings.catalog.invalid.${invalid}`);
    return;
  }
  saving.value = true;
  formError.value = '';
  try {
    const created = await getOmnicodeWebApi().createCatalogAgent({
      name: form.value.name.trim(),
      description: form.value.description.trim(),
      content: form.value.content,
      whenToUse: form.value.whenToUse?.trim() || undefined,
    });
    agents.value = [...agents.value, created];
    formOpen.value = false;
    void load();
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
    summary.value = await getOmnicodeWebApi().importCatalogAgents(file);
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
    saveDownload(await getOmnicodeWebApi().exportCatalogAgents());
  } catch (err) {
    error.value = errorText(err);
  } finally {
    exporting.value = false;
  }
}

function sourceLabel(source: string): string {
  const known = ['user', 'project', 'plugin', 'extra'];
  return known.includes(source) ? t(`settings.catalog.source.${source}`) : source;
}
</script>

<template>
  <section class="sec">
    <div class="sec-head">
      <div>
        <h3 class="sec-title">{{ t('settings.subagents.title') }}</h3>
        <p class="sec-desc">{{ t('settings.subagents.desc') }}</p>
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
          accept=".zip,application/zip"
          class="visually-hidden"
          :aria-label="t('settings.catalog.import')"
          @change="onImportFile"
        />
      </div>
    </div>

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
      :title="t('settings.subagents.emptyTitle')"
      :hint="t('settings.subagents.emptyHint')"
    />

    <div v-else class="settings-group">
      <div v-for="agent in sorted" :key="`${agent.source}:${agent.name}`" class="catalog-row">
        <span class="catalog-main">
          <span class="catalog-name">{{ agent.name }}</span>
          <span class="catalog-desc">{{ agent.description }}</span>
          <span v-if="agent.whenToUse" class="catalog-when">{{ t('settings.subagents.whenToUse') }}: {{ agent.whenToUse }}</span>
          <Tooltip v-if="agent.path" :text="agent.path">
            <span class="catalog-path">{{ agent.path }}</span>
          </Tooltip>
        </span>
        <Badge :variant="sourceTone(agent.source)" size="sm">{{ sourceLabel(agent.source) }}</Badge>
      </div>
    </div>
  </section>

  <Dialog
    :open="formOpen"
    :title="t('settings.subagents.createTitle')"
    :description="t('settings.subagents.createDesc')"
    size="lg"
    @update:open="formOpen = $event"
  >
    <div class="catalog-form">
      <Field :label="t('settings.catalog.name')" :hint="t('settings.catalog.agentNameHint')" :error="formError === t('settings.catalog.invalid.name') ? formError : ''">
        <Input v-model="form.name" :placeholder="t('settings.catalog.agentNamePlaceholder')" />
      </Field>
      <Field :label="t('settings.catalog.description')" :error="formError === t('settings.catalog.invalid.description') ? formError : ''">
        <Input v-model="form.description" :placeholder="t('settings.catalog.descriptionPlaceholder')" />
      </Field>
      <Field :label="t('settings.subagents.whenToUse')" :hint="t('settings.subagents.whenToUseHint')">
        <Input v-model="form.whenToUse" :placeholder="t('settings.subagents.whenToUsePlaceholder')" />
      </Field>
      <Field :label="t('settings.subagents.instructions')" :hint="t('settings.subagents.instructionsHint')" :error="formError === t('settings.catalog.invalid.content') ? formError : ''">
        <Textarea v-model="form.content" :rows="10" :placeholder="t('settings.subagents.instructionsPlaceholder')" />
      </Field>
      <p v-if="generalFormError" class="catalog-errors" role="alert">{{ generalFormError }}</p>
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
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  font-weight: var(--weight-option-label);
  color: var(--color-text);
}
.catalog-desc {
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.catalog-when {
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  color: var(--color-text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.catalog-path {
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
.catalog-form .catalog-errors,
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
