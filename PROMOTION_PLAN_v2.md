# MultiCC 营销推广计划 v2

> 制定日期 2026-07-04 | 替代 2026-06-24 v1 执行方案
> **此文件仅存本地，不上传 GitHub。**
> 仓库：github.com/lsjwzh/MultiCC（当前 Star ≈ 0，竞品 cc-switch ~111k）

---

## 〇、v1 → v2 的关键调整

| 维度 | v1 做法 | v2 调整 | 原因 |
|------|---------|---------|------|
| **节奏** | 30-45 天 Reddit 养号后才出手 | Day 1 即发"Show HN + GitHub"，养号与冷启动并行 | 竞品 6 月已涨到 111k，窗口在关闭，不能再等 45 天 |
| **核心叙事** | "多 Claude Code 会话编排" | **"让 AI coding agent 7×24 后台跑，手机/微信随时接管"** | 护城河是 cron+wait+IM，不是"多会话"（AionUi/Orca 都有） |
| **目标受众** | 泛开发者 | **聚焦三类：独立开发者 / 远程团队 / 跨境电商技术团队** | 自托管 + IM 网关 + 语音对这三类痛点最强 |
| **Star 目标** | 隐含"12 个月 1000 星" | **90 天 → 500 星；12 个月 → 3000 星** | 竞品月增 5-10k，1000 星太保守 |
| **首发渠道** | Reddit + X | **Hacker News + V2EX + 即刻 + Reddit** | HN 一次爆 = 抵 6 个月养号；中文社区 multicc 已有 IM 优势 |

---

## 一、产品定位与一句话叙事

**一句话**：MultiCC 是自托管的 AI coding agent 控制平面——把 Claude Code / Codex 变成 7×24 后台服务，手机、微信、浏览器随时接管，定时任务到点自动续接。

**三句价值**（用于所有文案）：
1. **持续性**：合上电脑任务不中断，手机接着看。tmux 持久化 + chat 状态机。
2. **调度性**：cron 定时触发 + wait/poll 自动续接——agent 跑完自动把结果发回给你，不用盯着。
3. **全端触达**：Web 终端 / 手机 PWA / Flutter App / 微信飞书网关，同一后端。

**差异化护城河（竞品都没有）**：
- cron + wait/poll 定时续接（独有）
- 每会话独立 provider/model 隔离（独有，可 import cc-switch）
- IM 网关（微信/飞书，cc-connect 只做网关不做编排）
- 自托管 + 一键安装 + 服务管理 + 自更新（竞品都是 desktop app 或 npx）

---

## 二、90 天冷启动路线图（Day 1-90）

### 阶段 1：发布前就绪（Day 1-7，本周内）

| # | 动作 | 产出 | 负责人 |
|---|------|------|--------|
| 1 | README 打磨 | 顶部 GIF demo（30s 四端切换）+ "Why" 三段 + 安装一行命令 | — |
| 2 | 补 LICENSE / CI badge / CONTRIBUTING / 旧 issue 模板 | 仓库可信度 | — |
| 3 | 录 3 条核心 demo 视频 | ①四端接管 30s ②cron 定时续接 45s ③微信控制 agent 30s | — |
| 4 | 准备 landing 页（用 multicc 自带的 public/） | github.io 一页纸 | — |
| 5 | 写好首发文案 4 份 | HN / V2EX / 即刻 / Reddit 各一版（见 §五） | — |

**就绪标准**：任何人 5 分钟内 curl 装好、看到 demo、理解为什么需要它。

### 阶段 2：首发冲刺（Day 8-14）

**Day 8 周二（HN 流量谷底前）**：Show HN 首发。
> 标题：`Show HN: MultiCC – Self-hosted control plane that runs Claude Code/Codex 24/7, controllable from phone/WeChat`
> 时段：太平洋时间周二 6-9 AM（HN 黄金窗口）。
> 首条评论放安装命令 + 30s GIF。作者全天在线回复。

