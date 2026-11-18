import '../config/server_config.dart';
import 'api_client.dart';
import 'envelope.dart';

class SessionRef {
  const SessionRef({required this.id, required this.raw});

  factory SessionRef.fromJson(JsonObject json) => SessionRef(
        id: readIdentifier(json, 'id') ??
            readIdentifier(json, 'session_id') ??
            readIdentifier(json, 'sessionId'),
        raw: json,
      );

  final String? id;
  final JsonObject raw;

  String get label {
    final title = readString(raw, 'title') ??
        readString(raw, 'name') ??
        readString(raw, 'label');
    if (title != null && title.trim().isNotEmpty) {
      return title;
    }
    final sessionId = id;
    if (sessionId != null) {
      return sessionId;
    }
    return 'Session without an id';
  }

  String? get status => readString(raw, 'status') ?? readString(raw, 'state');

  String? get workspaceId =>
      readIdentifier(raw, 'workspace_id') ?? readIdentifier(raw, 'workspaceId');

  bool get busy => readBool(raw, 'busy') ?? false;

  String? get updatedAt =>
      readString(raw, 'updated_at') ?? readString(raw, 'updatedAt');

  String? get model => readString(raw, 'model') ?? readString(raw, 'model_id');

  String describe() {
    final parts = <String>[];
    final currentStatus = status;
    if (currentStatus != null) {
      parts.add(currentStatus);
    }
    final updated = updatedAt;
    if (updated != null) {
      parts.add(updated);
    }
    final selectedModel = model;
    if (selectedModel != null) {
      parts.add(selectedModel);
    }
    return parts.join(' · ');
  }
}

class SessionPage {
  const SessionPage({required this.items, required this.raw});

  final List<SessionRef> items;
  final JsonObject raw;

  String? get beforeId =>
      readIdentifier(raw, 'before_id') ?? readIdentifier(raw, 'beforeId');

  String? get afterId =>
      readIdentifier(raw, 'after_id') ?? readIdentifier(raw, 'afterId');

  bool? get hasMore => readBool(raw, 'has_more') ?? readBool(raw, 'hasMore');
}

class TerminalInfo {
  const TerminalInfo({required this.id, required this.raw});

  factory TerminalInfo.fromJson(JsonObject json) => TerminalInfo(
        id: readIdentifier(json, 'id') ??
            readIdentifier(json, 'terminal_id') ??
            readIdentifier(json, 'terminalId'),
        raw: json,
      );

  final String? id;
  final JsonObject raw;

  String get runtimeId =>
      readIdentifier(raw, 'runtime_id') ??
      readIdentifier(raw, 'runtimeId') ??
      'local';

  String? get status => readString(raw, 'status') ?? readString(raw, 'state');

  String get label {
    final terminalId = id;
    if (terminalId == null) {
      return 'Terminal without an id';
    }
    return terminalId;
  }
}

class SessionsApi {
  const SessionsApi(this._client);

  final ApiClient _client;

  Future<SessionPage> listSessions({
    String? beforeId,
    String? afterId,
    int? pageSize,
  }) async {
    final query = <String, String>{};
    if (beforeId != null) {
      query['before_id'] = beforeId;
    }
    if (afterId != null) {
      query['after_id'] = afterId;
    }
    if (pageSize != null) {
      query['page_size'] = '$pageSize';
    }
    final data = await _client.get(
      ApiPaths.sessions,
      query: query.isEmpty ? null : query,
    );
    return SessionPage(items: _toSessionRefs(data), raw: _asRaw(data));
  }

  Future<SessionRef?> sessionDetail(String sessionId) async {
    final data = await _client.get(ApiPaths.session(sessionId));
    if (data is! Map<Object?, Object?>) {
      return null;
    }
    return SessionRef.fromJson(asJsonObject(data, context: 'session'));
  }

  Future<SessionRef> createSession({String? title, String? workspaceId}) async {
    final body = <String, Object?>{};
    if (title != null && title.trim().isNotEmpty) {
      body['title'] = title.trim();
    }
    if (workspaceId != null) {
      body['workspace_id'] = workspaceId;
    }
    final data = await _client.post(ApiPaths.sessions, body: body);
    return SessionRef.fromJson(asJsonObject(data, context: 'created session'));
  }

  Future<List<TerminalInfo>> listTerminals(String sessionId) async {
    final data = await _client.get(ApiPaths.terminals(sessionId));
    return _toTerminals(_itemsOf(data));
  }

  Future<TerminalInfo> createTerminal(
    String sessionId, {
    String? runtimeId,
  }) async {
    final body = <String, Object?>{};
    if (runtimeId != null) {
      body['runtime_id'] = runtimeId;
    }
    // The create route validates its body with zod; a request with no body at
    // all fails even though runtime_id itself is optional.
    final data = await _client.post(
      ApiPaths.terminals(sessionId),
      body: body,
    );
    return TerminalInfo.fromJson(
      asJsonObject(data, context: 'created terminal'),
    );
  }

  Future<TerminalInfo?> terminal(String sessionId, String terminalId) async {
    final data = await _client.get(ApiPaths.terminal(sessionId, terminalId));
    if (data is! Map<Object?, Object?>) {
      return null;
    }
    return TerminalInfo.fromJson(asJsonObject(data, context: 'terminal'));
  }

  Future<bool> closeTerminal(String sessionId, String terminalId) async {
    final data = await _client.post(
      ApiPaths.terminalClose(sessionId, terminalId),
    );
    if (data is! Map<Object?, Object?>) {
      return true;
    }
    return readBool(asJsonObject(data, context: 'close result'), 'closed') ??
        true;
  }
}

List<Object?> _itemsOf(Object? data) {
  if (data is List<Object?>) {
    return data;
  }
  if (data is Map<Object?, Object?>) {
    final map = asJsonObject(data, context: 'page');
    for (final key in const <String>[
      'items',
      'sessions',
      'terminals',
      'data',
      'results',
      'list',
    ]) {
      final value = map[key];
      if (value is List<Object?>) {
        return value;
      }
    }
  }
  return const <Object?>[];
}

List<SessionRef> _toSessionRefs(Object? data) {
  final result = <SessionRef>[];
  for (final item in _itemsOf(data)) {
    if (item is Map<Object?, Object?>) {
      result.add(SessionRef.fromJson(asJsonObject(item, context: 'session')));
    }
  }
  return result;
}

List<TerminalInfo> _toTerminals(List<Object?> items) {
  final result = <TerminalInfo>[];
  for (final item in items) {
    if (item is Map<Object?, Object?>) {
      result.add(TerminalInfo.fromJson(asJsonObject(item, context: 'terminal')));
    }
  }
  return result;
}

JsonObject _asRaw(Object? data) {
  if (data is Map<Object?, Object?>) {
    return asJsonObject(data, context: 'page');
  }
  return const <String, Object?>{};
}
