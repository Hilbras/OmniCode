import type { OmnicodeHarness } from '@hilbras/omnicode-api';
import type { ProcessTerminal, TUI } from '@hilbras/omnicode-tui';

import {
  readRegistryUpdateState,
  readUpdateDismissedState,
  writeUpdateDismissedState,
} from '#/cli/update/cache';
import { installCommandFor, installUpdate } from '#/cli/update/preflight';
import { CHANGELOG_URL } from '#/cli/update/prompt';
import {
  notesBetweenSections,
  parseChangelogSections,
  readChangelogFileIfPresent,
} from '#/cli/update/release-notes';
import { checkRegistryForUpdate, isUpdateAvailable } from '#/cli/update/registry-check';
import { detectInstallSource } from '#/cli/update/source';
import { type InstallSource } from '#/cli/update/types';
import { lt } from 'semver';
import { copyTextToClipboard } from '#/utils/clipboard/clipboard-text';
import { openUrl } from '#/utils/open-url';

import type { Theme } from '../theme';
import {
  UpdateRecommenderApp,
  type UpdateRecommenderProps,
} from '../components/dialogs/update-recommender';
import type { CustomEditor } from '../components/editor/custom-editor';
import type { AppState } from '../types';
import {
  beginScreenTakeover,
  endScreenTakeover,
  type ScreenTakeover,
} from '../utils/screen-takeover';

export interface UpdateRecommenderState {
  readonly component: UpdateRecommenderApp;
  readonly takeover: ScreenTakeover;
  readonly latestVersion: string;
}

export interface UpdateRecommenderHost {
  readonly state: {
    readonly updateRecommender: UpdateRecommenderState | undefined;
    readonly theme: Theme;
    readonly terminal: ProcessTerminal;
    readonly ui: TUI;
    readonly editor: CustomEditor;
    readonly appState: Pick<AppState, 'version'>;
  };
  readonly harness: OmnicodeHarness;
  showError(msg: string): void;
  setUpdateRecommender(value: UpdateRecommenderState | undefined): void;
}

/**
 * The `/update` command + the startup "update available" notice: check the
 * npm registry for a newer version, open the full-screen notes panel, and
 * run the install / dismiss actions. The panel is always reachable
 * (`show` re-checks the registry on demand); the startup notice only fires
 * when a check from this run or a previous one already found a newer
 * version and the user did not dismiss that exact version.
 */
export class UpdateRecommenderController {
  private loading = false;
  private installInFlight = false;
  private flashTimer: NodeJS.Timeout | undefined;

  constructor(private readonly host: UpdateRecommenderHost) {}

  /**
   * Startup-notice decision: true when a newer version is known (from this
   * run's background check or the persisted registry state) and the user
   * has not dismissed that version. Never blocks startup: all reads are
   * local, and a live re-check is skipped when the persisted state is
   * fresh enough (checked within the last hour).
   */
  async isUpdateNoticeWanted(): Promise<PromiseNotice> {
    const registry = await readRegistryUpdateState().catch(() => ({
      latest: '',
      checkedAt: '',
    }));
    if (registry.latest === '') return { wanted: false, latest: undefined };
    const dismissed = await readUpdateDismissedState().catch(() => ({
      version: '',
      dismissedAt: '',
    }));
    if (
      dismissed.version !== '' &&
      !(dismissed.version === registry.latest || lt(registry.latest, dismissed.version))
    ) {
      return { wanted: false, latest: undefined };
    }
    const current = this.host.state.appState.version;
    const ageMs = registry.checkedAt === '' ? Number.POSITIVE_INFINITY : Date.now() - Date.parse(registry.checkedAt);
    if (ageMs <= NOTICE_STATE_MAX_AGE_MS) {
      // The persisted state predates the running version whenever the user
      // already installed the advertised release; never re-notify for it.
      if (!isUpdateAvailable(current, registry.latest)) {
        return { wanted: false, latest: undefined };
      }
      return { wanted: true, latest: registry.latest };
    }
    const check = await checkRegistryForUpdate(current, undefined, 1_500).catch(() => null);
    if (check === null) return { wanted: true, latest: registry.latest };
    if (check.status === 'available') return { wanted: true, latest: check.latest };
    return { wanted: false, latest: undefined };
  }

  async show(): Promise<void> {
    if (this.loading || this.host.state.updateRecommender !== undefined) return;
    this.loading = true;
    try {
      const current = this.host.state.appState.version;
      const check = await checkRegistryForUpdate(current);
      if (check.status === 'error') {
        this.host.showError(`Update check failed: ${check.reason}`);
        return;
      }
      if (check.status === 'current') {
        await this.openPanel(current, current, '');
        return;
      }
      await this.openPanel(current, check.latest, check.latest);
    } catch (error) {
      this.host.showError(`Failed to open the update panel: ${errorMessage(error)}`);
    } finally {
      this.loading = false;
    }
  }

  close(): void {
    const state = this.host.state.updateRecommender;
    if (state === undefined) return;
    if (this.flashTimer !== undefined) {
      clearTimeout(this.flashTimer);
      this.flashTimer = undefined;
    }
    endScreenTakeover(this.host.state.ui, state.takeover);
    this.host.setUpdateRecommender(undefined);
    this.host.state.ui.setFocus(this.host.state.editor);
    this.host.state.ui.requestRender(true);
  }