**同日 +1 天**：V2EX（分享创造节点）、即刻（想法/产品圈）、Reddit（r/ClaudeAI 用"built with"，**不是**广告贴，而是"I built X to solve Y"叙事）。

**Day 9-14**：监控 HN 评论，每条必回；把 HN 反馈迭代进 README。

**首发 7 天目标**：Star 100+，至少 1 个外部 contributor issue。

### 阶段 3：内容飞轮（Day 15-60）

每周固定产出（build in public）：

| 周 | 主题 | 渠道 | 形态 |
|----|------|------|------|
| W3 | "我为什么自托管 AI agent 而不用云端" | X Thread + 知乎 | 文 |
| W4 | "cron + wait/poll：让 agent 真正后台跑的设计" | 博客 + HN | 技术深度 |
| W5 | "用微信指挥 4 个 Claude 会话改同一个 repo" | TikTok/B站 | 视频 |
| W6 | "cc-switch 用户为什么要装 multicc"（不踩只讲协同） | Reddit + X | 对比 |
| W7 | "跨境电商团队用 multicc 自动巡检Listing" | 知乎 + 即刻 | 场景案例 |
| W8 | 性能/成本 benchmark：4 会话 vs 1 会话 | 博客 | 数据 |

**X/Twitter 节奏**：每天 15 分钟回复热门 agent 帖（比发帖 ROI 高 3 倍），链接放第一条回复。

### 阶段 4：外部放大（Day 61-90）

| 渠道 | 撬动方式 | 时机 |
|------|----------|------|
| **TLDR newsletter** | v0.x 稳定版发布时投稿 | Day 65 前后 |
| **Changelog** | 发"self-hosted agent control plane"类目 | Day 70 |
| **阮一峰周刊** | 投一篇"自托管 AI agent 编排"技术文 | Day 75 |
| **@simonw / @swyx** | 已有深度教程后 @ 一次（不带索取感） | Day 80 |
| **即刻 AI KOL** | 找 3-5 人体验后转发 | Day 85 |
| **Console Dev** | 40k 开发者工具受众 | Day 88 |

**90 天目标**：Star 500，3 个真实用户 case，1 次媒体引用。

---

## 三、12 个月目标（Day 91-365）

| 季度 | Star 目标 | 关键里程碑 |
|------|-----------|-----------|
| Q1 (D1-90) | 500 | 冷启动完成，护城河叙事建立 |
| Q2 (D91-180) | 1,500 | 中文社区占位（知乎/V2EX/即刻头部）+ 英文 HN 二次刷榜（大版本） |
| Q3 (D181-270) | 2,500 | 生态：插件市场 / skill 贡献者 / 至少 1 个大型用户背书 |
| Q4 (D271-365) | 3,000+ | 成为"self-hosted agent orchestration"类目代名词 |

**类目争夺策略**：把 README 的竞品对比表（vs cc-switch/Ruflo/AionUi/Orca）持续维护为**事实清单**，让任何搜"claude code orchestration"的人最终都看到这张表。这是 SEO + 心智占位的双重武器。

---

## 四、账号矩阵与养号

| 平台 | 账号状态 | 优先级 | 养号节奏 |
|------|----------|--------|----------|
| **Hacker News** | 需新号或老号 | P0 | 老号最佳；新号需先评论 1 周再 Show HN |
| **X/Twitter** | 开 Premium $3/月 | P0 | 40% 教育 / 30% build / 20% 产品 / 10% 观点 |
| **Reddit** | 新号潜伏 | P1 | D1-3 潜伏，D4-14 评论，D15+ 首发；karma<50 不贴链接 |
| **V2EX** | 注册 | P1 | 直接发分享创造，无需养号 |
| **即刻** | 注册 | P1 | 想法/产品圈，中文 build in public 主场 |
| **知乎** | 注册 | P2 | 横评 + 场景文，长尾流量 |
| **TikTok / B站** | 注册 | P2 | 视频从 Draft 真机发，API 发会 shadow ban |
| **GitHub Discussions** | 开启 | P0 | 把 user voice 沉淀进仓库，对 Star 转化率影响最大 |

