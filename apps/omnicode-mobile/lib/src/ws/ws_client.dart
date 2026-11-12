import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import '../api/envelope.dart';
import '../config/server_config.dart';
import 'ws_protocol.dart';

enum WsConnectionState {
  disconnected,
  connecting,
  awaitingServerHello,
  handshaking,
  connected,
  reconnecting,
  failed,
}

class WsAck {
  const WsAck({
    required this.id,
    required this.code,
    required this.msg,
    required this.payload,
  });

  final String id;
  final int code;
  final String msg;
  final JsonObject payload;

  bool get isSuccess => code == ApiCodes.success;
}

typedef WsClientFactory = WsClient Function(ServerConfig config);

class WsClient {
  WsClient({
    required ServerConfig config,
    String? clientId,
    Duration handshakeTimeout = const Duration(seconds: 15),
    Duration ackTimeout = const Duration(seconds: 15),
    Duration initialReconnectDelay = const Duration(milliseconds: 500),
    Duration maxReconnectDelay = const Duration(seconds: 15),
    int heartbeatMultiplier = 3,
    Random? random,
  })  : _config = config,
        _clientId = clientId ?? _newClientId(random ?? Random()),
        _handshakeTimeout = handshakeTimeout,
        _ackTimeout = ackTimeout,
        _initialReconnectDelay = initialReconnectDelay,
        _maxReconnectDelay = maxReconnectDelay,
        _heartbeatMultiplier = heartbeatMultiplier,
        _random = random ?? Random();

  final ServerConfig _config;
  final String _clientId;
  final Duration _handshakeTimeout;
  final Duration _ackTimeout;
  final Duration _initialReconnectDelay;
  final Duration _maxReconnectDelay;
  final int _heartbeatMultiplier;
  final Random _random;

  final StreamController<WsConnectionState> _connectionController =
      StreamController<WsConnectionState>.broadcast();
  final StreamController<ApiFailure> _failureController =
      StreamController<ApiFailure>.broadcast();
  final StreamController<WsTerminalOutputFrame> _terminalOutputController =
      StreamController<WsTerminalOutputFrame>.broadcast();
  final StreamController<WsTerminalExitFrame> _terminalExitController =
      StreamController<WsTerminalExitFrame>.broadcast();
  final StreamController<WsSessionEventFrame> _sessionEventController =
      StreamController<WsSessionEventFrame>.broadcast();
  final StreamController<WsResyncRequiredFrame> _resyncController =
      StreamController<WsResyncRequiredFrame>.broadcast();
  final StreamController<WsUnknownFrame> _unknownFrameController =
      StreamController<WsUnknownFrame>.broadcast();
  final StreamController<void> _handshakeController =
      StreamController<void>.broadcast();

  final Map<String, Completer<WsAckFrame>> _pendingAcks =
      <String, Completer<WsAckFrame>>{};

  WebSocketChannel? _channel;
  StreamSubscription<Object?>? _subscription;
  Timer? _livenessTimer;
  Timer? _reconnectTimer;
  Completer<WsServerHelloFrame>? _helloCompleter;
  WsServerHelloFrame? _serverHello;

  WsConnectionState _state = WsConnectionState.disconnected;
  Duration _heartbeat =
      const Duration(milliseconds: WsProtocol.defaultHeartbeatMs);
  int _frameCounter = 0;
  int _reconnectAttempt = 0;
  bool _closing = false;
  bool _fatal = false;
  bool _reconnectScheduled = false;
  bool _disposed = false;

  String get clientId => _clientId;

  ServerConfig get config => _config;

  WsConnectionState get state => _state;

  int get reconnectAttempt => _reconnectAttempt;

  WsServerHelloFrame? get serverHello => _serverHello;

  Stream<WsConnectionState> get connectionStates => _connectionController.stream;

  Stream<ApiFailure> get failures => _failureController.stream;

  Stream<WsTerminalOutputFrame> get terminalOutput =>
      _terminalOutputController.stream;

  Stream<WsTerminalExitFrame> get terminalExits => _terminalExitController.stream;

  Stream<WsSessionEventFrame> get sessionEvents => _sessionEventController.stream;

  Stream<WsResyncRequiredFrame> get resyncRequired => _resyncController.stream;

  Stream<WsUnknownFrame> get unknownFrames => _unknownFrameController.stream;

  Stream<void> get handshakesCompleted => _handshakeController.stream;

