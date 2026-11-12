typedef JsonObject = Map<String, Object?>;

class ApiCodes {
  ApiCodes._();

  static const int success = 0;
  static const int unauthorized = 40101;
  static const int clientError = -1;
}

enum FailureSource { rest, ws, client }

class ApiFailure implements Exception {
  const ApiFailure({
    required this.code,
    required this.message,
    this.source = FailureSource.rest,
    this.fatal = false,
    this.requestId,
    this.details,
    this.httpStatus,
  });

  factory ApiFailure.client(String message) => ApiFailure(
        code: ApiCodes.clientError,
        message: message,
        source: FailureSource.client,
      );

  factory ApiFailure.malformed(
    String message, {
    FailureSource source = FailureSource.rest,
    int? httpStatus,
  }) =>
      ApiFailure(
        code: ApiCodes.clientError,
        message: message,
        source: source,
        httpStatus: httpStatus,
      );

  final int code;
  final String message;
  final FailureSource source;
  final bool fatal;
  final String? requestId;
  final Object? details;
  final int? httpStatus;

  bool get isUnauthorized => code == ApiCodes.unauthorized || httpStatus == 401;

  bool get isLocal => code == ApiCodes.clientError;

  String describe() {
    final buffer = StringBuffer('[$code] $message');
    final id = requestId;
    if (id != null && id.isNotEmpty) {
      buffer.write(' (request_id: $id)');
    }
    if (fatal) {
      buffer.write(' (fatal)');
    }
    return buffer.toString();
  }

  @override
  String toString() =>
      'ApiFailure(${source.name}, code: $code, message: $message, fatal: $fatal)';
}

JsonObject asJsonObject(Object? value, {String context = 'payload'}) {
  if (value is Map<String, Object?>) {
    return value;
  }
  if (value is Map<Object?, Object?>) {
    final result = <String, Object?>{};
    value.forEach((key, entry) {
      result[key.toString()] = entry;
    });
    return result;
  }
  throw FormatException('$context: expected a JSON object', value);
}

List<Object?> asJsonList(Object? value, {String context = 'payload'}) {
  if (value is List<Object?>) {
    return value;
  }
  throw FormatException('$context: expected a JSON array', value);
}

String? readString(JsonObject source, String key) {
  final value = source[key];
  return value is String ? value : null;
}

String? readIdentifier(JsonObject source, String key) {
  final value = source[key];
  if (value is String) {
    return value.isEmpty ? null : value;
  }
  if (value is num) {
    return value.toString();
  }
  return null;
}

int? readInt(JsonObject source, String key) {
  final value = source[key];
  if (value is int) {
    return value;
  }
  if (value is num) {
    return value.toInt();
  }
  if (value is String) {
    return int.tryParse(value);
  }
  return null;
}

bool? readBool(JsonObject source, String key) {
  final value = source[key];
  return value is bool ? value : null;
}

JsonObject? readObject(JsonObject source, String key) {
  final value = source[key];
  if (value is Map<Object?, Object?>) {
    return asJsonObject(value, context: key);
  }
  return null;
}

List<Object?> readList(JsonObject source, String key) {
  final value = source[key];
  if (value is List<Object?>) {
    return value;
  }
  return const <Object?>[];
}

List<String> readStringList(JsonObject source, String key) {
  final result = <String>[];
  for (final item in readList(source, key)) {
    if (item is String) {
      result.add(item);
    }
  }
  return result;
}

Map<String, List<String>> readStringListMap(JsonObject source, String key) {
  final value = source[key];
  if (value is! Map<Object?, Object?>) {
    return const <String, List<String>>{};
  }
  final result = <String, List<String>>{};
  value.forEach((mapKey, mapValue) {
    if (mapValue is List<Object?>) {
      final entries = <String>[];
      for (final item in mapValue) {
        if (item is String) {
          entries.add(item);
        }
      }
      result[mapKey.toString()] = entries;
    }
  });
  return result;
}

class ApiEnvelope {
  const ApiEnvelope({
    required this.code,
    required this.msg,
    required this.data,
    this.requestId,
    this.details,
    this.stack,
  });

  factory ApiEnvelope.decode(Object? raw) {
    final map = asJsonObject(raw, context: 'envelope');
    final code = readInt(map, 'code') ?? ApiCodes.success;
    return ApiEnvelope(
      code: code,
      msg: readString(map, 'msg') ??
          (code == ApiCodes.success ? 'success' : 'error'),
      data: map['data'],
      requestId: readString(map, 'request_id'),
      details: map['details'],
      stack: readString(map, 'stack'),
    );
  }

  final int code;
  final String msg;
  final Object? data;
  final String? requestId;
  final Object? details;
  final String? stack;

  bool get isSuccess => code == ApiCodes.success;

  JsonObject? get dataObject => data is Map<Object?, Object?>
      ? asJsonObject(data, context: 'data')
      : null;

  List<Object?> get dataList => data is List<Object?>
      ? asJsonList(data, context: 'data')
      : const <Object?>[];
}
