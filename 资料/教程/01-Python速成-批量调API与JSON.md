# 教程 01 · Python 速成：批量调 API 与 JSON（D1 Block 2 配套）

> 前提：你已会变量/字符串/列表/操作列表/if/字典/输入与循环（你周计划的 W1–W2）。
> 本教程教你 W3 要学的四样新东西——**函数、文件读写、JSON、异常**——外加"调 API"，全部围绕一个目标：写出 `batch_api.py`，批量调用 DeepSeek 并把结果存成 JSONL。
> 学习纪律：代码手敲，AI 只负责讲概念/审代码。每节末尾有"手敲检查点"。

---

## 1. 函数：给一段代码起名字

**为什么需要**：批量调 API 时，"调一次模型"这件事要重复用 N 次。每次都复制粘贴 10 行代码，改起来就是灾难。函数 = 把这段代码打包起名，以后喊名字就行。

```python
def greet(name, punctuation="！"):     # def 定义函数；name 是参数；punctuation 有默认值
    """向某人问好（这种三引号说明叫 docstring，写这个函数是干嘛的）"""
    return "你好，" + name + punctuation   # return 把结果交还给调用方

msg = greet("腾讯")        # 用默认的 "！"
msg2 = greet("DSH", "。")  # 第二个参数可以传，也可以不传
print(msg, msg2)
```

三个规则：
1. `def 名字(参数):` 之后**缩进的**都是函数体（和 if/for 一样靠缩进）；
2. 参数可以带默认值（不传就用默认）；
3. 函数里 `return` 的东西，在函数外面用变量接住。

**手敲检查点**：写一个 `def add(a, b=1):`，返回 `a + b`。测试 `add(5)` 和 `add(5, 2)` 分别是多少。

## 2. 文件读写：让数据活过关机

```python
with open("notes.txt", "w", encoding="utf-8") as f:   # "w"=写(会覆盖)；"a"=追加；"r"=读
    f.write("第一行\n")
    f.write("第二行\n")

with open("notes.txt", "r", encoding="utf-8") as f:
    content = f.read()        # 一次读全部
print(content)

with open("notes.txt", "r", encoding="utf-8") as f:
    for line in f:            # 也可以一行行读（大文件用它）
        print(line.strip())   # strip() 去掉行尾换行符
```

`with open(...) as f` 的意思：打开文件叫 `f`，**用完自动关**。`encoding="utf-8"` 必须带上，否则中文可能乱码。

## 3. JSON：程序世界的"普通话"

JSON 长这样（一种文本格式）：
```json
{"name": "deepseek", "tasks": [1, 2, 3], "done": false}
```
你会发现它和 Python 字典几乎一样（除了 `true/false/null` vs `True/False/None`）。所以 Python 互转只要两个函数：

```python
import json   # 内置模块，不用安装

# Python 对象 → JSON 字符串
text = json.dumps({"name": "deepseek"}, ensure_ascii=False, indent=2)

# JSON 字符串 → Python 对象
data = json.loads(text)
print(data["name"])

# 直接和文件互转（最常用！）
with open("config.json", "w", encoding="utf-8") as f:
    json.dump({"model": "deepseek-chat"}, f, ensure_ascii=False, indent=2)

with open("config.json", "r", encoding="utf-8") as f:
    cfg = json.load(f)
print(cfg["model"])
```

**JSONL**（JSON Lines）：每行一个独立 JSON 对象的文本文件。批量实验的结果就用它存——一行一条记录，追加方便、逐行读取方便：

```python
record = {"task": "T1", "pass": True, "tokens": 812}
with open("results.jsonl", "a", encoding="utf-8") as f:   # "a" 追加模式
    f.write(json.dumps(record, ensure_ascii=False) + "\n")
```

## 4. 异常：出错时不要崩

调用 API 会遇到网络超时、key 错误、返回格式不对。没有保护，程序直接崩，前面跑完的结果全丢。`try/except` = "试着做，出这两种错就接住"：

```python
try:
    n = int("abc")          # 这行会抛 ValueError
except ValueError:
    print("转不成整数，n 保持默认")
    n = 0
print(n)
```

