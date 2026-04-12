enum MessageRole { user, assistant, system }

class ToolCall {
  final String id;
  final String name;
  String inputJson;
  String? result;
  bool isError;
  bool isDone;

  ToolCall({
    required this.id,
    required this.name,
    this.inputJson = '',
    this.result,
    this.isError = false,
    this.isDone = false,
  });

  Map<String, dynamic>? get parsedInput {
    try {
      if (inputJson.isEmpty) return null;
      return _jsonDecode(inputJson);
    } catch (_) {
      return null;
    }
  }

  String get description {
    final p = parsedInput;
    if (p == null) return '';
    return (p['description'] ?? p['command'] ?? p['pattern'] ?? p['file_path'] ?? '').toString();
  }
}

Map<String, dynamic> _jsonDecode(String s) {
  // Simple wrapper — dart:convert is imported at use site
  return {};
}

class ChatMessage {
  final MessageRole role;
  String content;
  final List<ToolCall> toolCalls;
  final DateTime timestamp;
  bool isStreaming;
  double? cost;

  ChatMessage({
    required this.role,
    this.content = '',
    List<ToolCall>? toolCalls,
    DateTime? timestamp,
    this.isStreaming = false,
    this.cost,
  })  : toolCalls = toolCalls ?? [],
        timestamp = timestamp ?? DateTime.now();

  ChatMessage.fromHistory(Map<String, dynamic> json)
      : role = json['role'] == 'user' ? MessageRole.user : MessageRole.assistant,
        content = (json['content'] ?? '').toString(),
        toolCalls = _parseHistoryTools(json['tools']),
        timestamp = json['ts'] != null
            ? DateTime.fromMillisecondsSinceEpoch((json['ts'] as num).toInt() * 1000)
            : DateTime.now(),
        isStreaming = false,
        cost = (json['cost'] as num?)?.toDouble();

  static List<ToolCall> _parseHistoryTools(dynamic tools) {
    if (tools is! List) return [];
    return tools.map((t) {
      final tc = ToolCall(
        id: (t['id'] ?? '').toString(),
        name: (t['name'] ?? '').toString(),
        inputJson: t['input'] != null ? t['input'].toString() : '',
        result: t['result']?.toString(),
        isError: t['is_error'] == true,
        isDone: true,
      );
      return tc;
    }).toList();
  }
}

class Session {
  final String id;
  final String cwd;
  final DateTime createdAt;
  final String? claudeSessionId;

  Session({
    required this.id,
    required this.cwd,
    required this.createdAt,
    this.claudeSessionId,
  });

  factory Session.fromJson(Map<String, dynamic> json) {
    return Session(
      id: (json['id'] ?? '').toString(),
      cwd: (json['cwd'] ?? '').toString(),
      createdAt: json['createdAt'] != null
          ? DateTime.tryParse(json['createdAt'].toString()) ?? DateTime.now()
          : DateTime.now(),
      claudeSessionId: json['claudeSessionId']?.toString(),
    );
  }

  String get displayName => id.length > 12 ? id.substring(0, 12) : id;
  String get shortCwd {
    if (cwd.isEmpty) return '/';
    final parts = cwd.split('/');
    return parts.last.isEmpty ? '/' : parts.last;
  }
}
