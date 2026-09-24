"""D3 对照实验 runner（预注册：experiment-design.md，commit 104a222）。

唯一变量：TRUNCATE_ERRORS（A=完整报错 / B=截断 Error: failed），运行时拨模块开关——两组代码零 diff。
模型固定 deepseek-chat temperature=0；每 run 全新临时目录（目录级隔离，防产物污染）；
token 经 client 包装记录（loop 零改动，两组同版）。

用法：
    python d3_tasks.py                # 先跑判分元测试（尺子自检）
    python d3_runner.py --smoke       # 冒烟：A/B 各 T1×2（不计入正式 128 次）
    python d3_runner.py               # 正式：2 配置 × 8 题 × 8 次 = 128 次
复现：同样命令重跑即可；任务文本/数据/判分规则均为 d3_tasks.py 常量。

产物（编号保存，供逐条复核）：
    d3-results/results.jsonl                                   每 run 一行
    d3-results/runs/run-NNN__A__T1__r1/trace.log               步骤轨迹+最终答复
    d3-results/runs/run-NNN__A__T1__r1/result.txt               该 run 真实产物（留档）
    d3-results/runs/run-NNN__A__T1__r1/judge.txt                判分结论
    d3-results/runs/run-NNN__A__T1__r1/<初始文件>               未动文件可逐字节复核
"""
import argparse
import contextlib
import importlib.util
import io
import json
import os
import re
import shutil
import tempfile
import time
import types
from pathlib import Path

from openai import OpenAI

import d3_tasks

HERE = Path(__file__).resolve().parent
OUT = HERE / "d3-results"
RUNS = OUT / "runs"

_spec = importlib.util.spec_from_file_location("mini_agent_loop", HERE / "mini-agent-loop.py")
m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m)

GROUPS = {"A": False, "B": True}      # 组名 → TRUNCATE_ERRORS
MAX_STEPS = 10                         # 与 b4 一致，harness 固定量

# 模型轴（预注册修订 2，2026-09-24 数据未跑前锁定）：deepseek-chat/reasoner 别名
# 实测均路由 deepseek-flash，故用显式 id；step 臂 key 走 STEP_API_KEY 环境变量。
MODELS = {
    "DS": {"id": "deepseek-flash", "key_env": "MODELING_AGENT_API_KEY", "base": "https://api.deepseek.com"},
    "ST": {"id": "step-3.7-flash", "key_env": "STEP_API_KEY", "base": "https://api.stepfun.com/v1"},
}


