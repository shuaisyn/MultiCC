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

  Future<void> createSession({required String cwd, String? name}) async {
    final body = <String, dynamic>{'cwd': cwd};
    if (name != null && name.isNotEmpty) body['id'] = name;
    final res = await http
        .post(
          Uri.parse(_url('/api/sessions')),
          headers: _headers,
          body: jsonEncode(body),
        )
        .timeout(const Duration(seconds: 10));
    if (res.statusCode >= 400) throw Exception('${res.statusCode}');
  }
}