**什么时候用异常、什么时候用 if**（你 W3 的思考题）：if 处理**预期中的分支**（文件里有没有这个词）；try/except 处理**意外状况**（文件被删了、网络断了）。层层 if 兜不住意外，异常可以。

## 5. 调 DeepSeek API：第一次真正的"批量"

DeepSeek 的 API 兼容 OpenAI 的调用方式，装官方 SDK 最省事：

```sh
pip install openai
```

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-你的key",                       # 更安全的做法见第 6 节
    base_url="https://api.deepseek.com",        # 指向 DeepSeek 而不是 OpenAI
)

resp = client.chat.completions.create(
    model="deepseek-chat",
    messages=[
        {"role": "system", "content": "你是一个简洁的助手"},
        {"role": "user", "content": "用一句话解释什么是 JSON"},
    ],
)
print(resp.choices[0].message.content)          # 模型的回答
print(resp.usage.total_tokens)                  # 这次花了多少 token（实验要记录！）
```

`messages` 是一个**字典组成的列表**——每个字典有 `role`（谁说的）和 `content`（说了什么）。你已经会遍历列表和字典，所以你完全有能力动态构造它。

## 6. 正式产物：batch_api.py（手敲完成后跑通）

先准备 `prompts.json`：
```json
[
  {"id": 1, "prompt": "用一句话解释什么是置信区间"},
  {"id": 2, "prompt": "用一句话解释什么是消融实验"},
  {"id": 3, "prompt": "用一句话解释什么是 harness"}
]
```

然后 `batch_api.py`：
```python
import json
import os
from openai import OpenAI

def make_client():
    """创建 DeepSeek 客户端；key 从环境变量读，不写死在代码里。"""
    key = os.environ.get("DEEPSEEK_API_KEY")
    if not key:
        raise RuntimeError("请先 export DEEPSEEK_API_KEY=你的key")
    return OpenAI(api_key=key, base_url="https://api.deepseek.com")

def ask(client, prompt):
    """问模型一个问题，返回 (回答文本, token数)。"""
    resp = client.chat.completions.create(
        model="deepseek-chat",
        messages=[{"role": "user", "content": prompt}],
    )
    answer = resp.choices[0].message.content
    tokens = resp.usage.total_tokens
    return answer, tokens

def main():
    client = make_client()

    with open("prompts.json", "r", encoding="utf-8") as f:
        tasks = json.load(f)

    ok = 0
    with open("results.jsonl", "a", encoding="utf-8") as out:
        for task in tasks:                       # 你最熟的 for 循环
            try:
                answer, tokens = ask(client, task["prompt"])
                record = {"id": task["id"], "answer": answer,
                          "tokens": tokens, "ok": True}
                ok += 1
            except Exception as e:               # 网络/超时/key 错都接住
                record = {"id": task["id"], "error": str(e), "ok": False}
            out.write(json.dumps(record, ensure_ascii=False) + "\n")
            print(f"[{task['id']}] {'成功' if record['ok'] else '失败'}")

    print(f"完成 {ok}/{len(tasks)}，结果在 results.jsonl")

if __name__ == "__main__":   # 固定写法：直接运行本文件时才执行 main()
    main()
```

运行：
```sh
export DEEPSEEK_API_KEY="sk-你的key"
python batch_api.py
```

**验收**：`results.jsonl` 有 3 行，每行一个 JSON，含回答和 token 数。**跑完打开文件数一数**——"从外部验证，不信自我报告"，第一天就养成。

## 7. 本节新知识速查

| 新东西 | 一句话 |
| :--- | :--- |
| `def` | 给代码段起名，参数可带默认值，`return` 交还结果 |
| `open` + `with` | 读写文件、自动关闭；`w` 覆盖 / `a` 追加 / `r` 读；带 `encoding="utf-8"` |
| `json.load/dump` | 文件 ↔ Python 对象；`loads/dumps` 是字符串版 |
| JSONL | 每行一个 JSON，实验记录标准格式 |
| `try/except` | 接住意外错误，程序不崩 |
| 环境变量 `os.environ` | key 不写进代码（写死=泄露风险） |
