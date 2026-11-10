import { release as osRelease, type as osType } from 'node:os';

import type { SessionStatus, SessionUsage } from '@hilbras/omnicode-api';

import { openUrl } from '#/utils/open-url';
import { quotaUsageRows } from '#/utils/usage/usage-format';

import { submitFeedbackWithAttachments } from '../../feedback/feedback-attachments';
import { buildStatusReportLines } from '../components/messages/status-panel';
import {
  buildUsageReportLines,
  UsagePanelComponent,
  type ManagedUsageReport,
} from '../components/messages/usage-panel';
import {
  FEEDBACK_ISSUE_URL,
  FEEDBACK_STATUS_CANCELLED,
  FEEDBACK_STATUS_FALLBACK,
  FEEDBACK_STATUS_NETWORK_ERROR,
  FEEDBACK_STATUS_NOT_SIGNED_IN,
  FEEDBACK_STATUS_SUBMITTING,
  FEEDBACK_STATUS_SUCCESS,
  FEEDBACK_STATUS_UPLOAD_FAILED,
  FEEDBACK_TELEMETRY_EVENT,
  feedbackIdLine,
  feedbackSessionLine,
  omnicodeCodeSignupUrl,
  withFeedbackVersionPrefix,
} from '../constant/feedback';
import { DEFAULT_OAUTH_PROVIDER_NAME, isManagedUsageProvider } from '../constant/omnicode-tui';
import { formatErrorMessage } from '../utils/event-payload';
import type { SlashCommandHost } from './dispatch';
import { isExperimentalFlagEnabled } from './experimental-flags';
import { promptFeedbackAttachment, promptFeedbackInput } from './prompts';

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export async function handleFeedbackCommand(host: SlashCommandHost): Promise<void> {
  const fallback = (reason: string): void => {
    host.showStatus(reason);
    host.showStatus(FEEDBACK_ISSUE_URL);
    openUrl(FEEDBACK_ISSUE_URL);
  };

  // Gate on the OAuth token rather than the active model's provider: a
  // signed-in user running an API-key model can still submit feedback
  // through the authenticated channel.
  let signedIn = false;
  try {
    const status = await host.harness.auth.status(DEFAULT_OAUTH_PROVIDER_NAME);
    signedIn = status.providers.some(
      (provider) => provider.providerName === DEFAULT_OAUTH_PROVIDER_NAME && provider.hasToken,
    );
  } catch {
    // The sign-in state is unreadable — keep the feedback entry usable by
    // falling back to GitHub Issues instead of failing the command.
    fallback(FEEDBACK_STATUS_FALLBACK);
    return;
  }
  if (!signedIn) {
    host.showStatus(FEEDBACK_STATUS_NOT_SIGNED_IN);
    host.showStatus(omnicodeCodeSignupUrl());
    host.showStatus(FEEDBACK_ISSUE_URL);
    return;
  }

  // Stage 1: collect the free-form feedback text.
  const input = await promptFeedbackInput(host);
  if (input === undefined) {
    host.showStatus(FEEDBACK_STATUS_CANCELLED);
    return;
  }

  // Stage 2: ask whether to attach diagnostics (logs / codebase).
  const level = await promptFeedbackAttachment(host);
  if (level === undefined) {
    host.showStatus(FEEDBACK_STATUS_CANCELLED);
    return;
  }

  const version = withFeedbackVersionPrefix(host.state.appState.version);
  const spinner = host.showLoginProgressSpinner(FEEDBACK_STATUS_SUBMITTING);
  // Guarantee the spinner's underlying setInterval is always cleared, even when
  // submitFeedback throws — otherwise the interval (and its per-frame
  // requestRender) leaks for the rest of the session.
  let stopped = false;
  const stopSpinner = (opts: { ok: boolean; label: string }): void => {
    if (stopped) return;
    stopped = true;
    spinner.stop(opts);
  };
  try {
    const res = await host.harness.auth.submitFeedback({
      content: input.value,
      sessionId: host.state.appState.sessionId,
      version,
      os: `${osType()} ${osRelease()}`,
      model: host.state.appState.model.length > 0 ? host.state.appState.model : null,
    });

    if (res.kind !== 'ok') {
      stopSpinner({ ok: false, label: res.message });
      fallback(FEEDBACK_STATUS_FALLBACK);
      return;
    }

    // Stage 3: prepare and upload each requested attachment independently.
    // Attachment failures are non-fatal partial failures — the text feedback
    // already exists server-side — so a throw here degrades to the
    // partial-failure status, never to the GitHub fallback in the outer catch.
    let attachmentFailed = false;
    try {
      attachmentFailed = await submitFeedbackWithAttachments(host, res.feedbackId, level);
    } catch {
      attachmentFailed = true;
    }

    stopSpinner({ ok: true, label: FEEDBACK_STATUS_SUCCESS });
    host.showStatus(feedbackSessionLine(host.state.appState.sessionId));
    host.showStatus(feedbackIdLine(res.feedbackId));
    host.track(FEEDBACK_TELEMETRY_EVENT);
    if (attachmentFailed) {
      host.showStatus(FEEDBACK_STATUS_UPLOAD_FAILED);
    }
  } catch (error) {
    stopSpinner({ ok: false, label: FEEDBACK_STATUS_NETWORK_ERROR });
    fallback(FEEDBACK_STATUS_FALLBACK);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Info commands
// ---------------------------------------------------------------------------

interface SessionUsageResult {
  readonly usage?: SessionUsage;
  readonly error?: string;
}

interface RuntimeStatusResult {
  readonly status?: SessionStatus;
  readonly error?: string;
}

interface ManagedUsageResult {
  readonly usage?: ManagedUsageReport;
  readonly error?: string;
}

export async function showUsage(host: SlashCommandHost): Promise<void> {
  const sessionUsage = await loadSessionUsageReport(host);
  const managedUsage = await loadManagedUsageReport(host);
  const reportArgs = {
    sessionUsage: sessionUsage.usage,
    sessionUsageError: sessionUsage.error,
    contextUsage: host.state.appState.contextUsage,
    contextTokens: host.state.appState.contextTokens,
    maxContextTokens: host.state.appState.maxContextTokens,
    managedUsage: managedUsage?.usage,
    managedUsageError: managedUsage?.error,
  };
  const panel = new UsagePanelComponent(() => buildUsageReportLines(reportArgs), 'primary');
  host.state.transcriptContainer.addChild(panel);
  host.state.ui.requestRender();
}

export async function showStatusReport(host: SlashCommandHost): Promise<void> {
  const [runtimeStatus, managedUsage] = await Promise.all([
    loadRuntimeStatusReport(host),
    loadManagedUsageReport(host),
  ]);
  const appState = host.state.appState;
  const reportArgs = {
    version: appState.version,
    model: appState.model,
    workDir: appState.workDir,
    sessionId: appState.sessionId,
    sessionTitle: appState.sessionTitle,
    thinkingEffort: appState.thinkingEffort,
    permissionMode: appState.permissionMode,
    planMode: appState.planMode,
    towerMode: appState.towerMode,
    towerAvailable: isExperimentalFlagEnabled('tower'),
    contextUsage: appState.contextUsage,
    contextTokens: appState.contextTokens,
    maxContextTokens: appState.maxContextTokens,
    availableModels: appState.availableModels,
    status: runtimeStatus.status,
    statusError: runtimeStatus.error,
    managedUsage: managedUsage?.usage,
    managedUsageError: managedUsage?.error,
  };
  const panel = new UsagePanelComponent(
    () => buildStatusReportLines(reportArgs),
    'primary',
    ' Status ',
  );
  host.state.transcriptContainer.addChild(panel);
  host.state.ui.requestRender();
}

async function loadSessionUsageReport(host: SlashCommandHost): Promise<SessionUsageResult> {
  if (host.session === undefined) return {};
  try {
    return { usage: await host.session.getUsage() };
  } catch (error) {
    return { error: formatErrorMessage(error) };
  }
}

async function loadRuntimeStatusReport(host: SlashCommandHost): Promise<RuntimeStatusResult> {
  if (host.session === undefined) return {};
  try {
    return { status: await host.session.getStatus() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function loadManagedUsageReport(
  host: SlashCommandHost,
): Promise<ManagedUsageResult | undefined> {
  const alias = host.state.appState.model;
  const providerKey = host.state.appState.availableModels[alias]?.provider;
  if (!isManagedUsageProvider(providerKey)) return undefined;

  let res;
  try {
    res = await host.harness.auth.getManagedUsage(providerKey);
  } catch (error) {
    return { error: formatErrorMessage(error) };
  }
  if (res.kind === 'error') {
    return { error: res.message };
  }
  return { usage: { rows: quotaUsageRows(res.quota), extraUsage: res.quota.extraUsage } };
}
