# 卡样 4 ｜ DSH T2：故意失败——"文件不存在"在 DSH 工具面上的真实形态

实验：D2 Block 0｜运行：2026-09-22 16:21，dshtest/｜stdout 存档：`failures/dsh-T2-stdout.log`（原误名 dshtest/T1_2.log）
会话日志：`~/.dsh/sessions/.../session-4a836509-...`（122 事件；解压全文在 `dshtest/T2-session-extract.jsonl`——注意是**多帧 zstd**，一次性 decompress 只出第一帧 176B，须 `stream_reader(read_across_frames=True)`）

- **任务**："读取 data.txt 并汇总"（当前目录没有 data.txt）。
- **现象（会话行为链）**：`glob("data.txt")` → `No files found`；`glob("**/data.txt")` → `No files found`；`glob("**/*")` 列全目录 → `pwsh Get-ChildItem` → `read` ×5（hello/greeting/words/count.txt/count_words.py）→ `pwsh python count_words.py` → `turn/end = completed`（退出码 0）。
- **报错原文（D2 验收 2 指定项）**：`{"text": "No files found"}` ×2，且 **`isError: false`**——DSH 里"文件不存在"根本不以错误形态出现，是空 glob 结果（搜索语义）。**对照 mini loop**：同一情境回 `FileNotFoundError: [Errno 2] ... 'data.txt'`（异常语义）。同一事实、两种回传形态——这就是 D3 截断消融要拉开的维度在真实 harness 里的样子。
- **归因初判**：环境边界型（任务前提不成立）。模型行为合理（先探测后行动、pivot 到现有素材、最终答复诚实声明"未找到 data.txt"并反问）——不是模型的锅；DSH 的 glob-first 工具面把"不存在"吸收成搜索结果，连报错都没发生。**目录污染警告**：pivot 顺滑部分依赖 T3 残留的 count_words.py（16:15 先跑、共用同一工作区）——违反"每次运行全新目录"硬纪律；若目录是空的，行为可能不同（未测，单列）。
- **证据等级：较强**（122 事件完整可回放、报错原文逐字在案、退出码与产物双重核对）。
