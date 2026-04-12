import 'package:shared_preferences/shared_preferences.dart';

class SettingsService {
  static const _keyHost = 'multicc_host';
  static const _keyToken = 'multicc_token';
  static const _keySession = 'multicc_session';
  static const _keyCwd = 'multicc_cwd';

  static SettingsService? _instance;
  late SharedPreferences _prefs;

  SettingsService._();

  static Future<SettingsService> getInstance() async {
    if (_instance == null) {
      _instance = SettingsService._();
      _instance!._prefs = await SharedPreferences.getInstance();
    }
    return _instance!;
  }

  String get host => _prefs.getString(_keyHost) ?? '';
  String get token => _prefs.getString(_keyToken) ?? '';
  String get session => _prefs.getString(_keySession) ?? '';
  String get cwd => _prefs.getString(_keyCwd) ?? '';

  bool get isConfigured => host.isNotEmpty;

  Future<void> save({
    String? host,
    String? token,
    String? session,
    String? cwd,
  }) async {
    if (host != null) await _prefs.setString(_keyHost, host.trim());
    if (token != null) await _prefs.setString(_keyToken, token.trim());
    if (session != null) await _prefs.setString(_keySession, session);
    if (cwd != null) await _prefs.setString(_keyCwd, cwd);
  }

  /// Build ws[s]:// URL for /ws/chat
  String buildWsUrl({String? resumeId}) {
    var h = host;
    // Normalise: strip trailing slash and scheme
    h = h.replaceAll(RegExp(r'/$'), '');
    final isHttps = h.startsWith('https://');
    final wsScheme = isHttps ? 'wss' : 'ws';
    final bare = h.replaceFirst(RegExp(r'^https?://'), '');

    final params = <String, String>{};
    if (token.isNotEmpty) params['token'] = token;
    if (cwd.isNotEmpty) params['cwd'] = cwd;
    if (session.isNotEmpty) params['session'] = session;
    if (resumeId != null && resumeId.isNotEmpty) params['resume'] = resumeId;

    final query = params.entries.map((e) =>
        '${Uri.encodeQueryComponent(e.key)}=${Uri.encodeQueryComponent(e.value)}').join('&');

    return '$wsScheme://$bare/ws/chat${query.isNotEmpty ? '?$query' : ''}';
  }

  /// Build http[s]:// URL for REST endpoints
  String buildHttpUrl(String path) {
    var h = host.replaceAll(RegExp(r'/$'), '');
    if (!h.startsWith('http')) h = 'http://$h';
    return '$h$path';
  }
}
