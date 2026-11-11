// packages/app-client/src/icons/icons.ts
// Single source of truth for both apps' renderer icons (design-system §02).
//
// Icons come from three collections, all bundled by unplugin-icons at build
// time — only the icons listed below end up in the production bundle:
//   - `~icons/omnicode/*` — Omnicode Design System icons (24×24 outlined,
//     fill="currentColor"), local SVGs under src/icons/omnicode/ (this package)
//     copied from the Omnicode design-system icon set and registered as a custom
//     collection via the vite-preset's iconsDir (both apps point it here).
//     Preferred whenever a Omnicode glyph
//     exists for the intent. A few glyphs are filed under their intent rather
//     than the upstream asset name (terminal.svg is the upstream "Code" glyph,
//     mail.svg its "Message" envelope, clock.svg "History", comment.svg backs
//     message, task.svg backs sparkles).
//     dark-mode.svg, add-conversation.svg, left-panel.svg and
//     left-panel-expand.svg are newer designer exports that intentionally
//     diverge from the set's originals — do not overwrite them on the next
//     sync from the icon set.
//   - `~icons/tabler/*` — Tabler Icons (https://tabler.io/icons, MIT); only
//     the right-panel toggle, which the Omnicode set does not cover.
//   - `~icons/ri/*` — Remix Icon (https://remixicon.com/, Apache-2.0) for the
//     remaining intents the Omnicode set does not cover yet.
// Each icon is imported twice: once as a Vue component (for <Icon name=... />)
// and once as a `?raw` SVG string (for iconSvg() in v-html contexts such as
// lib/toolMeta.ts).
//
// All collections share the 24x24 source grid and follow currentColor; the
// rendered size comes from the size token prop. Colour follows text.
//
// Two consumers share this registry:
//   - the <Icon> Vue component (components/ui/Icon.vue) for template use;
//   - iconSvg() below, for v-html contexts (e.g. the apps' lib/toolMeta.ts).

import type { Component } from 'vue';

