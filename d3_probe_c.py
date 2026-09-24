"""B4 归因复测 · 去锚探针（配置 C，独立于主实验的追加验证）。

假设（源自复核 run-085 vs run-117）：ST 在完整报错下 T6 失败是"认输锚定"——
报错文本里的文件名让它一步认输；截断组通过是因为无信息逼它探索。
配置 C：报错保留错误类型、抹去诊断细节（文件名/路径/越界字样）。
预测（若机制为真）：C 下 ST·T6 趋近 B 组（探索→通过）而非 A 组（认输）。
跑法：importlib 加载与主实验同一份 loop，仅运行时包装 execute_tool——A/B 主数据不动。
产物：d3-results/probe-c/<模型>_T6_r<k>.log + probe-c.jsonl
"""
import contextlib
import importlib.util
import io
import json
import os
import re
import shutil
import tempfile
import time
from pathlib import Path

from openai import OpenAI

import d3_tasks
from d3_runner import MODELS, UsageClient

HERE = Path(__file__).resolve().parent
OUT = HERE / "d3-results" / "probe-c"

_spec = importlib.util.spec_from_file_location("mini_agent_loop_c", HERE / "mini-agent-loop.py")
m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m)

ERR_TYPES = ("FileNotFoundError", "PermissionError", "UnicodeDecodeError", "OSError")
_orig = m.execute_tool


def execute_tool_C(name, args):
    """包装：A 型完整报错 → 只留类型、抹掉线索。其余输出原样（含 run_python 旁路）。"""
    out = _orig(name, args)
    for t in ERR_TYPES:
        if out.startswith(t + ":"):
            return t + ": 出错了（无详情）"
    return out


def run_probe(client, model_tag, repeat):
    task_key = "T6"
    tmp = Path(tempfile.mkdtemp(prefix=f"probeC-{model_tag}-r{repeat}-"))
    saved_ws, saved_cwd, saved_tool = m.WORKSPACE, os.getcwd(), m.execute_tool
    buf, final, err = io.StringIO(), "", None
    t0 = time.time()
    try:
        d3_tasks.setup(tmp, task_key)
        m.TRUNCATE_ERRORS, m.KEEP_LAST_N, m.DISABLED_TOOLS = False, None, []
        m.WORKSPACE = str(tmp)
        m.execute_tool = execute_tool_C          # ← 配置 C 的唯一改动
        os.chdir(tmp)
        with contextlib.redirect_stdout(buf):
            final = m.run_agent(task["prompt"] if (task := d3_tasks.TASKS[task_key]) else "",
                                client, model=MODELS[model_tag]["id"])
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
    finally:
        m.execute_tool = saved_tool
        m.TRUNCATE_ERRORS, m.KEEP_LAST_N, m.DISABLED_TOOLS = False, None, []
        m.WORKSPACE = saved_ws
        os.chdir(saved_cwd)

    steps = [int(n) for n in re.findall(r"\[step (\d+)\]", buf.getvalue())]
    art = tmp / "result.txt"
    art_text = art.read_text(encoding="utf-8", errors="replace") if art.exists() else None
    passed, judge_msg = d3_tasks.judge(tmp, task_key)
    rec = {"config": "C", "model": model_tag, "task": task_key, "repeat": repeat,
           "passed": bool(passed and err is None), "api_error": err,
           "n_steps": (max(steps) + 1) if steps else 0,
           "tokens": client.total_tokens, "elapsed_s": round(time.time() - t0, 1),
           "final": (final or "")[:200], "judge": judge_msg}
    OUT.mkdir(parents=True, exist_ok=True)
    rd = OUT / f"{model_tag}_T6_r{repeat}"
    if rd.exists():
        shutil.rmtree(rd)
    shutil.copytree(tmp, rd)
    (rd / "trace.log").write_text(
        f"# 探针 C（报错留类型抹线索）{model_tag} × T6 × r{repeat}\n"
        f"步数 {rec['n_steps']}｜tokens {rec['tokens']}｜判分 {'通过' if passed else '不过'}（{judge_msg}）\n"
        + buf.getvalue() + "\n── 最终答复 ──\n" + (final or ""), encoding="utf-8")
    shutil.rmtree(tmp, ignore_errors=True)
    return rec


def main():
    missing = [mm["key_env"] for mm in MODELS.values() if mm["key_env"] not in os.environ]
    if missing:
        raise SystemExit(f"缺少环境变量：{missing}")
    inners = {tag: OpenAI(api_key=os.environ[mm["key_env"]], base_url=mm["base"])
              for tag, mm in MODELS.items()}
    rows = []
    for tag in MODELS:
        for r in range(1, 5):
            rec = run_probe(UsageClient(inners[tag]), tag, r)
            rows.append(rec)
            print(f"[C×{tag}×T6×r{r}] {'通过' if rec['passed'] else '不过'} "
                  f"步数={rec['n_steps']} tokens={rec['tokens']} 用时={rec['elapsed_s']}s")
            (OUT / "probe-c.jsonl").write_text(
                "\n".join(json.dumps(x, ensure_ascii=False) for x in rows) + "\n", encoding="utf-8")
    for tag in MODELS:
        p = sum(1 for x in rows if x["model"] == tag and x["passed"])
        print(f"汇总: C·{tag}·T6 = {p}/4（对照：A 组 {('0' if tag == 'ST' else '1')}/4，B 组 {'4' if tag == 'ST' else '1'}/4）")


if __name__ == "__main__":
    main()
