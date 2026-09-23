# 卡样 5 ｜ DSH T3：多步任务——控制台编码问题的自愈闭环

实验：D2 Block 0｜运行：2026-09-22 16:15，dshtest/｜stdout 存档：`failures/dsh-T3-stdout.log`（原误名 dshtest/T1.log）
会话日志：`session-4e03c6fd-...`（同目录多帧 zstd）

- **任务**："写一个 python 脚本统计 words.txt 里出现最多的词并运行它"。
- **现象（会话行为链）**：`glob("**/words.txt")` 定位 → `pwsh` 列目录 → `read words.txt` → `write count_words.py` → `pwsh python count_words.py` → 输出**中文乱码**（GBK 控制台）→ **自愈：再调 pwsh 设置 `[Console]::OutputEncoding = UTF8` 后重跑** → 干净输出（apple 10）→ `turn/end = completed`。stdout 末尾模型还主动留了乱码对策（`$env:PYTHONIOENCODING='utf-8'`）。残留瑕疵：count.txt 内容 "0" 始终未更新（T2 的答复里模型自己指出了这一点）。
- **归因初判**：多步任务两个观察点都有货——①步骤间状态传递正常（write → run 链路完整、结果回传后继续下一步）；②遇到平台层编码问题没卡死也没瞎编，用工具修工具（重设编码重跑验证）。Windows 上 DSH 的命令执行走 **pwsh**——零件表 #2 `ctx.shell` 的 `pwsh-local` 实现"对本机有直接意义"这条标注，现在有了实证。
- **证据等级：较强**（stdout + 会话日志 + 产物 count_words.py 三重在案；乱码-自愈全程事件可回放）。
- 附注（T1 补档）：T1 应成功任务首次运行 2026-09-22 16:14 只留了产物（greeting.txt）没存 stdout；2026-09-24 于全新临时目录重跑补档：exit=0、greeting.txt 内容=hello 逐字核对通过（`failures/dsh-T1-stdout.log`）。
