import 'dart:async';

import 'package:flutter/foundation.dart';

import '../api/api_client.dart';
import '../api/envelope.dart';
import '../api/sessions_api.dart';
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
    unawaited(_teardownConnection());
    super.dispose();
  }
}
