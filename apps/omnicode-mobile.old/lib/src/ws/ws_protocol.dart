import 'dart:convert';

import '../api/envelope.dart';

class WsProtocol {
  WsProtocol._();

  static const int protocolVersion = 2;
  static const String bearerSubprotocolPrefix = 'omnicode.bearer.';
  static const int defaultHeartbeatMs = 30000;
  static const int defaultMaxEventBufferSize = 0;

  static String bearerSubprotocol(String token) =>
      '$bearerSubprotocolPrefix$token';
}

class WsMessageType {
  WsMessageType._();

  static const String clientHello = 'client_hello';
  static const String subscribe = 'subscribe';
  static const String subscribeV2 = 'subscribe_v2';
  static const String unsubscribe = 'unsubscribe';
  static const String unsubscribeV2 = 'unsubscribe_v2';
  static const String abort = 'abort';
  static const String terminalAttach = 'terminal_attach';
  static const String terminalDetach = 'terminal_detach';
  static const String terminalInput = 'terminal_input';
  static const String terminalResize = 'terminal_resize';
  static const String terminalClose = 'terminal_close';
  static const String pong = 'pong';

  static const String ack = 'ack';
  static const String serverHello = 'server_hello';
  static const String ping = 'ping';
  static const String resyncRequired = 'resync_required';
  static const String error = 'error';
  static const String terminalOutput = 'terminal_output';
  static const String terminalExit = 'terminal_exit';
}

class WsResyncReason {
  WsResyncReason._();

  static const String bufferOverflow = 'buffer_overflow';
  static const String sessionRecreated = 'session_recreated';
  static const String epochChanged = 'epoch_changed';
}

class WsControlFrame {
  const WsControlFrame({
    required this.type,
    required this.id,
    required this.payload,
  });

  final String type;
  final String id;
  final JsonObject payload;

  JsonObject toMap() => <String, Object?>{
        'type': type,
        'id': id,
        'payload': payload,
      };

  String encode() => _encodeMap(toMap());
}

class WsCursor {
  const WsCursor({required this.seq, this.epoch});

  factory WsCursor.fromJson(JsonObject json) => WsCursor(
        seq: readInt(json, 'seq') ?? 0,
        epoch: readString(json, 'epoch'),
      );

  final int seq;
  final String? epoch;

  JsonObject toMap() => <String, Object?>{
        'seq': seq,
        if (epoch != null) 'epoch': epoch,
      };
}

sealed class WsServerFrame {
  const WsServerFrame({required this.type, this.timestamp});

  final String type;
  final String? timestamp;
}

class WsServerHelloFrame extends WsServerFrame {
  const WsServerHelloFrame({
    required super.type,
    required super.timestamp,
    required this.wsConnectionId,
    required this.protocolVersion,
    required this.maxEventBufferSize,
    required this.eventBatching,
    required this.compression,
    this.heartbeatMs,
  });

  final String? wsConnectionId;
  final int protocolVersion;
  final int maxEventBufferSize;
  final bool eventBatching;
  final bool compression;
  final int? heartbeatMs;

  Duration get heartbeat =>
      Duration(milliseconds: heartbeatMs ?? WsProtocol.defaultHeartbeatMs);

  bool get protocolMatchesClient =>
      protocolVersion == WsProtocol.protocolVersion;
}

class WsPingFrame extends WsServerFrame {
  const WsPingFrame({
    required super.type,
    required super.timestamp,
    required this.nonce,
  });

  final String nonce;
}

