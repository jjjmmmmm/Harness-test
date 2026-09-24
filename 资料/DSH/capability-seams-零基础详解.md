# capability-seams.md 零基础详解（v2 · 跟读版）

> 对应原文：`原文/capability-seams.md` / `原文/capability-seams.zh.md`（官方中文版）
> **v2 说明（2026-09-21）**：已逐条对照官方中文版核验——零件名/插槽名/实现包均无误；本次升级为流程版，并补 4 处原文细节（subagents 全部六个实现、`llm-replay` 回放适配器、`pwsh-local`、`ctx.web` 工具集 seam）。
> 计划位置：D2 Block 1（第二篇，先读 architecture 详解再读这篇，约 25 分钟）。
>
> 先说结论：**这篇"文档"其实是一张巨大的零件目录**——90% 篇幅是一张服务依赖图和一张几十行的大表。0 基础的你**不要逐行读**，那会淹死。你要练的技能是"会查这张目录"，不是"背下这张目录"。
>
> **怎么用**：跟着步骤框走；**📕 = 切到 `原文/capability-seams.zh.md` 的大表（文末那张）找对应 `ctx` 键的行，抄一行回来**。没找到就写"未见"。

---

> **Step 0 · 准备（2 分钟）**
> 左开本文件，右开原文大表；笔记/产出写进 `harness-prep/notes/dsh-parts.md`——**本篇的最终产出就是 D2 验收第 3 条要的"可换零件清单表"的底稿**（模板在文末）。
> 全篇只带一个问题读：**有哪些零件可以单独替换、各对应什么插槽？**

## 1. 这篇文档是什么，为什么 JD 点名它

`capability-seams.md` 列出 DSH 里**所有可替换能力（seam）的清单**：每个 seam 的插槽名（`ctx.什么`）、接口声明包、现有实现包、直接消费方。

JD 说 DSH"把文件系统、沙箱、压缩、工具集、权限都做成了可单独替换的插件，能一次只动一处——这是归因的前提"。**这篇文档就是那个"可单独替换"的官方清单**。你的交付物 |0|（可换零件清单）几乎就是以它为底子做筛选。

## 2. 十秒钟版：seam 的含义

回到 architecture 详解的三角色：**接口声明 / 实现（Provider）/ 消费方**。这张大表按此列出每个能力：

- `ctx.fs`（文件系统）：接口在 `fs` 包；实现有 `fs-local`（本地磁盘）、`fs-sandbox`（按沙箱策略限制）、`fs-ssh`（远程）；消费方是 `tool-fs`（模型的读写文件工具）。
- **换个实现 = 换个零件**：把 `fs-local` 换成 `fs-sandbox`，模型工具一个字不用改，但"文件写到哪、能写哪"全变了。

> 📕 **核对点 ①（热身）**：在原文大表找到 `ctx.fs` 那一行，抄"实现"列的三个包名——这是你第一次查表，后面全靠这个动作。

> **Step 1 · 按七维度挑零件（15 分钟）**
> 🎯 每个维度记 1–2 个零件（插槽名 + 实现名）即可；完整清单会查就行。

### 信息回传（模型能看到什么结果/报错）
| 零件 | 插槽 | 说明 |
| :--- | :--- | :--- |
| 工具执行流水线 | `ctx.tools` | 每次调用经过：策略前处理 → 单调守卫 → 环绕分派 → 策略后处理 → 结果观测（原文用词） |
| 结果外置（spill） | `ctx.spillStore` | **过大的工具输出**不整个塞给模型：后端保存文本、返回面向模型的定位信息与取回提示；何时 spill 由 `spill-policy`（tools/post-execute 消费方）决定 |
| 工具结果修剪 | `ctx.toolResultPruner` | 在摘要压缩前，用可回放的单节点表层替换改写过大的当前工具结果 |

**为什么值得注意**：报错"被截断/被摘要"这类 JD 点名的失败，就藏在这组策略里。