  Future<void> connect() async {
    if (_disposed || _isBusy) {
      return;
    }
    _closing = false;
    _fatal = false;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _reconnectScheduled = false;
    _reconnectAttempt = 0;
    await _open();
  }

  void disconnect() {
    _closing = true;
    _reconnectScheduled = false;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _teardownSocket();
    _reconnectAttempt = 0;
    _serverHello = null;
    _setState(WsConnectionState.disconnected);
  }

  Future<void> dispose() async {
    if (_disposed) {
      return;
    }
    disconnect();
    _disposed = true;
    await _connectionController.close();
    await _failureController.close();
    await _terminalOutputController.close();
    await _terminalExitController.close();
    await _sessionEventController.close();
    await _resyncController.close();
    await _unknownFrameController.close();
    await _handshakeController.close();
  }

  Future<WsAck> sendControl(
    String type,
    JsonObject payload, {
    Duration? timeout,
  }) {
    if (!_canSend) {
      return Future<WsAck>.error(
        ApiFailure.client('Cannot send "$type": the WebSocket is not connected'),
      );
    }
    return _sendControl(type, payload, timeout ?? _ackTimeout);
  }

  void sendNotification(String type, JsonObject payload) {
    final channel = _channel;
    if (channel == null) {
      _emitFailure(
        ApiFailure.client('Cannot send "$type": the WebSocket is closed'),
      );
      return;
    }
    try {
      channel.sink
          .add(WsControlFrame(type: type, id: _nextFrameId(), payload: payload).encode());
    } catch (error) {
      _emitFailure(
        ApiFailure(
          code: ApiCodes.clientError,
          message: 'Failed to send "$type": $error',
          source: FailureSource.ws,
        ),
      );
    }
  }

  bool get _isBusy =>
      _state == WsConnectionState.connecting ||
      _state == WsConnectionState.awaitingServerHello ||
      _state == WsConnectionState.handshaking ||
      _state == WsConnectionState.connected;

  bool get _canSend =>
      _channel != null &&
      (_state == WsConnectionState.connected ||
          _state == WsConnectionState.handshaking ||
          _state == WsConnectionState.awaitingServerHello);

  Future<void> _open() async {
    if (_disposed) {
      return;
    }
    _setState(
      _reconnectAttempt == 0
          ? WsConnectionState.connecting
          : WsConnectionState.reconnecting,
    );

    final uri = _config.wsUrl;
    final headers = <String, String>{};
    final protocols = <String>[];
    if (_config.hasToken) {
      headers['Authorization'] = 'Bearer ${_config.token}';
      protocols.add(WsProtocol.bearerSubprotocol(_config.token));
    }

    final WebSocketChannel channel;
    try {
      // `WebSocketChannel.connect` cannot send headers, so the Bearer header
      // needs `dart:io`; a web target would fall back to the subprotocol only.
      // Both auth forms go out because the daemon accepts either. No client
      // `pingInterval`: pings are the daemon's to send, pongs are ours.
      channel = IOWebSocketChannel.connect(
        uri,
        headers: headers.isEmpty ? null : headers,
        protocols: protocols.isEmpty ? null : protocols,
      );
    } catch (error) {
      _onConnectionLost('could not open $uri', error: error);
      return;
    }

    _channel = channel;
    final helloCompleter = Completer<WsServerHelloFrame>();
    _helloCompleter = helloCompleter;
    _subscription = channel.stream.listen(
      _onData,
      onError: _onSocketError,
      onDone: _onSocketDone,
      cancelOnError: false,
    );

    try {
      await channel.ready.timeout(_handshakeTimeout);
      _setState(WsConnectionState.awaitingServerHello);
      final hello = await helloCompleter.future.timeout(_handshakeTimeout);
      _helloCompleter = null;
      _serverHello = hello;
      _heartbeat = hello.heartbeat;
      if (!hello.protocolMatchesClient) {
        _emitFailure(
          ApiFailure(
            code: hello.protocolVersion,
            message: 'Daemon protocol version ${hello.protocolVersion} does not '
                'match client version ${WsProtocol.protocolVersion}',
            source: FailureSource.ws,
          ),
        );
      }
      _resetLivenessTimer();
      _setState(WsConnectionState.handshaking);
      final ack = await _sendControl(
        WsMessageType.clientHello,
        clientHelloPayload(clientId: _clientId),
        _handshakeTimeout,
      );
      if (!ack.isSuccess) {
        throw ApiFailure(
          code: ack.code,
          message: 'Daemon rejected client_hello: ${ack.msg}',
          source: FailureSource.ws,
        );
      }
      _reconnectAttempt = 0;
      _setState(WsConnectionState.connected);
      _resetLivenessTimer();
      if (!_handshakeController.isClosed) {
        _handshakeController.add(null);
      }
    } catch (error) {
      _onConnectionLost('the handshake with ${uri.host} did not complete',
          error: error);
    }
  }

