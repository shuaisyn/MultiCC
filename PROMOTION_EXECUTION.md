# MultiCC 推广执行方案

> 制定日期 2026-06-24 | 基于代码审计 + 竞品调研 + 多渠道策略
> **此文件仅存本地，不上传 GitHub。**

---

## 一、竞品速览

| 维度 | multicc | cc-switch | Ruflo | CCR | claude-squad | 官方 Agent Teams |
|------|---------|-----------|-------|-----|-------------|-----------------|
| **Star** | ~0 | ~105k | ~42k | ~35k | ~7.9k | 闭源 |
| **定时/cron 自动触发** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Wait/Poll 续接** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **每会话独立 Provider** | ✅ | ❌(全局) | ❌ | ❌(路由) | ❌ | ❌ |
| **Git Worktree 隔离** | ✅ | N/A | ✅ | N/A | ✅ | ✅ |
| **多端访问** | 全端 | GUI | CLI | CLI | CLI | CLI |
| **微信/飞书网关** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **语音输入** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

**multicc 独有护城河：** cron + wait/poll 定时续接、每会话 provider 隔离、IM 网关。

---

## 二、账号获取与养号时间线

### Reddit（30-45 天预热）

| 阶段 | 天数 | 动作 |
|------|------|------|
| 潜伏 | Day 1-3 | 注册，加入 r/ClaudeAI, r/selfhosted, r/LocalLLaMA |
| 评论 | Day 4-14 | 每天 3-5 条高质量评论，不贴链接 |
| 首发帖 | Day 15-30 | 在无门槛 sub 发价值帖，积累 karma > 100 |
| 软推广 | Day 30+ | 9:1 价值:推广比 |

> ⚠️ Karma < 50 不贴链接；VPN + 新号 = 秒 ban

### X/Twitter（6 个月积累）

- 开 X Premium（$3/月）验证
- 40% 教育 / 30% build-in-public / 20% 产品 / 10% 观点
- 每天 15 分钟回复热门帖（比发帖 ROI 高）
- 链接放第一条回复，不放在主帖

### TikTok（视觉冲击）

- 屏幕录制 + 字幕 + 流行音乐
- Draft 后从真机发布，API 发会 shadow ban
- 每天 2-3 条，15-60 秒

---

## 三、内容弹药

### Reddit r/ClaudeAI 帖模板

> I built a self-hosted orchestrator that runs multiple Claude Code sessions with cron, wait/poll, and per-session providers.
> [对比表 + curl 安装命令]

### X Thread 模板

> 1/ I run 4 Claude Code sessions simultaneously. They corrupted files. So I built something.
> 2-5/ 功能展示 + 对比 + 安装

### TikTok 视频脚本（60s）

> 0-5s: 隧道打开 dashboard
> 5-15s: 三会话并排 + 不同 provider
> 15-30s: cron 自动续接演示
> 30-45s: wait/poll 演示
> 45-55s: 安装命令
> 55-60s: Logo

---

## 四、联动清单

### 邮件/媒体

| 渠道 | 受众 | 时机 |
|------|------|------|
| Console Dev | 40k 开发者工具 | 发布后 1-2 周 |
| TLDR | 500k+ | 大版本 |
| Changelog | 80k+ OSS | 发布周 |

### KOL

| 谁 | 在哪 | 撬动方式 |
|----|------|----------|
| @simonw | X | 深度教程后 @他 |
| @swyx | X | 展示 agent orchestration |
| 阮一峰 | 周刊 | 投稿技术文章 |
| 即刻 AI KOL | 即刻 | 找 3-5 人转发 |

### 社区

- r/ClaudeAI (Built with Claude)
- r/selfhosted (Release)
- r/LocalLLaMA (多 provider)
- V2EX 分享创造
- 知乎横评
- 即刻发布帖

---

## 五、即刻执行清单

1. 注册 Reddit 号，开始潜伏
2. 开 X Premium，发第一条 build-in-public
3. 补 LICENSE + CI badge
4. 录 60s demo 视频
5. 写知乎/V2EX 首发帖
