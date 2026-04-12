import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:xterm/xterm.dart';

import 'settings_service.dart';

enum TerminalConnectionState { disconnected, connecting, connected }

class TerminalService {
  final SettingsService settings;
  final String sessionId;
  final Terminal terminal;

  WebSocketChannel? _channel;
  StreamSubscription? _sub;

  TerminalConnectionState _state = TerminalConnectionState.disconnected;
  TerminalConnectionState get state => _state;

  final _stateCtrl = StreamController<TerminalConnectionState>.broadcast();
  Stream<TerminalConnectionState> get onStateChange => _stateCtrl.stream;

  int _reconnectAttempt = 0;
  Timer? _reconnectTimer;
  bool _disposed = false;

  // Track last sent size to avoid no-op resizes
  int _lastCols = 0;
  int _lastRows = 0;

  TerminalService({
    required this.settings,
    required this.sessionId,
  }) : terminal = Terminal(maxLines: 5000) {
    terminal.onOutput = _onTerminalOutput;
    terminal.onResize = (w, h, pw, ph) => _onTerminalResize(w, h);
  }

  void connect() {
    if (_disposed) return;
    _reconnectTimer?.cancel();
    _state = TerminalConnectionState.connecting;
    _stateCtrl.add(_state);

    final url = _buildUrl();
    try {
      _channel = WebSocketChannel.connect(Uri.parse(url));
      _sub?.cancel();
      _sub = _channel!.stream.listen(
        _onMessage,
        onError: (_) => _scheduleReconnect(),
        onDone: _scheduleReconnect,
      );
      _state = TerminalConnectionState.connected;
      _reconnectAttempt = 0;
      _stateCtrl.add(_state);
      // Send initial resize
      _sendResize(terminal.viewWidth, terminal.viewHeight);
    } catch (_) {
      _scheduleReconnect();
    }
  }

  String _buildUrl() {
    var h = settings.host.replaceAll(RegExp(r'/$'), '');
    final isHttps = h.startsWith('https://');
    final wsScheme = isHttps ? 'wss' : 'ws';
    final bare = h.replaceFirst(RegExp(r'^https?://'), '');

    final params = <String, String>{'id': sessionId};
    if (settings.token.isNotEmpty) params['token'] = settings.token;

    final query = params.entries
        .map((e) => '${Uri.encodeQueryComponent(e.key)}=${Uri.encodeQueryComponent(e.value)}')
        .join('&');

    return '$wsScheme://$bare/?$query';
  }

  void _onMessage(dynamic raw) {
    if (raw is String) {
      // Server sends raw string output to write directly to terminal
      terminal.write(raw);
    } else if (raw is List<int>) {
      terminal.write(String.fromCharCodes(raw));
    }
  }

  void _onTerminalOutput(String data) {
    if (_channel == null) return;
    try {
      _channel!.sink.add(jsonEncode({'type': 'input', 'data': data}));
    } catch (_) {}
  }

  void _onTerminalResize(int width, int height) {
    _sendResize(width, height);
  }

  void _sendResize(int cols, int rows) {
    if (cols == _lastCols && rows == _lastRows) return;
    if (cols <= 0 || rows <= 0) return;
    _lastCols = cols;
    _lastRows = rows;
    try {
      _channel?.sink.add(jsonEncode({'type': 'resize', 'cols': cols, 'rows': rows}));
    } catch (_) {}
  }

  void _scheduleReconnect() {
    if (_disposed) return;
    _state = TerminalConnectionState.disconnected;
    _stateCtrl.add(_state);

    final delay = Duration(milliseconds: (_reconnectAttempt < 5)
        ? (1000 * (1 << _reconnectAttempt)).clamp(0, 15000)
        : 15000);
    _reconnectAttempt++;

    _reconnectTimer = Timer(delay, () {
      if (!_disposed) connect();
    });
  }

  void manualReconnect() {
    _reconnectAttempt = 0;
    _sub?.cancel();
    _channel?.sink.close();
    connect();
  }

  void dispose() {
    _disposed = true;
    _reconnectTimer?.cancel();
    _sub?.cancel();
    _channel?.sink.close();
    _stateCtrl.close();
  }
}
