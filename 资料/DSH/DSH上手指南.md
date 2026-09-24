# DSH 上手指南（D2 实操手册）

> 目标：D2 上午用最少步骤把 DSH 跑起来、配好 DeepSeek key、用 headless 模式跑 3 个任务并收集"卡住的样"。
> 你已装好 DSH 和 Node.js；Docker 已装好并验证（hello-world 通过，2026-09-22）。
> 具体命令以你本机 `dsh --help` 和仓库 README 为准——版本在快速迭代，**以下命令若有出入，以本机 help 输出为准**（这个"以实测为准"的习惯本身就是评测纪律）。

## 0. 为什么实验用 headless、不用 dsh web（30 秒，先读）

| | `dsh web`（浏览器界面） | `dsh --profile headless`（命令行一次性运行） |
| :--- | :--- | :--- |
| 定位 | 给"**用 agent 干活**"的人 | 给"**评测 agent**"的人——你的角色 |
| 跑 128 次对照（D3） | 手点 128 次，环境还不保证干净 | 脚本循环，每次全新目录 |
| 存证据 | 要去 DSH_HOME 翻会话日志 | `> run.log 2>&1` 一条命令全存 |
| 机器可读出口 | 无 | `--json` 事件流 + 退出码（0=完成 / 1=中止） |
| 学习成本 | 看着零门槛，配置藏设置页、日志藏目录 | **总共三条命令**，全部可复制 |

**headless 核心命令（直接抄）**：
```sh
dsh --profile headless "任务文本"            # 跑一次，最终答案打到 stdout，退出码 0=完成/1=失败
dsh --profile headless --dump-config         # 打印生效配置树（实验基线）
```

> **⚠️ 版本对照（2026-09-22 实测，本机 0.1.0-rc.6）**：官方文档描述的 `--json` 事件流和 `--session-id` 在你装的版本里**还不存在**（npm latest 0.1.5-rc.2 的依赖声明是坏的，装不上）。你的证据来源因此是：**stdout 最终答案 + 退出码 + 磁盘产物 + DSH_HOME 会话日志**（`session.vN.jsonl`，里面每步工具调用俱全——"模型可见即已记录"）。将来想确认新版本有没有，跑 `dsh --profile headless --help | grep json`，有输出再启用 §3.1 的用法。

**web 的正确用法＝开场观光车（10 分钟）**：跑正式任务前，先 `dsh web` 起界面、手动把 T1 跑一遍——**亲眼看工具调用面板和审批弹窗**（那就是 `ctx.approval` 瀑布事件在 UI 上的样子），这是"用过 Agent 产品"的体感分。看完关掉，存档和 T2/T3 全走 headless。

---

## 1. 开工前 30 秒体检

```sh
node --version      # 应输出 v20+ 之类
dsh --version       # 确认 dsh 命令可用（你已装好）
docker --version    # D1 晚装好后应有输出
docker run hello-world   # Docker 全链路通
```

## 2. 配置 DeepSeek API key

两条常见路径（以 `dsh --help` 输出为准）：

1. **环境变量**（最简单）：在 Git Bash 里
   ```sh
   export DEEPSEEK_API_KEY="sk-你的key"
   ```
   想持久化就写进 `~/.bashrc`。
2. **dsh 自带设置**：DSH 有凭据 seam（`ctx.credentials`）和设置界面，`dsh web` 的设置页里可以配；headless 跑批时环境变量更省事。

**验证**：直接跑第一个任务（见下），能收到模型回复即配通。

## 3. 跑第一个任务：headless 模式（做实验的主力）

```sh
dsh --profile headless "列出当前目录下的文件，并把文件个数写入 count.txt"
```

行为（来自 headless 官方文档）：跑完把**最终答案打到 stdout 然后退出**——没有界面、不占端口、不留后台进程。退出码 **0=完成，1=中止/出错**。

任务也可以从管道进来：

```sh
echo "把当前目录里所有 .md 文件的标题列出来" | dsh --profile headless
```

### 3.1 `--json`：机器可读事件流（**本机 0.1.0-rc.6 暂不可用，保留备查**）

> 你装的版本没有这个参数（`unknown option '--json'`，2026-09-22 实测）。以下内容对应官方文档描述的新版行为，**等 `dsh --profile headless --help | grep json` 有输出那天再用**。在 rc.6 上，事件级证据去 DSH_HOME 的会话日志里拿（见 §5）。

```sh
dsh --profile headless --json "把 hello 写入 hello.txt"
```

stdout 变成**每行一个 JSON 事件**，顺序大致是：

| 事件 | 含义 |
| :--- | :--- |
| `session` | 开头，携带本次会话 id |
| `status` / `text` / `thinking` | 状态与模型文本（**步骤提交时才到**，不是逐 token） |
| `tool_call` / `tool_result` | 模型调了什么工具 / 工具返回了什么 |
| `final` | 结尾，携带与普通模式相同的最终答案 |

要点：
- 每条字符串/对象键上限 8 KiB，超出带 `truncated` 标记——**你自己动手做"截断消融"之前，先知道它内部已有截断保护**；
- 轮次内失败的运行也可能以 `final` 结束而没有 `error` 事件——**所以失败判定要以"退出码 1 + turn_end 原因 + 检查脚本"三重确认**，不能只看有没有 error 事件（这是官方文档原话提醒的坑）。

