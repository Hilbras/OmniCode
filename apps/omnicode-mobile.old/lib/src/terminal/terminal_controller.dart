import 'dart:async';

import 'package:material_ui/material_ui.dart';
import 'package:xterm/xterm.dart';

import '../api/envelope.dart';
import '../ws/terminal_channel.dart';
import '../ws/ws_client.dart';

class OmniTerminalController extends ChangeNotifier {
  OmniTerminalController({
    required this.channel,
    required WsClient client,
    Terminal? terminalOverride,
    int maxLines = 5000,
  })  : _client = client,
        terminal = terminalOverride ?? Terminal(maxLines: maxLines) {
    // xterm 4 routes host-bound bytes through `Terminal.onOutput` rather than
    // the view, so an injected terminal gets the same wiring as a new one.
    terminal.onOutput = onUserInput;
    _connectionState = client.state;
    _outputSubscription = channel.output.listen(_onOutput);
    _statusSubscription = channel.status.listen(_setStatus);
    _exitSubscription = channel.exits.listen(_onExit);
    _connectionSubscription =
        client.connectionStates.listen(_onConnectionState);
  }

  static const int minCols = 2;
  static const int minRows = 1;
  static const int maxCols = 400;
  static const int maxRows = 200;
  static const double fallbackCellWidth = 8.4;
  static const double fallbackCellHeight = 17;
  static const double fontSize = 14;

  final TerminalChannel channel;
  final WsClient _client;
  final Terminal terminal;

  late final StreamSubscription<String> _outputSubscription;
  late final StreamSubscription<String> _statusSubscription;
  late final StreamSubscription<int?> _exitSubscription;
  late final StreamSubscription<WsConnectionState> _connectionSubscription;

  WsConnectionState _connectionState = WsConnectionState.disconnected;
  Size? _cellSize;
  String _status = 'Idle';
  int _cols = 0;
  int _rows = 0;
  int? _exitCode;
  bool _attached = false;
  bool _disposed = false;

  String get status => _status;

  WsConnectionState get connectionState => _connectionState;

  bool get isAttached => _attached;

  int? get exitCode => _exitCode;

  int get cols => _cols;

  int get rows => _rows;

  String get sizeLabel => _cols == 0 || _rows == 0 ? '—' : '${_cols}x$_rows';

  String get connectionLabel => switch (_connectionState) {
        WsConnectionState.connected => 'connected',
        WsConnectionState.connecting => 'connecting',
        WsConnectionState.awaitingServerHello => 'waiting for server_hello',
        WsConnectionState.handshaking => 'handshaking',
        WsConnectionState.reconnecting =>
          'reconnecting (attempt ${_client.reconnectAttempt})',
        WsConnectionState.failed => 'failed',
        WsConnectionState.disconnected => 'disconnected',
      };

  Future<void> attach() async {
    if (_disposed) {
      return;
    }
    _setStatus('Attaching to ${channel.terminalId}');
    try {
      await channel.attach();
      _attached = true;
      if (_cols > 0 && _rows > 0) {
        await _sendResize(_cols, _rows);
      }
    } on ApiFailure catch (failure) {
      _setStatus('Attach failed: ${failure.describe()}');
    }
    _notify();
  }

  Future<void> reconnect() async {
    if (_disposed) {
      return;
    }
    if (_client.state != WsConnectionState.connected) {
      _setStatus('Reconnecting to the daemon');
      await _client.connect();
      return;
    }
    _setStatus('Re-attaching to ${channel.terminalId}');
    await channel.reattach();
    _attached = channel.isLive;
    _notify();
  }

  Future<void> closeTerminal() async {
    if (_disposed) {
      return;
    }
    try {
      await channel.close();
      _attached = false;
    } on ApiFailure catch (failure) {
      _setStatus('Close failed: ${failure.describe()}');
    }
    _notify();
  }

  void onUserInput(String data) {
    channel.sendInput(data);
  }

  void updateLayout(double maxWidth, double maxHeight) {
    if (_disposed) {
      return;
    }
    if (!maxWidth.isFinite || !maxHeight.isFinite) {
      return;
    }
    if (maxWidth <= 0 || maxHeight <= 0) {
      return;
    }
    final cell = _measureCell();
    final cols = _clamp((maxWidth / cell.width).floor(), minCols, maxCols);
    final rows = _clamp((maxHeight / cell.height).floor(), minRows, maxRows);
    if (cols == _cols && rows == _rows) {
      return;
    }
    _cols = cols;
    _rows = rows;
    _notify();
    if (_attached) {
      unawaited(_sendResize(cols, rows));
    }
  }

  Future<void> _sendResize(int cols, int rows) async {
    try {
      await channel.resize(cols: cols, rows: rows);
    } on ApiFailure catch (failure) {
      _setStatus('Resize to ${cols}x$rows failed: ${failure.describe()}');
    }
  }

  Size _measureCell() {
    final cached = _cellSize;
    if (cached != null) {
      return cached;
    }
    final painter = TextPainter(
      text: const TextSpan(
        text: 'M',
        style: TextStyle(
          fontSize: fontSize,
          fontFamily: 'monospace',
          height: 1.3,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    final width = painter.width;
    final height = painter.height;
    final measured = Size(
      width > 1 ? width : fallbackCellWidth,
      height > 1 ? height : fallbackCellHeight,
    );
    _cellSize = measured;
    return measured;
  }

  void _onOutput(String data) {
    if (_disposed) {
      return;
    }
    terminal.write(data);
  }

  void _onExit(int? code) {
    if (_disposed) {
      return;
    }
    _exitCode = code;
    _attached = false;
    _notify();
  }

  void _onConnectionState(WsConnectionState state) {
    if (_disposed) {
      return;
    }
    _connectionState = state;
    if (state != WsConnectionState.connected) {
      _attached = false;
    } else {
      _attached = channel.isLive;
    }
    _notify();
  }

  void _setStatus(String message) {
    _status = message;
    _notify();
  }

  void _notify() {
    if (!_disposed) {
      notifyListeners();
    }
  }

  @override
  void dispose() {
    if (_disposed) {
      super.dispose();
      return;
    }
    _disposed = true;
    unawaited(_outputSubscription.cancel());
    unawaited(_statusSubscription.cancel());
    unawaited(_exitSubscription.cancel());
    unawaited(_connectionSubscription.cancel());
    super.dispose();
  }
}

int _clamp(int value, int low, int high) {
  if (value < low) {
    return low;
  }
  return value > high ? high : value;
}
