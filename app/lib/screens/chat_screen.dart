import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/message.dart';
import '../providers/chat_provider.dart';
import '../services/chat_service.dart';
import '../services/settings_service.dart';
import '../widgets/input_bar.dart';
import '../widgets/message_bubble.dart';
import '../widgets/thinking_indicator.dart';
import 'setup_screen.dart';

/// Reusable chat view — expects a ChatProvider in the widget tree
/// (provided by MainShell via ChangeNotifierProvider.value).
class ChatView extends StatefulWidget {
  final SettingsService settings;
  final VoidCallback? onOpenDrawer;
  const ChatView({super.key, required this.settings, this.onOpenDrawer});

  @override
  State<ChatView> createState() => _ChatViewState();
}

class _ChatViewState extends State<ChatView> {
  final _scrollCtrl = ScrollController();

  @override
  void dispose() {
    _scrollCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0d1117),
      body: SafeArea(
        child: Column(
          children: [
            _Header(settings: widget.settings, onOpenDrawer: widget.onOpenDrawer),
            _CwdBar(),
            Expanded(child: _MessageList(scrollCtrl: _scrollCtrl)),
            _CostBar(),
            const InputBar(),
          ],
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  final SettingsService settings;
  final VoidCallback? onOpenDrawer;
  const _Header({required this.settings, this.onOpenDrawer});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<ChatProvider>();
    final state = provider.connectionState;

    Color statusColor;
    switch (state) {
      case ChatConnectionState.connected:
        statusColor = const Color(0xFF3fb950);
        break;
      case ChatConnectionState.connecting:
        statusColor = const Color(0xFFd29922);
        break;
      case ChatConnectionState.disconnected:
        statusColor = const Color(0xFF8b949e);
        break;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      decoration: const BoxDecoration(
        color: Color(0xFF161b22),
        border: Border(bottom: BorderSide(color: Color(0xFF30363d))),
      ),
      child: Row(
        children: [
          // Drawer / Back button
          GestureDetector(
            onTap: onOpenDrawer ?? () => Scaffold.of(context).openDrawer(),
            child: Container(
              padding: const EdgeInsets.all(6),
              child: const Icon(Icons.menu_rounded, color: Color(0xFFc9d1d9), size: 20),
            ),
          ),
          const SizedBox(width: 4),
          RichText(
            text: const TextSpan(
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
              children: [
                TextSpan(text: 'Web', style: TextStyle(color: Color(0xFFf78166))),
                TextSpan(text: 'CC', style: TextStyle(color: Color(0xFF79c0ff))),
              ],
            ),
          ),
          if (provider.sessionId.isNotEmpty) ...[
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                provider.sessionName,
                style: const TextStyle(
                  color: Color(0xFF58a6ff),
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  fontFamily: 'monospace',
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
          const SizedBox(width: 8),
          GestureDetector(
            onTap: state == ChatConnectionState.disconnected ? provider.reconnect : null,
            child: Icon(Icons.circle, size: 8, color: statusColor),
          ),
          const Spacer(),
          // Clear history button
          _HeaderBtn(
            icon: Icons.delete_sweep_outlined,
            tooltip: 'Clear history',
            onTap: () => _confirmClear(context, provider),
          ),
          const SizedBox(width: 4),
          // Settings button
          _HeaderBtn(
            icon: Icons.settings_outlined,
            tooltip: 'Settings',
            onTap: () => _openSettings(context, settings),
          ),
        ],
      ),
    );
  }

  void _confirmClear(BuildContext context, ChatProvider provider) {
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Clear History'),
        content: const Text('This will clear the chat history and reset the Claude session.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel', style: TextStyle(color: Color(0xFF8b949e))),
          ),
          TextButton(
            onPressed: () {
              Navigator.pop(context);
              provider.clearHistory();
            },
            child: const Text('Clear', style: TextStyle(color: Color(0xFFf85149))),
          ),
        ],
      ),
    );
  }

  void _openSettings(BuildContext context, SettingsService settings) {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => SetupScreen(settings: settings)),
    );
  }
}

class _HeaderBtn extends StatelessWidget {
  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;
  const _HeaderBtn({required this.icon, required this.tooltip, required this.onTap});

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
          child: Icon(icon, color: const Color(0xFFc9d1d9), size: 18),
        ),
      ),
    );
  }
}

