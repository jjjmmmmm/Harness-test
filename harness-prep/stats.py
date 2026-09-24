import math
import random

def ci_two_props(x1: int, n1: int, x2: int, n2: int):
    """两组通过次数/总数 → (差值, 95%CI下限, 95%CI上限)，Wald 正态近似。"""
    p1, p2 = x1 / n1, x2 / n2
    diff = p1 - p2
    se = math.sqrt(p1 * (1 - p1) / n1 + p2 * (1 - p2) / n2)
    return diff, diff - 1.96 * se, diff + 1.96 * se

def ci_bootstrap(a_pass: list, b_pass: list, trials: int = 10000):
    """自助法：把两组各自重抽样一万次，看差异的分布。
    a_pass/b_pass 是 0/1 列表，如 [1,1,0,1,...]。
    它不依赖公式假设，用来交叉验证公式结果。"""
    diffs = []
    for _ in range(trials):
        ra = [random.choice(a_pass) for _ in range(len(a_pass))]
        rb = [random.choice(b_pass) for _ in range(len(b_pass))]
        diffs.append(sum(ra) / len(ra) - sum(rb) / len(rb))
    diffs.sort()
    lo = diffs[int(0.025 * trials)]
    hi = diffs[int(0.975 * trials)]
    return sum(diffs) / trials, lo, hi

if __name__ == "__main__":
    # 例题：A 配置 12/20 过，B 配置 9/20 过
    d, lo, hi = ci_two_props(12, 20, 9, 20)
    print(f"公式版: 差={d:+.1%}, 95% CI=[{lo:+.1%}, {hi:+.1%}]")
    print("含 0 吗:", "含，不能下结论" if lo < 0 < hi else "不含，差异大概率真实")

    a = [1] * 12 + [0] * 8
    b = [1] * 9 + [0] * 11
    d2, lo2, hi2 = ci_bootstrap(a, b)
    print(f"自助法: 差={d2:+.1%}, 95% CI=[{lo2:+.1%}, {hi2:+.1%}]")
