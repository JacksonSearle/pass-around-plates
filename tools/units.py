"""Standardize measurement wording: tsp, Tbsp, cup/cups, oz, lb, °F.

Mirrors normalizeUnits() in docs/assets/app.js so new recipes match the archive.
"""
import re

QTY = r"(\d+(?:\.\d+)?(?:\s+\d+/\d+)?(?:/\d+)?(?:\s*[–-]\s*\d+(?:\s+\d+/\d+)?(?:/\d+)?)?|[½¼¾⅓⅔⅛])"

UNITS = [
    (r"(?:teaspoons?|teas\.?|tsps?\.?|t\.?)(?![a-zA-Z])", "tsp"),
    (r"(?:tablespoons?|tbsps?\.?|tbls?\.?|tblsp\.?|tbs\.?|T\.?)(?![a-zA-Z])", "Tbsp"),
    (r"(?:cups?|cps?|c\.?)(?![a-zA-Z])", "cup"),
    (r"(?:ounces?|oz\.?)(?![a-zA-Z])", "oz"),
    (r"(?:pounds?|lbs?\.?)(?![a-zA-Z])", "lb"),
]


def _amount(q):
    """Largest number in a quantity like '1 1/2' or '2–3', for choosing cup vs cups."""
    best = 0.0
    for part in re.split(r"[–-]", q):
        total = 0.0
        for tok in part.split():
            if "/" in tok:
                n, d = tok.split("/")
                total += float(n) / float(d)
            elif tok in "½¼¾⅓⅔⅛":
                total += {"½": .5, "¼": .25, "¾": .75, "⅓": .33, "⅔": .67, "⅛": .125}[tok]
            else:
                total += float(tok)
        best = max(best, total)
    return best


def normalize(text):
    def unit_sub(pattern, canon, flags):
        def repl(m):
            q = m.group(1)
            unit = canon
            if canon == "cup" and _amount(q) > 1:
                unit = "cups"
            return f"{q} {unit}"
        return re.sub(QTY + r"\s*" + pattern, repl, text, flags=flags)

    for pattern, canon in UNITS:
        # 't' and 'T' are case-sensitive (tsp vs Tbsp); everything else is not.
        if canon == "tsp":
            text = unit_sub(r"(?:(?i:teaspoons?|teas\.?|tsps?\.?)|t\.?)(?![a-zA-Z])", canon, 0)
        elif canon == "Tbsp":
            text = unit_sub(r"(?:(?i:tablespoons?|tbsps?\.?|tbls?\.?|tblsp\.?|tbs\.?)|T\.?)(?![a-zA-Z])", canon, 0)
        else:
            text = unit_sub(pattern, canon, re.I)
    text = re.sub(r"\b([1-5]\d\d)\s*(?:degrees|°)(?:\s*F\b)?", r"\1°F", text)
    return text


if __name__ == "__main__":
    tests = {
        "1 c flour": "1 cup flour", "2 c milk": "2 cups milk", "1 1/2 c sugar": "1 1/2 cups sugar",
        "5 t butter": "5 tsp butter", "3 T flour": "3 Tbsp flour", "2 Tbs oil": "2 Tbsp oil",
        "1/2 tsp. salt": "1/2 tsp salt", "2 teaspoons cumin": "2 tsp cumin", "1-2 lb. beef": "1-2 lb beef",
        "Bake at 350 degrees": "Bake at 350°F", "at 375°.": "at 375°F.", "1/2c butter": "1/2 cup butter",
        "2 cups flour": "2 cups flour", "1 (8 oz) package": "1 (8 oz) package", "4 cats": "4 cats",
        "3/4 cup shortening": "3/4 cup shortening", "2–3 cups bread crumbs": "2–3 cups bread crumbs",
        "12 ounces chocolate": "12 oz chocolate", "450°F": "450°F", "1 tsp vanilla": "1 tsp vanilla",
        "1 Tbsp sugar": "1 Tbsp sugar", "2 large eggs": "2 large eggs", "Bake 30 minutes": "Bake 30 minutes",
    }
    for src, want in tests.items():
        got = normalize(src)
        print(("ok  " if got == want else "FAIL"), repr(src), "->", repr(got))
