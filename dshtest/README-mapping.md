# dshtest 目录读法（命名混淆更正，2026-09-24）

2026-09-22 跑 DSH 三个采集任务时，stdout 重定向的文件名标错了。对应关系：

| 文件（本目录） | 实际是 | 正名存档（harness-prep/failures/） |
|---|---|---|
| `T1.log`（16:16） | **T3 多步任务** stdout（写 count_words.py 统计 words.txt） | `dsh-T3-stdout.log` |
| `T1_2.log`（16:21） | **T2 故意失败** stdout（读不存在的 data.txt 并汇总） | `dsh-T2-stdout.log` |
| `greeting.txt`（16:14） | T1 产物（stdout 当时未存） | 2026-09-24 全新目录重跑补档 → `dsh-T1-stdout.log` |

- 卡样：`harness-prep/failures/04-dsh-T2-文件不存在.md`、`05-dsh-T3-多步自愈.md`（含 T2 报错原文与两会话行为链）。
- `T2-session-extract.jsonl` = T2 会话日志解压全文。坑：DSH 会话文件是**多帧 zstd**（流式追加），一次性 decompress 只得第一帧 176B，须 `stream_reader(read_across_frames=True)`。
- 教训：T2 与 T3 共用了本目录（T2 的 pivot 依赖 T3 残留的 count_words.py）——正式实验每次运行必须全新目录。
