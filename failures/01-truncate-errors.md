# 卡样 1 ｜ 弄坏开关 1：报错截断（TRUNCATE_ERRORS）

实验：D1 Block 4 ｜日期：2026-09-22 ｜代码：`02/mini-agent-loop.py` ｜原始日志：`00-raw-console-2026-09-22.md`

- **任务**：读 data.txt 统计出现最多的词并写入 result.txt（data.txt 事先改名为 data1.txt，制造一次真实的读文件失败）。
- **截断版（运行 2，TRUNCATE_ERRORS=True）**：step 0 只收到 `Error: failed` → 模型调 run_python 列目录，发现 data1.txt → 读它、统计、在 run_python 里顺手写文件——4 步完成，答案诚实汇报"data.txt 不存在"。
- **完整版（运行 7，TRUNCATE_ERRORS=False）**：step 0 收到 `FileNotFoundError: [Errno 2] ... 'data.txt'`（带文件名）→ 同样列目录 → 5 步完成，最后用 write_file 落盘。
- **现象**：两种报错形态下模型都恢复了，恢复路径几乎一样（列目录 → 读 data1.txt → 统计 → 写）；截断没有造成打转或失败；差异在步数（4 vs 5）和写文件的方式（run_python 内嵌 vs 专门调 write_file）。
- **归因初判**：read_file 的报错被截断后，模型丢掉的是"**哪个文件**不存在"这条线索；但它调用 run_python 列目录——子进程的输出不经过截断开关，信息从**旁路**补了回来。截断的伤害被"系统里还有第二条信息通道"吸收。若 run_python 也被撤掉，截断大概率致命。
- **证据等级：仅观察**——两次运行的任务文本可能不一致（写文件方式不同是暗示），且各只跑一次，不能下"截断不增加成本"的结论。D3 可预注册的假设：**撤掉旁路后，截断效应放大**。