// Components (Omnicode collection) ----------------------------------------------
import OmnicodeAdd from '~icons/omnicode/add';
import OmnicodeAddConversation from '~icons/omnicode/add-conversation';
import OmnicodeArchive from '~icons/omnicode/archive';
import OmnicodeArrowDown from '~icons/omnicode/arrow-down';
import OmnicodeArrowLeft from '~icons/omnicode/arrow-left';
import OmnicodeArrowRight from '~icons/omnicode/arrow-right';
import OmnicodeArrowUp from '~icons/omnicode/arrow-up';
import OmnicodeCheck from '~icons/omnicode/check';
import OmnicodeChevronDown from '~icons/omnicode/chevron-down';
import OmnicodeChevronRight from '~icons/omnicode/chevron-right';
import OmnicodeChevronUp from '~icons/omnicode/chevron-up';
import OmnicodeCircleCheck from '~icons/omnicode/circle-check';
import OmnicodeClock from '~icons/omnicode/clock';
import OmnicodeClose from '~icons/omnicode/close';
import OmnicodeCollapse from '~icons/omnicode/collapse';
import OmnicodeComment from '~icons/omnicode/comment';
import OmnicodeCopy from '~icons/omnicode/copy';
import OmnicodeDarkMode from '~icons/omnicode/dark-mode';
import OmnicodeDownload from '~icons/omnicode/download';
import OmnicodeEdit from '~icons/omnicode/edit';
import OmnicodeExpand from '~icons/omnicode/expand';
import OmnicodeFile from '~icons/omnicode/file';
import OmnicodeFileText from '~icons/omnicode/file-text';
import OmnicodeFolder from '~icons/omnicode/folder';
import OmnicodeFolderOpen from '~icons/omnicode/folder-open';
import OmnicodeGenTitle from '~icons/omnicode/gen-title';
import OmnicodeAddFolder from '~icons/omnicode/folder-plus';
import OmnicodeFollowSystem from '~icons/omnicode/follow-system';
import OmnicodeFullAccess from '~icons/omnicode/full-access';
import OmnicodeGlobe from '~icons/omnicode/globe';
import OmnicodeGrip from '~icons/omnicode/grip';
import OmnicodeHand from '~icons/omnicode/hand';
import OmnicodeHistogram from '~icons/omnicode/histogram';
import OmnicodeImage from '~icons/omnicode/image';
import OmnicodeImageFailed from '~icons/omnicode/image-failed';
import OmnicodeInfo from '~icons/omnicode/info';
import OmnicodeKeyboard from '~icons/omnicode/keyboard';
import OmnicodeLeftBar from '~icons/omnicode/left-panel';
import OmnicodeLeftPanelExpand from '~icons/omnicode/left-panel-expand';
import OmnicodeLightMode from '~icons/omnicode/light-mode';
import OmnicodeLink from '~icons/omnicode/link';
import OmnicodeList from '~icons/omnicode/list';
import OmnicodeMail from '~icons/omnicode/mail';
import OmnicodeMinus from '~icons/omnicode/minus';
import OmnicodeMicroscope from '~icons/omnicode/microscope';
import OmnicodeModel from '~icons/omnicode/model';
import OmnicodeMore from '~icons/omnicode/more';
import OmnicodeMusic from '~icons/omnicode/music';
import OmnicodePause from '~icons/omnicode/pause';
import OmnicodePencil from '~icons/omnicode/pencil';
import OmnicodePlay from '~icons/omnicode/play';
import OmnicodePower from '~icons/omnicode/power';
import OmnicodeQuestion from '~icons/omnicode/question';
import OmnicodeRobot from '~icons/omnicode/robot';
import OmnicodeSearch from '~icons/omnicode/search';
import OmnicodeSend from '~icons/omnicode/send';
import OmnicodeSetting from '~icons/omnicode/setting';
import OmnicodeShieldQuestion from '~icons/omnicode/shield-question';
import OmnicodeSignIn from '~icons/omnicode/sign-in';
import OmnicodeSignOut from '~icons/omnicode/sign-out';
import OmnicodeSliders from '~icons/omnicode/sliders';
import OmnicodeStop from '~icons/omnicode/stop';
import OmnicodeTarget from '~icons/omnicode/target';
import OmnicodeTask from '~icons/omnicode/task';
import OmnicodeTerminal from '~icons/omnicode/terminal';
import OmnicodeThinking from '~icons/omnicode/thinking';
import OmnicodeTodo from '~icons/omnicode/todo';
import OmnicodeTranslate from '~icons/omnicode/translate';
import OmnicodeTrash from '~icons/omnicode/trash';
import OmnicodeUndo from '~icons/omnicode/undo';
import OmnicodeUser from '~icons/omnicode/user';
import OmnicodeWarning from '~icons/omnicode/warning';

// Components (Tabler) ---------------------------------------------------------
import TablerAdjustmentsHorizontal from '~icons/tabler/adjustments-horizontal';
import TablerChevronLeft from '~icons/tabler/chevron-left';
import TablerCircleCheck from '~icons/tabler/circle-check';
import TablerCircleDashed from '~icons/tabler/circle-dashed';
import TablerDeviceDesktop from '~icons/tabler/device-desktop';
import TablerFlask from '~icons/tabler/flask';
import TablerSidebarRightCollapse from '~icons/tabler/layout-sidebar-right-collapse';
import TablerPaperclip from '~icons/tabler/paperclip';
import TablerTextWrap from '~icons/tabler/text-wrap';
import TablerTextWrapDisabled from '~icons/tabler/text-wrap-disabled';
import TablerListNumbers from '~icons/tabler/list-numbers';

