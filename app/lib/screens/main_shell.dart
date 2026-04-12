import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:timeago/timeago.dart' as timeago;

import '../models/message.dart';
import '../providers/chat_provider.dart';
import '../providers/session_manager.dart';
import '../services/chat_service.dart';
import '../services/settings_service.dart';
import 'chat_screen.dart';
import 'setup_screen.dart';
import 'terminal_screen.dart';

class MainShell extends StatefulWidget {
  final SettingsService settings;
  const MainShell({super.key, required this.settings});

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  final _scaffoldKey = GlobalKey<ScaffoldState>();

  void _openDrawer() => _scaffoldKey.currentState?.openDrawer();

  @override
  Widget build(BuildContext context) {
    final mgr = context.watch<SessionManager>();
    final active = mgr.activeProvider;

    return Scaffold(
      key: _scaffoldKey,
      backgroundColor: const Color(0xFF0d1117),
      drawer: _SessionDrawer(settings: widget.settings),
      body: active == null
          ? _SessionListBody(settings: widget.settings, onOpenDrawer: _openDrawer)
          : ChangeNotifierProvider<ChatProvider>.value(
              value: active,
              child: ChatView(
                settings: widget.settings,
                onOpenDrawer: _openDrawer,
              ),
            ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DRAWER — compact session list for quick switching
// ═══════════════════════════════════════════════════════════════════════════════

class _SessionDrawer extends StatelessWidget {
  final SettingsService settings;
  const _SessionDrawer({required this.settings});

  @override
  Widget build(BuildContext context) {
    final mgr = context.watch<SessionManager>();
    final sessions = mgr.sessions;
    final activeId = mgr.activeSessionId;

    return Drawer(
      backgroundColor: const Color(0xFF161b22),
      child: SafeArea(
        child: Column(
          children: [
            // Header
            Container(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
              decoration: const BoxDecoration(
                border: Border(bottom: BorderSide(color: Color(0xFF30363d))),
              ),
              child: Row(
                children: [
                  RichText(
                    text: const TextSpan(
                      style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                      children: [
                        TextSpan(text: 'Web', style: TextStyle(color: Color(0xFFf78166))),
                        TextSpan(text: 'CC', style: TextStyle(color: Color(0xFF79c0ff))),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    '${sessions.length} sessions',
                    style: const TextStyle(color: Color(0xFF8b949e), fontSize: 12),
                  ),
                  const Spacer(),
                  GestureDetector(
                    onTap: () {
                      mgr.goToSessionList();
                      Navigator.pop(context);
                    },
                    child: const Icon(Icons.list_rounded, color: Color(0xFF8b949e), size: 20),
                  ),
                  const SizedBox(width: 12),
                  GestureDetector(
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => SetupScreen(settings: settings)),
                    ),
                    child: const Icon(Icons.settings_outlined, color: Color(0xFF8b949e), size: 20),
                  ),
                ],
              ),
            ),

            // Session list
            Expanded(
              child: sessions.isEmpty
                  ? const Center(
                      child: Text('No sessions', style: TextStyle(color: Color(0xFF6e7681))),
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      itemCount: sessions.length,
                      itemBuilder: (_, i) {
                        final s = sessions[i];
                        final isActive = s.id == activeId;
                        final provider = mgr.allProviders[s.id];
                        final connected = provider != null &&
                            provider.connectionState == ChatConnectionState.connected;

                        return _DrawerSessionTile(
                          session: s,
                          isActive: isActive,
                          isConnected: connected,
                          hasProvider: provider != null,
                          onTap: () {
                            mgr.openSession(s.id, s.cwd);
                            mgr.switchToSession(s.id);
                            Navigator.pop(context); // close drawer
                          },
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DrawerSessionTile extends StatelessWidget {
  final Session session;
  final bool isActive;
  final bool isConnected;
  final bool hasProvider;
  final VoidCallback onTap;

  const _DrawerSessionTile({
    required this.session,
    required this.isActive,
    required this.isConnected,
    required this.hasProvider,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 16),
        decoration: BoxDecoration(
          color: isActive ? const Color(0xFF21262d) : Colors.transparent,
          borderRadius: BorderRadius.circular(8),
          border: isActive ? Border.all(color: const Color(0xFF388bfd), width: 1) : null,
        ),
        child: Row(
          children: [
            // Connection status dot
            Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(
                color: isConnected
                    ? const Color(0xFF3fb950)
                    : hasProvider
                        ? const Color(0xFFd29922)
                        : const Color(0xFF6e7681),
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    session.id,
                    style: TextStyle(
                      color: isActive ? const Color(0xFF58a6ff) : const Color(0xFFf0f6fc),
                      fontWeight: FontWeight.w600,
                      fontSize: 14,
                      fontFamily: 'monospace',
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    session.shortCwd,
                    style: const TextStyle(color: Color(0xFF6e7681), fontSize: 11),
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SESSION LIST BODY — full view when no session is selected
// ═══════════════════════════════════════════════════════════════════════════════

class _SessionListBody extends StatelessWidget {
  final SettingsService settings;
  final VoidCallback? onOpenDrawer;
  const _SessionListBody({required this.settings, this.onOpenDrawer});

  @override
  Widget build(BuildContext context) {
    final mgr = context.watch<SessionManager>();

    return Scaffold(
      backgroundColor: const Color(0xFF0d1117),
      appBar: AppBar(
        backgroundColor: const Color(0xFF161b22),
        foregroundColor: const Color(0xFFc9d1d9),
        elevation: 0,
        centerTitle: false,
        leading: IconButton(
          icon: const Icon(Icons.menu_rounded, size: 22),
          onPressed: onOpenDrawer,
        ),
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
            Text(
              '${mgr.sessions.length} active',
              style: const TextStyle(color: Color(0xFF8b949e), fontSize: 12, fontWeight: FontWeight.normal),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded, size: 20),
            onPressed: mgr.loadSessions,
          ),
          IconButton(
            icon: const Icon(Icons.settings_outlined, size: 20),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => SetupScreen(settings: settings)),
            ),
          ),
        ],
        bottom: const PreferredSize(
          preferredSize: Size.fromHeight(1),
          child: Divider(height: 1, color: Color(0xFF30363d)),
        ),
      ),
      body: _buildBody(context, mgr),
    );
  }

  Widget _buildBody(BuildContext context, SessionManager mgr) {
    if (mgr.loadingSessions && mgr.sessions.isEmpty) {
      return const Center(child: CircularProgressIndicator(color: Color(0xFF58a6ff)));
    }

    if (mgr.sessionsError != null && mgr.sessions.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, color: Color(0xFFf85149), size: 48),
            const SizedBox(height: 12),
            Text(mgr.sessionsError!, style: const TextStyle(color: Color(0xFF8b949e)), textAlign: TextAlign.center),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: mgr.loadSessions,
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF21262d)),
              child: const Text('Retry'),
            ),
          ],
        ),
      );
    }

    if (mgr.sessions.isEmpty) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.terminal, color: Color(0xFF6e7681), size: 48),
            SizedBox(height: 12),
            Text('No active sessions', style: TextStyle(color: Color(0xFF6e7681), fontSize: 15)),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: mgr.loadSessions,
      color: const Color(0xFF58a6ff),
      backgroundColor: const Color(0xFF161b22),
      child: ListView.separated(
        padding: const EdgeInsets.all(12),
        itemCount: mgr.sessions.length,
        separatorBuilder: (_, __) => const SizedBox(height: 8),
        itemBuilder: (_, i) => _FullSessionCard(
          session: mgr.sessions[i],
          settings: settings,
          mgr: mgr,
        ),
      ),
    );
  }
}

class _FullSessionCard extends StatelessWidget {
  final Session session;
  final SettingsService settings;
  final SessionManager mgr;

  const _FullSessionCard({required this.session, required this.settings, required this.mgr});

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
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
            child: Row(
              children: [
                Container(width: 8, height: 8, decoration: const BoxDecoration(color: Color(0xFF3fb950), shape: BoxShape.circle)),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    session.id,
                    style: const TextStyle(color: Color(0xFF58a6ff), fontWeight: FontWeight.bold, fontSize: 16, fontFamily: 'monospace'),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                Text(ago, style: const TextStyle(color: Color(0xFF6e7681), fontSize: 12)),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
            child: Row(
              children: [
                const Icon(Icons.folder_outlined, size: 13, color: Color(0xFF6e7681)),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    session.cwd.isEmpty ? '/' : session.cwd,
                    style: const TextStyle(color: Color(0xFF58a6ff), fontSize: 12, fontFamily: 'monospace'),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ),
          const Divider(height: 1, color: Color(0xFF21262d)),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
            child: Row(
              children: [
                _CardBtn(icon: Icons.chat_bubble_outline_rounded, label: 'Chat', color: const Color(0xFF3fb950), onTap: () {
                  mgr.openSession(session.id, session.cwd);
                  mgr.switchToSession(session.id);
                }),
                const SizedBox(width: 6),
                _CardBtn(icon: Icons.terminal_rounded, label: 'Terminal', color: const Color(0xFF79c0ff), onTap: () {
                  Navigator.of(context).push(MaterialPageRoute(
                    builder: (_) => TerminalScreen(settings: settings, session: session),
                  ));
                }),
                const Spacer(),
                _IconBtn(icon: Icons.restart_alt_rounded, tooltip: 'Restart', onTap: () async {
                  try {
                    await mgr.restartSession(session.id);
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Session restarted'), backgroundColor: Color(0xFF238636)),
                      );
                    }
                  } catch (e) {
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text('Failed: $e'), backgroundColor: const Color(0xFFf85149)),
                      );
                    }
                  }
                }),
                const SizedBox(width: 4),
                _IconBtn(icon: Icons.delete_outline_rounded, tooltip: 'Delete', color: const Color(0xFFf85149), onTap: () async {
                  final confirm = await showDialog<bool>(
                    context: context,
                    builder: (_) => AlertDialog(
                      title: const Text('Delete Session'),
                      content: Text('Delete "${session.id}"?'),
                      actions: [
                        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel', style: TextStyle(color: Color(0xFF8b949e)))),
                        TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Delete', style: TextStyle(color: Color(0xFFf85149)))),
                      ],
                    ),
                  );
                  if (confirm == true) mgr.deleteSession(session.id);
                }),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _CardBtn extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;
  const _CardBtn({required this.icon, required this.label, required this.color, required this.onTap});

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
  final String tooltip;
  final VoidCallback onTap;
  final Color color;
  const _IconBtn({required this.icon, required this.tooltip, required this.onTap, this.color = const Color(0xFF8b949e)});

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
