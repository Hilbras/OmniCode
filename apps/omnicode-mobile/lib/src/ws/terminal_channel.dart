import 'dart:async';

import '../api/envelope.dart';
import 'ws_client.dart';
import 'ws_protocol.dart';

class TerminalChannel {
  TerminalChannel({
    required WsClient client,
    required this.sessionId,
    required this.terminalId,
  }) : _client = client {
    _outputSubscription =
        client.terminalOutput.where(_matchesOutput).listen(_onOutput);
    _exitSubscription = client.terminalExits.where(_matchesExit).listen(_onExit);
    _handshakeSubscription = client.handshakesCompleted.listen((_) {
      if (_wantsAttachment) {
        unawaited(reattach());
      }
    });
  }

  final WsClient _client;
  final String sessionId;
  final String terminalId;

  final StreamController<String> _outputController =
      StreamController<String>.broadcast();
  final StreamController<int?> _exitController =
      StreamController<int?>.broadcast();
  final StreamController<String> _statusController =
      StreamController<String>.broadcast();

  late final StreamSubscription<WsTerminalOutputFrame> _outputSubscription;
  late final StreamSubscription<WsTerminalExitFrame> _exitSubscription;
  late final StreamSubscription<void> _handshakeSubscription;

  int _highestSeq = 0;
  int? _exitCode;
  bool _wantsAttachment = false;
  bool _exited = false;
  bool _disposed = false;

  Stream<String> get output => _outputController.stream;

  Stream<int?> get exits => _exitController.stream;

  Stream<String> get status => _statusController.stream;

  int get highestSeq => _highestSeq;

  int? get exitCode => _exitCode;

  bool get wantsAttachment => _wantsAttachment;

  bool get hasExited => _exited;

  bool get isLive => _wantsAttachment && !_exited;

  WsConnectionState get connectionState => _client.state;

  Future<int> attach() async {
    if (_disposed) {
      throw ApiFailure.client('This terminal channel is disposed');
    }
    _wantsAttachment = true;
    // since_seq resumes the scrollback: the daemon replays only buffered frames
    // whose seq is greater than the value sent here.
    final sinceSeq = _highestSeq > 0 ? _highestSeq : null;
    final ack = await _client.sendControl(
      WsMessageType.terminalAttach,
      terminalAttachPayload(
        sessionId: sessionId,
        terminalId: terminalId,
        sinceSeq: sinceSeq,
      ),
    );
    _throwIfFailed(ack, 'terminal_attach');
    final replayed = readInt(ack.payload, 'replayed') ?? 0;
    _addStatus(
      replayed == 0
          ? 'Attached to terminal $terminalId'
          : 'Attached and replayed $replayed buffered frames',
    );
    return replayed;
  }

  Future<void> reattach() async {
    if (_disposed || _exited) {
      return;
    }
    _addStatus('Re-attaching to terminal $terminalId from seq $_highestSeq');
    try {
      await attach();
    } on ApiFailure catch (failure) {
      _addStatus('Re-attach failed: ${failure.describe()}');
    }
  }

  Future<void> detach() async {
    _wantsAttachment = false;
    if (_disposed) {
      return;
    }
    final ack = await _client.sendControl(
      WsMessageType.terminalDetach,
      terminalIoPayload(sessionId: sessionId, terminalId: terminalId),
    );
    _throwIfFailed(ack, 'terminal_detach');
  }

  void sendInput(String data) {
    if (_disposed || _exited || data.isEmpty) {
      return;
    }
    unawaited(
      _client
          .sendControl(
            WsMessageType.terminalInput,
            terminalInputPayload(
              sessionId: sessionId,
              terminalId: terminalId,
              data: data,
            ),
          )
          .then<void>((ack) {
            if (!ack.isSuccess) {
              _addStatus('terminal_input rejected: ${ack.msg}');
            }
          })
          .catchError((Object error) {
            _addStatus('terminal_input failed: $error');
          }),
    );
  }

  Future<void> resize({required int cols, required int rows}) async {
    if (cols <= 0 || rows <= 0) {
      throw ApiFailure.client(
        'Terminal size must be positive, got ${cols}x$rows',
      );
    }
    final ack = await _client.sendControl(
      WsMessageType.terminalResize,
      terminalResizePayload(
        sessionId: sessionId,
        terminalId: terminalId,
        cols: cols,
        rows: rows,
      ),
    );
    _throwIfFailed(ack, 'terminal_resize');
  }

  Future<void> close() async {
    _wantsAttachment = false;
    if (_disposed) {
      return;
    }
    final ack = await _client.sendControl(
      WsMessageType.terminalClose,
      terminalIoPayload(sessionId: sessionId, terminalId: terminalId),
    );
    _throwIfFailed(ack, 'terminal_close');
    _exited = true;
    _addStatus('Terminal $terminalId closed');
  }

  void dispose() {
    if (_disposed) {
      return;
    }
    _disposed = true;
    unawaited(_outputSubscription.cancel());
    unawaited(_exitSubscription.cancel());
    unawaited(_handshakeSubscription.cancel());
    unawaited(_outputController.close());
    unawaited(_exitController.close());
    unawaited(_statusController.close());
  }

  bool _matchesOutput(WsTerminalOutputFrame frame) =>
      frame.sessionId == sessionId && frame.terminalId == terminalId;

  bool _matchesExit(WsTerminalExitFrame frame) =>
      frame.sessionId == sessionId && frame.terminalId == terminalId;

  void _onOutput(WsTerminalOutputFrame frame) {
    if (_disposed) {
      return;
    }
    // A re-attach can replay frames that were already written locally; anything
    // at or below the highest seq seen so far is a duplicate.
    if (frame.seq <= _highestSeq) {
      return;
    }
    _highestSeq = frame.seq;
    if (!_outputController.isClosed) {
      _outputController.add(frame.data);
    }
  }

  void _onExit(WsTerminalExitFrame frame) {
    if (_disposed) {
      return;
    }
    _exited = true;
    _exitCode = frame.exitCode;
    _wantsAttachment = false;
    final code = frame.exitCode;
    _addStatus(
      code == null
          ? 'Terminal $terminalId exited'
          : 'Terminal $terminalId exited with code $code',
    );
    if (!_exitController.isClosed) {
      _exitController.add(code);
    }
  }

  void _addStatus(String message) {
    if (!_statusController.isClosed) {
      _statusController.add(message);
    }
  }

  void _throwIfFailed(WsAck ack, String operation) {
    if (ack.isSuccess) {
      return;
    }
    throw ApiFailure(
      code: ack.code,
      message: '$operation rejected by the daemon: ${ack.msg}',
      source: FailureSource.ws,
    );
  }
}