### 产物落点（文件写去哪了）
| 零件 | 插槽 | 说明 |
| :--- | :--- | :--- |
| 文件系统提供方 | `ctx.fs` | `fs-local` / `fs-sandbox` / `fs-ssh` 三选一 |
| 附件存储 | `ctx.attachments` | 图片等二进制的持久引用 |

### 失败恢复（错了之后怎么办）
| 零件 | 插槽 | 说明 |
| :--- | :--- | :--- |
| 请求恢复 | agent-loop | 有界重试、失败分片不产生副作用 |
| 子 agent 委派 | `ctx.subagents` | **原文列出全部六个实现**：`subagent-spawn-in-process`（进程内新建）、`subagent-fork-in-process`（进程内分叉）、`subagent-acp`（委派 ACP）、`subagent-codex`（委派 Codex）、`subagent-claude-code`（委派 Claude Code）、`subagent-dsh-sdk`（委派另一个 DSH）——"换个执行体"最极端的形态 |

### 上下文管理（模型的历史里留什么）
| 零件 | 插槽 | 说明 |
| :--- | :--- | :--- |
| 压缩 | `ctx.compaction` | 实现 `compaction-basic`：消费步骤后的压力事件，把旧历史压成摘要；**原文注明"不存在面向模型的压缩工具"** |
| 会话日志投影 | `ctx.sessions` / 投影 | 模型历史从日志投影而来（"模型可见即已记录"） |
| 系统提示词组装 | `ctx.systemPrompt` | 哪些片段、哪些工具说明书进开头 |

### 中止条件（什么时候停）
| 零件 | 插槽 | 说明 |
| :--- | :--- | :--- |
| 轮次停止/取消 | `agent/*` 事件 | 显式取消、协作式工具取消 |
| 超时 | 工具超时策略库 | 每个工具调用可带 deadline |
| 后台任务 | `ctx.jobs` | 后台 bash、PTY 发送和 subagent 委派登记运行中工作；`tool-jobs` 是面向模型的控制器（读取/列出/终止） |

### 权限边界（什么允许做）
| 零件 | 插槽 | 说明 |
| :--- | :--- | :--- |
| 进程沙箱 | `ctx.sandbox` | `sandbox-local` / `sandbox-ssh`；消费方交出即将执行的确切 argv，后端按每次调用的策略包装它 |
| 沙箱策略 | `ctx.sandboxPolicy` | 原文原话：统一保存部署默认模式和工作区根目录；**"两类强制执行组件都读取该服务，因此 bash 与 fs 不会限制到不同的根目录"** |
| 审批 | `ctx.approval` | 一次性权限决策走 `approval/request` 瀑布式事件 |
| 权限预设 | `ctx.permissionPresets` | 两档：`workspace-write` / `danger-full-access`；**一次切换写入一个 `permission/preset` 事件，并贯通到两个选项事件**（可观测！） |

### 可观测性（发生了什么能被看到）
| 零件 | 插槽 | 说明 |
| :--- | :--- | :--- |
| 会话日志 | JSONL 持久化 | 每会话一份（v0 `session.jsonl` / v1+ `session.vN.jsonl`）——你的证据原料 |
| 遥测 | `ctx.sessionTelemetry` | 会话记录脱敏后交后端（实现 `session-telemetry-otel`） |
| 会话查询 | `ctx.sessionQuery` | 精确读取/过滤/追踪/全文搜索（实现 `session-query-sqlite`） |

> 📕 **核对点 ②**：查表抄两行——`ctx.sandboxPolicy` 行（把"不会限制到不同的根目录"那句抄全）和 `ctx.permissionPresets` 行（确认两档预设名）。这两个是 D3 候选零件，抄准了后面直接用。

> **Step 2 · 评测者视角的三个彩蛋（5 分钟，都是原文大表里的）**
> 🎯 这三个零件对"做评测"特别有用，一般读者会略过：

