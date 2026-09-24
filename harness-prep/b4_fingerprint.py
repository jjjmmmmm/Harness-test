"""B4 失败指纹初体验（D2 Block 4）：同一套 mini loop（harness 固定），3 个弄坏配置 × 2 个模型。

问题：同一配置造成的失败/卡住形态，换模型后是否复现？（命门第一句的手感版：
指纹跨模型复现 → 锅不在模型。）

用法（key 只放当前终端环境变量，绝不写进文件/聊天记录）：
    Git Bash:    export DEEPSEEK_API_KEY=sk-xxxx && python b4_fingerprint.py
    PowerShell:  $env:DEEPSEEK_API_KEY="sk-xxxx"; python b4_fingerprint.py

产物：
    failures/b4/<config>__<model>.log   每 run 一份完整步骤轨迹 + 最终答复 + 产物核对
    failures/b4/summary.md              机械列自动填好的对比表底稿（指纹判读留白待手填）

成本：8 次运行 × ≤10 步小上下文，合计远低于 ¥1。
"""
import contextlib
import importlib.util
import io
import os
import re
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUTDIR = HERE / "failures" / "b4"

# 复用同一份 loop（文件名带连字符不能直接 import，用 importlib 加载）
_spec = importlib.util.spec_from_file_location("mini_agent_loop", HERE / "mini-agent-loop.py")
m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m)

TASK = "读 data.txt，统计出现最多的词，把结果写入 result.txt"
MODELS = ["deepseek-chat", "deepseek-reasoner"]

# 配置名 → (TRUNCATE_ERRORS, KEEP_LAST_N, DISABLED_TOOLS)
CONFIGS = {
    "baseline":  (False, None, []),                 # 不弄坏：两模型各自的健康基线
    "truncate":  (True,  None, []),                 # 开关1：报错截断
    "keep1":     (False, 1,    []),                 # 开关2：历史砍到只剩 1 条
    "no_write":  (False, None, ["write_file"]),     # 开关3：撤掉 write_file
}


def run_one(client, config, model):
    """跑一次：重置开关 → 清掉上次产物 → 跑 → 核对磁盘产物。返回记录 dict。"""
    m.TRUNCATE_ERRORS, m.KEEP_LAST_N, m.DISABLED_TOOLS = CONFIGS[config]
    artifact = HERE / "result.txt"
    if artifact.exists():
        artifact.unlink()                           # 上次的 result.txt 不能污染本次"落盘没"判定

    buf = io.StringIO()
    t0 = time.time()
    error = None
    with contextlib.redirect_stdout(buf):
        try:
            final = m.run_agent(TASK, client, model=model)
        except Exception as e:                      # API 报错≠任务失败，单列
            final, error = "", f"{type(e).__name__}: {e}"
    elapsed = time.time() - t0

    steps = [int(n) for n in re.findall(r"\[step (\d+)\]", buf.getvalue())]
    art = artifact.read_text(encoding="utf-8") if artifact.exists() else None

    rec = {
        "config": config, "model": model,
        "n_steps": (max(steps) + 1) if steps else 0,
        "artifact": art, "final": final, "error": error,
        "elapsed": round(elapsed, 1), "trace": buf.getvalue(),
    }
    # 重置开关，防止污染下一个 run
    m.TRUNCATE_ERRORS, m.KEEP_LAST_N, m.DISABLED_TOOLS = CONFIGS["baseline"]
    return rec


def write_outputs(recs):
    OUTDIR.mkdir(parents=True, exist_ok=True)
    for r in recs:
        lines = [
            f"# B4 run：{r['config']} × {r['model']}",
            f"用时 {r['elapsed']}s｜工具步数 {r['n_steps']}｜落盘 {'是' if r['artifact'] is not None else '否'}"
            f"{'｜API异常 ' + r['error'] if r['error'] else ''}",
            f"result.txt 内容：{r['artifact']!r}" if r['artifact'] is not None else "result.txt：不存在",
            f"最终答复：{r['final']}",
            "── 步骤轨迹 ──", r["trace"],
        ]
        (OUTDIR / f"{r['config']}__{r['model']}.log").write_text("\n".join(lines), encoding="utf-8")

    rows = ["| 配置 | 模型 | 步数 | 落盘 | 用时s | 最终答复摘要 |",
            "|---|---|---|---|---|---|"]
    for r in recs:
        note = (r["error"] or r["final"]).replace("\n", " ")[:60]
        rows.append(f"| {r['config']} | {r['model'].removeprefix('deepseek-')} | {r['n_steps']} "
                    f"| {'是' if r['artifact'] is not None else '否'} | {r['elapsed']} | {note} |")
    hand = """

## 指纹判读（手填，对照各 .log）

同一配置换模型后逐项对比——
1. truncate：chat 版靠 run_python 旁路补线索；reasoner 版也旁路吗？步数/路径像不像？
2. keep1：chat 版口头汇报不落盘（假完成）；reasoner 版也丢任务指令吗？丢成什么形态？
3. no_write：chat 版原样重试后诚实认输；reasoner 版是重试、绕路还是伪造成功？

结论行（每配置一句）：指纹复现/不复现 → 初判锅在 harness/模型/分不清（都只标"仅观察"，单次运行）。
"""
    (OUTDIR / "summary.md").write_text(
        "# B4 失败指纹对比（3 配置 × 2 模型，2026-09-23 自动底稿）\n\n"
        + "\n".join(rows) + "\n" + hand, encoding="utf-8")
    print(f"\n共 {len(recs)} 次 run 完成；日志与对比表在 failures/b4/")


def main():
    if "DEEPSEEK_API_KEY" not in os.environ:
        raise SystemExit("先在当前终端设置 DEEPSEEK_API_KEY（不要写进文件）再运行。")
    if not (HERE / "data.txt").exists():
        raise SystemExit("data.txt 不在工作目录，先确认再跑。")

    from openai import OpenAI
    client = OpenAI(api_key=os.environ["DEEPSEEK_API_KEY"],
                    base_url="https://api.deepseek.com")

    recs = []
    for config in CONFIGS:              # 配置为外层、模型为内层，方便同配置两模型挨着比
        for model in MODELS:
            rec = run_one(client, config, model)
            recs.append(rec)
            print(f"[{config} × {model}] 步数={rec['n_steps']} 落盘={'是' if rec['artifact'] is not None else '否'}"
                  f" 用时={rec['elapsed']}s{' ERROR: ' + rec['error'] if rec['error'] else ''}")
    write_outputs(recs)


if __name__ == "__main__":
    main()
