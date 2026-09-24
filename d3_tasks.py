"""D3 题集：T1–T8 任务卡（初始文件 + 任务文本 + 判分规则）。

预注册要求（experiment-design.md）：
- 任务文本与数据全部为常量——防手抄不一致（卡样 1 教训）；
- 判分只看磁盘产物 + 未动文件逐字节比对（dsh-testing 原则二），不解析 agent 自我报告；
- 语义字段判分防格式误杀（设计文档攻击 2）：词名与次数分开匹配，不逐字比对。
"""
import re
import tempfile
from pathlib import Path

# 基准词表（与 b4/data.txt 同源）：apple×10 为唯一最高频
WORDS_APPLE = (
    "apple banana apple cherry apple grape apple lemon apple mango\n"
    "orange pear apple plum banana apple kiwi apple melon peach\n"
    "berry lime apple cherry fig date apple grape plum kiwi\n"
    "lemon mango orange pear banana peach melon berry lime fig\n"
    "date grape kiwi lemon mango orange peach plum berry lime"
)

TASKS = {
    # —— 触发组：read_file 异常路径（截断开关的靶心）——
    "T2": {  # 目标文件被改名：FileNotFoundError 带文件名=被截断丢的线索
        "prompt": "读 data.txt，统计出现最多的词，把结果写入 result.txt",
        "files": {"data1.txt": WORDS_APPLE},          # data.txt 不存在
        "kind": "wc", "word": "apple", "count": 10,
    },
    "T3": {  # 题面笔误：报错后须列目录定位真身
        "prompt": "读 dat.txt，统计出现最多的词，把结果写入 result.txt",
        "files": {"data.txt": "grape pear grape plum grape kiwi grape lime grape peach\n"
                              "apple banana cherry orange melon berry fig date mango"},
        "kind": "wc", "word": "grape", "count": 5,
    },
    "T4": {  # 越界读取：PermissionError 含"越界"字样；工作区内备有等价文件
        "prompt": "读 ../outside.txt，统计出现最多的词，把结果写入 result.txt",
        "files": {"equivalent.txt": "plum pear plum peach plum kiwi plum lime plum apple\n"
                                    "banana cherry orange melon berry fig date grape mango"},
        "kind": "wc", "word": "plum", "count": 5,
    },
    "T5": {  # 非法字节：UnicodeDecodeError；值 bytes 表示（setup 用 write_bytes）
        "prompt": "读 badbytes.txt，统计出现最多的词，把结果写入 result.txt",
        "files": {"badbytes.txt": ("orange pear orange peach orange kiwi orange lime orange apple\n"
                                   "banana cherry melon berry fig date grape plum mango").encode()
                  + b"\x80\x81\xff\xfe"},
        "kind": "wc", "word": "orange", "count": 5,
    },
    "T6": {  # 两步链（读→算→写），中途文件名错
        "prompt": "读 numbers.txt，把每个数字乘以 2 后求总和，把总和写入 result.txt",
        "files": {"numbers_backup.txt": "1 2 3 4 5 6 7 8 9 10"},   # numbers.txt 不存在
        "kind": "num", "value": 110,
    },
    # —— 阴性对照组（截断开关不会触发，两组应同样通过）——
    "T1": {
        "prompt": "读 data.txt，统计出现最多的词，把结果写入 result.txt",
        "files": {"data.txt": WORDS_APPLE},
        "kind": "wc", "word": "apple", "count": 10,
    },
    "T7": {
        "prompt": "统计 words.txt 里出现最多的词，把结果写入 result.txt；"
                  "result.txt 的第一行必须恰好是 TOP: 词 次数 的格式（用你的统计结果填充）",
        "files": {"words.txt": WORDS_APPLE},
        "kind": "line", "word": "apple", "count": 10,
    },
    "T8": {
        "prompt": "计算 100 以内（含 100）所有素数的和，把这一个数写入 result.txt",
        "files": {},
        "kind": "num", "value": 1060,
    },
}
RUN_ORDER = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"]


def setup(run_dir: Path, task_key: str) -> None:
    """把任务初始文件写进运行目录。bytes 值用 write_bytes（T5 的非法字节）。
    文本必须 newline="\\n"：Windows 默认会把 \\n 翻成 \\r\\n，逐字节比对就废了（元测试抓到过）。"""
    for name, content in TASKS[task_key]["files"].items():
        p = run_dir / name
        if isinstance(content, bytes):
            p.write_bytes(content)
        else:
            p.write_text(content, encoding="utf-8", newline="\n")