class UsageClient:
    """透明包装：累计 usage.total_tokens。loop 代码零改动（预注册补充 2026-09-24）。"""

    def __init__(self, inner):
        self._inner = inner
        self.total_tokens = 0
        self.chat = types.SimpleNamespace(
            completions=types.SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        resp = self._inner.chat.completions.create(**kwargs)
        u = getattr(resp, "usage", None)
        if u is not None and getattr(u, "total_tokens", None):
            self.total_tokens += u.total_tokens
        return resp


def run_one(client, model_tag, group, task_key, repeat, seq=None):
    """跑一次并留档。返回记录 dict（含判分）。"""
    task = d3_tasks.TASKS[task_key]
    tmp = Path(tempfile.mkdtemp(prefix=f"d3-{group}-{task_key}-r{repeat}-"))
    saved_ws, saved_cwd = m.WORKSPACE, os.getcwd()
    buf, final, err = io.StringIO(), "", None
    t0 = time.time()
    try:
        d3_tasks.setup(tmp, task_key)
        m.TRUNCATE_ERRORS = GROUPS[group]
        m.KEEP_LAST_N, m.DISABLED_TOOLS = None, []
        m.WORKSPACE = str(tmp)          # read_file 的 safe_path 锚定到本 run 目录
        os.chdir(tmp)                   # run_python 子进程与 result.txt 落点同步锚定
        with contextlib.redirect_stdout(buf):
            final = m.run_agent(task["prompt"], client, max_steps=MAX_STEPS)
    except Exception as e:              # API 级异常≠任务失败：记录并在最终 jsonl 标注
        err = f"{type(e).__name__}: {e}"
    finally:
        m.TRUNCATE_ERRORS, m.KEEP_LAST_N, m.DISABLED_TOOLS = False, None, []
        m.WORKSPACE = saved_ws
        os.chdir(saved_cwd)

    elapsed = round(time.time() - t0, 1)
    steps = [int(n) for n in re.findall(r"\[step (\d+)\]", buf.getvalue())]
    n_steps = (max(steps) + 1) if steps else 0
    art = tmp / "result.txt"
    art_text = art.read_text(encoding="utf-8", errors="replace") if art.exists() else None
    passed, judge_msg = d3_tasks.judge(tmp, task_key)

    rec = {
        "seq": seq, "model": MODELS[model_tag]["id"], "mtag": model_tag,
        "group": group, "task": task_key, "repeat": repeat,
        "passed": bool(passed and err is None), "api_error": err,
        "n_steps": n_steps, "elapsed_s": elapsed,
        "tokens": client.total_tokens, "artifact": art_text,
        "final": (final or "")[:200],
        "judge": judge_msg,
    }

    if seq is not None:                 # 正式 run 才编号留档；冒烟写 smoke 区
        rd = RUNS / f"run-{seq:03d}__{model_tag}__{group}__{task_key}__r{repeat}"
        if rd.exists():
            shutil.rmtree(rd)
        shutil.copytree(tmp, rd)
        (rd / "trace.log").write_text(
            f"# run-{seq:03d} {model_tag}/{MODELS[model_tag]['id']} × {group}"
            f"({'TRUNCATE' if GROUPS[group] else 'FULL'}) × {task_key} × r{repeat}\n"
            f"步数 {n_steps}｜用时 {elapsed}s｜tokens {rec['tokens']}｜判分 {'通过' if passed else '不过'}（{judge_msg}）"
            + (f"｜API异常 {err}" if err else "") + "\n── 步骤轨迹 ──\n" + buf.getvalue()
            + "\n── 最终答复 ──\n" + (final or ""), encoding="utf-8")
    shutil.rmtree(tmp, ignore_errors=True)
    return rec


def save_jsonl(rows):
    OUT.mkdir(exist_ok=True)
    (OUT / "results.jsonl").write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true", help="每模型×每组×T1×1，不编号不入库")
    args = ap.parse_args()

    missing = [m["key_env"] for m in MODELS.values() if m["key_env"] not in os.environ]
    if missing:
        raise SystemExit(f"缺少环境变量：{missing}（STEP_API_KEY 若刚加，从注册表注入或重开终端）。")
    if not d3_tasks.selftest():
        raise SystemExit("判分元测试未全过——先修尺子再跑实验（dsh-testing 纪律）。")

    inners = {tag: OpenAI(api_key=os.environ[m["key_env"]], base_url=m["base"])
              for tag, m in MODELS.items()}
    rows = []
    plan = ([(tag, g, "T1", 1) for tag in MODELS for g in GROUPS] if args.smoke
            else [(tag, g, t, r) for tag in MODELS for g in GROUPS
                  for t in d3_tasks.RUN_ORDER for r in range(1, 5)])  # 2模型×2组×8题×4=128
    if args.smoke:
        OUT.mkdir(exist_ok=True)
    for i, (tag, g, t, r) in enumerate(plan, 1):
        client = UsageClient(inners[tag])   # 每 run 独立计数
        seq = None if args.smoke else i
        rec = run_one(client, tag, g, t, r, seq)
        rows.append(rec)
        if not args.smoke:
            save_jsonl(rows)                # 每跑完一条就落盘，中断可查
        mark = "通过" if rec["passed"] else "不过"
        print(f"[{'SMOKE' if args.smoke else f'run-{i:03d}'}] {tag}×{g}×{t}×r{r} "
              f"{mark} 步数={rec['n_steps']} tokens={rec['tokens']} 用时={rec['elapsed_s']}s"
              + (f" API_ERROR={rec['api_error']}" if rec["api_error"] else ""))
    if args.smoke:
        (OUT / "smoke.jsonl").write_text(
            "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")
        print(f"冒烟完成 {len(rows)} 次 → d3-results/smoke.jsonl；确认判分正确后跑全量。")
    else:
        print(f"全量完成 {len(rows)} 次 → d3-results/results.jsonl + runs/run-001…")


if __name__ == "__main__":
    main()