### 3.2 看配置树（实验基线）

```sh
dsh --profile headless --dump-config
```

把输出存进你的实验仓库 `baseline-config.txt`——对照组 A/B 的"没动过的那一份"。

## 4. D2 的三个采集任务（收集"卡住的样"）

每个任务跑完，把 stdout/stderr/产物文件存进 `harness-prep/failures/`，并标注：卡在哪一步、模型当时"以为"什么、真实世界发生了什么。**统一跑法**：进一个全新目录再跑，命令后面接重定向（`> T1.log 2>&1`），日志就是你的证据。

> 先花 10 分钟：`dsh web` 起界面，手动跑一遍 T1 看**工具调用面板和审批弹窗**长什么样（体感分）；然后关掉，下面三个任务全用 headless 存档版重跑。

| # | 任务 | 预期观察 |
| :--- | :--- | :--- |
| T1（应成功） | "创建 greeting.txt，内容为 hello" | 基准：正常流程长什么样 |
| T2（故意失败） | "读取 data.txt 并汇总"（**当前目录没有 data.txt**） | 看它怎么处理"文件不存在"：报错信息长什么样？它会怎么重试/放弃？把报错原文存下来 |
| T3（多步） | "写一个 python 脚本统计 words.txt 里出现最多的词并运行它"（先手工准备 words.txt） | 步骤变多后：上下文管理、步骤间状态传递；留意 token 消耗 |

**卡样记录模板**（每条 3 行）：
```
任务：T2
现象：模型连续 3 次尝试读取 data.txt，每次收到同样的 ENOENT 报错后改为列出目录
归因初判：模型行为合理（在探索），失败根源是任务前提不成立 → 归"环境边界型"，不是模型的锅也不是 harness 的锅
```

## 5. 会话日志在哪（你的证据原料）

DSH 会话以 JSONL 持久化（`session.vN.jsonl[.zstd]`，zstd 是压缩格式），存放在 Harness home（环境变量 `DSH_HOME`，未设时是默认用户目录下的 harness home）的 `sessions/` 一类子目录。找不到就：

```sh
ls "$DSH_HOME" 2>/dev/null || ls ~/.dsh* 2>/dev/null; dsh --help | grep -i home
```

用 `--json` 拿到 session id 后按 id 检索文件。日志里能看到每一步模型看到了什么——这就是"模型可见即已记录"原则给你的证据链。

## 6. Python 驱动骨架（D3 实验 runner 的地基，已适配本机 rc.6）

D3 的实验脚本本质：**循环调用 headless → 用退出码+stdout 判定 → 检查脚本验产物 → 存结果**。事件级细节需要深挖时去读 DSH_HOME 的会话日志（§5）。地基代码（D2 先跑通一次，D3 再扩成全量）：

```python
import json, subprocess, tempfile, os, shutil

def run_task(task: str, timeout: int = 300):
    """在全新临时目录跑一次 headless 任务。
    返回 (退出码, 最终答案stdout, 完整日志, 临时目录路径)。"""
    workdir = tempfile.mkdtemp(prefix="dsh-t")   # 每次全新目录 = 初始状态可控（硬纪律）
    proc = subprocess.run(
        ["dsh", "--profile", "headless", task],
        capture_output=True, text=True, timeout=timeout, cwd=workdir,
    )
    return proc.returncode, proc.stdout.strip(), proc.stderr, workdir

code, out, err, workdir = run_task("创建 greeting.txt，内容为 hello")
print("退出码:", code)                      # 0=完成, 1=中止/出错 —— 失败判定第一重
print("最终答案:", out[:200])
print("产物核对:", os.path.isfile(os.path.join(workdir, "greeting.txt")),  # 第二重: 外部验证
      "内容对:", open(os.path.join(workdir, "greeting.txt"), encoding="utf-8").read() == "hello")
shutil.copy(os.path.join(workdir, "greeting.txt"), "T1-greeting.txt")      # 产物存档
# 失败时把 err 里最后几行 dsh: 诊断 + workdir 一起记进卡样
```

（**学习纪律提醒**：这段是骨架示范，请手敲进你的文件、每行能讲出干什么，再运行。）

## 7. 常见坑速查

| 坑 | 症状 | 处理 |
| :--- | :--- | :--- |
| key 没配对 | 报 401/认证错误 | `echo $DEEPSEEK_API_KEY` 检查；重开终端后要重新 export |
| Docker 没起 | 沙箱类任务失败/挂起 | 先 `docker run hello-world` 验证 |
| stdout 混入 stderr | JSON 解析偶尔失败 | 解析时 try/except 跳过（骨架已处理）；推理内容走 stderr 是设计行为 |
| 只看 error 事件漏判失败 | 明明失败却"看起来正常" | 退出码 + turn_end 原因 + 检查脚本三重确认 |
| 每次运行目录被上次污染 | 任务间结果互相影响 | 每次运行用全新临时目录（D3 实验的硬纪律） |
| 折腾超过 1 小时 | —— | 启动 B 计划：改用你 D1 的 mini loop 做实验，如实记录 |
