import json
import os
import subprocess
from pathlib import Path
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

# ─── 权限边界（最小版沙箱，2026-09-22 补）───
# 起因：Mimosa 扫描在 commit 前拦下"路径穿越"高危——模型给的路径未加限制即可写盘。
# 本版双管齐下：读路径必须经 safe_path 规范化并锁死在工作区内；写路径由 harness
# 钉死为运行目录下的 result.txt（交付物路径是任务协议的一部分，不是模型的自由度）。
# 对应 DSH 的 fs-sandbox / ctx.sandboxPolicy 零件。已知残留后门：run_python 可用
# python 代码绕过文件守卫——真沙箱需要进程级隔离（bash-sandbox 存在的理由）。
WORKSPACE = os.path.dirname(os.path.abspath(__file__))

def safe_path(path: str) -> str:
    """规范化并校验读路径：解析后必须仍在工作区内，否则 PermissionError。"""
    p = os.path.realpath(os.path.join(WORKSPACE, path))
    if p != WORKSPACE and not p.startswith(WORKSPACE + os.sep):
        raise PermissionError(f"路径越界，只允许访问工作区内文件: {path}")
    return p

def execute_tool(name: str, args: dict) -> str:
    """执行一个工具，返回给模型看的结果文本。"""
    try:
        if name == "read_file":
            return Path(safe_path(args["path"])).read_text(encoding="utf-8")
        if name == "write_file":
            # 权限边界：产物落点固定为运行目录下的 result.txt，模型不能选位置
            if os.path.basename(str(args["path"])) != "result.txt":
                return "PermissionError: write_file 仅允许写 result.txt"
            Path("result.txt").write_text(args["content"], encoding="utf-8")
            return "已写入 result.txt"
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

if __name__ == "__main__":
    client = OpenAI(api_key=os.environ["DEEPSEEK_API_KEY"],
                    base_url="https://api.deepseek.com")
    answer = run_agent("读 data.txt，统计出现最多的词，把结果写入 result.txt", client)
    print("最终答案:", answer)
