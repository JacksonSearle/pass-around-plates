"""Combine scraped post metadata with the rewritten recipes into site/data/recipes.json.

Also checks that every number in each rewritten ingredient list appears in the
original post, so ingredient amounts can't drift during the rewrite.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from people import default_from  # noqa: E402
from units import normalize  # noqa: E402

CATEGORY_GROUPS = {
    "Meal": ["Breakfast", "Dinner", "Side Dishes", "Appetizers & Snacks", "Dessert", "Drinks"],
    "Dish": ["Breads", "Soups & Stews", "Salads", "Pasta", "Pizza", "Sauces & Dips",
             "Cookies & Bars", "Cakes & Pies", "Candy"],
    "Main Ingredient": ["Chicken", "Beef", "Pork", "Seafood", "Vegetarian"],
    "Cuisine": ["Mexican", "Italian", "Asian", "Indian"],
    "Occasion & Method": ["Quick & Easy", "Slow Cooker", "Grilling", "Holiday"],
}
ALL_CATS = {c for cats in CATEGORY_GROUPS.values() for c in cats}

# Amounts that differ from the original only because the original had an obvious typo.
TYPO_FIXES = {
    "4413771139586023996": {"1/4"},  # "1.4 t pepper" -> 1/4 tsp
    "3505928666243043969": {"3/4"},  # "3.4 c milk" -> 3/4 cup
}


def parse_rewritten(text):
    recipes = {}
    for block in re.split(r"^=== ", text, flags=re.M)[1:]:
        lines = block.rstrip().split("\n")
        rid = lines[0].strip()
        r = {"ingredients": [], "steps": [], "tips": [], "notes": []}
        section = None
        for line in lines[1:]:
            if not line.strip():
                continue
            if line.startswith("## "):
                section = line[3:].strip().lower()
                continue
            if section is None:
                key, _, val = line.partition(":")
                key, val = key.strip(), val.strip()
                if key == "cats":
                    r["categories"] = [c.strip() for c in val.split(",") if c.strip()]
                elif key == "from":
                    r["from"] = [c.strip() for c in val.split(",") if c.strip()]
                else:
                    r[key] = val
                continue
            if section in ("ingredients", "steps"):
                groups = r[section]
                if line.startswith("### "):
                    groups.append({"heading": line[4:].strip(), "items": []})
                    continue
                if not groups or (groups[-1]["heading"] is None and False):
                    pass
                if not groups:
                    groups.append({"heading": None, "items": []})
                groups[-1]["items"].append(line[2:].strip() if line.startswith("- ") else line.strip())
            elif section in ("tips", "notes"):
                r[section].append(line[2:].strip() if line.startswith("- ") else line.strip())
            else:
                raise ValueError(f"{rid}: unknown section {section}")
        recipes[rid] = r
    return recipes


def slugify(title):
    s = title.lower().replace("&", " and ")
    s = re.sub(r"['’\"]", "", s)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    if len(s) > 70:
        s = s[:71].rsplit("-", 1)[0]
    return s


FRACTIONS = {"½": "1/2", "¼": "1/4", "¾": "3/4", "⅓": "1/3", "⅔": "2/3", "⅛": "1/8", "⁄": "/"}


def numbers(text):
    for k, v in FRACTIONS.items():
        text = text.replace(k, " " + v if v[0].isdigit() else v)
    text = re.sub(r"(\d)\s*/\s*(\d)", r"\1/\2", text)
    nums = set(re.findall(r"\d+/\d+|\d+(?:\.\d+)?", text))
    # 1.5 in an original matches "1 1/2" in a rewrite, etc.
    decimals = {"1.5": {"1", "1/2"}, "2.5": {"2", "1/2"}, "4.5": {"4", "1/2"}, "1.25": {"1", "1/4"}}
    for d, parts in decimals.items():
        if d in nums:
            nums |= parts
    return nums


def main():
    posts = {p["id"]: p for p in json.loads((ROOT / "work/posts.json").read_text())}
    rewritten = {}
    for f in sorted((ROOT / "work/rewritten").glob("*.txt")):
        rewritten.update(parse_rewritten(f.read_text()))

    missing = set(posts) - set(rewritten)
    extra = set(rewritten) - set(posts)
    if missing or extra:
        sys.exit(f"missing={missing} extra={extra}")

    problems, out, slugs = [], [], set()
    for pid, post in sorted(posts.items(), key=lambda kv: kv[1]["published"], reverse=True):
        r = rewritten[pid]
        bad = [c for c in r.get("categories", []) if c not in ALL_CATS]
        if bad or not r.get("categories"):
            problems.append(f"{pid} {r.get('title')}: categories {bad or 'none'}")

        for group in r["ingredients"] + r["steps"]:
            group["items"] = [normalize(i) for i in group["items"]]
        r["tips"] = [normalize(t) for t in r["tips"]]

        original = (ROOT / "work/text" / f"{pid}.txt").read_text()
        # recipe-card photo posts carry their text in the image, not the post body
        if len(original.replace("[PHOTO]", "").strip()) > 400:
            orig_nums = numbers(original) | TYPO_FIXES.get(pid, set())
            for g in r["ingredients"]:
                for item in g["items"]:
                    stray = numbers(item) - orig_nums
                    if stray:
                        problems.append(f"{pid} {r['title']}: {item!r} has {sorted(stray)} not in original")

        slug = base = slugify(r["title"])
        n = 2
        while slug in slugs:
            slug, n = f"{base}-{n}", n + 1
        slugs.add(slug)

        out.append({
            "slug": slug,
            "title": r["title"],
            "from": r.get("from") or default_from(post),
            "postedBy": {"Anonymous": "", "Unknown": ""}.get(post["author"], post["author"]),
            "date": post["published"][:10],
            "categories": [c for c in r["categories"] if c in ALL_CATS],
            "makes": r.get("makes", ""),
            "ingredients": r["ingredients"],
            "steps": r["steps"],
            "tips": r["tips"],
            "notes": r["notes"],
            "images": [{"src": f"images/{i['file']}", "w": i["w"], "h": i["h"]} for i in post["images"]],
            "original": post["url"],
        })

    data = {"categoryGroups": CATEGORY_GROUPS, "recipes": out}
    dest = ROOT / "docs/data/recipes.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")
    print(f"wrote {len(out)} recipes to {dest.relative_to(ROOT)} ({dest.stat().st_size // 1024} KB)")
    for p in problems:
        print("  CHECK:", p)


if __name__ == "__main__":
    main()
