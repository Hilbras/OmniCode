import '../config/server_config.dart';
import 'api_client.dart';
import 'envelope.dart';

class ChatMessage {
  const ChatMessage({
    required this.id,
    required this.role,
    required this.text,
    required this.toolCalls,
    required this.createdAt,
  });

  factory ChatMessage.fromJson(JsonObject json) {
    final content = json['content'];
    final textParts = <String>[];
    final toolCalls = <String>[];
    if (content is List<Object?>) {
      for (final block in content) {
        if (block is! Map<Object?, Object?>) {
          continue;
        }
        final type = block['type'];
        if (type == 'text' && block['text'] is String) {
          textParts.add(block['text'] as String);
        } else if (type == 'tool_use' && block['tool_name'] is String) {
          toolCalls.add(block['tool_name'] as String);
        }
      }
    }
    return ChatMessage(
      id: readIdentifier(json, 'id') ?? readIdentifier(json, 'message_id') ?? '',
      role: readString(json, 'role') ?? 'assistant',
      text: textParts.join('\n'),
      toolCalls: toolCalls,
      createdAt: readString(json, 'created_at') ?? readString(json, 'createdAt'),
    );
  }

  final String id;
  final String role;
  final String text;
  final List<String> toolCalls;
  final String? createdAt;

  bool get isUser => role == 'user';

  bool get isAssistant => role == 'assistant';
}

class ChatMessagePage {
  const ChatMessagePage({required this.items, required this.raw});

  final List<ChatMessage> items;
  final JsonObject raw;

  String? get beforeId =>
      readIdentifier(raw, 'before_id') ?? readIdentifier(raw, 'beforeId');
}

class ChatApi {
  const ChatApi(this._client);

  final ApiClient _client;

  Future<ChatMessagePage> listMessages(
    String sessionId, {
    String? beforeId,
    int? pageSize,
  }) async {
    final query = <String, String>{};
    if (beforeId != null) {
      query['before_id'] = beforeId;
    }
    if (pageSize != null) {
      query['page_size'] = '$pageSize';
    }
    final data = await _client.get(
      ApiPaths.messages(sessionId),
      query: query.isEmpty ? null : query,
    );
    final raw = asJsonObject(data, context: 'message page');
    final items = <ChatMessage>[];
    for (final item in _itemsOf(raw)) {
      final message = ChatMessage.fromJson(item);
      if (message.text.isEmpty && message.toolCalls.isEmpty) {
        continue;
      }
      items.add(message);
    }
    // The daemon lists newest first; the chat renders oldest at the bottom.
    return ChatMessagePage(items: items.reversed.toList(), raw: raw);
  }

  Future<void> sendPrompt(String sessionId, String text) async {
    await _client.post(
      ApiPaths.prompts(sessionId),
      body: <String, Object?>{
        'content': <Object?>[
          <String, Object?>{'type': 'text', 'text': text},
        ],
      },
    );
  }
}

List<JsonObject> _itemsOf(JsonObject page) {
  final items = page['items'];
  if (items is List<Object?>) {
    return items
        .whereType<Map<Object?, Object?>>()
        .map((item) => asJsonObject(item, context: 'message'))
        .toList();
  }
  return const <JsonObject>[];
}
