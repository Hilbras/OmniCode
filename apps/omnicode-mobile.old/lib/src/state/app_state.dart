import 'dart:async';

import 'package:flutter/foundation.dart';

import '../api/api_client.dart';
import '../api/chat_api.dart';
import '../api/envelope.dart';
import '../api/sessions_api.dart';
import '../api/workspaces_api.dart';
import '../config/server_config.dart';
import '../config/settings_store.dart';
import '../ws/ws_client.dart';

WsClient defaultWsClientFactory(ServerConfig config) => WsClient(config: config);

class AppState extends ChangeNotifier {
  AppState({
    required SettingsStore settings,
    WsClientFactory wsClientFactory = defaultWsClientFactory,
  })  : _settings = settings,
        _wsClientFactory = wsClientFactory;

  final SettingsStore _settings;
  final WsClientFactory _wsClientFactory;
  final List<StreamSubscription<Object?>> _subscriptions =
      <StreamSubscription<Object?>>[];

  ServerConfig? _config;
  ApiClient? _api;
  WsClient? _ws;
  WsConnectionState _connectionState = WsConnectionState.disconnected;
  List<SessionRef> _sessionRefs = const <SessionRef>[];
  List<WorkspaceRef> _workspaces = const <WorkspaceRef>[];
  String? _selectedWorkspaceId;
  final Map<String, List<ChatMessage>> _messages = <String, List<ChatMessage>>{};
  final Set<String> _loadingMessages = <String>{};
  String? _openSessionId;
  Timer? _chatPollTimer;
  bool _sendingPrompt = false;
  String? _error;
  String? _notice;
  bool _busy = false;
  bool _loadingSessions = false;
  bool _disposed = false;

  ServerConfig? get config => _config;

  WsClient? get ws => _ws;

  SessionsApi? get sessionsApi {
    final api = _api;
    return api == null ? null : SessionsApi(api);
  }

  WsConnectionState get connectionState => _connectionState;

  bool get isServerReady => _ws != null && _api != null;

  bool get isConnected => _connectionState == WsConnectionState.connected;

  bool get isBusy => _busy;

  bool get isLoadingSessions => _loadingSessions;

  List<SessionRef> get sessions => _sessionRefs;

  List<SessionRef> get visibleSessions {
    final String? selected = _selectedWorkspaceId;
    if (selected == null) {
      return _sessionRefs;
    }
    return _sessionRefs
        .where((SessionRef session) => session.workspaceId == selected)
        .toList();
  }

  List<WorkspaceRef> get workspaces => _workspaces;

  String? get selectedWorkspaceId => _selectedWorkspaceId;

  String? get openSessionId => _openSessionId;

  bool get isSendingPrompt => _sendingPrompt;

  List<ChatMessage> messagesFor(String sessionId) =>
      _messages[sessionId] ?? const <ChatMessage>[];

  bool isLoadingMessages(String sessionId) =>
      _loadingMessages.contains(sessionId);

  String? get errorMessage => _error;

  String? get notice => _notice;

  String get connectionLabel => switch (_connectionState) {
        WsConnectionState.connected => 'connected',
        WsConnectionState.connecting => 'connecting',
        WsConnectionState.awaitingServerHello => 'waiting for server_hello',
        WsConnectionState.handshaking => 'handshaking',
        WsConnectionState.reconnecting => 'reconnecting',
        WsConnectionState.failed => 'failed',
        WsConnectionState.disconnected => 'disconnected',
      };

  Future<void> loadSaved() async {
    try {
      final saved = await _settings.load();
      if (saved != null) {
        _config = saved;
        _notice = 'Loaded ${saved.displayUrl}';
        _notify();
      }
    } on StorageFailure catch (failure) {
      _setError(failure.toString());
    }
  }

  Future<({ServerConfig? config, String? error})> probeHealth({
    required String baseUrl,
    required String token,
  }) async {
    final ServerConfig config;
    try {
      config = ServerConfig.parse(baseUrl: baseUrl, token: token);
    } on ServerConfigException catch (failure) {
      return (config: null, error: failure.message);
    }
    final client = ApiClient(config: config);
    try {
      await client.healthz();
      return (config: config, error: null);
    } on ApiFailure catch (failure) {
      return (config: config, error: failure.describe());
    } catch (error) {
      return (config: config, error: 'Health check failed: $error');
    } finally {
      client.close();
    }
  }

  Future<bool> connect({
    required String baseUrl,
    required String token,
  }) async {
    _busy = true;
    _error = null;
    _notice = null;
    _notify();

    final probe = await probeHealth(baseUrl: baseUrl, token: token);
    final config = probe.config;
    final probeError = probe.error;
    if (config == null || probeError != null) {
      _busy = false;
      _setError(probeError ?? 'The daemon URL is not usable');
      return false;
    }

    try {
      await _settings.save(config);
    } on StorageFailure catch (failure) {
      _error = failure.toString();
    }

    await _attachClient(config);
    _busy = false;
    _notify();
    return _connectionState == WsConnectionState.connected;
  }

