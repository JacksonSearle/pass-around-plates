"""Print posts in batches for rewriting: python3 tools/dump.py <batch#> (batches of ~18k chars)."""
import json, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from people import default_from
posts = json.loads((ROOT / "work/posts.json").read_text())
batches, cur, size = [], [], 0
for p in posts:
    t = (ROOT / "work/text" / f"{p['id']}.txt").read_text()
    if cur and size + len(t) > 18000:
        batches.append(cur); cur, size = [], 0
    cur.append((p, t)); size += len(t)
batches.append(cur)
if len(sys.argv) < 2:
    print(len(batches), "batches"); sys.exit()
for p, t in batches[int(sys.argv[1])]:
    print(f"\n##### {p['id']} | {p['title']!r} | {p['published'][:10]} | by {p['author']} | labels={p['labels']} | from={default_from(p)} | photos={len(p['images'])}\n{t}")