// Components (Remix) ---------------------------------------------------------
import RiBracesLine from '~icons/ri/braces-line';
import RiCalendarCloseLine from '~icons/ri/calendar-close-line';
import RiCalendarScheduleLine from '~icons/ri/calendar-schedule-line';
import RiCalendarTodoLine from '~icons/ri/calendar-todo-line';
import RiCodeLine from '~icons/ri/code-line';
import RiEmotionLine from '~icons/ri/emotion-line';
import RiExternalLinkLine from '~icons/ri/external-link-line';
import RiEyeLine from '~icons/ri/eye-line';
import RiEyeOffLine from '~icons/ri/eye-off-line';
import RiFileAddLine from '~icons/ri/file-add-line';
import RiFlashlightLine from '~icons/ri/flashlight-line';
import RiSparklingLine from '~icons/ri/sparkling-line';
import RiFolderFill from '~icons/ri/folder-fill';
import RiGitForkLine from '~icons/ri/git-fork-line';
import RiGitPullRequestLine from '~icons/ri/git-pull-request-line';
import RiListSettingsLine from '~icons/ri/list-settings-line';
import RiNodeTree from '~icons/ri/node-tree';
import RiPushpinLine from '~icons/ri/pushpin-line';
import RiSortDesc from '~icons/ri/sort-desc';
import RiStarFill from '~icons/ri/star-fill';
import RiStarLine from '~icons/ri/star-line';
import RiToolsLine from '~icons/ri/tools-line';
import RiUnpinLine from '~icons/ri/unpin-line';

// Raw SVG strings (Omnicode collection) -----------------------------------------
import RawOmnicodeAdd from '~icons/omnicode/add?raw';
import RawOmnicodeAddConversation from '~icons/omnicode/add-conversation?raw';
import RawOmnicodeArchive from '~icons/omnicode/archive?raw';
import RawOmnicodeArrowDown from '~icons/omnicode/arrow-down?raw';
import RawOmnicodeArrowLeft from '~icons/omnicode/arrow-left?raw';
import RawOmnicodeArrowRight from '~icons/omnicode/arrow-right?raw';
import RawOmnicodeArrowUp from '~icons/omnicode/arrow-up?raw';
import RawOmnicodeCheck from '~icons/omnicode/check?raw';
import RawOmnicodeChevronDown from '~icons/omnicode/chevron-down?raw';
import RawOmnicodeChevronRight from '~icons/omnicode/chevron-right?raw';
import RawOmnicodeChevronUp from '~icons/omnicode/chevron-up?raw';
import RawOmnicodeCircleCheck from '~icons/omnicode/circle-check?raw';
import RawOmnicodeClock from '~icons/omnicode/clock?raw';
import RawOmnicodeClose from '~icons/omnicode/close?raw';
import RawOmnicodeCollapse from '~icons/omnicode/collapse?raw';
import RawOmnicodeComment from '~icons/omnicode/comment?raw';
import RawOmnicodeCopy from '~icons/omnicode/copy?raw';
import RawOmnicodeDarkMode from '~icons/omnicode/dark-mode?raw';
import RawOmnicodeDownload from '~icons/omnicode/download?raw';
import RawOmnicodeEdit from '~icons/omnicode/edit?raw';
import RawOmnicodeExpand from '~icons/omnicode/expand?raw';
import RawOmnicodeFile from '~icons/omnicode/file?raw';
import RawOmnicodeFileText from '~icons/omnicode/file-text?raw';
import RawOmnicodeFolder from '~icons/omnicode/folder?raw';
import RawOmnicodeFolderOpen from '~icons/omnicode/folder-open?raw';
import RawOmnicodeGenTitle from '~icons/omnicode/gen-title?raw';
import RawOmnicodeAddFolder from '~icons/omnicode/folder-plus?raw';
import RawOmnicodeFollowSystem from '~icons/omnicode/follow-system?raw';
import RawOmnicodeFullAccess from '~icons/omnicode/full-access?raw';
import RawOmnicodeGlobe from '~icons/omnicode/globe?raw';
import RawOmnicodeGrip from '~icons/omnicode/grip?raw';
import RawOmnicodeHand from '~icons/omnicode/hand?raw';
import RawOmnicodeHistogram from '~icons/omnicode/histogram?raw';
import RawOmnicodeImage from '~icons/omnicode/image?raw';
import RawOmnicodeImageFailed from '~icons/omnicode/image-failed?raw';
import RawOmnicodeInfo from '~icons/omnicode/info?raw';
import RawOmnicodeKeyboard from '~icons/omnicode/keyboard?raw';
import RawOmnicodeLeftBar from '~icons/omnicode/left-panel?raw';
import RawOmnicodeLeftPanelExpand from '~icons/omnicode/left-panel-expand?raw';
import RawOmnicodeLightMode from '~icons/omnicode/light-mode?raw';
import RawOmnicodeLink from '~icons/omnicode/link?raw';
import RawOmnicodeList from '~icons/omnicode/list?raw';
import RawOmnicodeMail from '~icons/omnicode/mail?raw';
import RawOmnicodeMinus from '~icons/omnicode/minus?raw';
import RawOmnicodeMicroscope from '~icons/omnicode/microscope?raw';
import RawOmnicodeModel from '~icons/omnicode/model?raw';
import RawOmnicodeMore from '~icons/omnicode/more?raw';
import RawOmnicodeMusic from '~icons/omnicode/music?raw';
import RawOmnicodePause from '~icons/omnicode/pause?raw';
import RawOmnicodePencil from '~icons/omnicode/pencil?raw';
import RawOmnicodePlay from '~icons/omnicode/play?raw';
import RawOmnicodePower from '~icons/omnicode/power?raw';
import RawOmnicodeQuestion from '~icons/omnicode/question?raw';
import RawOmnicodeRobot from '~icons/omnicode/robot?raw';
import RawOmnicodeSearch from '~icons/omnicode/search?raw';
import RawOmnicodeSend from '~icons/omnicode/send?raw';
import RawOmnicodeSetting from '~icons/omnicode/setting?raw';
import RawOmnicodeShieldQuestion from '~icons/omnicode/shield-question?raw';
import RawOmnicodeSignIn from '~icons/omnicode/sign-in?raw';
import RawOmnicodeSignOut from '~icons/omnicode/sign-out?raw';
import RawOmnicodeSliders from '~icons/omnicode/sliders?raw';
import RawOmnicodeStop from '~icons/omnicode/stop?raw';
import RawOmnicodeTarget from '~icons/omnicode/target?raw';
import RawOmnicodeTask from '~icons/omnicode/task?raw';
import RawOmnicodeTerminal from '~icons/omnicode/terminal?raw';
import RawOmnicodeThinking from '~icons/omnicode/thinking?raw';
import RawOmnicodeTodo from '~icons/omnicode/todo?raw';
import RawOmnicodeTranslate from '~icons/omnicode/translate?raw';
import RawOmnicodeTrash from '~icons/omnicode/trash?raw';
import RawOmnicodeUndo from '~icons/omnicode/undo?raw';
import RawOmnicodeUser from '~icons/omnicode/user?raw';
import RawOmnicodeWarning from '~icons/omnicode/warning?raw';

