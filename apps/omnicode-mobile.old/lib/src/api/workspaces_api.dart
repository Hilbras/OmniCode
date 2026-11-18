import 'dart:io';

import '../config/server_config.dart';
import 'api_client.dart';
import 'envelope.dart';

class WorkspaceRef {
  const WorkspaceRef({required this.id, required this.raw});

  factory WorkspaceRef.fromJson(JsonObject json) => WorkspaceRef(
        id: readIdentifier(json, 'id') ??
            readIdentifier(json, 'workspace_id') ??
            readIdentifier(json, 'workspaceId'),
        raw: json,
      );

  final String? id;
  final JsonObject raw;

  String? get root =>
      readString(raw, 'root') ?? readString(raw, 'path') ?? readString(raw, 'dir');

  String? get name => readString(raw, 'name') ?? readString(raw, 'title');

  String get label {
    final displayName = name;
    if (displayName != null && displayName.trim().isNotEmpty) {
      return displayName;
    }
    final rootPath = root;
    if (rootPath != null && rootPath.trim().isNotEmpty) {
      final segments = rootPath.split(Platform.pathSeparator);
      final last = segments.where((segment) => segment.isNotEmpty).toList();
      if (last.isNotEmpty) {
        return last.last;
      }
      return rootPath;
    }
    final workspaceId = id;
    if (workspaceId != null) {
      return workspaceId;
    }
    return 'Workspace without an id';
  }
}

class WorkspacesApi {
  const WorkspacesApi(this._client);

  final ApiClient _client;

  Future<List<WorkspaceRef>> listWorkspaces() async {
    final data = await _client.get(ApiPaths.workspaces);
    return _itemsOf(data).map(WorkspaceRef.fromJson).toList();
  }
}

List<JsonObject> _itemsOf(Object? data) {
  if (data is List<Object?>) {
    return data
        .whereType<Map<Object?, Object?>>()
        .map((item) => asJsonObject(item, context: 'workspace'))
        .toList();
  }
  if (data is Map<Object?, Object?>) {
    final raw = asJsonObject(data, context: 'workspace page');
    for (final key in const <String>['items', 'workspaces', 'results', 'list']) {
      final value = raw[key];
      if (value is List<Object?>) {
        return value
            .whereType<Map<Object?, Object?>>()
            .map((item) => asJsonObject(item, context: 'workspace'))
            .toList();
      }
    }
  }
  return const <JsonObject>[];
}
