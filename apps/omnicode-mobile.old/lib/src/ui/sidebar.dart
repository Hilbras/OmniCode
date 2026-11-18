import 'dart:async';

import 'package:material_ui/material_ui.dart';
import 'package:provider/provider.dart';

import '../api/sessions_api.dart';
import '../api/workspaces_api.dart';
import '../state/app_state.dart';
import '../theme/omni_palette.dart';
import '../theme/omni_theme.dart';
import '../theme/omni_widgets.dart';
import 'chat_screen.dart';
import 'history_screen.dart';
import 'library_screen.dart';

class OmniSidebar extends StatefulWidget {
  const OmniSidebar({super.key});

  @override
  State<OmniSidebar> createState() => _OmniSidebarState();
}

class _OmniSidebarState extends State<OmniSidebar> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        final AppState state = context.read<AppState>();
        unawaited(state.loadWorkspaces());
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final OmniPalette palette = omniPaletteOf(context);
    final AppState state = context.watch<AppState>();
    return Drawer(
      backgroundColor: palette.bg,
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
              child: Row(
                children: <Widget>[
                  const OmniBrandMark(size: 28),
                  const SizedBox(width: 8),
                  Text(
                    'Omnicode',
                    style: TextStyle(
                      fontFamily: OmniFont.activeSans,
                      fontSize: OmniType.button,
                      fontWeight: OmniType.semibold,
                      color: palette.text,
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: OmniStatusPill(
                label: state.connectionLabel,
                positive: state.isConnected,
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
              child: GoldButton(
                label: 'New chat',
                icon: Icons.add_comment_outlined,
                onPressed: state.isConnected ? () => unawaited(_newChat()) : null,
              ),
            ),
            Divider(height: 1, color: palette.line),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.symmetric(vertical: 8),
                children: <Widget>[
                  _sectionHeader(context, 'Omnicode'),
                  _navTile(
                    context,
                    icon: Icons.smart_toy_outlined,
                    label: 'Omnicode Bot',
                    onTap: () => _pickWorkspace(null),
                  ),
                  _navTile(
                    context,
                    icon: Icons.construction_outlined,
                    label: 'Build',
                    onTap: () => _openLibrary(LibraryTab.apps),
                  ),
                  _navTile(
                    context,
                    icon: Icons.psychology_outlined,
                    label: 'Your Agents',
                    onTap: () => _pickWorkspace(null),
                  ),
                  _navTile(
                    context,
                    icon: Icons.auto_fix_high_outlined,
                    label: 'Automations',
                    onTap: () => _pickWorkspace(null),
                  ),
                  _sectionHeader(context, 'Projects'),
                  _navTile(
                    context,
                    icon: Icons.folder_outlined,
                    label: 'Projects',
                    onTap: () => _pickWorkspace(null),
                  ),
                  _navTile(
                    context,
                    icon: Icons.link_outlined,
                    label: 'Connectors',
                    onTap: () => _pickWorkspace(null),
                  ),
                  _navTile(
                    context,
                    icon: Icons.folder_open_outlined,
                    label: 'Files',
                    onTap: () => _openLibrary(LibraryTab.files),
                  ),
                  Divider(height: 1, color: palette.line, indent: 16, endIndent: 16),
                  _sectionHeader(context, 'History'),
                  _navTile(
                    context,
                    icon: Icons.history_outlined,
                    label: 'Conversations',
                    onTap: () => _openHistory(),
                  ),
                  _navTile(
                    context,
                    icon: Icons.push_pin_outlined,
                    label: 'Pinned',
                    onTap: () => _pickWorkspace(null),
                  ),
                  Divider(height: 1, color: palette.line, indent: 16, endIndent: 16),
                  _navTile(
                    context,
                    icon: Icons.settings_outlined,
                    label: 'Settings',
                    onTap: () => _pickWorkspace(null),
                  ),
                ],
              ),
            ),
            Divider(height: 1, color: palette.line),
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: OmniThemeToggle(),
            ),
          ],
        ),
      ),
    );
  }

  Widget _sectionHeader(BuildContext context, String label) {
    final OmniPalette palette = omniPaletteOf(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: Text(
        label,
        style: TextStyle(
          fontFamily: OmniFont.activeMono,
          fontSize: OmniType.notice,
          fontWeight: OmniType.medium,
          color: palette.muted,
        ),
        overflow: TextOverflow.ellipsis,
      ),
    );
  }

  Widget _navTile(
    BuildContext context, {
    required IconData icon,
    required String label,
    required VoidCallback onTap,
  }) {
    final OmniPalette palette = omniPaletteOf(context);
    return ListTile(
      leading: Icon(icon, size: 18, color: palette.muted),
      title: Text(
        label,
        style: TextStyle(
          fontFamily: OmniFont.activeSans,
          fontSize: OmniType.button,
          fontWeight: OmniType.medium,
          color: palette.text,
        ),
      ),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16),
      dense: true,
      onTap: onTap,
    );
  }

  Future<void> _newChat() async {
    final AppState state = context.read<AppState>();
    final SessionRef? session = await state.createChat();
    final String? sessionId = session?.id;
    if (!mounted || sessionId == null) {
      return;
    }
    _closeAndPush(() => ChatScreen(sessionId: sessionId));
  }

  Future<void> _openHistory() async {
    final NavigatorState navigator = Navigator.of(context);
    if (navigator.canPop()) {
      navigator.pop();
    }
    unawaited(navigator.push<void>(MaterialPageRoute<void>(builder: (_) => const HistoryScreen())));
  }

  Future<void> _openLibrary(LibraryTab initialTab) async {
    final NavigatorState navigator = Navigator.of(context);
    if (navigator.canPop()) {
      navigator.pop();
    }
    unawaited(navigator.push<void>(MaterialPageRoute<void>(builder: (_) => LibraryScreen(initialTab: initialTab))));
  }

  void _pickWorkspace(String? workspaceId) {
    context.read<AppState>().selectWorkspace(workspaceId);
    Navigator.of(context).pop();
  }

  void _closeAndPush(Widget Function() screen) {
    final NavigatorState navigator = Navigator.of(context);
    if (navigator.canPop()) {
      navigator.pop();
    }
    unawaited(navigator.push<void>(MaterialPageRoute<void>(builder: (_) => screen())));
  }
}