  Future<void> reconnect() async {
    final ws = _ws;
    if (ws == null) {
      _setError('There is no daemon connection to restore');
      return;
    }
    _busy = true;
    _notify();
    await ws.connect();
    _connectionState = ws.state;
    _busy = false;
    _notify();
  }

  Future<void> disconnect() async {
    final display = _config?.displayUrl ?? 'the daemon';
    await _teardownConnection();
    _sessionRefs = const <SessionRef>[];
    _notice = 'Disconnected from $display';
    _notify();
  }

  Future<void> forgetServer() async {
    await disconnect();
    _config = null;
    try {
      await _settings.clear();
    } on StorageFailure catch (failure) {
      _setError(failure.toString());
    }
    _notify();
  }

  Future<void> refreshSessions({int pageSize = 50}) async {
    final api = _api;
    if (api == null) {
      _setError('No daemon connection is available to list sessions');
      return;
    }
    _loadingSessions = true;
    _error = null;
    _notify();
    try {
      final page = await SessionsApi(api).listSessions(pageSize: pageSize);
      _sessionRefs = page.items;
      if (page.items.isEmpty) {
        _notice = 'The daemon reported no sessions';
      }
    } on ApiFailure catch (failure) {
      _setError(failure.describe());
    } catch (error) {
      _setError('Listing sessions failed: $error');
    } finally {
      _loadingSessions = false;
      _notify();
    }
  }

  Future<SessionRef?> loadSessionDetail(String sessionId) async {
    final api = _requireApi();
    return api.sessionDetail(sessionId);
  }

  Future<void> loadWorkspaces() async {
    try {
      _workspaces = await WorkspacesApi(_requireClient()).listWorkspaces();
      _notify();
    } on ApiFailure catch (failure) {
      _setError(failure.describe());
    } catch (error) {
      _setError('Listing workspaces failed: $error');
    }
  }

  void selectWorkspace(String? workspaceId) {
    if (_selectedWorkspaceId == workspaceId) {
      return;
    }
    _selectedWorkspaceId = workspaceId;
    _notify();
  }

  Future<SessionRef?> createChat({String? title}) async {
    final api = _requireApi();
    try {
      final session = await api.createSession(
        title: title,
        workspaceId: _selectedWorkspaceId,
      );
      final sessionId = session.id;
      if (sessionId != null) {
        unawaited(refreshSessions());
        await openChat(sessionId);
      }
      return session;
    } on ApiFailure catch (failure) {
      _setError(failure.describe());
      return null;
    } catch (error) {
      _setError('Creating the session failed: $error');
      return null;
    }
  }

  Future<void> openChat(String sessionId) async {
    _openSessionId = sessionId;
    _notify();
    await loadMessages(sessionId);
    _chatPollTimer?.cancel();
    // The daemon streams session events over the socket but the client does
    // not decode turn events yet, so an open chat follows the daemon with a
    // bounded poll until the event stream carries message updates.
    _chatPollTimer = Timer.periodic(
      const Duration(milliseconds: 2500),
      (Timer timer) => unawaited(_pollOpenChat()),
    );
  }

  Future<void> closeChat() async {
    _chatPollTimer?.cancel();
    _chatPollTimer = null;
    if (_openSessionId == null) {
      return;
    }
    _openSessionId = null;
    _notify();
  }

  Future<void> loadMessages(String sessionId, {bool older = false}) async {
    if (_loadingMessages.contains(sessionId)) {
      return;
    }
    _loadingMessages.add(sessionId);
    _notify();
    try {
      String? beforeId;
      if (older) {
        final current = _messages[sessionId];
        final first = current == null || current.isEmpty
            ? null
            : current.first.id;
        beforeId = first;
      }
      final page = await ChatApi(_requireClient()).listMessages(
        sessionId,
        beforeId: beforeId,
        pageSize: 50,
      );
      final existing = _messages[sessionId] ?? const <ChatMessage>[];
      _messages[sessionId] = older
          ? <ChatMessage>[...page.items, ...existing]
          : page.items;
    } on ApiFailure catch (failure) {
      _setError(failure.describe());
    } catch (error) {
      _setError('Loading messages failed: $error');
    } finally {
      _loadingMessages.remove(sessionId);
      _notify();
    }
  }