> ⚠️ Reddit 新号 + VPN = 秒 ban，用住宅 IP。X 链接放第一条回复，不放主帖。

---

## 五、首发文案模板（4 版）

### 5.1 Hacker News (Show HN)

```
Show HN: MultiCC – Self-hosted control plane for AI coding agents (Claude Code/Codex), runs 24/7, controllable from phone/WeChat

I kept losing agent progress when I closed my laptop, and none of the existing tools
let me fire off a task from my phone and get notified when it's done. So I built MultiCC.

It wraps the official Claude Code / Codex CLIs into a persistent server:
- tmux + stateful chat turns → close laptop, resume from phone
- cron scheduling + wait/poll → agent finishes, result auto-sent back to you
- per-session provider/model isolation (import from cc-switch)
- Web / PWA / Flutter app / WeChat-Feishu gateway, one backend
- self-hosted, one-line install: curl ... | bash

[30s demo GIF]
[GitHub link]

Happy to answer questions about the architecture (why tmux, how wait/poll
auto-continuation works, how we isolate providers per session).
```

### 5.2 V2EX（分享创造）

中文，强调"自托管 + 微信接管 + 定时"，附 curl 安装 + 截图。结尾问"大家平时怎么管理多个 agent 会话？"引导讨论。

### 5.3 即刻

短帖 + GIF，话题标签 #AI编程 #独立开发。强调 build in public："今天开源了我的 AI agent 控制平面"。

### 5.4 Reddit r/ClaudeAI (Built with Claude)

> 标题：I built a self-hosted orchestrator that lets Claude Code run 24/7 and be controlled from my phone/WeChat
> 正文：问题 → 方案 → 对比表 → 安装。**9:1 价值:推广**，先在 r/ClaudeAI 评论区帮人答 1 周再发。

---

## 六、内容弹药库（按场景）

| 场景 | 钩子 | 适配渠道 |
|------|------|----------|
| 合上电脑任务不断 | "你的 agent 不该随终端一起死" | X / HN |
| cron 定时巡检 | "凌晨 3 点自动跑测试，结果推微信" | 知乎 / 跨境电商群 |
| 微信指挥 agent | "在地铁上回一句'fix login bug'，回家看 PR" | TikTok / B站 |
| 多 provider 省钱 | "同一 repo 4 个会话用 4 家 API" | Reddit / X |
| wait/poll 续接 | "agent 跑 2 小时，我睡了，醒来结果已到" | 即刻 / 博客 |

---

## 七、指标与复盘

**每周看板**：
- GitHub Star 周增量 / Star 来源（profile → which referrer）
- 仓库 clone 数（GitHub traffic）
- Discussions 活跃度（新 issue / 回复响应时长）
- 各渠道 UTM 链接点击
- curl 安装成功反馈（可加一个匿名 ping）

**复盘节奏**：每两周一次，问三个问题——
1. 哪条内容带来的 Star 最多？加倍投入。
2. 哪个护城河叙事引起的讨论最多？强化它。
3. 哪条渠道 ROI 为负？砍掉。

**弃用门槛**：某渠道连续 4 周带不来 10 Star → 停更该渠道。

---

## 八、即刻执行清单（本周）

- [ ] 录 30s 四端切换 GIF，放 README 顶部
- [ ] 补 LICENSE + CI badge + issue 模板
- [ ] 开启 GitHub Discussions
- [ ] 写完 4 份首发文案并存草稿
- [ ] 注册/确认 HN、V2EX、即刻、Reddit 账号
- [ ] Day 8 周二太平洋时间 6-9 AM 发 Show HN

---

> 核心信念：**multicc 的胜利不靠"又一个多 agent 工具"，而靠"自托管 + 7×24 + 全端接管 + 定时续接"这个竞品做不出的组合。** 把这句话钉在每一条内容上。
