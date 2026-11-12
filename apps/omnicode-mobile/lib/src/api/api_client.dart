import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/server_config.dart';
import 'envelope.dart';

class ApiClient {
  ApiClient({
    required ServerConfig config,
    http.Client? httpClient,
    Duration timeout = const Duration(seconds: 20),
  })  : _config = config,
        _httpClient = httpClient ?? http.Client(),
        _ownsHttpClient = httpClient == null,
        _timeout = timeout;

  final ServerConfig _config;
  final http.Client _httpClient;
  final bool _ownsHttpClient;
  final Duration _timeout;

  ServerConfig get config => _config;

  Future<void> healthz() async {
    await _send('GET', ApiPaths.healthz);
  }

  Future<Object?> get(String path, {Map<String, String>? query}) =>
      _send('GET', path, query: query);

  Future<Object?> post(
    String path, {
    Map<String, String>? query,
    Object? body,
  }) =>
      _send('POST', path, query: query, body: body);

  Future<Object?> _send(
    String method,
    String path, {
    Map<String, String>? query,
    Object? body,
  }) async {
    final uri = _config.apiUrl(path, query: query);
    final request = http.Request(method, uri)
      ..headers['Accept'] = 'application/json';
    if (_config.hasToken) {
      request.headers['Authorization'] = 'Bearer ${_config.token}';
    }
    if (body != null) {
      request.headers['Content-Type'] = 'application/json';
      request.body = jsonEncode(body);
    }

    final http.Response response;
    try {
      final streamed = await _httpClient.send(request).timeout(_timeout);
      response = await http.Response.fromStream(streamed).timeout(_timeout);
    } on TimeoutException {
      throw ApiFailure.client('$method ${uri.path} timed out');
    } on http.ClientException catch (error) {
      throw ApiFailure(
        code: ApiCodes.clientError,
        message: 'Network error talking to ${_config.displayUrl}: ${error.message}',
      );
    } catch (error) {
      throw ApiFailure(
        code: ApiCodes.clientError,
        message: '$method ${uri.path} failed: $error',
      );
    }
    return _decode(response);
  }

  Object? _decode(http.Response response) {
    final status = response.statusCode;
    final body = response.body;
    if (body.trim().isEmpty) {
      if (status >= 200 && status < 300) {
        return null;
      }
      throw ApiFailure(
        code: status,
        message: _reasonPhrase(response),
        httpStatus: status,
      );
    }

    final Object? decoded;
    try {
      decoded = jsonDecode(body);
    } on FormatException catch (error) {
      throw ApiFailure.malformed(
        'Server returned a body that is not JSON: ${error.message}',
        httpStatus: status,
      );
    }

    final ApiEnvelope envelope;
    try {
      envelope = ApiEnvelope.decode(decoded);
    } on FormatException catch (error) {
      throw ApiFailure.malformed(
        'Server response is not an Omnicode envelope: ${error.message}',
        httpStatus: status,
      );
    }

    if (!envelope.isSuccess || status >= 400) {
      throw ApiFailure(
        code: envelope.code == ApiCodes.success ? status : envelope.code,
        message: envelope.msg.isEmpty ? _reasonPhrase(response) : envelope.msg,
        source: FailureSource.rest,
        requestId: envelope.requestId,
        details: envelope.details,
        httpStatus: status,
      );
    }
    return envelope.data;
  }

  void close() {
    if (_ownsHttpClient) {
      _httpClient.close();
    }
  }
}

// HTTP/2 responses carry no reason phrase, so `reasonPhrase` is nullable.
String _reasonPhrase(http.Response response) =>
    response.reasonPhrase ?? 'HTTP ${response.statusCode}';