  Future<bool> sendPrompt(String text) async {
    final trimmed = text.trim();
    final sessionId = _openSessionId;
    if (trimmed.isEmpty || sessionId == null || _sendingPrompt) {
      return false;
    }
    _requireApi();
    _sendingPrompt = true;
    _messages[sessionId] = <ChatMessage>[
      ..._messages[sessionId] ?? const <ChatMessage>[],
      ChatMessage(
        id: 'local-${DateTime.now().microsecondsSinceEpoch}',
        role: 'user',
        text: trimmed,
        toolCalls: const <String>[],
        createdAt: null,
      ),
    ];
    _notify();
    try {
      await ChatApi(_requireClient()).sendPrompt(sessionId, trimmed);
      await _pollOpenChat();
      return true;
    } on ApiFailure catch (failure) {
      _setError(failure.describe());
      _messages[sessionId] = _dropLocalMessages(
        _messages[sessionId] ?? const <ChatMessage>[],
      );
      _notify();
      return false;
    } catch (error) {
      _setError('Sending the prompt failed: $error');
      return false;
    } finally {
      _sendingPrompt = false;
      _notify();
    }
  }

  Future<void> _pollOpenChat() async {
    final api = _api;
    final sessionId = _openSessionId;
    if (api == null ||
        sessionId == null ||
        _connectionState != WsConnectionState.connected) {
      return;
    }
    try {
      final page = await ChatApi(_requireClient()).listMessages(sessionId, pageSize: 50);
      final existing = _messages[sessionId] ?? const <ChatMessage>[];
      if (_sameTail(existing, page.items)) {
        return;
      }
      _messages[sessionId] = page.items;
      _notify();
    } on ApiFailure {
      // Polling races the socket reconnect path; the failures stream already
      // surfaces transport problems, so a single missed poll stays quiet.
      return;
    } catch (error) {
      _setError('Refreshing the chat failed: $error');
    }
  }

  bool _sameTail(List<ChatMessage> current, List<ChatMessage> incoming) {
    if (current.length != incoming.length) {
      return false;
    }
    for (var i = 0; i < current.length; i++) {
      if (current[i].role != incoming[i].role ||
          current[i].text != incoming[i].text ||
          current[i].toolCalls.length != incoming[i].toolCalls.length) {
        return false;
      }
    }
    return true;
  }

  List<ChatMessage> _dropLocalMessages(List<ChatMessage> messages) =>
      messages.where((message) => !message.id.startsWith('local-')).toList();

  Future<List<TerminalInfo>> loadTerminals(String sessionId) async {
    final api = _requireApi();
    return api.listTerminals(sessionId);
  }

  Future<TerminalInfo> createTerminal(String sessionId) async {
    final api = _requireApi();
    return api.createTerminal(sessionId);
  }

  Future<bool> closeTerminal(String sessionId, String terminalId) async {
    final api = _requireApi();
    return api.closeTerminal(sessionId, terminalId);
  }

  void clearError() {
    if (_error == null) {
      return;
    }
    _error = null;
    _notify();
  }

  void clearNotice() {
    if (_notice == null) {
      return;
    }
    _notice = null;
    _notify();
  }

  SessionsApi _requireApi() {
    final api = _api;
    if (api == null) {
      throw ApiFailure.client('No daemon connection is available');
    }
    return SessionsApi(api);
  }

  ApiClient _requireClient() {
    final api = _api;
    if (api == null) {
      throw ApiFailure.client('No daemon connection is available');
    }
    return api;
  }

  Future<void> _attachClient(ServerConfig config) async {
    await _teardownConnection();
    _config = config;
    _api = ApiClient(config: config);
    final ws = _wsClientFactory(config);
    _ws = ws;
    _connectionState = ws.state;
    _subscriptions.add(
      ws.connectionStates.listen((state) {
        _connectionState = state;
        _notify();
      }),
    );
    _subscriptions.add(ws.failures.listen(_onFailure));
    _subscriptions.add(
      ws.resyncRequired.listen((frame) {
        _notice = frame.describe();
        _notify();
      }),
    );
    await ws.connect();
    _connectionState = ws.state;
    if (_connectionState != WsConnectionState.connected) {
      _error = 'REST is reachable but the WebSocket is ${_connectionState.name}';
    }
    _notify();
  }

  void _onFailure(ApiFailure failure) {
    _error = failure.describe();
    if (failure.fatal) {
      _notice = 'The daemon closed this connection and marked the error fatal';
    }
    _notify();
  }

  Future<void> _teardownConnection() async {
    _chatPollTimer?.cancel();
    _chatPollTimer = null;
    _openSessionId = null;
    final subscriptions =
        List<StreamSubscription<Object?>>.from(_subscriptions);
    _subscriptions.clear();
    for (final subscription in subscriptions) {
      await subscription.cancel();
    }
    final ws = _ws;
    _ws = null;
    if (ws != null) {
      await ws.dispose();
    }
    final api = _api;
    _api = null;
    if (api != null) {
      api.close();
    }
    _connectionState = WsConnectionState.disconnected;
  }

  void _setError(String message) {
    _error = message;
    _notify();
  }

  void _notify() {
    if (!_disposed) {
      notifyListeners();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _chatPollTimer?.cancel();
    unawaited(_teardownConnection());
    super.dispose();
  }
}