1. **`ctx.llm` 的实现里有 `llm-replay`（回放适配器）**——除了 `llm-deepseek`、`llm-pi-ai`，还有专门"回放"的适配器。评测含义：**同一段模型输出可以回放给不同 harness 配置**——把"模型随机性"这个噪声源整个关掉，是比多次运行更狠的控制变量手段。
2. **`ctx.shell` 的实现里有 `pwsh-local`（PowerShell）**——除 `bash-local`、`bash-sandbox` 外。你在 Windows 上，这条对你的环境有直接意义。
3. **`ctx.web`（工具集维度）**——搜索/抓取的 seam：实现有 `web-search-exa`、`web-search-perplexity`、`web-search-deepseek`、`web-fetch-http`；"工具集"这个 JD 维度的现成零件。

> 📕 **核对点 ③**：在大表找到 `ctx.llm` 行，抄实现列三个包名（确认 `llm-replay` 真实存在）。

> **Step 3 · "一次只动一处"在工程上怎么落地（3 分钟）**

结合 architecture 详解的 profile/patch 机制：

1. `dsh --profile headless --dump-config` 导出基线配置；
2. 对照组 A：原配置直接跑；
3. 对照组 B：同一 profile + 一条 `cordis.patch.yml`，**patch 里只有一个条目**（比如把 `ctx.fs` 的实现从 `fs-local` 换成 `fs-sandbox`）；
4. 两组的差异 = 一个零件。归因成立的前提就是这条纪律。**别忘了：headless 只在启动时应用配置层——改 patch 要重启。**

## 4. 读后自测

1. `ctx.fs` 有哪三个实现？换实现对模型的读写文件工具有没有影响？（要点：fs-local/fs-sandbox/fs-ssh；没有——消费方 tool-fs 不改）
2. `ctx.sandboxPolicy` 为什么必须让 bash 和 fs 共用？（要点：各限各的根 = "顺手改了两处"式事故的温床；两类强制组件读同一服务）
3. `danger-full-access` 这个预设名为什么对评测者是警铃？（要点：全放开 = 权限维度被推到极端，实验里它意味着"权限不设防"这一格）
4. `ctx.subagents` 六个实现里有你天天用的产品——哪两个？说明"可替换"激进到什么程度？（要点：Codex、Claude Code；连执行体都能换成别家产品）
5. `llm-replay` 对你的实验有什么用？（要点：回放固定输出，关掉模型随机性这个噪声源）
6. 挑一个你最想在 D3 动的零件，说出：插槽名、现在的实现、换成什么、预期影响哪类任务。

## 5. 你 D3 实验该选哪个零件（建议）

按"改动简单、效果可程序化判定"排序：

| 候选零件 | 改法 | 为什么（不）推荐 |
| :--- | :--- | :--- |
| **权限预设**：`workspace-write` vs `danger-full-access` | 换 preset | 容易改；但影响太"硬"（直接允许/拒绝），区分度可能不够细腻 |
| **沙箱开/关**：`bash-local` vs `bash-sandbox` | 换 shell 执行器 | 干净；但依赖 Docker 沙箱装好 |
| **压缩开关**（`ctx.compaction` 行为） | patch | 贴近 JD"上下文管理"维度；需要长任务才显效，8 题小任务可能压不满 |
| **子 agent 委派目标**（`ctx.subagents`） | 换 provider | 最"换执行体"的 knob，但涉及面大，D3 时间不够 |

> 计划里 D3 的推荐题（错误信息截断 vs 完整回传）如果在 DSH 里配置成本高，就退回"在你自己的 mini loop 里做同样消融"——方法同构，零件级别相同，报告里如实说明即可。

## 6. 产出模板：可换零件清单表底稿（D2 验收第 3 条）

```markdown
# DSH 可换零件清单（底稿）
| # | 零件（插槽名） | 现有实现（全部列出） | 我会换成什么 | 改动影响（预期） | D3 候选？ |
|---|---|---|---|---|---|
| 1 | ctx.fs | fs-local / fs-sandbox / fs-ssh | … | 文件写到哪、能写哪 | |
| 2 | … | | | | |
（目标 ≥10 行；每行都经 📕 查表核对过再写"已核对"）
📕 核对记录：ctx.sandboxPolicy 原句 = ____
```
