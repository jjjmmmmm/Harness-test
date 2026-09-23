# DSH architecture 笔记

日期：2026-09-23｜Block：D2-1（三篇之一）
状态：**AI 依据官方中文版补记**（`资料/DSH/原文/architecture.zh.md`，L±n 为该文件行号，可一键复查）。📕 五个核对点已由 AI 对照原文完成，建议抽查 2 处再签收。

- 5 个模板 profile：`web`、`headless`、`sdk`、`sdk-minimal`、`acp`（L19）
- patch 规则（L27）：按 **id** 定位条目，替换其**整个 config**（或插入新条目）；叠加顺序：**组合包们（按 profile 列出的顺序）→ profile 的 cordis.patch.yml → home 级那份 → 命令行 --patch**
- headless 热重载：**无**。原文依据（L29）："随附的 `web` profile 使用实时重载；`headless`、`sdk`、`sdk-minimal` 和 `acp` 则只在启动时应用一次所有配置层" → **改 patch 必须重启进程，改了不生效先查这条**
- dump-config 合同（原话，L37）："**它打印出的任何条目，都可以由你自己的 patch 替换。**" → 实验前先 `dsh --profile headless --dump-config` 存一份当基线
- seam 三角色（L133）：**Service Definition（声明接口）/ Service Provider（实现方）/ Consumer（使用方，通常是面向模型的工具）**；换 **Provider** = 换零件
- "模型可见即已记录"（L127，原文黑体）："抵达模型请求的一切都必须能从日志重建，并由一项运行时不变量断言这一点。新增模型可见输入需要一个会话事件。" → 报错完整还是被截断，会话日志是铁证
- 日志文件名（L125）：v0 = `session.jsonl[.zstd]`；v1 及以后 = `session.vN.jsonl[.zstd]`

## 比 mini loop 深一层的三点

1. "Everything is a Plugin" 点名连 **agent loop 本身**都是插件（L11："……包括模型适配器、工具注册表、会话日志，以及 agent loop（智能体循环）本身，因此每个都可以从配置替换"）→ 循环本身也是合法实验变量。
2. 共享执行世界（L135）："文件系统与进程提供方共享同一个执行世界，因此把它们指向远程沙箱，也就把 Bash、PTY 和 LSP 一并搬了过去，无需提供方专用 fork。" → patch 只改"一个条目"，但这个零件牵动的是整套执行环境——设计对照组时要意识到改动的真实半径。
3. DSH 版循环词汇（L88、L104）：**步骤** = 一次模型请求 + 它调的工具；**轮次** = 零或多个步骤；工具链 = `tool/call → tools/pre-execute → tools/execute → tools/post-execute → tool/result`（执行前后都有把关事件）；模型历史不是内存 list，是**每次请求前从会话日志"派生并冻结"**（L101），重试不重复组装。

对照组落地：两组用同一个 profile（headless），B 组多挂一条 patch，**patch 里只改一个条目**（归因纪律的工程形态）。

## 📕 五个核对点结果（对照 architecture.zh.md）

- ① L19 数出 5 个 profile 如上；L29 "启动时应用一次" 已抄 → 见上
- ② L37 合同原话已逐字抄 → 见上
- ③ L59–68 核心包表 ctx 键与详解一致；被详解省略的两行 = core/scope（库，无 ctx 键）、webhook（`ctx.webhookRuntime`）
- ④ L104 事件链顺序一致；L88 步骤/轮次定义一致
- ⑤ L127 黑体原则 + L125 两代文件名已抄 → 见上

## 自测（详解 §3 六问，口头过一遍即可，要点在详解里）

①连 agent 主循环都是插件意味着什么｜②dump-config 为什么先跑｜③headless 改 patch 不生效先查什么｜④"模型可见即已记录"对证据链的用处｜⑤seam 三角色、换谁是换零件｜⑥对照组的 patch 改几个条目
