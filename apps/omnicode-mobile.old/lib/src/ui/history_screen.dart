import 'dart:async';

import 'package:material_ui/material_ui.dart';
import 'package:provider/provider.dart';

import '../api/chat_api.dart';
import '../api/sessions_api.dart';
import '../state/app_state.dart';
import '../theme/omni_palette.dart';
import '../theme/omni_theme.dart';
import '../theme/omni_widgets.dart';
import 'chat_screen.dart';

class HistoryScreen extends StatefulWidget {
  const HistoryScreen({super.key});

  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen> {
  final TextEditingController _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final OmniPalette palette = omniPaletteOf(context);
    final AppState state = context.watch<AppState>();
    final List<SessionRef> sessions = state.visibleSessions;

    return Scaffold(
      appBar: OmniAppBar(
        title: 'Conversations',
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: Column(
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.all(16),
            child: OmniInput(
              controller: _searchController,
              hint: 'Search conversations',
              onChanged: (_) {},
            ),
          ),
          Divider(height: 1, color: palette.line),
          Expanded(
            child: sessions.isEmpty
                ? _emptyState(context, palette)
                : _sessionList(context, state, palette, sessions),
          ),
        ],
      ),
    );
  }

  Widget _emptyState(BuildContext context, OmniPalette palette) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(Icons.chat_bubble_outline, size: 64, color: palette.muted),
          const SizedBox(height: 16),
          Text(
            'No chat history available',
            style: TextStyle(
              fontFamily: OmniFont.activeSans,
              fontSize: OmniType.button,
              color: palette.text,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Start a new conversation with Omnicode to see it here.',
            style: TextStyle(
              fontFamily: OmniFont.activeSans,
              fontSize: OmniType.notice,
              color: palette.muted,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 24),
          GoldButton(
            label: 'New chat',
            icon: Icons.add_comment_outlined,
            onPressed: () {
              final AppState state = context.read<AppState>();
              unawaited(_newChatAndPop(context, state));
            },
          ),
        ],
      ),
    );
  }

  Widget _sessionList(BuildContext context, AppState state, OmniPalette palette, List<SessionRef> sessions) {
    final Map<String, List<SessionRef>> grouped = <String, List<SessionRef>>{};
    for (final SessionRef session in sessions) {
      final String key = _groupKey(session);
      grouped.putIfAbsent(key, () => <SessionRef>[]).add(session);
    }

    return ListView(
      padding: const EdgeInsets.symmetric(vertical: 8),
      children: <Widget>[
        for (final MapEntry<String, List<SessionRef>> entry in grouped.entries)
          _section(context, state, palette, entry.key, entry.value),
      ],
    );
  }

  String _groupKey(SessionRef session) {
    // In a real implementation, this would use session.createdAt
    // For now, group by workspace
    return session.workspaceId ?? 'Conversations';
  }

  Widget _section(BuildContext context, AppState state, OmniPalette palette, String title, List<SessionRef> sessions) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Text(
            title,
            style: TextStyle(
              fontFamily: OmniFont.activeMono,
              fontSize: OmniType.notice,
              fontWeight: OmniType.medium,
              color: palette.muted,
            ),
          ),
        ),
        for (final SessionRef session in sessions)
          _sessionTile(context, state, palette, session),
      ],
    );
  }

  Widget _sessionTile(BuildContext context, AppState state, OmniPalette palette, SessionRef session) {
    final String? sessionId = session.id;
    final String label = session.label;
    final bool isOpen = state.openSessionId == sessionId;

    return ListTile(
      leading: Icon(
        Icons.chat_bubble_outline,
        size: 16,
        color: isOpen ? palette.gold : palette.muted,
      ),
      title: Text(
        label,
        style: TextStyle(
          fontFamily: OmniFont.activeSans,
          fontSize: OmniType.button,
          color: isOpen ? palette.goldText : palette.text,
        ),
        overflow: TextOverflow.ellipsis,
      ),
      trailing: PopupMenuButton<String>(
        icon: Icon(Icons.more_vert, size: 18, color: palette.muted),
        onSelected: (String value) => _handleMenuAction(context, state, sessionId, value),
        itemBuilder: (BuildContext context) => <PopupMenuEntry<String>>[
          const PopupMenuItem<String>(
            value: 'rename',
            child: ListTile(leading: Icon(Icons.edit_outlined, size: 18), title: Text('Rename'), dense: true, contentPadding: EdgeInsets.zero),
          ),
          const PopupMenuItem<String>(
            value: 'pin',
            child: ListTile(leading: Icon(Icons.push_pin_outlined, size: 18), title: Text('Pin'), dense: true, contentPadding: EdgeInsets.zero),
          ),
          const PopupMenuItem<String>(
            value: 'delete',
            child: ListTile(leading: Icon(Icons.delete_outline, size: 18, color: Colors.red), title: Text('Delete', style: TextStyle(color: Colors.red)), dense: true, contentPadding: EdgeInsets.zero),
          ),
        ],
      ),
      selected: isOpen,
      selectedTileColor: palette.goldSoft,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16),
      dense: true,
      onTap: sessionId == null ? null : () => unawaited(_openChat(context, state, sessionId)),
    );
  }

  Future<void> _handleMenuAction(BuildContext context, AppState state, String? sessionId, String action) async {
    if (sessionId == null) return;
    switch (action) {
      case 'rename':
        _showRenameDialog(context, state, sessionId);
        break;
      case 'pin':
        // TODO: implement pin
        break;
      case 'delete':
        final bool confirm = await showDialog<bool>(
          context: context,
          builder: (BuildContext context) => AlertDialog(
            title: const Text('Delete conversation?'),
            content: const Text('This conversation will be deleted from your account. This action can\'t be undone.'),
            actions: <Widget>[
              TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
              TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Delete', style: TextStyle(color: Colors.red))),
            ],
          ),
        ) ?? false;
        if (confirm && context.mounted) {
          // TODO: implement delete
        }
        break;
    }
  }

  void _showRenameDialog(BuildContext context, AppState state, String sessionId) {
    final TextEditingController controller = TextEditingController();
    showDialog<void>(
      context: context,
      builder: (BuildContext context) => AlertDialog(
        title: const Text('Rename conversation'),
        content: TextField(controller: controller, autofocus: true, decoration: const InputDecoration(hintText: 'New title')),
        actions: <Widget>[
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          TextButton(
            onPressed: () {
              Navigator.pop(context);
              // TODO: implement rename API call
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }

  Future<void> _openChat(BuildContext context, AppState state, String sessionId) async {
    await state.openChat(sessionId);
    if (!context.mounted) return;
    Navigator.of(context).pop();
    unawaited(Navigator.of(context).push<void>(MaterialPageRoute<void>(builder: (_) => ChatScreen(sessionId: sessionId))));
  }

  Future<void> _newChatAndPop(BuildContext context, AppState state) async {
    final SessionRef? session = await state.createChat();
    final String? sessionId = session?.id;
    if (!context.mounted || sessionId == null) return;
    Navigator.of(context).pop();
    unawaited(Navigator.of(context).push<void>(MaterialPageRoute<void>(builder: (_) => ChatScreen(sessionId: sessionId))));
  }
}