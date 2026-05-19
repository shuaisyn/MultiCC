import 'dart:convert';
import 'package:http/http.dart' as http;

import '../models/message.dart';
import 'settings_service.dart';

class SessionService {
  final SettingsService settings;

  SessionService({required this.settings});

  Map<String, String> get _headers {
    final h = <String, String>{'Content-Type': 'application/json'};
    if (settings.token.isNotEmpty) {
      h['X-Access-Token'] = settings.token;
    }
    return h;
  }

  String _url(String path) => settings.buildHttpUrl(path);

  // ── Sessions ──────────────────────────────────────────────────────────────

  Future<List<Session>> fetchSessions() async {
    final res = await http
        .get(Uri.parse(_url('/api/sessions')), headers: _headers)
        .timeout(const Duration(seconds: 10));
    if (res.statusCode != 200) throw Exception('${res.statusCode}');
    final list = jsonDecode(res.body) as List;
    return list.map((j) => Session.fromJson(j as Map<String, dynamic>)).toList();
  }

  Future<void> deleteSession(String id) async {
    final res = await http
        .delete(Uri.parse(_url('/api/sessions/$id')), headers: _headers)
        .timeout(const Duration(seconds: 10));
    if (res.statusCode >= 400) throw Exception('${res.statusCode}');
  }

  Future<void> restartSession(String id) async {
    final res = await http
        .post(Uri.parse(_url('/api/sessions/$id/restart')), headers: _headers)
        .timeout(const Duration(seconds: 10));
    if (res.statusCode >= 400) throw Exception('${res.statusCode}');
  }

  Future<void> updateSessionLabel(String id, String? label) async {
    final res = await http
        .patch(
          Uri.parse(_url('/api/sessions/$id')),
          headers: _headers,
          body: jsonEncode({'label': label ?? ''}),
        )
        .timeout(const Duration(seconds: 10));
    if (res.statusCode >= 400) throw Exception('${res.statusCode}');
  }

  // ── Directories ──────────────────────────────────────────────────────────

  Future<List<Directory>> fetchDirectories() async {
    final res = await http
        .get(Uri.parse(_url('/api/directories')), headers: _headers)
        .timeout(const Duration(seconds: 10));
    if (res.statusCode != 200) throw Exception('${res.statusCode}');
    final list = jsonDecode(res.body) as List;
    return list.map((j) => Directory.fromJson(j as Map<String, dynamic>)).toList();
  }

  Future<Directory> createDirectory({required String name, required String path}) async {
    final res = await http
        .post(
          Uri.parse(_url('/api/directories')),
          headers: _headers,
          body: jsonEncode({'name': name, 'path': path}),
        )
        .timeout(const Duration(seconds: 10));
    if (res.statusCode >= 400) {
      final err = _tryParseError(res.body);
      throw Exception(err ?? '${res.statusCode}');
    }
    return Directory.fromJson(jsonDecode(res.body) as Map<String, dynamic>);
  }

  Future<void> deleteDirectory(String id, {bool force = true}) async {
    final qs = force ? '?force=1' : '';
    final res = await http
        .delete(Uri.parse(_url('/api/directories/$id$qs')), headers: _headers)
        .timeout(const Duration(seconds: 10));
    if (res.statusCode >= 400) {
      final err = _tryParseError(res.body);
      throw Exception(err ?? '${res.statusCode}');
    }
  }

  /// Create a new session inside a directory. Server does not spawn the
  /// underlying CLI until the WebSocket connects.
  Future<Session> createSessionInDir({
    required String dirId,
    required SessionCli cli,
    required SessionKind kind,
    String? label,
  }) async {
    final body = <String, dynamic>{'cli': cli.name, 'kind': kind.name};
    if (label != null && label.isNotEmpty) body['label'] = label;
    final res = await http
        .post(
          Uri.parse(_url('/api/directories/$dirId/sessions')),
          headers: _headers,
          body: jsonEncode(body),
        )
        .timeout(const Duration(seconds: 10));
    if (res.statusCode >= 400) {
      final err = _tryParseError(res.body);
      throw Exception(err ?? '${res.statusCode}');
    }
    return Session.fromJson(jsonDecode(res.body) as Map<String, dynamic>);
  }

  String? _tryParseError(String body) {
    try {
      final j = jsonDecode(body);
      if (j is Map && j['error'] != null) return j['error'].toString();
    } catch (_) {}
    return null;
  }
}
