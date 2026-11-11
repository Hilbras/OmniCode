// @hilbras/app-components — product components shared by apps/web and the
// apps/desktop renderer. Source-only package: consumers' bundler transpiles
// these (`exports` points at ./src/*). Support modules (pure helpers,
// composables, assets) live alongside the components and are exported here.

import { defineAsyncComponent } from 'vue';

export { default as ErrorBoundary } from './ErrorBoundary.vue';
export const FilePreview = defineAsyncComponent(() => import('./FilePreview.vue'));
export { default as GlobalLoading } from './GlobalLoading.vue';
export { default as HighlightedCode } from './HighlightedCode.vue';
export { default as OmnicodeDoodle } from './OmnicodeDoodle.vue';
export { default as OmnicodeMascot } from './OmnicodeMascot.vue';
export { default as PinnedSessionList } from './PinnedSessionList.vue';
export { default as ResizeHandle } from './ResizeHandle.vue';
export { default as SessionEmojiPicker } from './SessionEmojiPicker.vue';
export { default as SessionRow } from './SessionRow.vue';
export const Terminal = defineAsyncComponent(() => import('./Terminal.vue'));
export { default as WarningToasts } from './WarningToasts.vue';
export { default as WorkspaceGroup } from './WorkspaceGroup.vue';
export { default as FilterSelect } from './admin/FilterSelect.vue';
export { default as MultiSelectMenu } from './admin/MultiSelectMenu.vue';
export { default as SessionAdminMenu } from './admin/SessionAdminMenu.vue';
export { default as SessionAdminPagination } from './admin/SessionAdminPagination.vue';
export const SessionAdminTable = defineAsyncComponent(() => import('./admin/SessionAdminTable.vue'));
export const ActivityNotice = defineAsyncComponent(() => import('./chat/ActivityNotice.vue'));
export const ActivityRun = defineAsyncComponent(() => import('./chat/ActivityRun.vue'));
export const AgentDetailPanel = defineAsyncComponent(() => import('./chat/AgentDetailPanel.vue'));
export const AuthMedia = defineAsyncComponent(() => import('./chat/AuthMedia.vue'));
export const ChatPane = defineAsyncComponent(() => import('./chat/ChatPane.vue'));
export { default as ConversationToc, type ConversationTocItem } from './chat/ConversationToc.vue';
export const CronNotice = defineAsyncComponent(() => import('./chat/CronNotice.vue'));
export const DiffView = defineAsyncComponent(() => import('./chat/DiffView.vue'));
export const MediaLightbox = defineAsyncComponent(() => import('./chat/MediaLightbox.vue'));
export const MediaThumb = defineAsyncComponent(() => import('./chat/MediaThumb.vue'));
export const MessageTime = defineAsyncComponent(() => import('./chat/MessageTime.vue'));
export const NotificationCard = defineAsyncComponent(() => import('./chat/NotificationCard.vue'));
export const OpenInMenu = defineAsyncComponent(() => import('./chat/OpenInMenu.vue'));
export const QuestionCard = defineAsyncComponent(() => import('./chat/QuestionCard.vue'));
export { default as SelectionActionBubble } from './chat/SelectionActionBubble.vue';
export { default as SideChatPanel } from './chat/SideChatPanel.vue';
export const StatusGlyph = defineAsyncComponent(() => import('./chat/StatusGlyph.vue'));
export const StatusPanel = defineAsyncComponent(() => import('./chat/StatusPanel.vue'));
export const ThinkingBlock = defineAsyncComponent(() => import('./chat/ThinkingBlock.vue'));
export const ThinkingPanel = defineAsyncComponent(() => import('./chat/ThinkingPanel.vue'));
export const ToolCall = defineAsyncComponent(() => import('./chat/ToolCall.vue'));
export const TurnDiffPanel = defineAsyncComponent(() => import('./chat/TurnDiffPanel.vue'));
export const TurnFilesSummary = defineAsyncComponent(() => import('./chat/TurnFilesSummary.vue'));
export const TurnFold = defineAsyncComponent(() => import('./chat/TurnFold.vue'));
export const WorkingIndicator = defineAsyncComponent(() => import('./chat/WorkingIndicator.vue'));
export const FilterControl = defineAsyncComponent(() => import('./chat/dock/FilterControl.vue'));
export const GoalPanel = defineAsyncComponent(() => import('./chat/dock/GoalPanel.vue'));
export const PlanPanel = defineAsyncComponent(() => import('./chat/dock/PlanPanel.vue'));
export const SubagentGrid = defineAsyncComponent(() => import('./chat/dock/SubagentGrid.vue'));
export const TasksPane = defineAsyncComponent(() => import('./chat/dock/TasksPane.vue'));
export const TodoCard = defineAsyncComponent(() => import('./chat/dock/TodoCard.vue'));
export const WorkPanelHead = defineAsyncComponent(() => import('./chat/dock/WorkPanelHead.vue'));
export const WorkPill = defineAsyncComponent(() => import('./chat/dock/WorkPill.vue'));
export const AgentTool = defineAsyncComponent(() => import('./chat/tool-calls/AgentTool.vue'));
export const AskUserTool = defineAsyncComponent(() => import('./chat/tool-calls/AskUserTool.vue'));
export const BashTool = defineAsyncComponent(() => import('./chat/tool-calls/BashTool.vue'));
export const EditTool = defineAsyncComponent(() => import('./chat/tool-calls/EditTool.vue'));
export const GenericTool = defineAsyncComponent(() => import('./chat/tool-calls/GenericTool.vue'));
export const GlobTool = defineAsyncComponent(() => import('./chat/tool-calls/GlobTool.vue'));
export const GoalTool = defineAsyncComponent(() => import('./chat/tool-calls/GoalTool.vue'));
export const GrepTool = defineAsyncComponent(() => import('./chat/tool-calls/GrepTool.vue'));
export const MediaTool = defineAsyncComponent(() => import('./chat/tool-calls/MediaTool.vue'));
export const OutputPanel = defineAsyncComponent(() => import('./chat/tool-calls/OutputPanel.vue'));
export const PlanTool = defineAsyncComponent(() => import('./chat/tool-calls/PlanTool.vue'));
export const ReadTool = defineAsyncComponent(() => import('./chat/tool-calls/ReadTool.vue'));
export const SwarmTool = defineAsyncComponent(() => import('./chat/tool-calls/SwarmTool.vue'));
export const TodoTool = defineAsyncComponent(() => import('./chat/tool-calls/TodoTool.vue'));
export const ToolDisclosure = defineAsyncComponent(
  () => import('./chat/tool-calls/ToolDisclosure.vue'),
);
export const WaitForTool = defineAsyncComponent(() => import('./chat/tool-calls/WaitForTool.vue'));
export const WebFetchTool = defineAsyncComponent(
  () => import('./chat/tool-calls/WebFetchTool.vue'),
);
export const AddWorkspaceDialog = defineAsyncComponent(
  () => import('./dialogs/AddWorkspaceDialog.vue'),
);
export { default as BottomSheet } from './dialogs/BottomSheet.vue';
export { default as ConfirmDialog } from './dialogs/ConfirmDialog.vue';
export { default as ConfirmDialogHost } from './dialogs/ConfirmDialogHost.vue';
export const SearchSessionsDialog = defineAsyncComponent(
  () => import('./dialogs/SearchSessionsDialog.vue'),
);
export { default as MobileTopBar } from './mobile/MobileTopBar.vue';
export const AddProviderFlow = defineAsyncComponent(
  () => import('./settings/AddProviderFlow.vue'),
);
export const ModelPicker = defineAsyncComponent(() => import('./settings/ModelPicker.vue'));
export const PlanUpgradeCard = defineAsyncComponent(
  () => import('./settings/PlanUpgradeCard.vue'),
);
export const ProviderForm = defineAsyncComponent(() => import('./settings/ProviderForm.vue'));
export const ProvidersPanel = defineAsyncComponent(
  () => import('./settings/ProvidersPanel.vue'),
);
export const SecondaryModelPicker = defineAsyncComponent(
  () => import('./settings/SecondaryModelPicker.vue'),
);
export const SkillsPanel = defineAsyncComponent(() => import('./settings/SkillsPanel.vue'));
export const SubagentsPanel = defineAsyncComponent(
  () => import('./settings/SubagentsPanel.vue'),
);
export const McpServersPanel = defineAsyncComponent(
  () => import('./settings/McpServersPanel.vue'),
);

export * from './chatTurnRendering';
export * from './chat/tool-calls/toolArgs';
export * from './chat/tool-calls/askUserToolParse';
export * from './chat/tool-calls/toolRegistry';
export * from './admin/pageItems';
export * from './admin/formatAdminTime';
export * from './admin/adminBatchToast';
export * from './admin/useAnchoredMenu';
export * from './lib/toolMeta';
export * from './lib/activitySummary';
export * from './lib/openInTarget';
export { useDialogFocus } from './composables/useDialogFocus';
