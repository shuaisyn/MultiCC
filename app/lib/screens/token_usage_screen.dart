import 'package:flutter/material.dart';

import '../services/manage_service.dart';
import '../services/settings_service.dart';
import '../theme.dart';

/// Token 用量统计 — 镜像网页 manage 页「全局配置」里的用量展示：按时间窗
/// （今天 / 本周 / 本月 / 全部）显示各模型累计 token 消耗。只读，可强制刷新。
class TokenUsageScreen extends StatefulWidget {
  final SettingsService settings;
  const TokenUsageScreen({super.key, required this.settings});

  @override
  State<TokenUsageScreen> createState() => _TokenUsageScreenState();
}

class _TokenUsageScreenState extends State<TokenUsageScreen> {
  late final ManageService _manage = ManageService(settings: widget.settings);

  Map<String, dynamic>? _data;
  bool _loading = true;
  bool _refreshing = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _refresh(force: false);
  }

  Future<void> _refresh({required bool force}) async {
    final isInitial = !_loading;
    if (isInitial) {
      setState(() => _loading = true);
    } else {
      setState(() => _refreshing = true);
    }
    setState(() => _error = null);
    try {
      final d = await _manage.fetchTokenUsage(force: force);
      if (!mounted) return;
      setState(() {
        _data = d;
        _loading = false;
        _refreshing = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '$e';
        _loading = false;
        _refreshing = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Token 用量'),
        actions: [
          IconButton(
            icon: _refreshing
                ? const SizedBox(
                    width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.refresh),
            onPressed: _refreshing ? null : () => _refresh(force: true),
            tooltip: '强制刷新',
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _ErrorView(error: _error!, onRetry: () => _refresh(force: false))
              : _data == null
                  ? const _EmptyView()
                  : RefreshIndicator(
                      onRefresh: () => _refresh(force: false),
                      child: ListView(
                        padding: const EdgeInsets.all(12),
                        children: [
                          _summaryCard(),
                          const SizedBox(height: 12),
                          ..._windowSections(),
                        ],
                      ),
                    ),
    );
  }

  Widget _summaryCard() {
    final d = _data!;
    final responses = d['responses'] ?? 0;
    final generatedAt = (d['generatedAt'] as String?)?.substring(0, 19) ?? '';
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.panel,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.line),
      ),
      child: Row(
        children: [
          _stat('总响应数', '$responses', AppColors.accent),
          const SizedBox(width: 30),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('生成于',
                    style: TextStyle(color: AppColors.muted, fontSize: 11)),
                Text(generatedAt,
                    style: const TextStyle(color: AppColors.faint, fontSize: 11)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  List<Widget> _windowSections() {
    final windows = (_data!['windows'] as Map?) ?? {};
    const labels = ['today', 'week', 'month', 'all'];
    const names = {
      'today': '今天',
      'week': '本周',
      'month': '本月',
      'all': '全部',
    };
    final out = <Widget>[];
    for (final k in labels) {
      final w = (windows[k] as Map?) ?? {};
      if (w.isEmpty) continue;
      out.add(_windowCard(names[k]!, w));
      out.add(const SizedBox(height: 10));
    }
    if (out.isEmpty) out.add(const _EmptyView());
    return out;
  }

  Widget _windowCard(String title, Map w) {
    // Sum tokens across models for a window total.
    int total = 0;
    final rows = <MapEntry<String, int>>[];
    for (final e in w.entries) {
      int v = 0;
      final val = e.value;
      if (val is num) {
        v = val.toInt();
      } else if (val is Map) {
        for (final bv in val.values) {
          if (bv is num) v += bv.toInt();
        }
      }
      rows.add(MapEntry(e.key as String, v));
      total += v;
    }
    rows.sort((a, b) => b.value.compareTo(a.value));
    final maxV = rows.isEmpty ? 1 : rows.first.value;

    return Container(
      padding: const EdgeInsets.all(12),
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
              Text(title,
                  style: const TextStyle(
                      color: AppColors.textBright, fontSize: 14, fontWeight: FontWeight.w600)),
              const Spacer(),
              Text(_fmt(total),
                  style: const TextStyle(color: AppColors.accent, fontSize: 13)),
            ],
          ),
          const SizedBox(height: 8),
          ...rows.take(12).map((r) => _bar(r.key, r.value, maxV)),
        ],
      ),
    );
  }

  Widget _bar(String model, int value, int maxV) {
    final pct = maxV == 0 ? 0.0 : (value / maxV).clamp(0.0, 1.0);
    return Padding(
      padding: const EdgeInsets.only(bottom: 5),
      child: Row(
        children: [
          SizedBox(
            width: 150,
            child: Text(model,
                style: const TextStyle(color: AppColors.muted, fontSize: 11),
                maxLines: 1, overflow: TextOverflow.ellipsis),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Stack(
              children: [
                Container(
                  height: 6,
                  decoration: BoxDecoration(
                    color: AppColors.line,
                    borderRadius: BorderRadius.circular(3),
                  ),
                ),
                FractionallySizedBox(
                  widthFactor: pct,
                  child: Container(
                    height: 6,
                    decoration: BoxDecoration(
                      color: AppColors.accent.withValues(alpha: 0.7),
                      borderRadius: BorderRadius.circular(3),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          SizedBox(
            width: 70,
            child: Text(_fmt(value),
                textAlign: TextAlign.right,
                style: const TextStyle(color: AppColors.text, fontSize: 11)),
          ),
        ],
      ),
    );
  }

  String _fmt(int n) {
    if (n >= 1000000) return '${(n / 1000000).toStringAsFixed(1)}M';
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(1)}k';
    return '$n';
  }

  Widget _stat(String label, String value, Color valueColor) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: AppColors.muted, fontSize: 11)),
        Text(value,
            style: TextStyle(
                color: valueColor, fontSize: 20, fontWeight: FontWeight.w600)),
      ],
    );
  }
}

class _EmptyView extends StatelessWidget {
  const _EmptyView();
  @override
  Widget build(BuildContext context) => const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text('暂无用量数据',
              style: TextStyle(color: AppColors.muted, fontSize: 13)),
        ),
      );
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
