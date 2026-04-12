import 'dart:async';
import 'package:flutter/material.dart';
import 'package:timeago/timeago.dart' as timeago;

import '../models/message.dart';
import '../services/session_service.dart';
import '../services/settings_service.dart';
import 'terminal_screen.dart';
import 'chat_screen.dart';
import 'setup_screen.dart';

class SessionsScreen extends StatefulWidget {
  final SettingsService settings;
  const SessionsScreen({super.key, required this.settings});

  @override
  State<SessionsScreen> createState() => _SessionsScreenState();
}

class _SessionsScreenState extends State<SessionsScreen> {
  late final SessionService _svc;
  List<Session> _sessions = [];
  bool _loading = true;
  String? _error;
  Timer? _refreshTimer;

  @override
  void initState() {
    super.initState();
    _svc = SessionService(settings: widget.settings);
    _load();
    // Auto-refresh every 5 seconds
    _refreshTimer = Timer.periodic(const Duration(seconds: 5), (_) => _load());
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final sessions = await _svc.fetchSessions();
      if (!mounted) return;
      setState(() {
        _sessions = sessions;
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.toString();
      });
    }
  }

  Future<void> _delete(Session s) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: const Color(0xFF161b22),
        title: const Text('Delete Session', style: TextStyle(color: Color(0xFFf0f6fc))),
        content: Text(
          'Delete session "${s.displayName}"?\nThis will kill the tmux session.',
          style: const TextStyle(color: Color(0xFF8b949e)),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel', style: TextStyle(color: Color(0xFF8b949e))),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete', style: TextStyle(color: Color(0xFFf85149))),
          ),
        ],
      ),
    );
    if (confirm != true) return;
    try {
      await _svc.deleteSession(s.id);
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed: $e'), backgroundColor: const Color(0xFFf85149)),
      );
    }
  }

  Future<void> _restart(Session s) async {
    try {
      await _svc.restartSession(s.id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Session restarted'), backgroundColor: Color(0xFF238636)),
      );
      _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed: $e'), backgroundColor: const Color(0xFFf85149)),
      );
    }
  }

  void _openTerminal(Session s) {
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => TerminalScreen(settings: widget.settings, session: s),
    ));
  }

  void _openChat(Session s) {
    // Save session name and CWD, then open chat
    widget.settings.save(session: s.id, cwd: s.cwd);
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => ChatScreen(settings: widget.settings),
    ));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0d1117),
      appBar: AppBar(
        backgroundColor: const Color(0xFF161b22),
        foregroundColor: const Color(0xFFc9d1d9),
        elevation: 0,
        centerTitle: false,
        title: Row(
          children: [
            RichText(
              text: const TextSpan(
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                children: [
                  TextSpan(text: 'Web', style: TextStyle(color: Color(0xFFf78166))),
                  TextSpan(text: 'CC', style: TextStyle(color: Color(0xFF79c0ff))),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: const Color(0xFF6e40c9),
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Text('Sessions', style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w600)),
            ),
            const SizedBox(width: 8),
            if (!_loading)
              Text(
                '${_sessions.length} active',
                style: const TextStyle(color: Color(0xFF8b949e), fontSize: 12, fontWeight: FontWeight.normal),
              ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded, size: 20),
            onPressed: _load,
            tooltip: 'Refresh',
          ),
          IconButton(
            icon: const Icon(Icons.settings_outlined, size: 20),
            onPressed: () {
              Navigator.of(context).pushReplacement(
                MaterialPageRoute(
                  builder: (_) => SetupScreen(settings: widget.settings),
                ),
              );
            },
            tooltip: 'Settings',
          ),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1),
          child: Container(height: 1, color: const Color(0xFF30363d)),
        ),
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading && _sessions.isEmpty) {
      return const Center(
        child: CircularProgressIndicator(color: Color(0xFF58a6ff)),
      );
    }

    if (_error != null && _sessions.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, color: Color(0xFFf85149), size: 48),
            const SizedBox(height: 12),
            Text(_error!, style: const TextStyle(color: Color(0xFF8b949e)), textAlign: TextAlign.center),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: _load,
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF21262d)),
              child: const Text('Retry'),
            ),
          ],
        ),
      );
    }

    if (_sessions.isEmpty) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.terminal, color: Color(0xFF6e7681), size: 48),
            SizedBox(height: 12),
            Text('No active sessions', style: TextStyle(color: Color(0xFF6e7681), fontSize: 15)),
            SizedBox(height: 6),
            Text(
              'Start a session from the terminal or chat.',
              style: TextStyle(color: Color(0xFF484f58), fontSize: 13),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _load,
      color: const Color(0xFF58a6ff),
      backgroundColor: const Color(0xFF161b22),
      child: ListView.separated(
        padding: const EdgeInsets.all(12),
        itemCount: _sessions.length,
        separatorBuilder: (_, __) => const SizedBox(height: 8),
        itemBuilder: (_, i) => _SessionCard(
          session: _sessions[i],
          onTerminal: () => _openTerminal(_sessions[i]),
          onChat: () => _openChat(_sessions[i]),
          onDelete: () => _delete(_sessions[i]),
          onRestart: () => _restart(_sessions[i]),
        ),
      ),
    );
  }
}

