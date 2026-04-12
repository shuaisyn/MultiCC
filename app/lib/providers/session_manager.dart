import 'dart:async';
import 'package:flutter/widgets.dart';

import '../models/message.dart';
import '../services/chat_service.dart';
import '../services/session_service.dart';
import '../services/settings_service.dart';
import 'chat_provider.dart';

class SessionManager extends ChangeNotifier with WidgetsBindingObserver {
  final SettingsService settings;
  late final SessionService _sessionService;

  /// Active ChatProviders keyed by session name.
  final Map<String, ChatProvider> _providers = {};
  Map<String, ChatProvider> get allProviders => Map.unmodifiable(_providers);

  /// Currently viewed session (null = show session list).
  String? _activeSessionId;
  String? get activeSessionId => _activeSessionId;
  ChatProvider? get activeProvider =>
      _activeSessionId != null ? _providers[_activeSessionId] : null;

  /// Session list from REST API.
  List<Session> _sessions = [];
  List<Session> get sessions => List.unmodifiable(_sessions);
  bool _loadingSessions = true;
  bool get loadingSessions => _loadingSessions;
  String? _sessionsError;
  String? get sessionsError => _sessionsError;

  Timer? _refreshTimer;
  bool _isInBackground = false;

  SessionManager({required this.settings}) {
    _sessionService = SessionService(settings: settings);
    WidgetsBinding.instance.addObserver(this);
    loadSessions();
    _refreshTimer = Timer.periodic(const Duration(seconds: 5), (_) => loadSessions());
  }

  // ── App lifecycle ──────────────────────────────────────────────────────────

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _isInBackground = false;
      for (final p in _providers.values) {
        p.isInBackground = false;
        if (p.connectionState == ChatConnectionState.disconnected) {
          p.reconnect();
        }
      }
    } else if (state == AppLifecycleState.paused || state == AppLifecycleState.hidden) {
      _isInBackground = true;
      for (final p in _providers.values) {
        p.isInBackground = true;
      }
    }
  }

  // ── Session list (REST) ────────────────────────────────────────────────────

  Future<void> loadSessions() async {
    try {
      final list = await _sessionService.fetchSessions();
      _sessions = list;
      _loadingSessions = false;
      _sessionsError = null;
      notifyListeners();
    } catch (e) {
      _loadingSessions = false;
      _sessionsError = e.toString();
      notifyListeners();
    }
  }

  // ── Multi-session management ───────────────────────────────────────────────

  /// Open (or reuse) a chat connection for a session.
  ChatProvider openSession(String name, String cwd) {
    if (_providers.containsKey(name)) return _providers[name]!;
    final provider = ChatProvider(
      settings: settings,
      sessionName: name,
      sessionCwd: cwd,
    )
      ..isActive = false
      ..isInBackground = _isInBackground;
    _providers[name] = provider;
    return provider;
  }

  /// Switch the visible session.
  void switchToSession(String name) {
    // Mark old active as inactive
    if (_activeSessionId != null && _providers.containsKey(_activeSessionId!)) {
      _providers[_activeSessionId!]!.isActive = false;
    }
    _activeSessionId = name;
    if (_providers.containsKey(name)) {
      _providers[name]!.isActive = true;
    }
    notifyListeners();
  }

  /// Go back to session list (no active session).
  void goToSessionList() {
    if (_activeSessionId != null && _providers.containsKey(_activeSessionId!)) {
      _providers[_activeSessionId!]!.isActive = false;
    }
    _activeSessionId = null;
    notifyListeners();
  }

  /// Close a background chat connection.
  void closeSession(String name) {
    final p = _providers.remove(name);
    p?.dispose();
    if (_activeSessionId == name) {
      _activeSessionId = null;
    }
    notifyListeners();
  }

  // ── Session actions (REST) ─────────────────────────────────────────────────

  Future<void> deleteSession(String id) async {
    await _sessionService.deleteSession(id);
    closeSession(id);
    loadSessions();
  }

  Future<void> restartSession(String id) async {
    await _sessionService.restartSession(id);
    loadSessions();
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _refreshTimer?.cancel();
    for (final p in _providers.values) {
      p.dispose();
    }
    _providers.clear();
    super.dispose();
  }
}
