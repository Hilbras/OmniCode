import 'dart:async';

import 'package:material_ui/material_ui.dart';
import 'package:provider/provider.dart';

import '../api/envelope.dart';
import '../api/sessions_api.dart';
import '../state/app_state.dart';
import '../theme/omni_palette.dart';
import '../theme/omni_theme.dart';
import '../theme/omni_widgets.dart';
import 'terminal_screen.dart';

class SessionsScreen extends StatefulWidget {
  const SessionsScreen({super.key});

  @override
  State<SessionsScreen> createState() => _SessionsScreenState();
}

class _SessionsScreenState extends State<SessionsScreen> {
  bool _requested = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || _requested) {
        return;
      }
      _requested = true;
      unawaited(context.read<AppState>().refreshSessions());
    });
  }

  @override
  Widget build(BuildContext context) {
    final AppState state = context.watch<AppState>();
    final String? error = state.errorMessage;
    final String? notice = state.notice;

    return Scaffold(
      appBar: OmniAppBar(
        title: 'Sessions',
        automaticallyImplyLeading: false,
        actions: <Widget>[
          Padding(
            padding: const EdgeInsets.only(right: 4),
            child: Center(
              child: OmniStatusPill(
                label: state.connectionLabel,
                positive: state.isConnected,
              ),
            ),
          ),
          PopupMenuButton<String>(
            tooltip: 'Connection',
            onSelected: (String value) => unawaited(_onMenuSelected(state, value)),
            itemBuilder: (BuildContext context) => const <PopupMenuEntry<String>>[
              PopupMenuItem<String>(
                value: 'refresh',
                child: Text('Refresh sessions'),
              ),
              PopupMenuItem<String>(
                value: 'reconnect',
                child: Text('Reconnect WebSocket'),
              ),
              PopupMenuItem<String>(
                value: 'disconnect',
                child: Text('Disconnect'),
              ),
            ],
          ),
          const OmniThemeToggle(),
        ],
      ),
      body: Column(
        children: <Widget>[
          if (error != null)
            OmniNotice(
              message: error,
              variant: OmniNoticeVariant.error,
              margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
              onDismiss: state.clearError,
            ),
          if (notice != null)
            OmniNotice(
              message: notice,
              margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
              onDismiss: state.clearNotice,
            ),
          Expanded(child: _buildContent(state)),
        ],
      ),
    );
  }

  Widget _buildContent(AppState state) {
    final List<SessionRef> sessions = state.sessions;
    if (state.isLoadingSessions && sessions.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    return RefreshIndicator(
      onRefresh: state.refreshSessions,
      child: sessions.isEmpty ? _buildEmpty(state) : _buildList(sessions),
    );
  }

  Widget _buildEmpty(AppState state) {
    final OmniPalette palette = omniPaletteOf(context);
    final String message = state.errorMessage ??
        state.notice ??
        'The daemon reported no sessions';
    return CustomScrollView(
      slivers: <Widget>[
        SliverFillRemaining(
          hasScrollBody: false,
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: OmniCard(
                padding: const EdgeInsets.fromLTRB(24, 24, 24, 20),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Icon(Icons.dns_outlined, size: 40, color: palette.muted),
                    const SizedBox(height: 12),
                    Text(message, textAlign: TextAlign.center),
                    const SizedBox(height: 16),
                    GoldButton(
                      label: 'Refresh',
                      icon: Icons.refresh,
                      onPressed: () => unawaited(state.refreshSessions()),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildList(List<SessionRef> sessions) {
    final ThemeData theme = Theme.of(context);
    final OmniPalette palette = omniPaletteOf(context);
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      itemCount: sessions.length,
      separatorBuilder: (BuildContext context, int index) =>
          const SizedBox(height: 10),
      itemBuilder: (BuildContext context, int index) {
        final SessionRef session = sessions[index];
        final String subtitle = _subtitleFor(session);
        return OmniCard(
          animateEntrance: false,
          padding: EdgeInsets.zero,
          onTap: () => _openSession(session),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 10, 12),
            child: Row(
              children: <Widget>[
                Icon(Icons.dns_outlined, size: 18, color: palette.muted),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        session.label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.titleSmall,
                      ),
                      if (subtitle.isNotEmpty)
                        Text(
                          subtitle,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: palette.muted,
                          ),
                        ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Icon(Icons.chevron_right, size: 18, color: palette.muted),
              ],
            ),
          ),
        );
      },
    );
  }

  String _subtitleFor(SessionRef session) {
    final List<String> parts = <String>[];
    final String? status = session.status;
    if (status != null) {
      parts.add(status);
    }
    final String? updated = session.updatedAt;
    if (updated != null) {
      parts.add(updated);
    }
    final String? id = session.id;
    if (id != null) {
      parts.add(id);
    }
    return parts.join(' · ');
  }

  Future<void> _openSession(SessionRef session) async {
    final NavigatorState navigator = Navigator.of(context);
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    final String? sessionId = session.id;
    if (sessionId == null) {
      messenger.showSnackBar(
        const SnackBar(
          content: Text(
            'This session has no id in the daemon response, so it cannot be '
            'opened',
          ),
        ),
      );
      return;
    }
    await navigator.push<void>(
      MaterialPageRoute<void>(
        builder: (BuildContext context) => SessionTerminalsScreen(
          sessionId: sessionId,
          title: session.label,
        ),
      ),
    );
  }

  Future<void> _onMenuSelected(AppState state, String value) async {
    switch (value) {
      case 'refresh':
        await state.refreshSessions();
      case 'reconnect':
        await state.reconnect();
      case 'disconnect':
        await state.disconnect();
    }
  }
}

class SessionTerminalsScreen extends StatefulWidget {
  const SessionTerminalsScreen({
    required this.sessionId,
    required this.title,
    super.key,
  });

  final String sessionId;
  final String title;

  @override
  State<SessionTerminalsScreen> createState() => _SessionTerminalsScreenState();
}

class _SessionTerminalsScreenState extends State<SessionTerminalsScreen> {
  List<TerminalInfo> _terminals = const <TerminalInfo>[];
  bool _loading = true;
  bool _creating = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        unawaited(_load());
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final String? error = _error;
    return Scaffold(
      appBar: OmniAppBar(
        title: widget.title,
        actions: const <Widget>[OmniThemeToggle()],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _creating || _loading ? null : _create,
        tooltip: 'Create terminal',
        child: const Icon(Icons.add),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: <Widget>[
                if (error != null)
                  OmniNotice(
                    message: error,
                    variant: OmniNoticeVariant.error,
                    margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                    onDismiss: () => setState(() => _error = null),
                  ),
                Expanded(
                  child: _terminals.isEmpty
                      ? _buildEmpty()
                      : RefreshIndicator(
                          onRefresh: _load,
                          child: _buildList(),
                        ),
                ),
              ],
            ),
    );
  }

  Widget _buildEmpty() {
    final OmniPalette palette = omniPaletteOf(context);
    return CustomScrollView(
      slivers: <Widget>[
        SliverFillRemaining(
          hasScrollBody: false,
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: OmniCard(
                padding: const EdgeInsets.fromLTRB(24, 24, 24, 20),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Icon(Icons.terminal, size: 40, color: palette.muted),
                    const SizedBox(height: 12),
                    const Text('This session has no terminals yet'),
                    const SizedBox(height: 16),
                    GoldButton(
                      label: 'Create terminal',
                      icon: Icons.add,
                      busy: _creating,
                      onPressed: _creating ? null : _create,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildList() {
    final ThemeData theme = Theme.of(context);
    final OmniPalette palette = omniPaletteOf(context);
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
      itemCount: _terminals.length,
      separatorBuilder: (BuildContext context, int index) =>
          const SizedBox(height: 10),
      itemBuilder: (BuildContext context, int index) {
        final TerminalInfo terminal = _terminals[index];
        final String? terminalId = terminal.id;
        final String? status = terminal.status;
        final String id = terminalId ?? '';
        final bool usable = terminalId != null;
        return OmniCard(
          animateEntrance: false,
          padding: EdgeInsets.zero,
          onTap: usable ? () => _open(id, terminal.label) : null,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(14, 10, 6, 10),
            child: Row(
              children: <Widget>[
                Icon(Icons.terminal, size: 18, color: palette.muted),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        terminal.label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.titleSmall,
                      ),
                      Text(
                        <String>[
                          'runtime ${terminal.runtimeId}',
                          ?status,
                        ].join(' · '),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: palette.muted,
                        ),
                      ),
                    ],
                  ),
                ),
                if (!usable)
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: Icon(Icons.block, size: 18, color: palette.bad),
                  )
                else
                  PopupMenuButton<String>(
                    tooltip: 'Terminal actions',
                    onSelected: (String value) {
                      if (value == 'open') {
                        _open(id, terminal.label);
                      } else if (value == 'close') {
                        unawaited(_close(id));
                      }
                    },
                    itemBuilder: (BuildContext context) =>
                        const <PopupMenuEntry<String>>[
                      PopupMenuItem<String>(value: 'open', child: Text('Attach')),
                      PopupMenuItem<String>(value: 'close', child: Text('Close')),
                    ],
                  ),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _load() async {
    if (!mounted) {
      return;
    }
    final AppState state = context.read<AppState>();
    setState(() {
      _loading = _terminals.isEmpty;
      _error = null;
    });
    try {
      final List<TerminalInfo> terminals =
          await state.loadTerminals(widget.sessionId);
      if (!mounted) {
        return;
      }
      setState(() {
        _terminals = terminals;
        _loading = false;
      });
    } on ApiFailure catch (failure) {
      if (!mounted) {
        return;
      }
      setState(() {
        _error = failure.describe();
        _loading = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _error = 'Loading terminals failed: $error';
        _loading = false;
      });
    }
  }

  Future<void> _create() async {
    final AppState state = context.read<AppState>();
    setState(() {
      _creating = true;
      _error = null;
    });
    try {
      final TerminalInfo created = await state.createTerminal(widget.sessionId);
      if (!mounted) {
        return;
      }
      setState(() => _creating = false);
      final String? terminalId = created.id;
      if (terminalId == null) {
        await _load();
        return;
      }
      _open(terminalId, created.label);
    } on ApiFailure catch (failure) {
      if (!mounted) {
        return;
      }
      setState(() {
        _creating = false;
        _error = failure.describe();
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _creating = false;
        _error = 'Creating a terminal failed: $error';
      });
    }
  }

  Future<void> _close(String terminalId) async {
    final AppState state = context.read<AppState>();
    try {
      await state.closeTerminal(widget.sessionId, terminalId);
      await _load();
    } on ApiFailure catch (failure) {
      if (!mounted) {
        return;
      }
      setState(() => _error = failure.describe());
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() => _error = 'Closing the terminal failed: $error');
    }
  }

  void _open(String terminalId, String label) {
    unawaited(
      Navigator.of(context).push<void>(
        MaterialPageRoute<void>(
          builder: (BuildContext context) => TerminalScreen(
            sessionId: widget.sessionId,
            terminalId: terminalId,
            title: label,
          ),
        ),
      ),
    );
  }
}
