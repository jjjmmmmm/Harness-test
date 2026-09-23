# DSH 可换零件清单（D2 验收 3 正式产出）

日期：2026-09-23｜Block：D2-1（三篇之二）
状态：**AI 依据原文大表补记**（`资料/DSH/原文/capability-seams.zh.md` 文末服务表，L±n 为该文件行号）。"D3 候选"列按详解 §5 的建议填，**定稿在 D2 Block 5 实验设计文档**。

## 可换零件清单表（16 行 ≥ 验收要求的 10 行，全部经 📕 查表核对）

| # | 零件（插槽名） | 现有实现（全部列出） | 我会换成什么 | 改动影响（预期） | D3 候选？ |
|---|---|---|---|---|---|
| 1 | `ctx.fs` 文件系统（L573） | fs-local / fs-sandbox / fs-ssh；消费方 tool-fs | fs-local → fs-sandbox | 文件写到哪、能写哪全变；模型读写工具一行不改 | ★ |
| 2 | `ctx.shell` Bash 执行器（L565） | bash-local / bash-sandbox / pwsh-local；消费方 tool-bash、tool-pwsh、hooks | bash-local → bash-sandbox | 命令在不在沙箱里跑（依赖 Docker 沙箱装好） | ★ |
| 3 | `ctx.sandbox` 进程沙箱（L568） | sandbox-local / sandbox-ssh；消费方交出确切 argv，后端按策略包装 | local → ssh | 进程执行环境整个搬家 | |
| 4 | `ctx.sandboxPolicy` 沙箱策略（L569，core） | 无并列实现；存部署默认模式 + 工作区根目录 | patch 改默认模式 | bash 与 fs 共用同一策略（见核对记录）——不会各限各的根 | ★ |
| 5 | `ctx.permissionPresets` 权限预设（L571） | 两档：workspace-write / danger-full-access | 换 preset | 沙箱模式+审批策略组合整体切换；写 `permission/preset` 事件（可观测） | ★ |
| 6 | `ctx.approval` 审批（L570） | user-approval；一次性决策走 `approval/request` 瀑布事件 | 换回答方/策略 | 什么动作要先问人 | |
| 7 | `ctx.compaction` 压缩（L574） | compaction-basic（唯一实现）；消费步骤后压力事件 | patch 改行为 | 旧历史何时压成摘要；原文注明"不存在面向模型的压缩工具" | ★（8 题小任务可能压不满，显效难） |
| 8 | `ctx.toolResultPruner` 工具结果修剪（L521，core） | 无并列实现；摘要压缩前改写过大的当前工具结果 | patch 阈值 | 超大工具结果何时被改写 | |
| 9 | `ctx.spillStore` 结果外置（L580） | spill-local；何时 spill 由 spill-policy（tools/post-execute 消费方）决定 | patch spill-policy | 过大工具文本外置，模型只拿定位信息 + 取回提示 | ★（"错误信息截断 vs 完整回传"的 DSH 原生对应物） |
| 10 | `ctx.llm` 模型适配器（L518） | llm-deepseek / llm-pi-ai / **llm-replay**（回放） | deepseek → replay | 同一段模型输出回放给不同配置——把模型随机性噪声整个关掉 | 控制变量利器（不是消融对象） |
| 11 | `ctx.subagents` 子 agent 委派（L575） | 六个：spawn-in-process / fork-in-process / acp / codex / claude-code / dsh-sdk | 换 provider | 委派给谁执行——激进到可换成别家产品（Codex、Claude Code） | （D3 时间不够） |
| 12 | `ctx.web` 搜索/抓取（L579） | web-search-exa / web-search-perplexity / web-search-deepseek / web-fetch-http | 换搜索后端 | "工具集"维度的现成零件 | |
| 13 | `ctx.terminals` 持久终端（L567） | terminal-bash | — | PTY 会话机制 | |
| 14 | `ctx.subprocess` 子进程（L564） | subprocess-local / subprocess-ssh | local → ssh | spawn 的进程坐标/生命周期换环境 | |
| 15 | `ctx.sessionQuery` 会话查询（L546） | session-query-sqlite（精确读取/过滤/追踪/全文） | — | 评测取证效率 | |
| 16 | `ctx.sessionTelemetry` 遥测（L540） | session-telemetry-otel（脱敏后交后端） | 换后端 | 可观测性维度 | |

大表里还有 settings / credentials / storage / sessionPersistence / skills / jobs / workflowEngine / lsp / ptcRuntime 等 seam，会查表即可，暂不入 D3 视野。

## D3 候选（验收 3 要的"指出 2–3 个"）

1. **沙箱开/关**（#1+#2：fs-local/bash-local → fs-sandbox/bash-sandbox）——最干净的"一处改动"，且 sandboxPolicy 保证 bash 与 fs 同根，不会"顺手改了两处"；Docker 已装好正好用上。预期影响：能写哪/产物落哪/命令权限类任务。
2. **权限预设**（#5：workspace-write vs danger-full-access）——最容易改（一条 patch，事件可观测）；影响偏"硬"（允许/拒绝），区分度可能不够细腻——若 CI 含 0 就按预注册写"证据不够"。
3. **结果外置/修剪策略**（#9 spill-policy / #8 toolResultPruner）——最贴近计划推荐题"错误信息截断 vs 完整回传"的 DSH 原生零件；若配置成本高，退回 mini loop 的 `TRUNCATE_ERRORS` 开关做同构实验（计划里已备此退路）。

## 📕 核对记录（原文行号）

- `ctx.sandboxPolicy` 原句（L569）："统一保存部署默认模式和工作区根目录；只有沙箱执行器和提供方读取该服务……**两类强制执行组件都读取该服务，因此 bash 与 fs 不会限制到不同的根目录**。"
- `ctx.permissionPresets`（L571）：两档 workspace-write / danger-full-access；"一次切换会写入一个 `permission/preset` 事件，并贯通到两个选项事件。"
- `ctx.llm` 实现列三包（L518）：llm-deepseek、llm-pi-ai、llm-replay（llm-replay 真实存在，位于 test-support 目录）。

## 评测者三彩蛋（详解 Step 2，均已查表）

① `llm-replay` = 关掉"模型随机性"这个噪声源的控制变量手段；② `pwsh-local` 对本机 Windows 环境有直接意义；③ `ctx.web` 是"工具集"维度现成零件。
