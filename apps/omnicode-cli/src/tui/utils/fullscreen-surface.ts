/**
 * Whether any full-screen surface currently owns the terminal: an editor
 * replacement panel, a children/layout-root takeover browser, or the
 * suspended-for-external-editor state. Input routing belongs to whichever
 * surface is open — a component that mounts over it mounts invisibly (the
 * takeover swapped the root children) and ui.setFocus would steal keys from
 * the surface the user is actually navigating.
 */

import type { TUIState } from '../tui-state';

export function fullscreenSurfaceOpen(state: TUIState): boolean {
  return (
    state.editorReplacementMounted ||
    state.tasksBrowser !== undefined ||
    state.toolCallsBrowser !== undefined ||
    state.liveAgentsBrowser !== undefined ||
    state.skillsBrowser !== undefined ||
    state.subagentsBrowser !== undefined ||
    state.connectorsBrowser !== undefined ||
    state.updateRecommender !== undefined ||
    state.mcpManager !== undefined ||
    state.externalEditorRunning
  );
}