class WsAckFrame extends WsServerFrame {
  const WsAckFrame({
    required super.type,
    required super.timestamp,
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

class WsErrorFrame extends WsServerFrame {
  const WsErrorFrame({
    required super.type,
    required super.timestamp,
    required this.code,
    required this.msg,
    required this.fatal,
    this.requestId,
    this.details,
  });

  final int code;
  final String msg;
  final bool fatal;
  final String? requestId;
  final Object? details;

  ApiFailure toFailure() => ApiFailure(
        code: code,
        message: msg,
        source: FailureSource.ws,
        fatal: fatal,
        requestId: requestId,
        details: details,
      );
}

class WsResyncRequiredFrame extends WsServerFrame {
  const WsResyncRequiredFrame({
    required super.type,
    required super.timestamp,
    required this.sessionId,
    required this.reason,
    required this.currentSeq,
    this.epoch,
  });

  final String? sessionId;
  final String reason;
  final int currentSeq;
  final String? epoch;

  String describe() {
    final session = sessionId ?? 'unknown session';
    return 'Server requested a resync of $session ($reason, current_seq $currentSeq)';
  }
}

class WsTerminalOutputFrame extends WsServerFrame {
  const WsTerminalOutputFrame({
    required super.type,
    required super.timestamp,
    required this.seq,
    required this.sessionId,
    required this.terminalId,
    required this.data,
  });

  final int seq;
  final String sessionId;
  final String terminalId;
  final String data;
}

class WsTerminalExitFrame extends WsServerFrame {
  const WsTerminalExitFrame({
    required super.type,
    required super.timestamp,
    required this.sessionId,
    required this.terminalId,
    this.exitCode,
  });

  final String sessionId;
  final String terminalId;
  final int? exitCode;
}

class WsSessionEventFrame extends WsServerFrame {
  const WsSessionEventFrame({
    required super.type,
    required super.timestamp,
    required this.seq,
    required this.payload,
    this.epoch,
    this.offset,
    this.sessionId,
    this.isVolatile = false,
  });

  final int seq;
  final Object? payload;
  final String? epoch;
  final int? offset;
  final String? sessionId;
  final bool isVolatile;
}

class WsUnknownFrame extends WsServerFrame {
  const WsUnknownFrame({
    required super.type,
    required super.timestamp,
    required this.raw,
  });

  final JsonObject raw;
}

String _encodeMap(JsonObject map) {
  try {
    return jsonEncode(map);
  } catch (error) {
    throw FormatException('Cannot encode WebSocket frame: $error', map);
  }
}

WsServerFrame decodeWsServerFrame(Object? raw) {
  final map = asJsonObject(raw, context: 'ws frame');
  final type = readString(map, 'type');
  if (type == null) {
    throw const FormatException('ws frame has no "type"');
  }
  final timestamp = readString(map, 'timestamp');
  switch (type) {
    case WsMessageType.serverHello:
      return _decodeServerHello(type, timestamp, _payloadOf(map));
    case WsMessageType.ping:
      return WsPingFrame(
        type: type,
        timestamp: timestamp,
        nonce: readString(_payloadOf(map), 'nonce') ?? '',
      );
    case WsMessageType.ack:
      return _decodeAck(type, timestamp, map);
    case WsMessageType.error:
      return _decodeError(type, timestamp, _payloadOf(map));
    case WsMessageType.resyncRequired:
      return _decodeResync(type, timestamp, _payloadOf(map));
    case WsMessageType.terminalOutput:
      return _decodeTerminalOutput(type, timestamp, map);
    case WsMessageType.terminalExit:
      return _decodeTerminalExit(type, timestamp, map);
    default:
      final seq = readInt(map, 'seq');
      if (seq == null) {
        return WsUnknownFrame(type: type, timestamp: timestamp, raw: map);
      }
      return WsSessionEventFrame(
        type: type,
        timestamp: timestamp,
        seq: seq,
        payload: map['payload'],
        epoch: readString(map, 'epoch'),
        offset: readInt(map, 'offset'),
        sessionId: readIdentifier(map, 'session_id'),
        isVolatile: readBool(map, 'volatile') ?? false,
      );
  }
}

JsonObject _payloadOf(JsonObject map) =>
    readObject(map, 'payload') ?? const <String, Object?>{};

WsServerHelloFrame _decodeServerHello(
  String type,
  String? timestamp,
  JsonObject payload,
) {
  final capabilities =
      readObject(payload, 'capabilities') ?? const <String, Object?>{};
  return WsServerHelloFrame(
    type: type,
    timestamp: timestamp,
    wsConnectionId: readIdentifier(payload, 'ws_connection_id'),
    protocolVersion:
        readInt(payload, 'protocol_version') ?? WsProtocol.protocolVersion,
    maxEventBufferSize: readInt(payload, 'max_event_buffer_size') ??
        WsProtocol.defaultMaxEventBufferSize,
    eventBatching: readBool(capabilities, 'event_batching') ?? false,
    compression: readBool(capabilities, 'compression') ?? false,
    heartbeatMs: readInt(payload, 'heartbeat_ms'),
  );
}

WsAckFrame _decodeAck(String type, String? timestamp, JsonObject map) {
  final id = readString(map, 'id');
  if (id == null) {
    throw const FormatException('ack frame has no "id"');
  }
  return WsAckFrame(
    type: type,
    timestamp: timestamp,
    id: id,
    code: readInt(map, 'code') ?? ApiCodes.success,
    msg: readString(map, 'msg') ?? '',
    payload: _payloadOf(map),
  );
}

WsErrorFrame _decodeError(String type, String? timestamp, JsonObject payload) {
  return WsErrorFrame(
    type: type,
    timestamp: timestamp,
    code: readInt(payload, 'code') ?? ApiCodes.clientError,
    msg: readString(payload, 'msg') ?? 'Server reported an error',
    fatal: readBool(payload, 'fatal') ?? false,
    requestId: readString(payload, 'request_id'),
    details: payload['details'],
  );
}

WsResyncRequiredFrame _decodeResync(
  String type,
  String? timestamp,
  JsonObject payload,
) {
  return WsResyncRequiredFrame(
    type: type,
    timestamp: timestamp,
    sessionId: readIdentifier(payload, 'session_id'),
    reason: readString(payload, 'reason') ?? 'unknown',
    currentSeq: readInt(payload, 'current_seq') ?? 0,
    epoch: readString(payload, 'epoch'),
  );
}

WsTerminalOutputFrame _decodeTerminalOutput(
  String type,
  String? timestamp,
  JsonObject map,
) {
  final payload = _payloadOf(map);
  final seq = readInt(map, 'seq');
  if (seq == null) {
    throw const FormatException('terminal_output frame has no "seq"');
  }
  final data = readString(payload, 'data');
  if (data == null) {
    throw const FormatException('terminal_output payload has no string "data"');
  }
  return WsTerminalOutputFrame(
    type: type,
    timestamp: timestamp,
    seq: seq,
    sessionId: readIdentifier(map, 'session_id') ?? '',
    terminalId: readIdentifier(map, 'terminal_id') ?? '',
    data: data,
  );
}

WsTerminalExitFrame _decodeTerminalExit(
  String type,
  String? timestamp,
  JsonObject map,
) {
  final payload = _payloadOf(map);
  return WsTerminalExitFrame(
    type: type,
    timestamp: timestamp,
    sessionId: readIdentifier(map, 'session_id') ?? '',
    terminalId: readIdentifier(map, 'terminal_id') ?? '',
    exitCode: readInt(payload, 'exit_code'),
  );
}

JsonObject clientHelloPayload({
  required String clientId,
  List<String>? subscriptions,
  Map<String, WsCursor>? cursors,
  Map<String, List<String>>? agentFilter,
}) {
  final payload = <String, Object?>{'client_id': clientId};
  if (subscriptions != null) {
    payload['subscriptions'] = subscriptions;
  }
  if (cursors != null && cursors.isNotEmpty) {
    payload['cursors'] =
        cursors.map((sessionId, cursor) => MapEntry(sessionId, cursor.toMap()));
  }
  if (agentFilter != null && agentFilter.isNotEmpty) {
    payload['agent_filter'] = agentFilter;
  }
  return payload;
}

JsonObject subscribePayload({
  required List<String> sessionIds,
  Map<String, WsCursor>? cursors,
  Map<String, List<String>>? agentFilter,
}) {
  final payload = <String, Object?>{'session_ids': sessionIds};
  if (cursors != null && cursors.isNotEmpty) {
    payload['cursors'] =
        cursors.map((sessionId, cursor) => MapEntry(sessionId, cursor.toMap()));
  }
  if (agentFilter != null && agentFilter.isNotEmpty) {
    payload['agent_filter'] = agentFilter;
  }
  return payload;
}

JsonObject subscribeV2Payload({
  required String sessionId,
  required String transcript,
  String? transcriptSince,
}) =>
    <String, Object?>{
      'session_id': sessionId,
      'transcript': transcript,
      'transcript_since': ?transcriptSince,
    };

JsonObject unsubscribePayload({required List<String> sessionIds}) =>
    <String, Object?>{'session_ids': sessionIds};

JsonObject unsubscribeV2Payload({
  required String sessionId,
  List<String>? agentIds,
}) =>
    <String, Object?>{
      'session_id': sessionId,
      'agent_ids': ?agentIds,
    };

JsonObject abortPayload({
  required String sessionId,
  required String promptId,
}) =>
    <String, Object?>{'session_id': sessionId, 'prompt_id': promptId};

JsonObject pongPayload({required String nonce}) =>
    <String, Object?>{'nonce': nonce};

JsonObject terminalIoPayload({
  required String sessionId,
  required String terminalId,
}) =>
    <String, Object?>{
      'session_id': sessionId,
      'terminal_id': terminalId,
    };

JsonObject terminalAttachPayload({
  required String sessionId,
  required String terminalId,
  int? sinceSeq,
}) =>
    <String, Object?>{
      'session_id': sessionId,
      'terminal_id': terminalId,
      'since_seq': ?sinceSeq,
    };

JsonObject terminalInputPayload({
  required String sessionId,
  required String terminalId,
  required String data,
}) =>
    <String, Object?>{
      'session_id': sessionId,
      'terminal_id': terminalId,
      'data': data,
    };

JsonObject terminalResizePayload({
  required String sessionId,
  required String terminalId,
  required int cols,
  required int rows,
}) =>
    <String, Object?>{
      'session_id': sessionId,
      'terminal_id': terminalId,
      'cols': cols,
      'rows': rows,
    };