// Raw SVG strings (Tabler) ----------------------------------------------------
import RawTablerAdjustmentsHorizontal from '~icons/tabler/adjustments-horizontal?raw';
import RawTablerChevronLeft from '~icons/tabler/chevron-left?raw';
import RawTablerCircleCheck from '~icons/tabler/circle-check?raw';
import RawTablerCircleDashed from '~icons/tabler/circle-dashed?raw';
import RawTablerDeviceDesktop from '~icons/tabler/device-desktop?raw';
import RawTablerFlask from '~icons/tabler/flask?raw';
import RawTablerSidebarRightCollapse from '~icons/tabler/layout-sidebar-right-collapse?raw';
import RawTablerPaperclip from '~icons/tabler/paperclip?raw';
import RawTablerTextWrap from '~icons/tabler/text-wrap?raw';
import RawTablerTextWrapDisabled from '~icons/tabler/text-wrap-disabled?raw';
import RawTablerListNumbers from '~icons/tabler/list-numbers?raw';

// Raw SVG strings (Remix) ----------------------------------------------------
import RawBracesLine from '~icons/ri/braces-line?raw';
import RawCalendarCloseLine from '~icons/ri/calendar-close-line?raw';
import RawCalendarScheduleLine from '~icons/ri/calendar-schedule-line?raw';
import RawCalendarTodoLine from '~icons/ri/calendar-todo-line?raw';
import RawCodeLine from '~icons/ri/code-line?raw';
import RawEmotionLine from '~icons/ri/emotion-line?raw';
import RawExternalLinkLine from '~icons/ri/external-link-line?raw';
import RawEyeLine from '~icons/ri/eye-line?raw';
import RawEyeOffLine from '~icons/ri/eye-off-line?raw';
import RawFileAddLine from '~icons/ri/file-add-line?raw';
import RawFlashlightLine from '~icons/ri/flashlight-line?raw';
import RawSparklingLine from '~icons/ri/sparkling-line?raw';
import RawFolderFill from '~icons/ri/folder-fill?raw';
import RawGitForkLine from '~icons/ri/git-fork-line?raw';
import RawGitPullRequestLine from '~icons/ri/git-pull-request-line?raw';
import RawListSettingsLine from '~icons/ri/list-settings-line?raw';
import RawNodeTree from '~icons/ri/node-tree?raw';
import RawPushpinLine from '~icons/ri/pushpin-line?raw';
import RawSortDesc from '~icons/ri/sort-desc?raw';
import RawStarFill from '~icons/ri/star-fill?raw';
import RawStarLine from '~icons/ri/star-line?raw';
import RawToolsLine from '~icons/ri/tools-line?raw';
import RawUnpinLine from '~icons/ri/unpin-line?raw';