class _CwdBar extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final provider = context.watch<ChatProvider>();
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: const BoxDecoration(
        color: Color(0xFF0d1117),
        border: Border(bottom: BorderSide(color: Color(0xFF21262d))),
      ),
      child: Row(
        children: [
          const Icon(Icons.folder_outlined, size: 14, color: Color(0xFF6e7681)),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              provider.cwd.isEmpty ? '(unknown)' : provider.cwd,
              style: const TextStyle(fontFamily: 'monospace', fontSize: 12, color: Color(0xFF58a6ff)),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          GestureDetector(
            onTap: () => _showCwdDialog(context, provider),
            child: const Text('Change', style: TextStyle(fontSize: 11, color: Color(0xFF8b949e))),
          ),
        ],
      ),
    );
  }

  void _showCwdDialog(BuildContext context, ChatProvider provider) {
    final ctrl = TextEditingController(text: provider.cwd);
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Change Working Directory', style: TextStyle(fontSize: 15)),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          style: const TextStyle(color: Color(0xFFc9d1d9), fontFamily: 'monospace', fontSize: 13),
          decoration: InputDecoration(
            hintText: '/path/to/project',
            hintStyle: const TextStyle(color: Color(0xFF484f58)),
            filled: true,
            fillColor: const Color(0xFF0d1117),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(6)),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(6),
              borderSide: const BorderSide(color: Color(0xFF30363d)),
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel', style: TextStyle(color: Color(0xFF8b949e))),
          ),
          TextButton(
            onPressed: () {
              final newCwd = ctrl.text.trim();
              Navigator.pop(context);
              if (newCwd.isNotEmpty && newCwd != provider.cwd) {
                provider.changeCwd(newCwd);
              }
            },
            child: const Text('Apply', style: TextStyle(color: Color(0xFF58a6ff), fontWeight: FontWeight.w600)),
          ),
        ],
      ),
    );
  }
}

class _MessageList extends StatefulWidget {
  final ScrollController scrollCtrl;
  const _MessageList({required this.scrollCtrl});

  @override
  State<_MessageList> createState() => _MessageListState();
}

class _MessageListState extends State<_MessageList> {
  bool _userScrolled = false;

  @override
  void initState() {
    super.initState();
    widget.scrollCtrl.addListener(_onScroll);
  }

  void _onScroll() {
    if (!widget.scrollCtrl.hasClients) return;
    final pos = widget.scrollCtrl.position;
    final atBottom = pos.pixels >= pos.maxScrollExtent - 60;
    if (atBottom && _userScrolled) {
      setState(() => _userScrolled = false);
    } else if (!atBottom && !_userScrolled) {
      setState(() => _userScrolled = true);
    }
  }

  void _scrollToBottom() {
    if (!widget.scrollCtrl.hasClients || _userScrolled) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (widget.scrollCtrl.hasClients) {
        widget.scrollCtrl.animateTo(
          widget.scrollCtrl.position.maxScrollExtent,
          duration: const Duration(milliseconds: 150),
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<ChatProvider>();
    final messages = provider.messages;
    final showThinking = provider.isStreaming &&
        (messages.isEmpty || messages.last.role != MessageRole.assistant || messages.last.content.isEmpty && messages.last.toolCalls.isEmpty);

    _scrollToBottom();

    return Stack(
      children: [
        ListView.builder(
          controller: widget.scrollCtrl,
          padding: const EdgeInsets.all(12),
          itemCount: messages.length + (showThinking ? 1 : 0),
          itemBuilder: (_, i) {
            if (i == messages.length) return const ThinkingIndicator();
            return MessageBubble(message: messages[i]);
          },
        ),
        if (_userScrolled)
          Positioned(
            bottom: 8,
            right: 8,
            child: GestureDetector(
              onTap: () {
                setState(() => _userScrolled = false);
                _scrollToBottom();
              },
              child: Container(
                padding: const EdgeInsets.all(6),
                decoration: BoxDecoration(
                  color: const Color(0xFF238636),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: const Icon(Icons.keyboard_arrow_down, color: Colors.white, size: 20),
              ),
            ),
          ),
      ],
    );
  }
}

class _CostBar extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final costText = context.watch<ChatProvider>().costText;
    if (costText.isEmpty) return const SizedBox.shrink();
    return Container(
      color: const Color(0xFF0d1117),
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Text(
        costText,
        textAlign: TextAlign.center,
        style: const TextStyle(color: Color(0xFF6e7681), fontSize: 11),
      ),
    );
  }
}
