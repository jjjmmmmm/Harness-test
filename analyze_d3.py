"""D3 Block 1+2：出结果 + 归因初判（机械部分全自动，证据等级留人复核）。v2：双模型轴。

网格：2 模型（deepseek-flash / step-3.7-flash）× 2 配置（A=完整报错 / B=截断）× 8 题 × 4 次 = 128。
主指标：截断效应（合并两模型，A 64 vs B 64）；
次级：每模型内 A vs B（32/32）；模型轴对比 = 失败指纹是否跨模型复现（命门第一句判定法）。
用法：python analyze_d3.py [--src d3-results/results.jsonl]
"""
import argparse
import json
from pathlib import Path

import stats

HERE = Path(__file__).resolve().parent
ORDER = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"]


def load(src: Path):
    return [json.loads(ln) for ln in src.read_text(encoding="utf-8").splitlines() if ln.strip()]


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


def ci_line(x1, n1, x2, n2):
    """公式 + 自助双算一行；返回 (文本, 是否含0)。"""
    diff, lo_w, hi_w = stats.ci_two_props(x1, n1, x2, n2)
    a_pass = [1] * x1 + [0] * (n1 - x1)
    b_pass = [1] * x2 + [0] * (n2 - x2)
    _, lo_b, hi_b = stats.ci_bootstrap(a_pass, b_pass)
    contains0 = (lo_w < 0 < hi_w) and (lo_b < 0 < hi_b)
    txt = f"diff {diff * 100:+.1f}pp｜公式 {fmt_ci(lo_w, hi_w)}｜自助 {fmt_ci(lo_b, hi_b)}"
    return txt, contains0, diff