// Public types -------------------------------------------------------------
export type IconName =
  | 'plus'
  | 'chat-new'
  | 'calendar-close'
  | 'calendar-schedule'
  | 'calendar-todo'
  | 'close'
  | 'check'
  | 'circle-check'
  | 'state-open'
  | 'state-done'
  | 'archive'
  | 'search'
  | 'copy'
  | 'text-wrap'
  | 'text-wrap-disabled'
  | 'list-numbers'
  | 'link'
  | 'external-link'
  | 'download'
  | 'undo'
  | 'send'
  | 'image'
  | 'settings'
  | 'sliders'
  | 'light-mode'
  | 'dark-mode'
  | 'follow-system'
  | 'log-in'
  | 'log-out'
  | 'hand'
  | 'full-access'
  | 'shield-question'
  | 'chevron-down'
  | 'chevron-right'
  | 'chevron-left'
  | 'chevron-up'
  | 'arrow-up'
  | 'arrow-down'
  | 'arrow-right'
  | 'arrow-left'
  | 'minus'
  | 'microscope'
  | 'flask'
  | 'panel-collapse'
  | 'panel-collapse-right'
  | 'panel-expand'
  | 'expand'
  | 'collapse'
  | 'list'
  | 'list-settings'
  | 'tree-view'
  | 'sort'
  | 'grip'
  | 'session-admin'
  | 'folder'
  | 'folder-closed'
  | 'folder-plus'
  | 'folder-solid'
  | 'file'
  | 'file-text'
  | 'file-edit'
  | 'file-plus'
  | 'file-off'
  | 'attachment'
  | 'image-off'
  | 'eye'
  | 'eye-off'
  | 'code'
  | 'terminal'
  | 'device-desktop'
  | 'pencil'
  | 'tool'
  | 'glob'
  | 'globe'
  | 'translate'
  | 'check-list'
  | 'bolt'
  | 'keyboard'
  | 'trash'
  | 'git-fork'
  | 'git-pull-request'
  | 'message'
  | 'mail'
  | 'user'
  | 'info'
  | 'help-circle'
  | 'alert-triangle'
  | 'clock'
  | 'robot'
  | 'sparkles'
  | 'sparkling'
  | 'gen-title'
  | 'histogram'
  | 'music'
  | 'emoji'
  | 'target'
  | 'pause'
  | 'play'
  | 'power'
  | 'pin'
  | 'stop'
  | 'star'
  | 'star-outline'
  | 'unpin'
  | 'dots-horizontal'
  | 'model'
  | 'thinking';

export type IconSize = 'sm' | 'md' | 'lg';

export const SIZE_PX: Record<IconSize, number> = { sm: 14, md: 16, lg: 20 };

export interface IconEntry {
  /** Vue component that renders the icon (used by <Icon>). */
  component: Component;
  /** Raw `<svg>` string (used by iconSvg() in v-html contexts). */
  svg: string;
}

function entry(component: Component, svg: string): IconEntry {
  return { component, svg };
}

