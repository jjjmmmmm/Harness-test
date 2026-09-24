"""统计 words.txt 中出现次数最多的词。"""

import re
from collections import Counter

INPUT_FILE = "words.txt"


def main() -> None:
    with open(INPUT_FILE, encoding="utf-8") as f:
        words = re.findall(r"[A-Za-z']+", f.read().lower())

    if not words:
        print(f"{INPUT_FILE} 中没有找到任何单词。")
        return

    counter = Counter(words)
    top_count = counter.most_common(1)[0][1]
    top_words = sorted(w for w, c in counter.items() if c == top_count)

    print(f"总词数: {len(words)}，不同单词数: {len(counter)}")
    print(f"出现最多的词 (出现 {top_count} 次): {', '.join(top_words)}")
    print("\n完整排名:")
    for rank, (word, count) in enumerate(counter.most_common(), start=1):
        print(f"{rank:>2}. {word:<8} {count}")


if __name__ == "__main__":
    main()