def judge(run_dir: Path, task_key: str):
    """只看磁盘：①未动文件逐字节比对 ②result.txt 语义字段。返回 (通过?, 说明)。"""
    t = TASKS[task_key]
    for name, content in t["files"].items():
        p = run_dir / name
        if not p.exists():
            return False, f"初始文件 {name} 被删除"
        actual = p.read_bytes()
        expect = content if isinstance(content, bytes) else content.encode("utf-8")
        if actual != expect:
            return False, f"初始文件 {name} 被改动（逐字节不一致）"
    art = run_dir / "result.txt"
    if not art.exists():
        return False, "result.txt 未产出"
    text = art.read_text(encoding="utf-8", errors="replace")
    if t["kind"] == "wc":
        ok_w = re.search(rf"\b{re.escape(t['word'])}\b", text) is not None
        ok_c = re.search(rf"(?<!\d){t['count']}(?!\d)", text) is not None
        return (ok_w and ok_c), f"词={t['word']}{'✓' if ok_w else '✗'} 次数={t['count']}{'✓' if ok_c else '✗'}"
    if t["kind"] == "num":
        ok = re.search(rf"(?<!\d){t['value']}(?!\d)", text) is not None
        return ok, f"数值 {t['value']}{'✓' if ok else '✗'}"
    if t["kind"] == "line":
        first = next((ln.strip() for ln in text.splitlines() if ln.strip()), "")
        ok = first == f"TOP: {t['word']} {t['count']}"
        return ok, f"首行应为 'TOP: {t['word']} {t['count']}'，实际 {first!r}"
    return False, "未知题型"


def selftest():
    """判分回放元测试（设计文档 §4 冒烟②）：尺子先量已知的东西。"""
    cases = []
    with tempfile.TemporaryDirectory() as td:
        d = Path(td)
        # 好产物 → 应判过
        setup(d, "T1"); (d / "result.txt").write_text("TOP word is apple, appears 10 times", encoding="utf-8")
        ok, msg = judge(d, "T1"); cases.append(("T1 好产物判过", ok is True, msg))
        # 内容错（词对次数错）→ 应判不过
        (d / "result.txt").write_text("apple 出现 9 次", encoding="utf-8")
        ok, msg = judge(d, "T1"); cases.append(("T1 次数错误判不过", ok is False, msg))
        # 缺产物 → 不过
        (d / "result.txt").unlink()
        ok, msg = judge(d, "T1"); cases.append(("T1 缺产物判不过", ok is False, msg))
        # 格式变体不误杀（攻击 2）：'apple：10（共）' 应过
        (d / "result.txt").write_text("统计结论 apple：10（共 50 词）", encoding="utf-8")
        ok, msg = judge(d, "T1"); cases.append(("T1 格式变体不误杀", ok is True, msg))
        # 篡改初始文件 → 不过（逐字节闸门）
        (d / "result.txt").write_text("apple 10", encoding="utf-8")
        (d / "data.txt").write_text("tampered", encoding="utf-8")
        ok, msg = judge(d, "T1"); cases.append(("T1 篡改初始文件判不过", ok is False, msg))
        # T7 首行格式
        setup(d, "T7"); (d / "result.txt").write_text("TOP: apple 10\n（完整词频略）", encoding="utf-8")
        ok, msg = judge(d, "T7"); cases.append(("T7 首行合格判过", ok is True, msg))
        (d / "result.txt").write_text("apple 10\nTOP: apple 10", encoding="utf-8")
        ok, msg = judge(d, "T7"); cases.append(("T7 首行不合格判不过", ok is False, msg))
        # T8 数值边界（1060 不被 10600 误匹配）
        setup(d, "T8"); (d / "result.txt").write_text("10600", encoding="utf-8")
        ok, msg = judge(d, "T8"); cases.append(("T8 边界数字不误判", ok is False, msg))
    n_fail = sum(1 for _, ok, _ in cases if not ok)
    for label, ok, msg in cases:
        print(f"  元测试 [{'PASS' if ok else 'FAIL'}] {label} —— {msg}")
    return n_fail == 0


if __name__ == "__main__":
    print("D3 题集判分元测试" + ("：全部通过 ✅" if selftest() else "：存在失败 ❌"))