  Future<WsAck> _sendControl(
    String type,
    JsonObject payload,
    Duration timeout,
  ) async {
    final channel = _channel;
    if (channel == null) {
      throw ApiFailure.client('Cannot send "$type": the WebSocket is closed');
    }
    final id = _nextFrameId();
    final completer = Completer<WsAckFrame>();
    _pendingAcks[id] = completer;
    try {
      channel.sink
          .add(WsControlFrame(type: type, id: id, payload: payload).encode());
    } catch (error) {
      _pendingAcks.remove(id);
      throw ApiFailure(
        code: ApiCodes.clientError,
        message: 'Failed to send "$type": $error',
        source: FailureSource.ws,
      );
    }
    try {
      final ack = await completer.future.timeout(timeout);
      return WsAck(id: ack.id, code: ack.code, msg: ack.msg, payload: ack.payload);
    } on TimeoutException {
      throw ApiFailure.client(
        'Timed out after ${timeout.inMilliseconds}ms waiting for the ack of "$type"',
      );
    } finally {
      _pendingAcks.remove(id);
    }
  }

  void _onData(Object? data) {
    _resetLivenessTimer();
    try {
      _handleFrame(data);
    } catch (error) {
      _emitFailure(
        ApiFailure(
          code: ApiCodes.clientError,
          message: 'Failed to handle a daemon frame: $error',
          source: FailureSource.ws,
        ),
      );
    }
  }

  void _handleFrame(Object? data) {
    final Object? decoded;
    try {
      if (data is String) {
        decoded = jsonDecode(data);
      } else if (data is List<int>) {
        decoded = jsonDecode(utf8.decode(data));
      } else {
        decoded = null;
      }
    } on FormatException catch (error) {
      _emitFailure(
        ApiFailure.malformed(
          'Daemon sent a frame that is not valid JSON: ${error.message}',
          source: FailureSource.ws,
        ),
      );
      return;
    }
    if (decoded == null) {
      _emitFailure(
        ApiFailure.malformed(
          'Daemon sent an unreadable frame (${data.runtimeType})',
          source: FailureSource.ws,
        ),
      );
      return;
    }
    final WsServerFrame frame;
    try {
      frame = decodeWsServerFrame(decoded);
    } on FormatException catch (error) {
      _emitFailure(
        ApiFailure.malformed(
          'Daemon sent an unparsable frame: ${error.message}',
          source: FailureSource.ws,
        ),
      );
      return;
    }
    _dispatch(frame);
  }

  void _dispatch(WsServerFrame frame) {
    switch (frame) {
      case final WsServerHelloFrame hello:
        _onServerHello(hello);
      case final WsPingFrame ping:
        _onPing(ping);
      case final WsAckFrame ack:
        _onAck(ack);
      case final WsErrorFrame errorFrame:
        _onErrorFrame(errorFrame);
      case final WsResyncRequiredFrame resync:
        _add(_resyncController, resync);
      case final WsTerminalOutputFrame output:
        _add(_terminalOutputController, output);
      case final WsTerminalExitFrame exit:
        _add(_terminalExitController, exit);
      case final WsSessionEventFrame event:
        _add(_sessionEventController, event);
      case final WsUnknownFrame unknown:
        _add(_unknownFrameController, unknown);
    }
  }

  void _onServerHello(WsServerHelloFrame hello) {
    final completer = _helloCompleter;
    if (completer != null && !completer.isCompleted) {
      completer.complete(hello);
    }
  }

  void _onPing(WsPingFrame ping) {
    // The daemon pings and the client pongs; there is no client-initiated ping.
    sendNotification(WsMessageType.pong, pongPayload(nonce: ping.nonce));
  }

  void _onAck(WsAckFrame ack) {
    final completer = _pendingAcks.remove(ack.id);
    if (completer == null || completer.isCompleted) {
      return;
    }
    completer.complete(ack);
  }

