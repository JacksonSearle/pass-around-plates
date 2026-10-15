/* Pass Around Plates — static recipe site for GitHub Pages.
 * Data lives in data/recipes.json. New and edited recipes are committed back to the
 * repository through the GitHub API using a personal access token the cook pastes in.
 */
(() => {
  "use strict";

  const CONFIG = Object.assign({ title: "Recipes", branch: "main", siteDir: "docs" }, window.RECIPE_SITE || {});
  const app = document.getElementById("app");
  const searchInput = document.getElementById("search");
  const PENDING_KEY = "pap.pending";
  const TOKEN_KEY = "pap.token";

  let DATA = { categoryGroups: {}, recipes: [] };
  let bySlug = new Map();

  /* ---------- helpers ---------- */

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Minimal inline formatting for recipe text: **bold** and *italic*.
  const fmt = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  const fold = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, "");
  const icon = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const ICONS = {
    back: icon('<path d="M15 18l-6-6 6-6"/>'),
    print: icon('<path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2"/><path d="M6 14h12v7H6z"/>'),
    external: icon('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
    edit: icon('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
    filter: icon('<path d="M4 6h16M7 12h10M10 18h4"/>'),
    x: icon('<path d="M6 6l12 12M18 6L6 18"/>'),
    link: icon('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  };
  const PLACEHOLDER_COLORS = ["#c4532d", "#5d7a5c", "#b07d2b", "#7a5c8a", "#3f6e8c", "#a0483f", "#6b7a3a", "#8c5a3c"];
  function hashCode(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }
  function formatDate(iso) {
    if (!iso) return "";
    const d = new Date(iso + "T12:00:00");
    return isNaN(d) ? iso : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  }
  function slugify(title) {
    return fold(title).replace(/&/g, " and ").replace(/["]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/^(.{0,70})(-.*)?$/, "$1") || "recipe";
  }
  function toast(msg, ms = 4000) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (t.hidden = true), ms);
  }
  const store = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };

  /* ---------- unit standardization (mirrors tools/units.py) ---------- */

  const QTY = "(\\d+(?:\\.\\d+)?(?:\\s+\\d+/\\d+)?(?:/\\d+)?(?:\\s*[–-]\\s*\\d+(?:\\s+\\d+/\\d+)?(?:/\\d+)?)?|[½¼¾⅓⅔⅛])";
  const UNIT_RULES = [
    ["(?:[Tt][Ee][Aa][Ss][Pp][Oo][Oo][Nn][Ss]?|[Tt]eas\\.?|[Tt][Ss][Pp][Ss]?\\.?|t\\.?)(?![a-zA-Z])", "tsp", ""],
    ["(?:[Tt]ablespoons?|TABLESPOONS?|[Tt][Bb][Ss][Pp][Ss]?\\.?|[Tt][Bb][Ll][Ss]?\\.?|[Tt]blsp\\.?|[Tt][Bb][Ss]\\.?|T\\.?)(?![a-zA-Z])", "Tbsp", ""],
    ["(?:cups?|cps?|c\\.?)(?![a-zA-Z])", "cup", "i"],
    ["(?:ounces?|oz\\.?)(?![a-zA-Z])", "oz", "i"],
    ["(?:pounds?|lbs?\\.?)(?![a-zA-Z])", "lb", "i"],
  ];
  function amount(q) {
    const uni = { "½": .5, "¼": .25, "¾": .75, "⅓": .33, "⅔": .67, "⅛": .125 };
    return Math.max(...q.split(/[–-]/).map((part) => part.trim().split(/\s+/).reduce((sum, tok) => {
      if (tok.includes("/")) { const [n, d] = tok.split("/"); return sum + n / d; }
      return sum + (uni[tok] ?? (parseFloat(tok) || 0));
    }, 0)));
  }
  function normalizeUnits(text) {
    let out = text;
    for (const [pattern, canon, flags] of UNIT_RULES) {
      out = out.replace(new RegExp(QTY + "\\s*" + pattern, "g" + flags), (_, q) => `${q} ${canon === "cup" && amount(q) > 1 ? "cups" : canon}`);
    }
    return out.replace(/\b([1-5]\d\d)\s*(?:degrees|°)(?:\s*F\b)?/g, "$1°F");
  }

  /* ---------- data ---------- */

  function indexRecipes() {
    bySlug = new Map(DATA.recipes.map((r) => [r.slug, r]));
    for (const r of DATA.recipes) {
      const items = (groups) => (groups || []).flatMap((g) => [g.heading || "", ...g.items]).join(" ");
      r._title = fold(r.title);
      r._ing = fold(items(r.ingredients));
      r._rest = fold([items(r.steps), (r.tips || []).join(" "), (r.notes || []).join(" "), (r.from || []).join(" "), (r.categories || []).join(" ")].join(" "));
    }
  }

  // Edits saved from this browser show up right away, before GitHub Pages finishes redeploying.
  function applyPending(recipes) {
    const pending = store.get(PENDING_KEY, {});
    const now = Date.now();
    let list = recipes.slice();
    for (const [slug, p] of Object.entries(pending)) {
      const live = list.find((r) => r.slug === slug);
      const settled = p.deleted ? !live : live && live.updated === p.recipe.updated;
      if (settled || now - p.savedAt > 86400000) { delete pending[slug]; continue; }
      list = list.filter((r) => r.slug !== slug && r.slug !== p.previousSlug);
      if (!p.deleted) list.unshift(p.recipe);
    }
    store.set(PENDING_KEY, pending);
    return list;
  }

  async function loadData() {
    const res = await fetch("data/recipes.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`Couldn't load recipes (HTTP ${res.status})`);
    const data = await res.json();
    data.recipes = applyPending(data.recipes);
    DATA = data;
    indexRecipes();
  }

  function allPeople() {
    const counts = new Map();
    for (const r of DATA.recipes) for (const p of r.from || []) counts.set(p, (counts.get(p) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }

  /* ---------- routing ---------- */

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, "");
    const [path, query = ""] = raw.split("?");
    const params = new URLSearchParams(query);
    const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
    return { parts, params };
  }
  function browseHash(state) {
    const p = new URLSearchParams();
    if (state.q) p.set("q", state.q);
    if (state.cats.length) p.set("c", state.cats.join("|"));
    if (state.person) p.set("p", state.person);
    if (state.sort && state.sort !== "relevance") p.set("sort", state.sort);
    const s = p.toString();
    return "#/" + (s ? "?" + s : "");
  }
  function browseState(params) {
    return {
      q: params.get("q") || "",
      cats: (params.get("c") || "").split("|").filter(Boolean),
      person: params.get("p") || "",
      sort: params.get("sort") || "relevance",
    };
  }

  let lastBrowseHash = "#/";
  function route() {
    const { parts, params } = parseHash();
    const [page, slug] = parts;
    if (!page) {
      lastBrowseHash = location.hash || "#/";
      return renderBrowse(browseState(params));
    }
    searchInput.value = "";
    if (page === "r" && slug) return renderRecipe(slug);
    if (page === "new") return renderEditor(null);
    if (page === "edit" && slug) return renderEditor(slug);
    location.replace("#/");
  }

  /* ---------- browse ---------- */

  function search(recipes, q) {
    const terms = fold(q).split(/\s+/).filter(Boolean);
    if (!terms.length) return recipes.map((r) => ({ r, score: 0 }));
    const out = [];
    for (const r of recipes) {
      let score = 0;
      let ok = true;
      for (const t of terms) {
        const inTitle = r._title.includes(t);
        const inIng = r._ing.includes(t);
        const inRest = r._rest.includes(t);
        if (!inTitle && !inIng && !inRest) { ok = false; break; }
        score += (inTitle ? 10 : 0) + (inIng ? 3 : 0) + (inRest ? 1 : 0);
        if (r._title.startsWith(t) || r._title.includes(" " + t)) score += 4;
      }
      if (ok) out.push({ r, score });
    }
    return out;
  }

  function filterRecipes(state) {
    let hits = search(DATA.recipes, state.q);
    if (state.person) hits = hits.filter(({ r }) => (r.from || []).includes(state.person));
    if (state.cats.length) hits = hits.filter(({ r }) => state.cats.every((c) => (r.categories || []).includes(c)));
    const sorters = {
      relevance: (a, b) => b.score - a.score || a.r.title.localeCompare(b.r.title),
      az: (a, b) => a.r.title.localeCompare(b.r.title),
      newest: (a, b) => (b.r.date || "").localeCompare(a.r.date || "") || a.r.title.localeCompare(b.r.title),
    };
    const sortKey = state.sort === "relevance" && !state.q ? "az" : state.sort;
    return hits.sort(sorters[sortKey] || sorters.az).map((h) => h.r);
  }

  function cardMedia(r) {
    const img = r.images && r.images[0];
    if (img) return `<img src="${esc(img.src)}" alt="" loading="lazy" decoding="async">`;
    const color = PLACEHOLDER_COLORS[hashCode(r.slug) % PLACEHOLDER_COLORS.length];
    return `<div class="placeholder" style="background:${color}"><span>${esc(r.title.trim()[0] || "?")}</span></div>`;
  }

  function renderBrowse(state) {
    document.title = CONFIG.title;
    if (document.activeElement !== searchInput) searchInput.value = state.q;
    const results = filterRecipes(state);
    const go = (next) => location.assign(browseHash(Object.assign({}, state, next)));

    const groups = Object.entries(DATA.categoryGroups).map(([group, cats]) => {
      const chips = cats.map((c) => {
        const on = state.cats.includes(c);
        const n = on ? results.length : results.filter((r) => (r.categories || []).includes(c)).length;
        return `<button type="button" class="chip" data-cat="${esc(c)}" aria-pressed="${on}" ${!on && !n ? "disabled" : ""}>${esc(c)} <span class="count">${n}</span></button>`;
      }).join("");
      return `<div class="filter-group"><h2>${esc(group)}</h2><div class="chips">${chips}</div></div>`;
    }).join("");
    const people = allPeople().map(([p, n]) =>
      `<button type="button" class="chip person" data-person="${esc(p)}" aria-pressed="${state.person === p}">${esc(p)} <span class="count">${n}</span></button>`).join("");

    const active = [
      ...state.cats.map((c) => `<button type="button" class="chip" data-remove-cat="${esc(c)}">${esc(c)} ${ICONS.x}</button>`),
      state.person ? `<button type="button" class="chip" data-remove-person>From ${esc(state.person)} ${ICONS.x}</button>` : "",
    ].join("");
    const anyFilter = state.q || state.cats.length || state.person;
    const heading = state.q ? `Results for “${esc(state.q)}”` : state.person ? `From ${esc(state.person)}` : state.cats.length === 1 ? esc(state.cats[0]) : "All recipes";

    app.innerHTML = `
      <div class="browse">
        <aside class="filters" id="filters">
          <button type="button" class="btn filters-toggle" aria-expanded="false" aria-controls="filters-body">${ICONS.filter} Filters${state.cats.length || state.person ? ` (${state.cats.length + (state.person ? 1 : 0)})` : ""}</button>
          <div class="filters-body" id="filters-body">
            ${groups}
            <div class="filter-group"><h2>Who it's from</h2><div class="chips">${people}</div></div>
          </div>
        </aside>
        <section aria-live="polite">
          <div class="results-bar">
            <h1>${heading}</h1>
            <span class="meta">${results.length} recipe${results.length === 1 ? "" : "s"}</span>
            <label class="visually-hidden" for="sort">Sort</label>
            <select id="sort" class="select">
              ${state.q ? `<option value="relevance" ${state.sort === "relevance" ? "selected" : ""}>Best match</option>` : ""}
              <option value="az" ${state.sort === "az" || (!state.q && state.sort === "relevance") ? "selected" : ""}>A–Z</option>
              <option value="newest" ${state.sort === "newest" ? "selected" : ""}>Newest</option>
            </select>
            ${anyFilter ? `<a class="btn btn-quiet" href="#/">Clear all</a>` : ""}
          </div>
          ${active ? `<div class="active-filters">${active}</div>` : ""}
          ${results.length ? `<div class="grid">${results.map((r) => `
            <a class="card" href="#/r/${encodeURIComponent(r.slug)}">
              <div class="card-media">${cardMedia(r)}</div>
              <div class="card-body">
                <h2 class="card-title">${esc(r.title)}</h2>
                ${r.from && r.from.length ? `<div class="card-from">From ${esc(r.from.join(" & "))}</div>` : ""}
              </div>
            </a>`).join("")}</div>`
          : `<div class="empty"><h2>No recipes found</h2><p>Try a different word or remove a filter.</p></div>`}
        </section>
      </div>`;

    const filters = app.querySelector("#filters");
    filters.querySelector(".filters-toggle").addEventListener("click", (e) => {
      const open = filters.classList.toggle("open");
      e.currentTarget.setAttribute("aria-expanded", open);
    });
    app.querySelectorAll("[data-cat]").forEach((b) => b.addEventListener("click", () => {
      const c = b.dataset.cat;
      go({ cats: state.cats.includes(c) ? state.cats.filter((x) => x !== c) : [...state.cats, c] });
    }));
    app.querySelectorAll("[data-person]").forEach((b) => b.addEventListener("click", () => {
      go({ person: state.person === b.dataset.person ? "" : b.dataset.person });
    }));
    app.querySelectorAll("[data-remove-cat]").forEach((b) => b.addEventListener("click", () => go({ cats: state.cats.filter((x) => x !== b.dataset.removeCat) })));
    const rp = app.querySelector("[data-remove-person]");
    if (rp) rp.addEventListener("click", () => go({ person: "" }));
    app.querySelector("#sort").addEventListener("change", (e) => go({ sort: e.target.value }));
  }

  let searchTimer;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const { parts, params } = parseHash();
      const state = parts.length ? browseState(new URLSearchParams()) : browseState(params);
      state.q = searchInput.value.trim();
      state.sort = state.q ? "relevance" : state.sort === "relevance" ? "az" : state.sort;
      location.replace(browseHash(state));
    }, 180);
  });
  document.getElementById("search-form").addEventListener("submit", (e) => { e.preventDefault(); searchInput.blur(); });

  /* ---------- recipe page ---------- */

  function renderGroups(groups, renderItems) {
    return (groups || []).map((g) => `${g.heading ? `<h3>${esc(g.heading)}</h3>` : ""}${renderItems(g.items)}`).join("");
  }

  function renderRecipe(slug) {
    const r = bySlug.get(slug);
    if (!r) {
      app.innerHTML = `<div class="empty"><h2>Recipe not found</h2><p><a href="#/">Back to all recipes</a></p></div>`;
      return;
    }
    document.title = `${r.title} · ${CONFIG.title}`;
    const [hero, ...more] = r.images || [];
    let n = 0;
    const ingredients = renderGroups(r.ingredients, (items) =>
      `<ul class="ing-list">${items.map((i) => `<li><label><input type="checkbox" id="ing-${n++}"><span>${fmt(i)}</span></label></li>`).join("")}</ul>`);
    const steps = renderGroups(r.steps, (items) => `<ol>${items.map((s) => `<li>${fmt(s)}</li>`).join("")}</ol>`);
    const tags = (r.categories || []).map((c) => `<a class="chip" href="${browseHash({ q: "", cats: [c], person: "", sort: "az" })}">${esc(c)}</a>`).join("");
    const credits = [
      r.postedBy ? `Posted by ${esc(r.postedBy)}` : "",
      r.date ? `${r.postedBy ? "on" : "Added"} ${esc(formatDate(r.date))}` : "",
    ].filter(Boolean).join(" ");

    app.innerHTML = `
      <article class="recipe">
        <a class="back" href="${esc(lastBrowseHash)}">${ICONS.back} All recipes</a>
        <header class="recipe-head ${hero ? "has-photo" : ""}">
          <div>
            <h1>${esc(r.title)}</h1>
            <div class="recipe-meta">
              ${r.from && r.from.length ? `<span>From <strong>${esc(r.from.join(" & "))}</strong></span>` : ""}
              ${r.makes ? `<span>Makes <strong>${esc(r.makes)}</strong></span>` : ""}
            </div>
            ${tags ? `<div class="tag-row">${tags}</div>` : ""}
            <div class="actions">
              <button type="button" class="btn btn-primary" id="print" title="Opens your browser's print dialog. Choose “Save as PDF” to download a PDF.">${ICONS.print} Print / Save PDF</button>
              ${r.original ? `<a class="btn" href="${esc(r.original)}" target="_blank" rel="noopener">${ICONS.external} Original post</a>` : ""}
              <button type="button" class="btn" id="copy-link">${ICONS.link} Copy link</button>
              <a class="btn" href="#/edit/${encodeURIComponent(r.slug)}">${ICONS.edit} Edit</a>
            </div>
          </div>
          ${hero ? `<figure class="hero"><img src="${esc(hero.src)}" alt="${esc(r.title)}"></figure>` : ""}
        </header>

        <div class="recipe-body">
          <section class="ingredients panel" aria-labelledby="h-ing">
            <h2 id="h-ing">Ingredients</h2>
            ${r.makes ? `<p class="makes">Makes ${esc(r.makes)}</p>` : ""}
            ${ingredients || "<p>—</p>"}
          </section>
          <div>
            <section class="steps" aria-labelledby="h-steps">
              <h2 id="h-steps">Instructions</h2>
              <p class="hint">Tap a step to mark it done.</p>
              ${steps}
            </section>
            ${r.tips && r.tips.length ? `<section class="tips"><h2>Tips &amp; variations</h2><ul>${r.tips.map((t) => `<li>${fmt(t)}</li>`).join("")}</ul></section>` : ""}
          </div>
        </div>

        ${more.length ? `<section class="gallery"><h2>More photos</h2><div class="gallery-grid">${more.map((img) =>
          `<a href="${esc(img.src)}" target="_blank" rel="noopener"><img src="${esc(img.src)}" alt="" loading="lazy"></a>`).join("")}</div></section>` : ""}

        <section class="about" aria-labelledby="h-about">
          <h2 id="h-about">Notes &amp; stories</h2>
          ${r.notes && r.notes.length ? `<ul>${r.notes.map((t) => `<li>${fmt(t)}</li>`).join("")}</ul>` : ""}
          <p class="credits">${credits}${credits && r.original ? " · " : ""}${r.original ? `<a href="${esc(r.original)}" target="_blank" rel="noopener">View the original blog post</a>` : ""}</p>
        </section>
        <p class="print-source">${esc(location.href.split("#")[0])}#/r/${esc(r.slug)}${r.original ? ` · Original: ${esc(r.original)}` : ""}</p>
      </article>`;

    app.querySelector("#print").addEventListener("click", () => window.print());
    app.querySelector("#copy-link").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(location.href); toast("Link copied"); } catch { toast(location.href, 6000); }
    });
    app.querySelectorAll(".steps li").forEach((li) => li.addEventListener("click", (e) => {
      if (window.getSelection().toString()) return;
      li.classList.toggle("done");
    }));
    window.scrollTo(0, 0);
  }

  /* ---------- GitHub ---------- */

  function repoInfo() {
    let { owner, repo } = CONFIG;
    if ((!owner || !repo) && location.hostname.endsWith(".github.io")) {
      owner = owner || location.hostname.split(".")[0];
      const first = location.pathname.split("/").filter(Boolean)[0];
      repo = repo || (first && !first.includes(".") ? first : `${owner}.github.io`);
    }
    return owner && repo ? { owner, repo, branch: CONFIG.branch || "main", dir: (CONFIG.siteDir || "").replace(/^\/|\/$/g, "") } : null;
  }
  const repoPath = (info, p) => (info.dir ? `${info.dir}/${p}` : p);

  function getToken() {
    try { return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
  }
  function setToken(token, remember) {
    try {
      sessionStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY);
      if (token) (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
    } catch { /* storage unavailable; token lives only in memory */ }
    getToken.memory = token;
  }

  async function gh(path, { method = "GET", body, raw = false } = {}) {
    const token = getToken() || getToken.memory;
    const res = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    if (!res.ok) {
      let msg = `GitHub said ${res.status}`;
      try { const j = await res.json(); if (j.message) msg += `: ${j.message}`; } catch { /* not JSON */ }
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return raw ? res.text() : res.status === 204 ? null : res.json();
  }

  async function checkAccess() {
    const info = repoInfo();
    if (!info) throw new Error("The site doesn't know which GitHub repository to save to yet. Fill in owner and repo in config.js.");
    const [user, repo] = await Promise.all([gh("/user").catch(() => null), gh(`/repos/${info.owner}/${info.repo}`)]);
    if (repo.permissions && !repo.permissions.push) throw new Error("This token can read the repository but can't save to it. Give it “Contents: Read and write” access.");
    return { login: user ? user.login : "", repo: repo.full_name };
  }

  // One atomic commit: upload photos, rewrite recipes.json via `mutate`, delete files in `remove`.
  async function commitRecipes({ mutate, message, photos = [], remove = [] }) {
    const info = repoInfo();
    const base = `/repos/${info.owner}/${info.repo}`;
    const photoEntries = [];
    for (const p of photos) {
      const blob = await gh(`${base}/git/blobs`, { method: "POST", body: { content: p.base64, encoding: "base64" } });
      photoEntries.push({ path: repoPath(info, p.path), mode: "100644", type: "blob", sha: blob.sha });
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const ref = await gh(`${base}/git/ref/heads/${encodeURIComponent(info.branch)}`);
      const headSha = ref.object.sha;
      const head = await gh(`${base}/git/commits/${headSha}`);
      const current = JSON.parse(await gh(`${base}/contents/${repoPath(info, "data/recipes.json")}?ref=${headSha}`, { raw: true }));
      const result = mutate(current);
      const json = await gh(`${base}/git/blobs`, { method: "POST", body: { content: JSON.stringify(current, null, 1) + "\n", encoding: "utf-8" } });
      const tree = await gh(`${base}/git/trees`, {
        method: "POST",
        body: {
          base_tree: head.tree.sha,
          tree: [
            { path: repoPath(info, "data/recipes.json"), mode: "100644", type: "blob", sha: json.sha },
            ...photoEntries,
            ...remove.map((p) => ({ path: repoPath(info, p), mode: "100644", type: "blob", sha: null })),
          ],
        },
      });
      const commit = await gh(`${base}/git/commits`, { method: "POST", body: { message, tree: tree.sha, parents: [headSha] } });
      try {
        await gh(`${base}/git/refs/heads/${encodeURIComponent(info.branch)}`, { method: "PATCH", body: { sha: commit.sha, force: false } });
        return result;
      } catch (e) {
        if (e.status !== 422 || attempt === 2) throw e; // someone else saved at the same moment; retry on top of theirs
      }
    }
  }

  /* ---------- photos ---------- */

  function resizePhoto(file, max = 1600) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * scale);
        const h = Math.round(img.naturalHeight * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        resolve({ dataUrl, base64: dataUrl.split(",")[1], w, h });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Couldn't read ${file.name}. Try a JPEG or PNG.`)); };
      img.src = url;
    });
  }

  /* ---------- editor ---------- */

  // Text format for the big boxes: one item per line, "# Heading" starts a section.
  function groupsToText(groups) {
    return (groups || []).map((g) => [g.heading ? `# ${g.heading}` : null, ...g.items].filter((x) => x !== null).join("\n")).join("\n\n");
  }
  function textToGroups(text, normalize) {
    const groups = [];
    for (let line of text.split("\n")) {
      line = line.trim().replace(/^([-*•]|\d+[.)])\s+/, "");
      if (!line) continue;
      if (line.startsWith("#")) { groups.push({ heading: line.replace(/^#+\s*/, "").replace(/:$/, ""), items: [] }); continue; }
      if (!groups.length) groups.push({ heading: null, items: [] });
      groups[groups.length - 1].items.push(normalize ? normalizeUnits(line) : line);
    }
    return groups.filter((g) => g.items.length);
  }
  const linesToList = (text, normalize) => text.split("\n").map((l) => l.trim().replace(/^([-*•])\s+/, "")).filter(Boolean).map((l) => (normalize ? normalizeUnits(l) : l));

  function tokenPanel(connected) {
    if (connected) {
      return `<div class="token-box connected">
        <span><span class="ok">✓ Connected</span>${connected.login ? ` as ${esc(connected.login)}` : ""} · saving to ${esc(connected.repo)}</span>
        <button type="button" class="btn btn-quiet" id="forget-token">Forget token</button>
      </div>`;
    }
    return `<div class="token-box">
      <h2>Paste your access token</h2>
      <p>Only family members with a token can save recipes. Ask whoever manages the site for one.</p>
      <div class="token-row">
        <label class="visually-hidden" for="token">Access token</label>
        <input class="input" id="token" type="password" placeholder="github_pat_…" autocomplete="off" spellcheck="false">
        <button type="button" class="btn btn-primary" id="connect">Connect</button>
      </div>
      <label class="check"><input type="checkbox" id="remember" checked> Remember on this device</label>
      <div id="token-error"></div>
    </div>`;
  }

  async function renderEditor(slug) {
    const existing = slug ? bySlug.get(slug) : null;
    if (slug && !existing) { app.innerHTML = `<div class="empty"><h2>Recipe not found</h2><p><a href="#/">Back to all recipes</a></p></div>`; return; }
    document.title = `${existing ? "Edit" : "Add"} recipe · ${CONFIG.title}`;
    const r = existing || { title: "", from: [], categories: [], makes: "", ingredients: [], steps: [], tips: [], notes: [], images: [] };
    const photos = (r.images || []).map((img) => ({ ...img, existing: true }));
    const people = allPeople().map(([p]) => p);
    const chosenPeople = new Set(r.from || []);
    const chosenCats = new Set(r.categories || []);

    let connected = null;
    if (getToken()) { try { connected = await checkAccess(); } catch { connected = null; } }

    app.innerHTML = `
      <div class="editor">
        <a class="back" href="${existing ? `#/r/${encodeURIComponent(existing.slug)}` : esc(lastBrowseHash)}">${ICONS.back} ${existing ? "Back to recipe" : "All recipes"}</a>
        <h1>${existing ? "Edit recipe" : "Add a recipe"}</h1>
        <p class="lede">Start the recipe with what you need and what to do. Stories, who recommended it, and other comments go in “Notes &amp; stories” at the bottom.</p>
        <div id="token-slot">${tokenPanel(connected)}</div>
        <form id="recipe-form" novalidate>
          <div id="form-error"></div>
          <div class="field">
            <label for="f-title">Recipe name</label>
            <input class="input" id="f-title" required value="${esc(r.title)}" placeholder="Grandma's Cinnamon Rolls">
          </div>
          <div class="field">
            <span class="label">Who it's from</span>
            <div class="chips" id="f-people">${people.map((p) => `<button type="button" class="chip person" data-person="${esc(p)}" aria-pressed="${chosenPeople.has(p)}">${esc(p)}</button>`).join("")}</div>
            <p class="help">Not listed? Add names separated by commas.</p>
            <input class="input" id="f-people-other" placeholder="e.g. Aunt Renee" value="${esc([...chosenPeople].filter((p) => !people.includes(p)).join(", "))}">
          </div>
          <div class="field">
            <span class="label">Categories</span>
            <div class="cat-groups">${Object.entries(DATA.categoryGroups).map(([g, cats]) => `
              <div><div class="group-name">${esc(g)}</div><div class="chips">${cats.map((c) =>
                `<button type="button" class="chip" data-cat="${esc(c)}" aria-pressed="${chosenCats.has(c)}">${esc(c)}</button>`).join("")}</div></div>`).join("")}
            </div>
          </div>
          <div class="field">
            <label for="f-makes">Makes <span class="help">(optional)</span></label>
            <input class="input" id="f-makes" value="${esc(r.makes)}" placeholder="2 loaves, 24 cookies, 6 servings…">
          </div>
          <div class="field">
            <label for="f-ingredients">Ingredients</label>
            <p class="help">One per line. Start a line with # to add a section heading, like “# Frosting”.</p>
            <textarea class="textarea" id="f-ingredients" rows="10" placeholder="2 cups flour&#10;1 tsp salt&#10;&#10;# Frosting&#10;1 cup powdered sugar">${esc(groupsToText(r.ingredients))}</textarea>
          </div>
          <div class="field">
            <label for="f-steps">Instructions</label>
            <p class="help">One step per line. # headings work here too.</p>
            <textarea class="textarea" id="f-steps" rows="10" placeholder="Preheat the oven to 350°F.&#10;Mix the dry ingredients…">${esc(groupsToText(r.steps))}</textarea>
          </div>
          <div class="field">
            <label for="f-tips">Tips &amp; variations <span class="help">(optional, one per line)</span></label>
            <textarea class="textarea" id="f-tips" rows="4">${esc((r.tips || []).join("\n"))}</textarea>
          </div>
          <div class="field">
            <label for="f-notes">Notes &amp; stories <span class="help">(optional, one per line)</span></label>
            <p class="help">Who recommended it, where it came from, family memories. Shown at the bottom of the recipe.</p>
            <textarea class="textarea" id="f-notes" rows="4">${esc((r.notes || []).join("\n"))}</textarea>
          </div>
          <div class="field">
            <span class="label">Photos</span>
            <div class="photos" id="f-photos"></div>
            <label class="btn" for="f-photo-input">Add photos</label>
            <input type="file" id="f-photo-input" accept="image/*" multiple hidden>
          </div>
          <p class="help">Measurements are tidied automatically when you save (for example “1 t” becomes “1 tsp” and “2 c” becomes “2 cups”).</p>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary" id="save">${existing ? "Save changes" : "Save recipe"}</button>
            <a class="btn btn-quiet" href="${existing ? `#/r/${encodeURIComponent(existing.slug)}` : "#/"}">Cancel</a>
            <span class="spacer"></span>
            ${existing ? `<button type="button" class="btn btn-danger" id="delete">Delete recipe</button>` : ""}
          </div>
        </form>
      </div>`;

    const $ = (sel) => app.querySelector(sel);
    const showError = (where, msg) => { $(where).innerHTML = msg ? `<div class="error">${esc(msg)}</div>` : ""; };

    function wireToken() {
      const forget = $("#forget-token");
      if (forget) forget.addEventListener("click", () => { setToken("", false); connected = null; $("#token-slot").innerHTML = tokenPanel(null); wireToken(); });
      const connect = $("#connect");
      if (!connect) return;
      const tryConnect = async () => {
        const token = $("#token").value.trim();
        if (!token) return;
        connect.disabled = true;
        setToken(token, $("#remember").checked);
        try {
          connected = await checkAccess();
          $("#token-slot").innerHTML = tokenPanel(connected);
          wireToken();
        } catch (e) {
          setToken("", false);
          showError("#token-error", e.status === 401 ? "That token wasn't accepted. Check that you copied all of it." : e.message);
          connect.disabled = false;
        }
      };
      connect.addEventListener("click", tryConnect);
      $("#token").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); tryConnect(); } });
    }
    wireToken();

    app.querySelectorAll("[data-person], [data-cat]").forEach((b) => b.addEventListener("click", () => {
      b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true");
    }));

    function drawPhotos() {
      $("#f-photos").innerHTML = photos.map((p, i) => `
        <div class="photo">
          <img src="${esc(p.dataUrl || p.src)}" alt="">
          ${i === 0 ? `<span class="badge">Main photo</span>` : ""}
          <div class="photo-actions">
            ${i > 0 ? `<button type="button" data-main="${i}" title="Make main photo" aria-label="Make main photo">★</button>` : ""}
            <button type="button" data-remove="${i}" title="Remove photo" aria-label="Remove photo">✕</button>
          </div>
        </div>`).join("");
      app.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", () => { photos.splice(+b.dataset.remove, 1); drawPhotos(); }));
      app.querySelectorAll("[data-main]").forEach((b) => b.addEventListener("click", () => { photos.unshift(...photos.splice(+b.dataset.main, 1)); drawPhotos(); }));
    }
    drawPhotos();
    $("#f-photo-input").addEventListener("change", async (e) => {
      for (const file of e.target.files) {
        try { photos.push(await resizePhoto(file)); } catch (err) { toast(err.message); }
      }
      e.target.value = "";
      drawPhotos();
    });

    $("#recipe-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      showError("#form-error", "");
      if (!connected) { showError("#form-error", "Paste your access token above before saving."); $("#token-slot").scrollIntoView({ behavior: "smooth" }); return; }
      const title = $("#f-title").value.trim();
      const ingredients = textToGroups($("#f-ingredients").value, true);
      const steps = textToGroups($("#f-steps").value, true);
      if (!title) return showError("#form-error", "Give the recipe a name.");
      if (!ingredients.length && !steps.length) return showError("#form-error", "Add ingredients or instructions.");

      const from = [
        ...[...app.querySelectorAll("[data-person][aria-pressed=true]")].map((b) => b.dataset.person),
        ...$("#f-people-other").value.split(",").map((s) => s.trim()).filter(Boolean),
      ];
      const categories = [...app.querySelectorAll("[data-cat][aria-pressed=true]")].map((b) => b.dataset.cat);
      const now = new Date();
      const stamp = now.toISOString();
      let slugBase = existing ? existing.slug : slugify(title);

      const save = $("#save");
      save.disabled = true;
      save.textContent = "Saving…";
      try {
        const newPhotos = photos.filter((p) => !p.existing).map((p, i) => ({ ...p, path: `images/${slugBase}-${now.getTime()}-${i + 1}.jpg` }));
        const removed = existing ? (existing.images || []).filter((img) => !photos.some((p) => p.existing && p.src === img.src)).map((img) => img.src) : [];
        const recipe = {
          slug: slugBase,
          title,
          from,
          postedBy: existing ? existing.postedBy : connected.login || "",
          date: existing ? existing.date : stamp.slice(0, 10),
          updated: stamp,
          categories,
          makes: $("#f-makes").value.trim(),
          ingredients,
          steps,
          tips: linesToList($("#f-tips").value, true),
          notes: linesToList($("#f-notes").value, false),
          images: photos.map((p) => (p.existing ? { src: p.src, w: p.w, h: p.h } : { src: newPhotos.find((n) => n.dataUrl === p.dataUrl).path, w: p.w, h: p.h })),
          original: existing ? existing.original || "" : "",
        };
        const saved = await commitRecipes({
          message: `${existing ? "Update" : "Add"} recipe: ${title}`,
          photos: newPhotos,
          remove: removed.filter((src) => !DATA.recipes.some((o) => o.slug !== slugBase && (o.images || []).some((i) => i.src === src))),
          mutate(data) {
            const list = data.recipes;
            if (existing) {
              const idx = list.findIndex((x) => x.slug === existing.slug);
              if (idx === -1) list.unshift(recipe); else list[idx] = recipe;
            } else {
              let s = recipe.slug, n = 2;
              while (list.some((x) => x.slug === s)) s = `${recipe.slug}-${n++}`;
              recipe.slug = s;
              list.unshift(recipe);
            }
            return recipe;
          },
        });
        const pending = store.get(PENDING_KEY, {});
        pending[saved.slug] = { recipe: saved, savedAt: Date.now() };
        store.set(PENDING_KEY, pending);
        DATA.recipes = [saved, ...DATA.recipes.filter((x) => x.slug !== saved.slug)];
        indexRecipes();
        location.assign(`#/r/${encodeURIComponent(saved.slug)}`);
        toast("Saved! Everyone else will see it in a minute or two, once GitHub Pages updates.", 6000);
      } catch (err) {
        showError("#form-error", `Couldn't save: ${err.message}`);
        save.disabled = false;
        save.textContent = existing ? "Save changes" : "Save recipe";
      }
    });

    const del = $("#delete");
    if (del) del.addEventListener("click", async () => {
      if (!connected) { showError("#form-error", "Paste your access token above before deleting."); return; }
      if (!confirm(`Delete “${existing.title}”? This removes it from the site for everyone.`)) return;
      del.disabled = true;
      try {
        await commitRecipes({
          message: `Delete recipe: ${existing.title}`,
          remove: (existing.images || []).map((i) => i.src).filter((src) => !DATA.recipes.some((o) => o.slug !== existing.slug && (o.images || []).some((i) => i.src === src))),
          mutate(data) { data.recipes = data.recipes.filter((x) => x.slug !== existing.slug); },
        });
        const pending = store.get(PENDING_KEY, {});
        pending[existing.slug] = { deleted: true, savedAt: Date.now() };
        store.set(PENDING_KEY, pending);
        DATA.recipes = DATA.recipes.filter((x) => x.slug !== existing.slug);
        indexRecipes();
        location.assign("#/");
        toast("Recipe deleted.");
      } catch (err) {
        showError("#form-error", `Couldn't delete: ${err.message}`);
        del.disabled = false;
      }
    });
  }

  /* ---------- start ---------- */

  document.getElementById("brand-name").textContent = CONFIG.title;
  window.addEventListener("hashchange", () => { route(); if (!parseHash().parts.length) return; window.scrollTo(0, 0); });
  loadData().then(route).catch((e) => {
    app.innerHTML = `<div class="empty"><h2>Something went wrong</h2><p>${esc(e.message)}</p></div>`;
  });
})();