export const ICONS: Record<IconName, IconEntry> = {
  plus: entry(OmnicodeAdd, RawOmnicodeAdd),
  'chat-new': entry(OmnicodeAddConversation, RawOmnicodeAddConversation),
  'calendar-close': entry(RiCalendarCloseLine, RawCalendarCloseLine),
  'calendar-schedule': entry(RiCalendarScheduleLine, RawCalendarScheduleLine),
  'calendar-todo': entry(RiCalendarTodoLine, RawCalendarTodoLine),
  close: entry(OmnicodeClose, RawOmnicodeClose),
  check: entry(OmnicodeCheck, RawOmnicodeCheck),
  // Session-state glyphs for the status view's Open/Done row icons — both
  // from tabler's circle family so they share the same ring geometry and
  // optical size: open = dashed ring, done = solid ring with a check. (The
  // omnicode 'circle-check' is a full-bleed glyph reserved for dock/task states.)
  'circle-check': entry(OmnicodeCircleCheck, RawOmnicodeCircleCheck),
  'state-open': entry(TablerCircleDashed, RawTablerCircleDashed),
  'state-done': entry(TablerCircleCheck, RawTablerCircleCheck),
  archive: entry(OmnicodeArchive, RawOmnicodeArchive),
  search: entry(OmnicodeSearch, RawOmnicodeSearch),
  copy: entry(OmnicodeCopy, RawOmnicodeCopy),
  // Code-block word-wrap toggle (chat markdown code / diff bars). The Omnicode
  // set has no wrap glyph; tabler's text-wrap pair gives the two states.
  'text-wrap': entry(TablerTextWrap, RawTablerTextWrap),
  'text-wrap-disabled': entry(TablerTextWrapDisabled, RawTablerTextWrapDisabled),
  // Code-block line-numbers toggle (chat markdown code / diff bars) — same
  // tabler family as the wrap pair, single glyph + pressed state.
  'list-numbers': entry(TablerListNumbers, RawTablerListNumbers),
  link: entry(OmnicodeLink, RawOmnicodeLink),
  'external-link': entry(RiExternalLinkLine, RawExternalLinkLine),
  download: entry(OmnicodeDownload, RawOmnicodeDownload),
  undo: entry(OmnicodeUndo, RawOmnicodeUndo),
  send: entry(OmnicodeSend, RawOmnicodeSend),
  image: entry(OmnicodeImage, RawOmnicodeImage),
  settings: entry(OmnicodeSetting, RawOmnicodeSetting),
  sliders: entry(OmnicodeSliders, RawOmnicodeSliders),
  'light-mode': entry(OmnicodeLightMode, RawOmnicodeLightMode),
  'dark-mode': entry(OmnicodeDarkMode, RawOmnicodeDarkMode),
  'follow-system': entry(OmnicodeFollowSystem, RawOmnicodeFollowSystem),
  'log-in': entry(OmnicodeSignIn, RawOmnicodeSignIn),
  'log-out': entry(OmnicodeSignOut, RawOmnicodeSignOut),
  hand: entry(OmnicodeHand, RawOmnicodeHand),
  'full-access': entry(OmnicodeFullAccess, RawOmnicodeFullAccess),
  'shield-question': entry(OmnicodeShieldQuestion, RawOmnicodeShieldQuestion),
  'chevron-down': entry(OmnicodeChevronDown, RawOmnicodeChevronDown),
  'chevron-right': entry(OmnicodeChevronRight, RawOmnicodeChevronRight),
  // The Omnicode set has no left chevron (navigation never needed one before the
  // admin page's pager) — tabler's, same stroke family as the state glyphs.
  'chevron-left': entry(TablerChevronLeft, RawTablerChevronLeft),
  'chevron-up': entry(OmnicodeChevronUp, RawOmnicodeChevronUp),
  'arrow-up': entry(OmnicodeArrowUp, RawOmnicodeArrowUp),
  'arrow-down': entry(OmnicodeArrowDown, RawOmnicodeArrowDown),
  'arrow-right': entry(OmnicodeArrowRight, RawOmnicodeArrowRight),
  'arrow-left': entry(OmnicodeArrowLeft, RawOmnicodeArrowLeft),
  minus: entry(OmnicodeMinus, RawOmnicodeMinus),
  microscope: entry(OmnicodeMicroscope, RawOmnicodeMicroscope),
  // Settings → 实验室 (lab) tab glyph; the Omnicode set has no flask — tabler's,
  // same stroke family as the state glyphs.
  flask: entry(TablerFlask, RawTablerFlask),
  'panel-collapse': entry(OmnicodeLeftBar, RawOmnicodeLeftBar),
  'panel-collapse-right': entry(TablerSidebarRightCollapse, RawTablerSidebarRightCollapse),
  'panel-expand': entry(OmnicodeLeftPanelExpand, RawOmnicodeLeftPanelExpand),
  expand: entry(OmnicodeExpand, RawOmnicodeExpand),
  collapse: entry(OmnicodeCollapse, RawOmnicodeCollapse),
  list: entry(OmnicodeList, RawOmnicodeList),
  'list-settings': entry(RiListSettingsLine, RawListSettingsLine),
  'tree-view': entry(RiNodeTree, RawNodeTree),
  sort: entry(RiSortDesc, RawSortDesc),
  grip: entry(OmnicodeGrip, RawOmnicodeGrip),
  // Sidebar view-menu entry opening the session admin page (/admin/sessions).
  'session-admin': entry(TablerAdjustmentsHorizontal, RawTablerAdjustmentsHorizontal),
  folder: entry(OmnicodeFolderOpen, RawOmnicodeFolderOpen),
  'folder-closed': entry(OmnicodeFolder, RawOmnicodeFolder),
  'folder-plus': entry(OmnicodeAddFolder, RawOmnicodeAddFolder),
  'folder-solid': entry(RiFolderFill, RawFolderFill),
  file: entry(OmnicodeFile, RawOmnicodeFile),
  'file-text': entry(OmnicodeFileText, RawOmnicodeFileText),
  'file-edit': entry(OmnicodeEdit, RawOmnicodeEdit),
  'file-plus': entry(RiFileAddLine, RawFileAddLine),
  'file-off': entry(OmnicodeFile, RawOmnicodeFile),
  attachment: entry(TablerPaperclip, RawTablerPaperclip),
  'image-off': entry(OmnicodeImageFailed, RawOmnicodeImageFailed),
  eye: entry(RiEyeLine, RawEyeLine),
  'eye-off': entry(RiEyeOffLine, RawEyeOffLine),
  code: entry(RiCodeLine, RawCodeLine),
  terminal: entry(OmnicodeTerminal, RawOmnicodeTerminal),
  // rc device switcher rows; the Omnicode set has no monitor glyph — tabler's,
  // same stroke family as the state glyphs.
  'device-desktop': entry(TablerDeviceDesktop, RawTablerDeviceDesktop),
  pencil: entry(OmnicodePencil, RawOmnicodePencil),
  tool: entry(RiToolsLine, RawToolsLine),
  glob: entry(RiBracesLine, RawBracesLine),
  globe: entry(OmnicodeGlobe, RawOmnicodeGlobe),
  translate: entry(OmnicodeTranslate, RawOmnicodeTranslate),
  'check-list': entry(OmnicodeTodo, RawOmnicodeTodo),
  bolt: entry(RiFlashlightLine, RawFlashlightLine),
  sparkling: entry(RiSparklingLine, RawSparklingLine),
  keyboard: entry(OmnicodeKeyboard, RawOmnicodeKeyboard),
  trash: entry(OmnicodeTrash, RawOmnicodeTrash),
  'git-fork': entry(RiGitForkLine, RawGitForkLine),
  'git-pull-request': entry(RiGitPullRequestLine, RawGitPullRequestLine),
  message: entry(OmnicodeComment, RawOmnicodeComment),
  mail: entry(OmnicodeMail, RawOmnicodeMail),
  user: entry(OmnicodeUser, RawOmnicodeUser),
  info: entry(OmnicodeInfo, RawOmnicodeInfo),
  'help-circle': entry(OmnicodeQuestion, RawOmnicodeQuestion),
  'alert-triangle': entry(OmnicodeWarning, RawOmnicodeWarning),
  clock: entry(OmnicodeClock, RawOmnicodeClock),
  robot: entry(OmnicodeRobot, RawOmnicodeRobot),
  sparkles: entry(OmnicodeTask, RawOmnicodeTask),
  'gen-title': entry(OmnicodeGenTitle, RawOmnicodeGenTitle),
  histogram: entry(OmnicodeHistogram, RawOmnicodeHistogram),
  music: entry(OmnicodeMusic, RawOmnicodeMusic),
  emoji: entry(RiEmotionLine, RawEmotionLine),
  target: entry(OmnicodeTarget, RawOmnicodeTarget),
  pause: entry(OmnicodePause, RawOmnicodePause),
  play: entry(OmnicodePlay, RawOmnicodePlay),
  power: entry(OmnicodePower, RawOmnicodePower),
  pin: entry(RiPushpinLine, RawPushpinLine),
  stop: entry(OmnicodeStop, RawOmnicodeStop),
  star: entry(RiStarFill, RawStarFill),
  'star-outline': entry(RiStarLine, RawStarLine),
  unpin: entry(RiUnpinLine, RawUnpinLine),
  'dots-horizontal': entry(OmnicodeMore, RawOmnicodeMore),
  // The composer's collapsed model selector (icon-only pill) — a designer
  // export for that intent, not part of the upstream set.
  model: entry(OmnicodeModel, RawOmnicodeModel),
  thinking: entry(OmnicodeThinking, RawOmnicodeThinking),
};