def verdict_of(contains0):
    if contains0:
        return ("**CI 含 0 → 按预注册：未发现可区分的证据。**"
                "不下「截断无害」也不下「截断有害」的结论；下一步建议加样本（每配置 N=200）。")
    return "**CI 不含 0 → 差异大概率真实（附区间）。**"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(HERE / "d3-results" / "results.jsonl"))
    args = ap.parse_args()
    rows = load(Path(args.src))
    assert rows and rows[0].get("seq") is not None, "先跑正式全量（--smoke 不计入分析）"

    A = [r for r in rows if r["group"] == "A"]
    B = [r for r in rows if r["group"] == "B"]
    xa, xb = sum(1 for r in A if r["passed"]), sum(1 for r in B if r["passed"])
    primary, contains0, diff = ci_line(xa, len(A), xb, len(B))

    # 每模型 × 组的次级 CI
    per_model = []
    for tag in ("DS", "ST"):
        ma = [r for r in A if r["mtag"] == tag]
        mb = [r for r in B if r["mtag"] == tag]
        xa_m, xb_m = sum(1 for r in ma if r["passed"]), sum(1 for r in mb if r["passed"])
        txt, c0, _ = ci_line(xa_m, len(ma), xb_m, len(mb))
        per_model.append((tag, xa_m, len(ma), xb_m, len(mb), txt, c0))

    # 每(模型×题)明细 + 失败标签分布
    detail, tag_cells, fails = [], {}, []
    for tag in ("DS", "ST"):
        for t in ORDER:
            ta = [r for r in A if r["mtag"] == tag and r["task"] == t]
            tb = [r for r in B if r["mtag"] == tag and r["task"] == t]
            detail.append(
                f"| {tag} | {t} | {sum(1 for r in ta if r['passed'])}/{len(ta)} "
                f"| {sum(1 for r in tb if r['passed'])}/{len(tb)} "
                f"| {mean([r['n_steps'] for r in ta]):.1f} | {mean([r['n_steps'] for r in tb]):.1f} "
                f"| {mean([r['tokens'] for r in ta]):.0f} | {mean([r['tokens'] for r in tb]):.0f} |")
            for r in ta + tb:
                lab = classify(r)
                key = (tag, r["group"])
                tag_cells[key] = tag_cells.get(key, {})
                tag_cells[key][lab] = tag_cells[key].get(lab, 0) + 1
                if not r["passed"]:
                    fails.append((r["seq"], tag, r["group"], r["task"], r["repeat"], lab, r["final"][:70]))

    tags_all = sorted({l for cell in tag_cells.values() for l in cell})
    tag_rows = "\n".join(
        f"| {l} | {tag_cells.get(('DS', 'A'), {}).get(l, 0)} | {tag_cells.get(('DS', 'B'), {}).get(l, 0)} "
        f"| {tag_cells.get(('ST', 'A'), {}).get(l, 0)} | {tag_cells.get(('ST', 'B'), {}).get(l, 0)} |"
        for l in tags_all)
    fail_lines = "\n".join(
        f"- run-{s:03d} {tag}·{g} {t}×r{r}【{lab}】{f}" for s, tag, g, t, r, lab, f in fails) or "（无失败）"

    model_rows = "\n".join(
        f"| {tag} | {xa_m}/{na}（{xa_m / na:.0%}） | {xb_m}/{nb}（{xb_m / nb:.0%}） | {txt} |"
        f" {'含 0 → 证据不够' if c0 else '不含 0'} |"
        for tag, xa_m, na, xb_m, nb, txt, c0 in per_model)

    sum_md = f"""# D3 实验结果与归因初判（sum.md v2 · 自动生成，证据等级待人工复核）

网格：2 模型（DS=deepseek-flash，ST=step-3.7-flash）× 2 配置（A=完整报错，B=截断）× 8 题 × 4 次 = {len(rows)} 次
固定：temperature=0、任务文本常量、每 run 全新目录、判分只看磁盘（语义字段 + 未动文件逐字节）
预注册：experiment-design.md（含 2026-09-24 修订 2：模型轴）

## ① 主指标：截断效应（合并两模型，A {len(A)} vs B {len(B)}）

| 对比 | A(完整) | B(截断) | 95% CI 双算 | 判读 |
|---|---|---|---|---|
| 合并 | {xa}/{len(A)}（{xa / len(A):.1%}） | {xb}/{len(B)}（{xb / len(B):.1%}） | {primary} | {'含 0' if contains0 else '不含 0'} |

{verdict_of(contains0)}

## ② 次级：每模型内的截断效应（各 32 vs 32）

| 模型 | A 通过 | B 通过 | 95% CI 双算 | 判读 |
|---|---|---|---|---|
{model_rows}

## ③ 每（模型 × 题）明细（通过/总数、平均步数、平均 token）

| 模型 | 题 | A 通过 | B 通过 | A 步数 | B 步数 | A tok | B tok |
|---|---|---|---|---|---|---|---|
{chr(10).join(detail)}

## ④ 成本对比（辅指标：分数分不清时看代价——Scaffold Effect 逻辑）

| 指标 | DS-A | DS-B | ST-A | ST-B |
|---|---|---|---|---|
| 平均步数 | {mean([r['n_steps'] for r in A if r['mtag'] == 'DS']):.2f} | {mean([r['n_steps'] for r in B if r['mtag'] == 'DS']):.2f} | {mean([r['n_steps'] for r in A if r['mtag'] == 'ST']):.2f} | {mean([r['n_steps'] for r in B if r['mtag'] == 'ST']):.2f} |
| 平均token | {mean([r['tokens'] for r in A if r['mtag'] == 'DS']):.0f} | {mean([r['tokens'] for r in B if r['mtag'] == 'DS']):.0f} | {mean([r['tokens'] for r in A if r['mtag'] == 'ST']):.0f} | {mean([r['tokens'] for r in B if r['mtag'] == 'ST']):.0f} |

## ⑤ 失败形态自动分类（规则标签，需人工复核后才进报告；跨模型相似性 = 指纹判定原料）

| 形态 | DS-A | DS-B | ST-A | ST-B |
|---|---|---|---|---|
{tag_rows}

全部失败样（run 编号可回看 runs/run-NNN…/trace.log）：
{fail_lines}

## ⑥ 归因初判草稿（AI 起草，证据等级由人定）

- **命门第一句（指纹判定）**：对照⑤——同一配置下 DS 与 ST 的失败形态是否相似？相似 → 失败是脚手架属性（锅偏 harness）；不同 → 模型敏感（锅偏模型）。此判定必须人工看 trace 后签收。
- **命门第二句（零件归因）**：触发题（T2–T6）A/B 分化而阴性对照（T1/T7/T8）不分化，才支持"截断这个零件"的归因；全分化或全不分化都要另找解释。
- **命门第三句（证据硬度）**：预注册处置已自动套用（见①②）；全部结论从「仅观察」起步，只有 CI 不含 0 + Block 4 复测闭环才升「较强」。
- 局限（写进报告）：每格 n=32、合并 n=64 仍属小样本；两模型各一个、Flash 档；题集为合成触发题；run_python 旁路可能吸收截断效应（b4 已证）；ST 臂若为思考型模型，其思考预算不在我们的计量内。
"""
    out = HERE / "d3-results" / "sum.md"
    out.write_text(sum_md, encoding="utf-8")
    print(f"已写 {out}")
    print(f"主指标 A {xa}/{len(A)} vs B {xb}/{len(B)}：{primary} → {'含 0' if contains0 else '不含 0'}")


if __name__ == "__main__":
    main()
