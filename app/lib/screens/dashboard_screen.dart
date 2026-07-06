import 'package:flutter/material.dart';

import '../services/manage_service.dart';
import '../services/settings_service.dart';
import '../theme.dart';

/// 状态看板 — 镜像网页 dashboard.html：全会话一览（active/idle）+ 聚合统计
/// （总数 / 活跃数 / 按 CLI / 按 kind）。只读，自动刷新。
class DashboardScreen extends StatefulWidget {
  final SettingsService settings;
  const DashboardScreen({super.key, required this.settings});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  late final ManageService _manage = ManageService(settings: widget.settings);

  List<Map<String, dynamic>> _sessions = [];
  Map<String, dynamic>? _stats;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        _manage.fetchDashboardSessions(),
        _manage.fetchDashboardStats(),
      ]);
      if (!mounted) return;
      final sessMap = results[0];
      setState(() {
        _sessions = (sessMap['sessions'] as List? ?? [])
            .map((e) => (e as Map).cast<String, dynamic>())
            .toList();
        _stats = results[1];
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '$e';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('状态看板'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loading ? null : _refresh,
            tooltip: '刷新',
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _ErrorView(error: _error!, onRetry: _refresh)
              : RefreshIndicator(
                  onRefresh: _refresh,
                  child: ListView(
                    padding: const EdgeInsets.all(12),
                    children: [
                      _statsCard(),
                      const SizedBox(height: 12),
                      _sectionTitle('会话 (${_sessions.length})'),
                      ..._sessions.map(_sessionTile),
                    ],
                  ),
                ),
    );
  }

  Widget _statsCard() {
    final s = _stats ?? {};
    final total = s['total'] ?? 0;
    final active = s['active'] ?? 0;
    final byCli = (s['byCli'] as Map?) ?? {};
    final byKind = (s['byKind'] as Map?) ?? {};
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.panel,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _stat('总会话', '$total', AppColors.textBright),
              const SizedBox(width: 24),
              _stat('活跃', '$active', AppColors.accent),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 10,
            runSpacing: 6,
            children: [
              ...byCli.entries.map((e) => _chip(
                  e.key == 'claude' ? 'Claude' : 'Codex',
                  '${e.value}',
                  e.key == 'claude' ? AppColors.claude : AppColors.codex)),
              ...byKind.entries.map((e) => _chip(
                  e.key == 'chat' ? 'Chat' : 'Term', '${e.value}', AppColors.blue)),
            ],
          ),
        ],
      ),
    );
  }

  Widget _stat(String label, String value, Color valueColor) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: AppColors.muted, fontSize: 11)),
        Text(value,
            style: TextStyle(
                color: valueColor, fontSize: 22, fontWeight: FontWeight.w600)),
      ],
    );
  }

  Widget _chip(String label, String value, Color c) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: c.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: c.withValues(alpha: 0.3)),
      ),
      child: Text('$label $value',
          style: TextStyle(color: c, fontSize: 12, fontWeight: FontWeight.w500)),
    );
  }

  Widget _sectionTitle(String t) => Padding(
        padding: const EdgeInsets.only(top: 8, bottom: 6),
        child: Text(t,
            style:
                const TextStyle(color: AppColors.muted, fontSize: 13, fontWeight: FontWeight.w600)),
      );

  Widget _sessionTile(Map<String, dynamic> s) {
    final active = s['active'] == true;
    final cli = (s['cli'] ?? 'claude') == 'codex' ? 'Codex' : 'Claude';
    final kind = (s['kind'] ?? 'terminal') == 'chat' ? 'Chat' : 'Term';
    final label = (s['label'] as String?)?.isNotEmpty == true
        ? s['label'] as String
        : (s['id'] as String?) ?? '';
    final dot = active ? AppColors.accent : AppColors.faint;
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.panel,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.line),
      ),
      child: Row(
        children: [
          Container(
            width: 8,
            height: 8,
            margin: const EdgeInsets.only(right: 10),
            decoration: BoxDecoration(
                color: dot,
                shape: BoxShape.circle,
                boxShadow: active
                    ? [BoxShadow(color: dot.withValues(alpha: 0.6), blurRadius: 6)]
                    : null),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label,
                    style: const TextStyle(
                        color: AppColors.text, fontSize: 14),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis),
                const SizedBox(height: 2),
                Text('$cli · $kind${active ? ' · 活跃' : ''}',
                    style: const TextStyle(color: AppColors.muted, fontSize: 11)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  final String error;
  final VoidCallback onRetry;
  const _ErrorView({required this.error, required this.onRetry});

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, color: AppColors.danger, size: 40),
              const SizedBox(height: 12),
              Text('加载失败：$error',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: AppColors.muted, fontSize: 13)),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh, size: 18),
                label: const Text('重试'),
              ),
            ],
          ),
        ),
      );
}
