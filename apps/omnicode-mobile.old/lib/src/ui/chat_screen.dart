import 'dart:async';

import 'package:material_ui/material_ui.dart';
import 'package:provider/provider.dart';

import '../api/chat_api.dart';
import '../state/app_state.dart';
import '../theme/omni_palette.dart';
import '../theme/omni_theme.dart';
import '../theme/omni_widgets.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({required this.sessionId, this.title, super.key});

  final String sessionId;
  final String? title;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final TextEditingController _composer = TextEditingController();
  final ScrollController _scroll = ScrollController();
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        final AppState state = context.read<AppState>();
        if (state.openSessionId != widget.sessionId) {
          unawaited(state.openChat(widget.sessionId));
        }
      }
    });
  }

  @override
  void dispose() {
    _composer.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) {
        return;
      }
      unawaited(
        _scroll.animateTo(
          _scroll.position.maxScrollExtent,
          duration: OmniMotion.interaction,
          curve: OmniMotion.ease,
        ),
      );
    });
  }

  Future<void> _send() async {
    final String text = _composer.text.trim();
    if (text.isEmpty || _sending) {
      return;
    }
    _composer.clear();
    setState(() => _sending = true);
    await context.read<AppState>().sendPrompt(text);
    if (mounted) {
      setState(() => _sending = false);
      _scrollToBottom();
    }
  }

  @override
  Widget build(BuildContext context) {
    final OmniPalette palette = omniPaletteOf(context);
    final AppState state = context.watch<AppState>();
    final List<ChatMessage> messages = state.messagesFor(widget.sessionId);
    final bool loading = state.isLoadingMessages(widget.sessionId);
    return Scaffold(
      backgroundColor: palette.bg,
      appBar: OmniAppBar(
        title: _titleOf(state),
        actions: <Widget>[
          OmniStatusPill(
            label: state.connectionLabel,
            positive: state.isConnected,
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: Column(
        children: <Widget>[
          Expanded(
            child: loading && messages.isEmpty
                ? Center(
                    child: CircularProgressIndicator(color: palette.gold),
                  )
                : _messageList(context, state, messages),
          ),
          SafeArea(
            top: false,
            child: _composerBar(context, state),
          ),
        ],
      ),
    );
  }

  String _titleOf(AppState state) {
    final String? provided = widget.title;
    if (provided != null && provided.trim().isNotEmpty) {
      return provided;
    }
    for (final session in state.sessions) {
      if (session.id == widget.sessionId) {
        return session.label;
      }
    }
    return 'Chat';
  }

  Widget _messageList(
    BuildContext context,
    AppState state,
    List<ChatMessage> messages,
  ) {
    if (messages.isEmpty) {
      return _emptyState(context);
    }
    WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToBottom());
    return ListView.builder(
      controller: _scroll,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      itemCount: messages.length,
      itemBuilder: (BuildContext context, int index) =>
          _bubble(context, messages[index]),
    );
  }

  Widget _emptyState(BuildContext context) {
    final OmniPalette palette = omniPaletteOf(context);
    return Center(
      child: OmniCard(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(Icons.forum_outlined, size: 28, color: palette.gold),
            const SizedBox(height: 8),
            Text(
              'Send the first message',
              style: TextStyle(
                fontFamily: OmniFont.activeSans,
                fontSize: OmniType.button,
                fontWeight: OmniType.medium,
                color: palette.muted,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _bubble(BuildContext context, ChatMessage message) {
    final OmniPalette palette = omniPaletteOf(context);
    final List<Widget> rows = <Widget>[];
    if (message.text.isNotEmpty) {
      rows.add(
        SelectableText(
          message.text,
          style: TextStyle(
            fontFamily: message.isAssistant ? OmniFont.activeMono : OmniFont.activeSans,
            fontSize: OmniType.input,
            height: 1.45,
            color: palette.text,
          ),
        ),
      );
    }
    for (final String tool in message.toolCalls) {
      rows.add(
        Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(Icons.build_outlined, size: 12, color: palette.gold),
              const SizedBox(width: 4),
              Text(
                tool,
                style: TextStyle(
                  fontFamily: OmniFont.activeMono,
                  fontSize: OmniType.notice,
                  color: palette.muted,
                ),
              ),
            ],
          ),
        ),
      );
    }
    if (rows.isEmpty) {
      rows.add(
        Text(
          message.role,
          style: TextStyle(
            fontFamily: OmniFont.activeSans,
            fontSize: OmniType.notice,
            color: palette.muted,
          ),
        ),
      );
    }
    final Alignment alignment =
        message.isUser ? Alignment.centerRight : Alignment.centerLeft;
    final Color background = message.isUser ? palette.goldSoft : palette.surface;
    final Color border = message.isUser ? palette.goldBorderHover : palette.line;
    return Align(
      alignment: alignment,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.sizeOf(context).width * 0.82,
        ),
        decoration: BoxDecoration(
          color: background,
          borderRadius: BorderRadius.circular(OmniRadius.primary),
          border: Border.all(color: border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: rows,
        ),
      ),
    );
  }

  Widget _composerBar(BuildContext context, AppState state) {
    final OmniPalette palette = omniPaletteOf(context);
    final bool connected = state.isConnected;
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
      decoration: BoxDecoration(
        color: palette.bg,
        border: Border(top: BorderSide(color: palette.line)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: <Widget>[
          Expanded(
            child: OmniInput(
              controller: _composer,
              hint: connected ? 'Message the agent' : 'Offline',
              keyboardType: TextInputType.multiline,
              textInputAction: TextInputAction.newline,
              onFieldSubmitted: (_) => unawaited(_send()),
            ),
          ),
          const SizedBox(width: 8),
          GoldButton(
            label: 'Send',
            icon: Icons.send_outlined,
            busy: _sending,
            onPressed: connected && !_sending ? () => unawaited(_send()) : null,
          ),
        ],
      ),
    );
  }
}
