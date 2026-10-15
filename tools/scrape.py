"""Scrape every post from passaroundplates.blogspot.com via the Blogger JSON feed.

Outputs (under work/):
  posts.json         one record per post: id, url, title, published, author, labels, image list
  text/<id>.txt      plain-text rendering of the post body (for rewriting)
Photos are downloaded at full size, resized, and saved to docs/images/<id>-<n>.jpg.
"""
import io
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

from bs4 import BeautifulSoup, NavigableString
from PIL import Image, ImageOps

BLOG = "https://passaroundplates.blogspot.com"
ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "work"
IMG_DIR = ROOT / "docs" / "images"
MAX_DIM = 1400


def get(url, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 recipe-archiver"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            if i == tries - 1:
                raise
            print(f"  retry {url[:80]}: {e}", file=sys.stderr)
            time.sleep(2 ** (i + 1))


def fetch_entries():
    entries, start = [], 1
    while True:
        url = f"{BLOG}/feeds/posts/default?alt=json&max-results=150&start-index={start}"
        feed = json.loads(get(url))["feed"]
        batch = feed.get("entry", [])
        entries += batch
        total = int(feed["openSearch$totalResults"]["$t"])
        start += len(batch)
        if not batch or start > total:
            return entries


def full_size(url):
    """Ask Blogger for the original-resolution version of an image URL."""
    if "googleusercontent.com" in url or "bp.blogspot.com" in url:
        if re.search(r"/s\d+(-[a-z0-9-]+)?/", url):
            return re.sub(r"/s\d+(-[a-z0-9-]+)?/", "/s1600/", url)
        if re.search(r"/w\d+-h\d+[^/]*/", url):
            return re.sub(r"/w\d+-h\d+[^/]*/", "/s1600/", url)
        if "/img/a/" in url:
            return re.sub(r"=[swh]\d+.*$", "", url) + "=s1600"
    return url


def save_image(url, dest):
    data = get(url)
    im = Image.open(io.BytesIO(data))
    im = ImageOps.exif_transpose(im).convert("RGB")
    im.thumbnail((MAX_DIM, MAX_DIM))
    im.save(dest, "JPEG", quality=82, optimize=True, progressive=True)
    return im.size


BLOCK = {"p", "div", "br", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "ul", "ol", "table", "blockquote"}


def to_text(soup):
    out = []

    def walk(node):
        for child in node.children:
            if isinstance(child, NavigableString):
                out.append(str(child))
                continue
            name = child.name
            if name in ("script", "style"):
                continue
            if name == "img":
                out.append("\n[PHOTO]\n")
                continue
            if name == "br":
                out.append("\n")
                continue
            if name == "li":
                out.append("\n• ")
            elif name in BLOCK:
                out.append("\n")
            if name in ("td", "th"):
                out.append(" | ")
            walk(child)
            if name in BLOCK:
                out.append("\n")

    walk(soup)
    text = "".join(out).replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def main():
    (WORK / "text").mkdir(parents=True, exist_ok=True)
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    entries = fetch_entries()
    print(f"{len(entries)} posts")
    posts = []
    for e in entries:
        pid = e["id"]["$t"].rsplit("-", 1)[-1]
        url = next(l["href"] for l in e["link"] if l["rel"] == "alternate")
        html = e["content"]["$t"]
        soup = BeautifulSoup(html, "lxml")

        images = []
        seen = set()
        for img in soup.find_all("img"):
            src = img.get("src", "")
            parent = img.find_parent("a")
            href = parent.get("href", "") if parent else ""
            candidates = [u for u in (href, src) if u.startswith("http") and re.search(r"googleusercontent|bp\.blogspot", u)]
            if not candidates:
                continue
            best = full_size(candidates[0])
            if best in seen:
                continue
            seen.add(best)
            name = f"{pid}-{len(images) + 1}.jpg"
            dest = IMG_DIR / name
            try:
                if not dest.exists():
                    save_image(best, dest)
                    time.sleep(0.2)
                w, h = Image.open(dest).size
                images.append({"file": name, "w": w, "h": h, "source": best})
            except Exception:  # noqa: BLE001
                try:  # fall back to the URL as embedded
                    save_image(full_size(src) if src.startswith("http") else src, dest)
                    w, h = Image.open(dest).size
                    images.append({"file": name, "w": w, "h": h, "source": src})
                except Exception as err:  # noqa: BLE001
                    print(f"  image failed for {url}: {err}", file=sys.stderr)

        (WORK / "text" / f"{pid}.txt").write_text(to_text(soup))
        posts.append({
            "id": pid,
            "url": url,
            "title": e["title"]["$t"].strip(),
            "published": e["published"]["$t"],
            "updated": e["updated"]["$t"],
            "author": e["author"][0]["name"]["$t"],
            "labels": sorted(c["term"] for c in e.get("category", [])),
            "images": images,
        })
        print(f"  {pid} {posts[-1]['title'][:50]!r} images={len(images)}")

    posts.sort(key=lambda p: p["published"])
    (WORK / "posts.json").write_text(json.dumps(posts, indent=1))


if __name__ == "__main__":
    main()
