import type {
  AgentProfileSummary,
  OmnicodeHarness,
  Session,
  SkillSummary,
} from '@hilbras/omnicode-api';
import type { ProcessTerminal, TUI } from '@hilbras/omnicode-tui';

import {
  CatalogBrowserApp,
  type CatalogBrowserEntry,
  type CatalogBrowserProps,
} from '../components/dialogs/catalog-browser';
import type { CustomEditor } from '../components/editor/custom-editor';
import type { AppState } from '../types';
import {
  beginScreenTakeover,
  endScreenTakeover,
  type ScreenTakeover,
} from '../utils/screen-takeover';

export interface CatalogBrowserHost {
  readonly state: {
    readonly terminal: ProcessTerminal;
    readonly ui: TUI;
    readonly editor: CustomEditor;
    readonly appState: Pick<AppState, 'workDir'>;
    readonly skillsBrowser: CatalogBrowserState | undefined;
    readonly subagentsBrowser: CatalogBrowserState | undefined;
    readonly connectorsBrowser: CatalogBrowserState | undefined;
  };
  readonly harness: OmnicodeHarness;
  readonly session: Session | undefined;
  setSkillsBrowser(value: CatalogBrowserState | undefined): void;
  setSubagentsBrowser(value: CatalogBrowserState | undefined): void;
  setConnectorsBrowser(value: CatalogBrowserState | undefined): void;
}

export interface CatalogBrowserState {
  readonly component: CatalogBrowserApp;
  readonly takeover: ScreenTakeover;
  readonly entries: readonly CatalogBrowserEntry[];
  readonly error: string | undefined;
}

/**
 * Read-only skills catalog. Lists the session's skills once a session exists,
 * and the workspace catalog before the (lazily created) first session — the
 * same split `refreshSkillCommands` uses.
 */
export class SkillsBrowserController {
  private loading = false;
  private cancelled = false;

  constructor(private readonly host: CatalogBrowserHost) {}

  async show(): Promise<void> {
    if (this.loading || this.host.state.skillsBrowser !== undefined) return;
    this.loading = true;
    this.cancelled = false;
    try {
      const session = this.host.session;
      const skills =
        session !== undefined
          ? await session.listSkills()
          : await this.host.harness.listWorkspaceSkills(this.host.state.appState.workDir);
      if (this.cancelled) return;
      this.open(skillEntries(skills), undefined);
    } catch (error) {
      if (this.cancelled) return;
      this.open([], `Failed to load skills: ${errorMessage(error)}`);
    } finally {
      this.loading = false;
    }
  }

  close(): void {
    this.cancelled = true;
    closeCatalogBrowser(
      this.host,
      this.host.state.skillsBrowser,
      this.host.setSkillsBrowser.bind(this.host),
    );
  }

  private open(entries: readonly CatalogBrowserEntry[], error: string | undefined): void {
    openCatalogBrowser(
      this.host,
      {
        title: 'Available Skills',
        emptyMessage: 'No skills available.',
        entries,
        error,
        onCancel: () => {
          this.close();
        },
      },
      this.host.setSkillsBrowser.bind(this.host),
    );
  }
}

/**
 * Read-only subagent catalog: the profile definitions configured for the
 * active workspace (project, user, plugin and explicit agent files).
 */
export class SubagentsBrowserController {
  private loading = false;
  private cancelled = false;

  constructor(private readonly host: CatalogBrowserHost) {}

  async show(): Promise<void> {
    if (this.loading || this.host.state.subagentsBrowser !== undefined) return;
    this.loading = true;
    this.cancelled = false;
    try {
      const profiles = await this.host.harness.listWorkspaceAgentProfiles(
        this.host.state.appState.workDir,
      );
      if (this.cancelled) return;
      this.open(profileEntries(profiles), undefined);
    } catch (error) {
      if (this.cancelled) return;
      this.open([], `Failed to load subagents: ${errorMessage(error)}`);
    } finally {
      this.loading = false;
    }
  }

  close(): void {
    this.cancelled = true;
    closeCatalogBrowser(
      this.host,
      this.host.state.subagentsBrowser,
      this.host.setSubagentsBrowser.bind(this.host),
    );
  }

  private open(entries: readonly CatalogBrowserEntry[], error: string | undefined): void {
    openCatalogBrowser(
      this.host,
      {
        title: 'Available Subagents',
        emptyMessage: 'No subagent profiles available.',
        entries,
        error,
        onCancel: () => {
          this.close();
        },
      },
      this.host.setSubagentsBrowser.bind(this.host),
    );
  }
}

export function openCatalogBrowser(
  host: CatalogBrowserHost,
  props: CatalogBrowserProps,
  setBrowser: (value: CatalogBrowserState | undefined) => void,
): CatalogBrowserApp {
  const component = new CatalogBrowserApp(props, host.state.terminal);
  const takeover = beginScreenTakeover(host.state.ui, component);
  setBrowser({
    component,
    takeover,
    entries: props.entries,
    error: props.error,
  });
  host.state.ui.setFocus(component);
  host.state.ui.requestRender(true);
  return component;
}

export function closeCatalogBrowser(
  host: CatalogBrowserHost,
  browser: CatalogBrowserState | undefined,
  setBrowser: (value: CatalogBrowserState | undefined) => void,
): void {
  if (browser === undefined) return;
  endScreenTakeover(host.state.ui, browser.takeover);
  setBrowser(undefined);
  host.state.ui.setFocus(host.state.editor);
  host.state.ui.requestRender(true);
}

function skillEntries(skills: readonly SkillSummary[]): CatalogBrowserEntry[] {
  return skills.map((skill) => ({ name: skill.name, detail: skill.description }));
}

function profileEntries(profiles: readonly AgentProfileSummary[]): CatalogBrowserEntry[] {
  return profiles.map((profile) => {
    const parts = [profile.description, profile.whenToUse].filter(
      (part): part is string => part !== undefined && part.length > 0,
    );
    return { name: profile.name, detail: parts.length > 0 ? parts.join(' · ') : undefined };
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
