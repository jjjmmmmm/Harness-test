# 教程 02 · 手写 Mini-Agent：60 行看懂 agent 循环（D1 Block 3–4 配套）

> 目标：亲手写一个带 3 个工具的 agent 循环，**并且内置 3 个"弄坏开关"**——D1 下午弄坏它、D3 的消融实验，用的都是这同一个文件。
> 这是理解 JD 那句"模型输出 → 调工具 → 结果回给模型"的最快路径：DSH 的循环比这复杂一百倍，但**骨架一模一样**。
> 学习纪律：下面的代码分段讲解，每段先自己想"如果是我会怎么写"，再对照手敲。

---

## 1. 原理：循环到底转的是什么

没有工具的模型：你问 → 它答，结束。
有工具的 agent：

```
┌────────────────────────────────────────────┐
│ 1. 把「任务 + 工具说明书 + 历史记录」发给模型  │
│ 2. 模型回复：要么是最终答案，要么是"我要用工具X" │
│    ├─ 是最终答案 → 退出循环                   │
│    └─ 要用工具 → 3                           │
│ 3. 你（不是模型！）在本地执行这个工具           │
│ 4. 把工具结果追加进历史记录 → 回到 1           │
└────────────────────────────────────────────┘
```

**最容易被误解的一点**：模型自己**执行不了任何东西**。它只能说"我想调 read_file 这个工具"；真正读文件的是你写的 Python。执行结果作为一条新消息发回去，模型才知道发生了什么。harness 的所有价值（工具强不强、报错清不清楚、历史保不保留）都发生在这个循环里。

## 2. 工具协议：怎么让模型"说人话"地请求工具

我们用最透明的方式：要求模型**每次回复都输出一个 JSON 对象**（包在 ```json 代码块里）：

- 要用工具时：`{"thought": "...", "tool": "read_file", "args": {"path": "data.txt"}}`
- 任务完成时：`{"thought": "...", "final": "任务完成了，因为..."}`

（真实 harness 如 DSH 用更完善的机制——工具 schema 注入提示词、原生 function calling——但循环结构完全相同。我们选手写 JSON 是因为**每一环你都看得见**。）

## 3. 三个工具 + 三个"弄坏开关"

```python
import json
import subprocess
from openai import OpenAI

