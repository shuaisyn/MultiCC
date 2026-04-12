import 'package:flutter/material.dart';
import 'package:xterm/xterm.dart';

import '../models/message.dart';
import '../services/settings_service.dart';
import '../services/terminal_service.dart';

class TerminalScreen extends StatefulWidget {
  final SettingsService settings;
  final Session session;

  const TerminalScreen({
    super.key,
    required this.settings,
    required this.session,
  });

  @override
  State<TerminalScreen> createState() => _TerminalScreenState();
}

class _TerminalScreenState extends State<TerminalScreen> {
  late TerminalService _svc;
  TerminalConnectionState _connState = TerminalConnectionState.disconnected;

  @override
  void initState() {
    super.initState();
    _svc = TerminalService(settings: widget.settings, sessionId: widget.session.id);
    _svc.onStateChange.listen((s) {
      if (mounted) setState(() => _connState = s);
    });
    _svc.connect();
  }

  @override
  void dispose() {
    _svc.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0d1117),
      appBar: PreferredSize(
        preferredSize: const Size.fromHeight(48),
        child: _TerminalAppBar(
          session: widget.session,
          connState: _connState,
          onReconnect: _svc.manualReconnect,
        ),
      ),
      body: SafeArea(
        top: false,
        child: Column(
          children: [
            Expanded(
              child: TerminalView(
                _svc.terminal,
                theme: _kTerminalTheme,
                textStyle: const TerminalStyle(
                  fontSize: 13,
                  fontFamily: 'monospace',
                ),
                autofocus: true,
                backgroundOpacity: 1.0,
                padding: const EdgeInsets.all(4),
                onSecondaryTapDown: (details, offset) {
                  // Context menu for copy on long press could be added here
                },
              ),
            ),
            _MobileKeyBar(terminal: _svc.terminal),
          ],
        ),
      ),
    );
  }
}

class _TerminalAppBar extends StatelessWidget {
  final Session session;
  final TerminalConnectionState connState;
  final VoidCallback onReconnect;

  const _TerminalAppBar({
    required this.session,
    required this.connState,
    required this.onReconnect,
  });

  @override
  Widget build(BuildContext context) {
    Color dotColor;
    String stateLabel;
    switch (connState) {
      case TerminalConnectionState.connected:
        dotColor = const Color(0xFF3fb950);
        stateLabel = 'Connected';
        break;
      case TerminalConnectionState.connecting:
        dotColor = const Color(0xFFd29922);
        stateLabel = 'Connecting…';
        break;
      case TerminalConnectionState.disconnected:
        dotColor = const Color(0xFF6e7681);
        stateLabel = 'Disconnected';
        break;
    }

    return Container(
      decoration: const BoxDecoration(
        color: Color(0xFF161b22),
        border: Border(bottom: BorderSide(color: Color(0xFF30363d))),
      ),
      padding: EdgeInsets.fromLTRB(
        12, MediaQuery.of(context).padding.top + 4, 12, 4),
      child: Row(
        children: [
          GestureDetector(
            onTap: () => Navigator.of(context).pop(),
            child: const Icon(Icons.arrow_back_rounded, color: Color(0xFFc9d1d9), size: 20),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  session.id,
                  style: const TextStyle(
                    color: Color(0xFFf0f6fc),
                    fontWeight: FontWeight.w600,
                    fontSize: 14,
                    fontFamily: 'monospace',
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
                Row(
                  children: [
                    Container(
                      width: 6, height: 6,
                      decoration: BoxDecoration(color: dotColor, shape: BoxShape.circle),
                    ),
                    const SizedBox(width: 5),
                    Text(stateLabel, style: const TextStyle(color: Color(0xFF8b949e), fontSize: 11)),
                    const SizedBox(width: 8),
                    Text(
                      session.shortCwd,
                      style: const TextStyle(color: Color(0xFF484f58), fontSize: 11, fontFamily: 'monospace'),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ],
            ),
          ),
          if (connState == TerminalConnectionState.disconnected)
            GestureDetector(
              onTap: onReconnect,
              child: const Icon(Icons.refresh_rounded, color: Color(0xFF58a6ff), size: 20),
            ),
        ],
      ),
    );
  }
}

/// Mobile-friendly key bar for common terminal keys
class _MobileKeyBar extends StatelessWidget {
  final Terminal terminal;
  const _MobileKeyBar({required this.terminal});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: Color(0xFF161b22),
        border: Border(top: BorderSide(color: Color(0xFF30363d))),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            _Key('Ctrl+C', () => terminal.keyInput(TerminalKey.keyC, ctrl: true)),
            _Key('Ctrl+D', () => terminal.keyInput(TerminalKey.keyD, ctrl: true)),
            _Key('Ctrl+Z', () => terminal.keyInput(TerminalKey.keyZ, ctrl: true)),
            _Key('Tab', () => terminal.keyInput(TerminalKey.tab)),
            _Key('Esc', () => terminal.keyInput(TerminalKey.escape)),
            _Key('↑', () => terminal.keyInput(TerminalKey.arrowUp)),
            _Key('↓', () => terminal.keyInput(TerminalKey.arrowDown)),
            _Key('←', () => terminal.keyInput(TerminalKey.arrowLeft)),
            _Key('→', () => terminal.keyInput(TerminalKey.arrowRight)),
            _Key('Home', () => terminal.keyInput(TerminalKey.home)),
            _Key('End', () => terminal.keyInput(TerminalKey.end)),
          ],
        ),
      ),
    );
  }
}

class _Key extends StatelessWidget {
  final String label;
  final VoidCallback onTap;
  const _Key(this.label, this.onTap);

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 3),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: const Color(0xFF21262d),
          border: Border.all(color: const Color(0xFF30363d)),
          borderRadius: BorderRadius.circular(5),
        ),
        child: Text(
          label,
          style: const TextStyle(
            color: Color(0xFFc9d1d9),
            fontSize: 12,
            fontFamily: 'monospace',
          ),
        ),
      ),
    );
  }
}

/// Terminal color theme matching web client
const _kTerminalTheme = TerminalTheme(
  cursor: Color(0xFFf78166),
  selection: Color(0x44264f78),
  foreground: Color(0xFFc9d1d9),
  background: Color(0xFF0d1117),
  black: Color(0xFF484f58),
  red: Color(0xFFff7b72),
  green: Color(0xFF3fb950),
  yellow: Color(0xFFd29922),
  blue: Color(0xFF58a6ff),
  magenta: Color(0xFFbc8cff),
  cyan: Color(0xFF39c5cf),
  white: Color(0xFFb1bac4),
  brightBlack: Color(0xFF6e7681),
  brightRed: Color(0xFFffa198),
  brightGreen: Color(0xFF56d364),
  brightYellow: Color(0xFFe3b341),
  brightBlue: Color(0xFF79c0ff),
  brightMagenta: Color(0xFFd2a8ff),
  brightCyan: Color(0xFF56d4dd),
  brightWhite: Color(0xFFf0f6fc),
  searchHitBackground: Color(0xFFd29922),
  searchHitBackgroundCurrent: Color(0xFF3fb950),
  searchHitForeground: Color(0xFF0d1117),
);
