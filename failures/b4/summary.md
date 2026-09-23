# B4 失败指纹对比（4 配置 × 2 模型 + truncate 补测，2026-09-23）

第一轮 8 次（b4_fingerprint.py 自动跑，data.txt 在位）：

| 配置 | 模型 | 步数 | 落盘 | 用时s | 最终答复摘要 |
|---|---|---|---|---|---|
| baseline | chat | 2 | 是 | 7.0 | 已完成统计并写入 result.txt。出现最多的词是 apple，共 10 次。 |
| baseline | reasoner | 2 | 是 | 2.7 | 已完成。读取 data.txt 后统计词频，apple 10 次，已写入 result.txt。 |
| truncate | chat | 2 | 是 | 3.1 | （开关未触发，见下）同 baseline 形态 |
| truncate | reasoner | 3 | 是 | 4.4 | （开关未触发，见下）同 baseline 形态 |
| keep1 | chat | 2 | **否** | 2.5 | "我收到一个工具结果'10'，但还没有任务说明，你想让我做什么？" |
| keep1 | reasoner | 2 | **否** | 5.7 | "统计完成：总词数 50。apple 10 次……"（口头汇报，不落盘） |
| no_write | chat | 2 | 是 | 2.6 | 已完成（run_python 内嵌写盘，未碰被撤的 write_file） |
| no_write | reasoner | 2 | 是 | 4.5 | 已完成，result.txt 内容 "apple 10"（同上，旁路写盘） |

**⚠️ 协议教训**：第一轮 truncate 两跑空转——data.txt 在位、read_file 没失败，截断开关从未被任何错误触发（两次形态与 baseline 一致反过来印证了"没触发=无差异"）。**触发条件是实验协议的一部分**：按 D1 卡样 1 的协议补测如下。

补测（data.txt 事先改名 data1.txt，跑完恢复）：

| 配置 | 模型 | 步数 | 落盘 | 用时s | 恢复路径 |
|---|---|---|---|---|---|
| truncate-rename | chat | 4 | 是 | 5.3 | `Error: failed` → run_python 列目录 → 读 data1.txt → run_python 统计+写盘 |
| truncate-rename | reasoner | 4 | 是 | 8.9 | `Error: failed` → run_python 列目录 → 读 data1.txt → run_python 统计+写盘（还回读验证） |

## 指纹判读（AI 草稿 2026-09-23，待本人复核各 .log 后签收）

**1. keep1（砍历史）——指纹复现 ✅ 初判锅在 harness（仅观察）**
chat 和 reasoner **都丢了"写入 result.txt"这条任务指令**（KEEP_LAST_N=1 砍掉的正是它），都没落盘，都把"统计"当成任务全部。末态形态有差异：chat 迷路问人（"你想让我做什么"），reasoner 自信假汇报——但假完成**正好复刻 D1 卡样 2 的 chat 形态**。核心症状（任务指令丢失→不落盘）跨模型复现；末态差异值得 D3 多次跑。

**2. truncate-rename（报错截断）——指纹复现 ✅ 恢复路径逐步对齐（仅观察）**
两模型 4 步完全同构：截断的 `Error: failed` → **run_python 列目录（旁路：子进程输出不经过截断开关）** → 读 data1.txt → 统计落盘；连最终答复都同款（都主动提醒"data.txt 不存在，用的是 data1.txt"）。卡样 1 的预言"截断伤害被第二条信息通道吸收"在第二个模型上复现。初判锅在 harness 信息通道设计（截断没盖住 run_python），不是模型。D3 可预注册：撤掉 run_python 后截断效应放大。

**3. no_write（撤工具）——本轮"未遂"，跨 run 形态漂移 → 分不清（证据不够）**
两模型都没碰被撤的 write_file，直接 run_python 内嵌写盘完成（产物正确，走的是已知后门）。与 D1 卡样 3 同配置的"原样重试→诚实认输"**形态不一致**——同配置跨 run 会抽到不同路径。这条本身就是"指纹判定必须多次运行"的直接证据（D3 每配置 8 次不是浪费，是底线）。另：baseline 里两模型也都用 run_python 落盘——mini loop 里"绕过 write_file"是常态，不是异常。

**结论行**：keep1、truncate-rename 指纹跨模型复现 → 初判锅在 harness（均仅观察，单次）；no_write 形态不稳定 → 证据不够，需多次运行。
**方法论收获**：① 触发条件要写进协议（不触发=白跑）；② 单次 run 形态会漂移 → 重复运行是底线；③ 判"未遂"也要记录（模型绕过了被测障碍 ≠ 实验无发现）。