class _SessionCard extends StatelessWidget {
  final Session session;
  final VoidCallback onTerminal;
  final VoidCallback onChat;
  final VoidCallback onDelete;
  final VoidCallback onRestart;

  const _SessionCard({
    required this.session,
    required this.onTerminal,
    required this.onChat,
    required this.onDelete,
    required this.onRestart,
  });

  @override
  Widget build(BuildContext context) {
    final ago = timeago.format(session.createdAt, locale: 'en_short');

    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFF161b22),
        border: Border.all(color: const Color(0xFF30363d)),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
            child: Row(
              children: [
                Container(
                  width: 8,
                  height: 8,
                  decoration: const BoxDecoration(
                    color: Color(0xFF3fb950),
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    session.id,
                    style: const TextStyle(
                      color: Color(0xFF58a6ff),
                      fontWeight: FontWeight.bold,
                      fontSize: 16,
                      fontFamily: 'monospace',
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                Text(
                  ago,
                  style: const TextStyle(color: Color(0xFF6e7681), fontSize: 12),
                ),
              ],
            ),
          ),

          // CWD
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
            child: Row(
              children: [
                const Icon(Icons.folder_outlined, size: 13, color: Color(0xFF6e7681)),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    session.cwd.isEmpty ? '/' : session.cwd,
                    style: const TextStyle(
                      color: Color(0xFF58a6ff),
                      fontSize: 12,
                      fontFamily: 'monospace',
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ),

          // Divider
          const Divider(height: 1, color: Color(0xFF21262d)),

          // Action buttons
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
            child: Row(
              children: [
                _Btn(icon: Icons.terminal_rounded, label: 'Terminal', onTap: onTerminal, color: const Color(0xFF79c0ff)),
                const SizedBox(width: 6),
                _Btn(icon: Icons.chat_bubble_outline_rounded, label: 'Chat', onTap: onChat, color: const Color(0xFF3fb950)),
                const Spacer(),
                _IconBtn(icon: Icons.restart_alt_rounded, onTap: onRestart, tooltip: 'Restart'),
                const SizedBox(width: 4),
                _IconBtn(icon: Icons.delete_outline_rounded, onTap: onDelete, tooltip: 'Delete', color: const Color(0xFFf85149)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Btn extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final Color color;

  const _Btn({required this.icon, required this.label, required this.onTap, required this.color});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: const Color(0xFF21262d),
          border: Border.all(color: const Color(0xFF30363d)),
          borderRadius: BorderRadius.circular(6),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 14, color: color),
            const SizedBox(width: 5),
            Text(label, style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w500)),
          ],
        ),
      ),
    );
  }
}

class _IconBtn extends StatelessWidget {
  final IconData icon;
  final VoidCallback onTap;
  final String tooltip;
  final Color color;

  const _IconBtn({
    required this.icon,
    required this.onTap,
    required this.tooltip,
    this.color = const Color(0xFF8b949e),
  });

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(6),
          decoration: BoxDecoration(
            color: const Color(0xFF21262d),
            border: Border.all(color: const Color(0xFF30363d)),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Icon(icon, size: 16, color: color),
        ),
      ),
    );
  }
}
