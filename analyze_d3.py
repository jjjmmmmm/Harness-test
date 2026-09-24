"""D3 Block 1+2：出结果 + 归因初判（机械部分全自动，证据等级留人复核）。

读 d3-results/results.jsonl，产出 d3-results/sum.md：
  ① 总表：通过率/差值/95%CI（公式+自助双算，复用 stats.py）
  ② 每题明细；③ 步数/用时/token 对比；④ 失败形态自动分类（规则标签，待人工复核）
  ⑤ 预注册处置句自动套用（CI 含 0 → "未发现可区分的证据"）
用法：python analyze_d3.py [--src d3-results/results.jsonl]
"""
import argparse
import json
from pathlib import Path

import stats

HERE = Path(__file__).resolve().parent


def load(src: Path):
    rows = [json.loads(ln) for ln in src.read_text(encoding="utf-8").splitlines() if ln.strip()]
    return rows


def classify(rec):
    """失败形态规则标签（HB 分类的自动子集；不确定的标'待人工'）。"""
    if rec["passed"]:
        return "通过"
    if rec["api_error"]:
        return "API异常(重跑)"
    final = rec["final"] or ""
    if rec["n_steps"] >= 10:
        return "MAX-TURNS(打满步数)"
    if rec["artifact"] is None:
        if any(w in final for w in ("已完成", "完成。", "已写入", "已将", "写入 result")):
            return "假完成(Artifact)"
        if any(w in final for w in ("无法", "失败", "不可用", "不能", "未能")):
            return "认输(REASON)"
        return "未落盘-待人工"
    return "产物错误(Evidence)"


def mean(xs):
    return sum(xs) / len(xs) if xs else 0.0


def fmt_ci(lo, hi):
    return f"[{lo * 100:+.1f}pp, {hi * 100:+.1f}pp]"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(HERE / "d3-results" / "results.jsonl"))
    args = ap.parse_args()
    rows = load(Path(args.src))
    assert rows and rows[0]["seq"] is not None, "先跑正式全量（--smoke 不计入分析）"

    a = [r for r in rows if r["group"] == "A"]
    b = [r for r in rows if r["group"] == "B"]
    xa = sum(1 for r in a if r["passed"]); xb = sum(1 for r in b if r["passed"])
    diff, lo_w, hi_w = stats.ci_two_props(xa, len(a), xb, len(b))
    a_pass = [int(r["passed"]) for r in a]
    b_pass = [int(r["passed"]) for r in b]
    _, lo_b, hi_b = stats.ci_bootstrap(a_pass, b_pass)
    contains0 = (lo_w < 0 < hi_w) and (lo_b < 0 < hi_b)

    # 每题明细与失败标签
    per_task, tag_counts = [], {"A": {}, "B": {}}
    fails_b = []
    order = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"]
    tasks = sorted({r["task"] for r in rows}, key=order.index)
    for t in tasks:
        ta = [r for r in a if r["task"] == t]
        tb = [r for r in b if r["task"] == t]
        for r in ta + tb:
            tag = classify(r)
            tag_counts[r["group"]][tag] = tag_counts[r["group"]].get(tag, 0) + 1
            if r["group"] == "B" and not r["passed"]:
                fails_b.append((r["seq"], t, r["repeat"], tag, r["final"][:80]))
        per_task.append(
            f"| {t} | {sum(1 for r in ta if r['passed'])}/{len(ta)} | {sum(1 for r in tb if r['passed'])}/{len(tb)} "
            f"| {mean([r['n_steps'] for r in ta]):.1f} | {mean([r['n_steps'] for r in tb]):.1f} "
            f"| {mean([r['tokens'] for r in ta]):.0f} | {mean([r['tokens'] for r in tb]):.0f} |")

    sa = f"{xa}/{len(a)}（{xa / len(a):.1%}）"; sb = f"{xb}/{len(b)}（{xb / len(b):.1%}）"
    verdict = (
        f"**CI 含 0（公式 {fmt_ci(lo_w, hi_w)}；自助 {fmt_ci(lo_b, hi_b)}）→ 按预注册：未发现可区分的证据。**\n"
        "不下「截断无害」也不下「截断有害」的结论；下一步建议每配置样本增至 N=200。"
        if contains0 else
        f"**CI 不含 0（公式 {fmt_ci(lo_w, hi_w)}；自助 {fmt_ci(lo_b, hi_b)}）→ 差异大概率真实。**")

    tags = sorted(set(tag_counts["A"]) | set(tag_counts["B"]))
    tag_table = "\n".join(f"| {t} | {tag_counts['A'].get(t, 0)} | {tag_counts['B'].get(t, 0)} |" for t in tags)
    fail_lines = "\n".join(f"- run-{s:03d} {t}×r{r}【{tag}】{f}" for s, t, r, tag, f in fails_b) or "（B 组无失败）"

    sum_md = f"""# D3 实验结果与归因初判（sum.md · 自动生成，证据等级待人工复核）

数据：{len(rows)} 次（A=完整报错 {len(a)}，B=截断 {len(b)}）｜模型 deepseek-chat t=0｜
唯一变量 TRUNCATE_ERRORS（两组代码零 diff）｜预注册：experiment-design.md

## ① 总表（主指标）

| 指标 | A 组(完整) | B 组(截断) | 差值 | 95% CI |
|---|---|---|---|---|
| 通过率 | {sa} | {sb} | {diff * 100:+.1f}pp | 公式 {fmt_ci(lo_w, hi_w)}｜自助 {fmt_ci(lo_b, hi_b)} |

{verdict}

## ② 每题明细（通过/总数、平均步数、平均 token）

| 题 | A 通过 | B 通过 | A 步数 | B 步数 | A tok | B tok |
|---|---|---|---|---|---|---|
{chr(10).join(per_task)}

## ③ 成本对比（辅指标：分数分不清时看代价——Scaffold Effect 逻辑）

| 指标 | A | B |
|---|---|---|
| 平均步数 | {mean([r['n_steps'] for r in a]):.2f} | {mean([r['n_steps'] for r in b]):.2f} |
| 平均用时s | {mean([r['elapsed_s'] for r in a]):.1f} | {mean([r['elapsed_s'] for r in b]):.1f} |
| 平均token | {mean([r['tokens'] for r in a]):.0f} | {mean([r['tokens'] for r in b]):.0f} |

## ④ 失败形态自动分类（规则标签，需人工复核后才进报告）

| 形态 | A 次数 | B 次数 |
|---|---|---|
{tag_table}

B 组失败样（run 编号可回看 runs/run-NNN…/trace.log）：
{fail_lines}

## ⑤ 归因初判草稿（AI 起草，证据等级由人定）

- 失败是否按预期在组间分化：见 ②④——预期触发题（T2–T6）分化、阴性对照（T1/T7/T8）不分化即为方向性支持。
- 预注册处置已自动套用（见 ① verdict）。
- 证据等级建议：全部从"仅观察"起步；只有"CI 不含 0 + 复测闭环（Block 4）"才升"较强"。
- 局限（写进报告）：N=64/组 CI 宽；单模型；题集为合成触发题不代表真实工作流；run_python 旁路可能吸收截断效应（b4 已证，见设计文档攻击 1）。
"""
    out = HERE / "d3-results" / "sum.md"
    out.write_text(sum_md, encoding="utf-8")
    print(f"已写 {out}")
    print(f"A {sa} vs B {sb}，diff {diff * 100:+.1f}pp，公式 CI {fmt_ci(lo_w, hi_w)}，自助 CI {fmt_ci(lo_b, hi_b)}")


if __name__ == "__main__":
    main()
