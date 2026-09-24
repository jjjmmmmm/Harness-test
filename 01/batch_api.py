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