# ─────── 弄坏开关（D1 Block 4 和 D3 实验就改这里，一次只改一个！）───────
TRUNCATE_ERRORS = False   # True = 工具报错只回 "Error: failed"（模拟报错被截断）
KEEP_LAST_N     = None    # 设为 1 = 只保留最近 1 条历史（模拟上下文被压缩）
DISABLED_TOOLS  = []      # 加入 "write_file" = 撤掉这个工具（模拟零件缺失）
# ────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """你是一个谨慎的 agent。每轮回复必须是且仅是一个 JSON 对象（放在```json 代码块中）：
需要用工具时: {"thought": "简要理由", "tool": "工具名", "args": {...}}
任务完成时:   {"thought": "简要理由", "final": "给用户的最终答复"}
可用工具：
- read_file:  {"path": "文件路径"} → 返回文件内容
- write_file: {"path": "文件路径", "content": "要写入的内容"} → 创建/覆盖文件
- run_python: {"code": "python 代码"} → 执行并返回输出
任务完成后必须立即给 final，不要重复劳动。"""
```

**注意第三点**：工具清单写死在系统提示词里——这就是 DSH `ctx.systemPrompt`（提示词组装）干的事。`DISABLED_TOOLS` 里的工具要同时从"可用工具"文字和本地注册表里消失，**两处必须一致**，否则模型会调一个根本不存在的工具（这本身就是一种经典的 harness 失败，值得观察）。

## 4. 工具执行器：harness 的"手"

```python
def execute_tool(name: str, args: dict) -> str:
    """执行一个工具，返回给模型看的结果文本。"""
    try:
        if name == "read_file":
            with open(args["path"], "r", encoding="utf-8") as f:
                return f.read()
        if name == "write_file":
            with open(args["path"], "w", encoding="utf-8") as f:
                f.write(args["content"])
            return f"已写入 {args['path']}"
        if name == "run_python":
            proc = subprocess.run(
                ["python", "-c", args["code"]],
                capture_output=True, text=True, timeout=30,
            )
            out = proc.stdout + proc.stderr
            return out if out.strip() else "(无输出)"
        return f"未知工具: {name}"
    except Exception as e:                       # 任何意外都变成"给模型的报错"
        msg = f"{type(e).__name__}: {e}"
        if TRUNCATE_ERRORS:                      # ← 弄坏开关 1：把报错截成废话
            return "Error: failed"
        return msg
```

体会一下：**同一个失败**，`TRUNCATE_ERRORS=False` 时模型能看到 `FileNotFoundError: [Errno 2] No such file: 'data.txt'`——它会换个路径或先创建文件；`=True` 时只看到 `Error: failed`——它只能瞎猜。这一行开关就是 JD 那个"报错被截断"故事的全部，也是你 D3 实验的消融对象。

## 5. 主循环：模型的大脑外的一切

```python
def run_agent(task: str, client: OpenAI, max_steps: int = 10) -> str:
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": task},
    ]
    for step in range(max_steps):
        if KEEP_LAST_N is not None:              # ← 弄坏开关 2：砍历史
            messages = messages[-KEEP_LAST_N:]
            # 砍掉 system 后必须补回来，否则模型忘了规则（观察这会怎样！）
            if messages[0]["role"] != "system":
                messages.insert(0, {"role": "system", "content": SYSTEM_PROMPT})

        resp = client.chat.completions.create(
            model="deepseek-chat", temperature=0, messages=messages,
        )
        text = resp.choices[0].message.content

        reply = parse_json_block(text)           # 见下
        if reply is None:                        # 模型没按要求给 JSON
            messages.append({"role": "assistant", "content": text})
            messages.append({"role": "user", "content": "你的回复不是合法 JSON，请重新按格式输出。"})
            continue

        if "final" in reply:
            return reply["final"]                # 任务完成，退出循环

        tool = reply.get("tool")
        if tool in DISABLED_TOOLS:               # ← 弄坏开关 3：工具被撤
            result = f"Error: 工具 {tool} 不可用"
        else:
            result = execute_tool(tool, reply.get("args", {}))

        print(f"  [step {step}] {tool}({reply.get('args')}) -> {result[:60]}")
        messages.append({"role": "assistant", "content": text})
        messages.append({"role": "user", "content": f"工具结果：\n{result}"})
    return "(达到最大步数仍未完成)"


def parse_json_block(text: str):
    """从模型回复里抠出 ```json 块并解析；失败返回 None。"""
    if "```json" not in text:
        return None
    body = text.split("```json")[1].split("```")[0]
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return None
```

加上入口：

```python
if __name__ == "__main__":
    import os
    client = OpenAI(api_key=os.environ["DEEPSEEK_API_KEY"],
                    base_url="https://api.deepseek.com")
    answer = run_agent("读 data.txt，统计出现最多的词，把结果写入 result.txt", client)
    print("最终答案:", answer)
```

跑之前准备一个 `data.txt`（几十个单词，有明显的众数）。

## 6. 验收：先跑通，再弄坏

1. **跑通**：观察它 read → run_python（或心算）→ write 的过程，最终 `result.txt` 内容正确。
2. **弄坏 1**（`TRUNCATE_ERRORS=True`，把 data.txt 临时改名制造一次失败）：观察模型在 `Error: failed` 面前的行为 vs 完整报错面前的行为，**两种各截图**。
3. **弄坏 2**（`KEEP_LAST_N=1`，用多步任务）：观察它忘记之前做过什么、重复读文件或答非所问。
4. **弄坏 3**（`DISABLED_TOOLS=["write_file"]`）：观察它尝试调用被拒后的反应——是换方案还是反复撞墙？

每个弄坏实验存 3 行卡样记录（模板见 DSH 上手指南 §4）。

## 7. 对照 DSH：你刚写的东西在真 harness 里叫什么

| 你的 mini agent | DSH 里的对应物 |
| :--- | :--- |
| `SYSTEM_PROMPT` 里的工具清单 | `ctx.systemPrompt` 提示词组装 |
| `execute_tool()` | `ctx.tools` 执行流水线（多了前后把关事件） |
| `messages` 列表 | 会话日志（持久化，"模型可见即已记录"） |
| `KEEP_LAST_N` 砍历史 | `ctx.compaction` 压缩 |
| `max_steps` | 中止条件/超时策略 |
| `TRUNCATE_ERRORS` | 工具结果的回传/外置（spill）策略 |

**这句话写进你的面试弹药库**：我用 60 行写过一个带故障注入开关的 mini agent，亲眼复现了"报错截断让模型原地打转"和"砍历史让 agent 失忆"两类执行层失败——所以我理解 DSH 的 compaction、工具流水线这些零件各自防的是什么病。
