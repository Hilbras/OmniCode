import 'dart:async';

import 'package:material_ui/material_ui.dart';
import 'package:provider/provider.dart';
import 'package:xterm/xterm.dart';

import '../state/app_state.dart';
import '../terminal/terminal_controller.dart';
import '../theme/omni_palette.dart';
import '../theme/omni_theme.dart';
import '../theme/omni_widgets.dart';
import '../ws/terminal_channel.dart';
import '../ws/ws_client.dart';

class TerminalScreen extends StatefulWidget {
  const TerminalScreen({
    required this.sessionId,
    required this.terminalId,
    this.title,
    super.key,
  });

  final String sessionId;
  final String terminalId;
  final String? title;

  @override
  State<TerminalScreen> createState() => _TerminalScreenState();
}

class _TerminalScreenState extends State<TerminalScreen> {
  // `TerminalView` insets its own grid by `padding`, so the size reported to
  // the PTY has to be measured on the inset box or cols/rows overrun the grid.
  static const EdgeInsets _viewportPadding = EdgeInsets.fromLTRB(6, 4, 6, 0);

  OmniTerminalController? _controller;
  String? _setupError;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        unawaited(_setup());
      }
    });
  }

  @override
  void dispose() {
    final OmniTerminalController? controller = _controller;
    if (controller != null) {
      controller.dispose();
      if (!controller.channel.hasExited) {
        unawaited(
          controller.channel.detach().catchError((Object error) {
            debugPrint('terminal_detach failed: $error');
          }),
        );
      }
      controller.channel.dispose();
    }
    super.dispose();
  }

  Future<void> _setup() async {
    final WsClient? ws = context.read<AppState>().ws;
    if (ws == null) {
      setState(() {
        _setupError = 'The WebSocket to the daemon is not connected';
      });
      return;
    }
    final TerminalChannel channel = TerminalChannel(
      client: ws,
      sessionId: widget.sessionId,
      terminalId: widget.terminalId,
    );
    final OmniTerminalController controller =
        OmniTerminalController(channel: channel, client: ws);
    setState(() {
      _controller = controller;
      _setupError = null;
    });
    await controller.attach();
  }

  @override
  Widget build(BuildContext context) {
    final String? setupError = _setupError;
    if (setupError != null) {
      final OmniPalette palette = omniPaletteOf(context);
      return Scaffold(
        appBar: OmniAppBar(title: _title),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: OmniCard(
              padding: const EdgeInsets.fromLTRB(24, 24, 24, 20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Icon(Icons.link_off, size: 40, color: palette.bad),
                  const SizedBox(height: 12),
                  Text(setupError, textAlign: TextAlign.center),
                  const SizedBox(height: 16),
                  GhostButton(
                    label: 'Try again',
                    icon: Icons.refresh,
                    onPressed: () => unawaited(_setup()),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    }

    final OmniTerminalController? controller = _controller;
    if (controller == null) {
      return Scaffold(
        appBar: OmniAppBar(title: _title),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    return AnimatedBuilder(
      animation: controller,
      builder: (BuildContext context, Widget? child) {
        return Scaffold(
          appBar: OmniAppBar(
            title: _title,
            bottom: PreferredSize(
              preferredSize: const Size.fromHeight(32),
              child: _StatusStrip(controller: controller),
            ),
            actions: <Widget>[
              Center(
                child: SecondaryButton(
                  label: 'Reconnect',
                  icon: Icons.refresh,
                  onPressed: () => unawaited(controller.reconnect()),
                ),
              ),
              PopupMenuButton<String>(
                tooltip: 'Terminal',
                onSelected: (String value) =>
                    unawaited(_onMenuSelected(controller, value)),
                itemBuilder: (BuildContext context) =>
                    const <PopupMenuEntry<String>>[
                  PopupMenuItem<String>(
                    value: 'close-terminal',
                    child: Text('Close terminal'),
                  ),
                  PopupMenuItem<String>(
                    value: 'detach',
                    child: Text('Detach and leave it running'),
                  ),
                  PopupMenuItem<String>(
                    value: 'disconnect',
                    child: Text('Disconnect from daemon'),
                  ),
                ],
              ),
              const OmniThemeToggle(),
            ],
          ),
          body: DecoratedBox(
            decoration: BoxDecoration(color: OmniTerminalTokens.background),
            child: Theme(
              data: OmniTheme.darkTheme,
              child: LayoutBuilder(
                builder: (BuildContext context, BoxConstraints constraints) {
                  WidgetsBinding.instance.addPostFrameCallback((_) {
                    if (mounted) {
                      controller.updateLayout(
                        constraints.maxWidth - _viewportPadding.horizontal,
                        constraints.maxHeight - _viewportPadding.vertical,
                      );
                    }
                  });
                  return TerminalView(
                    controller.terminal,
                    theme: OmniTerminalTokens.xtermTheme,
                    cursorType: TerminalCursorType.block,
                    padding: _viewportPadding,
                  );
                },
              ),
            ),
          ),
        );
      },
    );
  }

  String get _title => widget.title ?? widget.terminalId;

  Future<void> _onMenuSelected(
    OmniTerminalController controller,
    String value,
  ) async {
    final NavigatorState navigator = Navigator.of(context);
    switch (value) {
      case 'close-terminal':
        await _closeTerminal(controller, navigator);
      case 'detach':
        navigator.pop();
      case 'disconnect':
        await _disconnectFromDaemon(navigator);
    }
  }

  Future<void> _closeTerminal(
    OmniTerminalController controller,
    NavigatorState navigator,
  ) async {
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => OmniDialog(
        title: 'Close this terminal?',
        message:
            'The daemon terminates the process running in this terminal. '
            'It cannot be undone.',
        actions: <Widget>[
          GhostButton(
            label: 'Cancel',
            onPressed: () => Navigator.of(dialogContext).pop(false),
          ),
          DangerButton(
            label: 'Close terminal',
            onPressed: () => Navigator.of(dialogContext).pop(true),
          ),
        ],
      ),
    );
    if (confirmed != true) {
      return;
    }
    await controller.closeTerminal();
    messenger.showSnackBar(
      const SnackBar(content: Text('Terminal close requested')),
    );
    navigator.pop();
  }

  Future<void> _disconnectFromDaemon(NavigatorState navigator) async {
    final AppState state = context.read<AppState>();
    await state.disconnect();
    navigator.popUntil((route) => route.isFirst);
  }
}

class _StatusStrip extends StatelessWidget {
  const _StatusStrip({required this.controller});

  final OmniTerminalController controller;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final OmniPalette palette = omniPaletteOf(context);
    final int? exitCode = controller.exitCode;
    final bool connected =
        controller.connectionState == WsConnectionState.connected;
    final Color accent = connected ? palette.ok : palette.bad;
    final TextStyle? labelStyle =
        theme.textTheme.labelSmall?.copyWith(color: palette.muted);

    return SizedBox(
      height: 32,
      width: double.infinity,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12),
        child: Row(
          children: <Widget>[
            Icon(
              connected ? Icons.link : Icons.link_off,
              size: 14,
              color: accent,
            ),
            const SizedBox(width: 4),
            Text(
              controller.connectionLabel,
              style: theme.textTheme.labelSmall?.copyWith(color: accent),
            ),
            const SizedBox(width: 10),
            Text(controller.sizeLabel, style: labelStyle),
            if (exitCode != null) ...<Widget>[
              const SizedBox(width: 10),
              Text('exit $exitCode', style: labelStyle),
            ],
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                controller.status,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.end,
                style: labelStyle,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
