class ApiPaths {
  ApiPaths._();

  static const String base = '/api/v1';
  static const String healthz = '/api/v1/healthz';
  static const String sessions = '/api/v1/sessions';
  static const String workspaces = '/api/v1/workspaces';
  static const String ws = '/api/v1/ws';

  static String session(String sessionId) =>
      '$sessions/${Uri.encodeComponent(sessionId)}';

  static String terminals(String sessionId) => '${session(sessionId)}/terminals';

  static String messages(String sessionId) => '${session(sessionId)}/messages';

  static String prompts(String sessionId) => '${session(sessionId)}/prompts';

  static String terminal(String sessionId, String terminalId) =>
      '${terminals(sessionId)}/${Uri.encodeComponent(terminalId)}';

  static String terminalClose(String sessionId, String terminalId) =>
      '${terminal(sessionId, terminalId)}/close';
}

class ServerConfigException implements Exception {
  const ServerConfigException(this.message);

  final String message;

  @override
  String toString() => message;
}

class ServerConfig {
  ServerConfig._({
    required this.baseUrl,
    required this.token,
    required Uri baseUri,
  }) : _baseUri = baseUri;

  factory ServerConfig.parse({
    required String baseUrl,
    required String token,
  }) {
    final trimmed = baseUrl.trim();
    if (trimmed.isEmpty) {
      throw const ServerConfigException(
        'Enter the daemon URL, for example http://192.168.1.20:8787',
      );
    }
    var uri = Uri.tryParse(trimmed);
    if (uri == null || !uri.hasAuthority) {
      uri = Uri.tryParse('http://$trimmed');
    }
    if (uri == null) {
      throw ServerConfigException('"$trimmed" is not a valid URL');
    }
    if (uri.scheme != 'http' && uri.scheme != 'https') {
      throw ServerConfigException(
        'Only http and https daemons are supported, got "${uri.scheme}"',
      );
    }
    if (uri.host.isEmpty) {
      throw ServerConfigException('"$trimmed" has no host');
    }
    return ServerConfig._(
      baseUrl: trimmed,
      token: token,
      baseUri: uri.replace(
        path: _withoutTrailingSlash(uri.path),
        queryParameters: const <String, String>{},
        fragment: '',
      ),
    );
  }

  final String baseUrl;
  final String token;
  final Uri _baseUri;

  bool get hasToken => token.trim().isNotEmpty;

  String get displayUrl => _baseUri.toString();

  Uri apiUrl(String path, {Map<String, String>? query}) {
    final normalized = path.startsWith('/') ? path : '/$path';
    return _baseUri.replace(
      path: '${_baseUri.path}$normalized',
      queryParameters: query ?? const <String, String>{},
    );
  }

  Uri get wsUrl => _baseUri.replace(
        scheme: _baseUri.scheme == 'https' ? 'wss' : 'ws',
        path: '${_baseUri.path}${ApiPaths.ws}',
        queryParameters: const <String, String>{},
      );

  @override
  bool operator ==(Object other) =>
      other is ServerConfig &&
      other.baseUrl == baseUrl &&
      other.token == token;

  @override
  int get hashCode => Object.hash(baseUrl, token);

  @override
  String toString() => 'ServerConfig($displayUrl, token: ${hasToken ? 'set' : 'empty'})';
}

String _withoutTrailingSlash(String path) {
  if (path.isEmpty) {
    return '';
  }
  return path.endsWith('/') ? path.substring(0, path.length - 1) : path;
}