  private async openPanel(
    currentVersion: string,
    latestVersion: string,
    installTarget: string,
  ): Promise<void> {
    const upToDate = installTarget === '';
    const source = upToDate
      ? undefined
      : await detectInstallSource().catch(() => 'unsupported' as InstallSource);
    const installCommand =
      upToDate || source === undefined || source === 'unsupported'
        ? ''
        : installCommandFor(source, installTarget, process.platform);

    const changelog = readChangelogFileIfPresent();
    let noteSections: UpdateRecommenderProps['noteSections'] = [];
    let omittedItems = 0;
    if (changelog !== undefined) {
      const parsed = parseChangelogSections(changelog);
      const between = notesBetweenSections(parsed, currentVersion, latestVersion);
      noteSections = between.sections;
      omittedItems = between.omittedItems;
    }

    const component = new UpdateRecommenderApp(
      this.propsFor({
        currentVersion,
        latestVersion,
        installSource: source ?? 'unsupported',
        installCommand,
        noteSections,
        omittedItems,
        changelogAvailable: changelog !== undefined,
        upToDate,
        installResult: undefined,
        flashMessage: undefined,
      }),
      this.host.state.terminal,
    );

    const takeover = beginScreenTakeover(this.host.state.ui, component);
    this.host.state.ui.setFocus(component);
    this.host.state.ui.requestRender(true);
    this.host.setUpdateRecommender({ component, takeover, latestVersion });
  }

  private propsFor(patch: Partial<UpdateRecommenderProps>): UpdateRecommenderProps {
    const open = this.host.state.updateRecommender;
    if (open !== undefined) {
      const base = open.component.currentProps();
      return { ...base, ...patch } as UpdateRecommenderProps;
    }
    return patch as unknown as UpdateRecommenderProps;
  }

  private async handleInstall(target: string): Promise<void> {
    if (this.installInFlight) return;
    this.installInFlight = true;
    this.pushProps({
      flashMessage: `Installing ${target}…`,
      installResult: undefined,
    });
    let result: { ok: boolean; detail?: string };
    const source = await detectInstallSource().catch(() => 'unsupported' as InstallSource);
    if (source === 'unsupported') {
      result = {
        ok: false,
        detail: `Could not detect how this installation was made; run ${installCommandFor('npm-global', target, process.platform)} manually.`,
      };
    } else {
      try {
        await installUpdate(source, target, process.platform);
        result = { ok: true };
      } catch (error) {
        result = { ok: false, detail: errorMessage(error) };
      }
    }
    this.installInFlight = false;
    this.pushProps({
      flashMessage: undefined,
      installResult: result,
    });
  }

  private handleCopyCommand(command: string): void {
    void copyTextToClipboard(command).then((method) => {
      this.pushProps({
        flashMessage:
          method === 'native'
            ? 'Install command copied to the clipboard.'
            : 'Install command sent to the terminal clipboard (OSC 52).',
      });
    }, () => {
      this.pushProps({ flashMessage: 'Clipboard unavailable — copy the command manually.' });
    });
  }

  private handleDismiss(target: string): void {
    if (target !== '') {
      void writeUpdateDismissedState({
        version: target,
        dismissedAt: new Date().toISOString(),
      }).catch(() => {});
    }
    this.close();
  }

  private pushProps(patch: Partial<UpdateRecommenderProps>): void {
    const open = this.host.state.updateRecommender;
    if (open === undefined) return;
    if (this.flashTimer !== undefined) clearTimeout(this.flashTimer);
    const base = open.component.currentProps();
    const next = { ...base, ...patch };
    open.component.setProps({ ...next, ...this.buildCallbacks() });
    this.host.state.ui.requestRender();
    if (patch.flashMessage !== undefined && patch.flashMessage !== null) {
      this.flashTimer = setTimeout(() => {
        this.flashTimer = undefined;
        const current = this.host.state.updateRecommender;
        if (current === undefined) return;
        const fresh = current.component.currentProps();
        current.component.setProps({
          ...fresh,
          flashMessage: undefined,
          ...this.buildCallbacks(),
        });
        this.host.state.ui.requestRender();
      }, 4_000);
    }
  }

  private buildCallbacks(): Pick<
    UpdateRecommenderProps,
    'onInstall' | 'onCopyCommand' | 'onOpenChangelog' | 'onDismiss' | 'onCancel'
  > {
    return {
      onInstall: () => {
        const open = this.host.state.updateRecommender;
        if (open === undefined || open.latestVersion === '') return;
        void this.handleInstall(open.latestVersion);
      },
      onCopyCommand: () => {
        const open = this.host.state.updateRecommender;
        if (open === undefined) return;
        const command = open.component.currentProps().installCommand;
        if (command === '') return;
        this.handleCopyCommand(command);
      },
      onOpenChangelog: () => {
        openUrl(CHANGELOG_URL, (error) => {
          this.host.showError(`Could not open the changelog: ${error.message}`);
        });
      },
      onDismiss: () => {
        const open = this.host.state.updateRecommender;
        this.handleDismiss(open?.latestVersion ?? '');
      },
      onCancel: () => {
        this.close();
      },
    };
  }
}

interface PromiseNotice {
  readonly wanted: boolean;
  readonly latest: string | undefined;
}

const NOTICE_STATE_MAX_AGE_MS = 60 * 60 * 1_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