  void _onErrorFrame(WsErrorFrame frame) {
    _emitFailure(frame.toFailure());
    if (!frame.fatal) {
      return;
    }
    _fatal = true;
    _reconnectScheduled = false;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _teardownSocket();
    _setState(WsConnectionState.failed);
  }

  void _onSocketError(Object error, StackTrace stackTrace) {
    _onConnectionLost('socket error', error: error);
  }

  void _onSocketDone() {
    _onConnectionLost('the daemon closed the socket');
  }

  void _onConnectionLost(String reason, {Object? error}) {
    if (_disposed) {
      return;
    }
    if (_closing || _fatal) {
      _teardownSocket();
      return;
    }
    _emitFailure(
      ApiFailure(
        code: ApiCodes.clientError,
        message: error == null
            ? 'WebSocket connection lost: $reason'
            : 'WebSocket connection lost: $reason ($error)',
        source: FailureSource.ws,
      ),
    );
    _teardownSocket();
    if (_reconnectScheduled) {
      return;
    }
    _reconnectScheduled = true;
    _scheduleReconnect();
  }

  void _scheduleReconnect() {
    _reconnectTimer?.cancel();
    _reconnectAttempt += 1;
    final exponent = _reconnectAttempt - 1 > 10 ? 10 : _reconnectAttempt - 1;
    final backoff =
        (_initialReconnectDelay.inMilliseconds * pow(2, exponent)).round();
    final ceiling = _maxReconnectDelay.inMilliseconds;
    final delay = backoff > ceiling ? ceiling : backoff;
    final jitter = _random.nextInt(delay ~/ 4 + 1);
    _setState(WsConnectionState.reconnecting);
    _reconnectTimer = Timer(Duration(milliseconds: delay + jitter), () {
      _reconnectScheduled = false;
      _reconnectTimer = null;
      unawaited(_open());
    });
  }

  void _resetLivenessTimer() {
    _livenessTimer?.cancel();
    _livenessTimer = null;
    if (_disposed || _closing || _fatal) {
      return;
    }
    if (_state == WsConnectionState.disconnected ||
        _state == WsConnectionState.reconnecting ||
        _state == WsConnectionState.failed) {
      return;
    }
    _livenessTimer = Timer(_heartbeat * _heartbeatMultiplier, _onLivenessTimeout);
  }

  void _onLivenessTimeout() {
    _livenessTimer = null;
    final limit = _heartbeat * _heartbeatMultiplier;
    _onConnectionLost('no frame arrived within ${limit.inSeconds}s');
  }

  void _teardownSocket() {
    _livenessTimer?.cancel();
    _livenessTimer = null;

    final hello = _helloCompleter;
    _helloCompleter = null;
    if (hello != null && !hello.isCompleted) {
      hello.completeError(
        ApiFailure.client('The WebSocket closed before server_hello arrived'),
      );
    }

    final subscription = _subscription;
    _subscription = null;
    if (subscription != null) {
      unawaited(subscription.cancel());
    }

    final channel = _channel;
    _channel = null;
    if (channel != null) {
      unawaited(channel.sink.close().catchError((Object error) {
        _emitFailure(ApiFailure.client('Failed to close the WebSocket: $error'));
      }));
    }

    _failPendingAcks('The WebSocket disconnected');
  }

  void _failPendingAcks(String reason) {
    if (_pendingAcks.isEmpty) {
      return;
    }
    final pending = List<Completer<WsAckFrame>>.from(_pendingAcks.values);
    _pendingAcks.clear();
    for (final completer in pending) {
      if (!completer.isCompleted) {
        completer.completeError(ApiFailure.client(reason));
      }
    }
  }

  String _nextFrameId() {
    _frameCounter += 1;
    return '$_frameCounter-$_clientId';
  }

  void _setState(WsConnectionState next) {
    if (_disposed || _state == next) {
      return;
    }
    _state = next;
    _add(_connectionController, next);
  }

  void _emitFailure(ApiFailure failure) {
    _add(_failureController, failure);
  }

  void _add<T>(StreamController<T> controller, T value) {
    if (!controller.isClosed) {
      controller.add(value);
    }
  }
}

String _newClientId(Random random) {
  final suffix = random.nextInt(0xFFFFFF).toRadixString(16).padLeft(6, '0');
  return 'omnicode-mobile-$suffix';
}