export function getIcon(name: IconName): IconEntry {
  return ICONS[name];
}

function applySize(svg: string, px: number): string {
  return svg
    .replace(/<svg\b[^>]*>/, (tag) => tag.replace(/\s(?:width|height)="[^"]*"/g, ''))
    .replace(/^<svg\b/, `<svg class="kw-icon" width="${px}" height="${px}" aria-hidden="true"`);
}

/** Render an icon to a full <svg> string for v-html contexts. Mirrors <Icon>. */
export function iconSvg(name: IconName, size: IconSize = 'md'): string {
  const entry = ICONS[name];
  if (!entry) return '';
  return applySize(entry.svg, SIZE_PX[size]);
}

// ---------------------------------------------------------------------------
// catalog grouping — single source of truth for design-system §02 icon list
// ---------------------------------------------------------------------------

/** Display order + grouping for the design-system §02 icon catalog. */
export const ICON_GROUPS: ReadonlyArray<readonly [string, readonly IconName[]]> = [
  [
    'Actions',
    [
      'plus',
      'attachment',
      'chat-new',
      'close',
      'check',
      'search',
      'copy',
      'text-wrap',
      'text-wrap-disabled',
      'list-numbers',
      'link',
      'external-link',
      'download',
      'undo',
      'send',
      'image',
      'settings',
      'sliders',
      'log-in',
      'log-out',
      'eye',
      'eye-off',
    ],
  ],
  [
    'Navigation & layout',
    [
      'chevron-down',
      'chevron-right',
      'chevron-up',
      'arrow-up',
      'arrow-down',
      'arrow-right',
      'arrow-left',
      'minus',
      'panel-collapse',
      'panel-collapse-right',
      'panel-expand',
      'expand',
      'collapse',
      'list',
      'list-settings',
      'tree-view',
      'sort',
      'grip',
    ],
  ],
  [
    'Files & tools',
    [
      'folder',
      'folder-closed',
      'folder-plus',
      'folder-solid',
      'file',
      'file-text',
      'file-edit',
      'file-plus',
      'file-off',
      'image-off',
      'code',
      'terminal',
      'device-desktop',
      'pencil',
      'tool',
      'glob',
      'globe',
      'check-list',
      'bolt',
      'git-fork',
      'git-pull-request',
      'archive',
      'pin',
      'unpin',
      'target',
      'calendar-schedule',
      'calendar-todo',
      'calendar-close',
      'keyboard',
      'trash',
      'microscope',
      'flask',
    ],
  ],
  ['Communication', ['message', 'mail', 'user', 'robot', 'emoji', 'translate']],
  [
    'Status & media',
    [
      'info',
      'help-circle',
      'alert-triangle',
      'hand',
      'full-access',
      'shield-question',
      'clock',
      'histogram',
      'music',
      'sparkles',
      'sparkling',
      'gen-title',
      'pause',
      'play',
      'stop',
      'star',
      'star-outline',
      'dots-horizontal',
      'model',
      'thinking',
      'light-mode',
      'dark-mode',
      'follow-system',
    ],
  ],
];
