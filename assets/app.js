// ---------------------------------------------------------------------------
// Site configuration — edit these two values if you rename/move the repo.
// ---------------------------------------------------------------------------
const SITE_CONFIG = {
  githubUsername: "kathuman",
  githubRepo: "claude-projects",
};

const els = {
  grid: document.getElementById("grid"),
  earlyGrid: document.getElementById("earlyGrid"),
  earlySection: document.getElementById("earlySection"),
  flagshipGrid: document.getElementById("flagshipGrid"),
  flagshipSection: document.getElementById("flagshipSection"),
  labHead: document.getElementById("labHead"),
  search: document.getElementById("searchInput"),
  tagFilter: document.getElementById("tagFilter"),
  stats: document.getElementById("stats"),
  empty: document.getElementById("emptyState"),
  template: document.getElementById("cardTemplate"),
  themeToggle: document.getElementById("themeToggle"),
  ghProfileLink: document.getElementById("ghProfileLink"),
  ghProfileHandle: document.getElementById("ghProfileHandle"),
  repoLink: document.getElementById("repoLink"),
};

let allProjects = [];
let activeTag = null;

// disciplines, in the order of the filter tiles; each tile shows a small screenshot of one example project.
// A project's "discipline" in projects.json is one of these ids; without one it counts as "other".
const DISCIPLINES = [
  { id: "supply-chain", label: "Supply chain", img: "assets/cat/supply-chain.webp", example: "Global Disruption Atlas" },
  { id: "mechanical", label: "Mechanical engineering", img: "assets/cat/mechanical.webp", example: "Turbine Lab" },
  { id: "other", label: "Others", img: "assets/cat/other.webp", example: "Epicycles" },
];
let activeCat = (() => {
  try { const c = new URLSearchParams(location.search).get("cat"); return DISCIPLINES.some((d) => d.id === c) ? c : null; } catch (e) { return null; }
})();
els.cats = document.getElementById("cats");
function disciplineOf(p) { return DISCIPLINES.some((d) => d.id === p.discipline) ? p.discipline : "other"; }

// ---------------------------------------------------------------------------
// Wire up static config-driven links
// ---------------------------------------------------------------------------
els.ghProfileLink.href = `https://github.com/${SITE_CONFIG.githubUsername}`;
els.ghProfileHandle.textContent = `@${SITE_CONFIG.githubUsername}`;
els.repoLink.href = `https://github.com/${SITE_CONFIG.githubUsername}/${SITE_CONFIG.githubRepo}`;

// ---------------------------------------------------------------------------
// Theme toggle (persisted per-browser via localStorage)
// ---------------------------------------------------------------------------
(function initTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem("theme");
  } catch (e) {
    /* localStorage unavailable — fall back to system preference */
  }
  // dark (the Cobot Lab blueprint look) unless light was chosen
  document.documentElement.setAttribute("data-theme", saved === "light" ? "light" : "dark");
})();

els.themeToggle.addEventListener("click", () => {
  const root = document.documentElement;
  const current = root.getAttribute("data-theme") || "dark";
  const next = current === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", next);
  try {
    localStorage.setItem("theme", next);
  } catch (e) {
    /* ignore — theme just won't persist across visits */
  }
});

// ---------------------------------------------------------------------------
// Load projects.json and render
// ---------------------------------------------------------------------------
fetch("projects.json", { cache: "no-store" })
  .then((res) => {
    if (!res.ok) throw new Error(`Failed to load projects.json (${res.status})`);
    return res.json();
  })
  .then((data) => {
    allProjects = (data || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    renderStats();
    renderCats();
    renderTagFilters();
    renderGrid();
  })
  .catch((err) => {
    els.grid.innerHTML = `<p class="empty-state">Couldn't load projects.json: ${escapeHtml(err.message)}</p>`;
    console.error(err);
  });

function renderStats() {
  const tagCount = new Set(allProjects.flatMap((p) => p.tags || [])).size;
  els.stats.innerHTML = "";
  const early = allProjects.filter(isEarly).length;
  const items = [
    { num: allProjects.length - early, label: "projects" },
    { num: allProjects.filter(isFlagship).length, label: "flagships" },
    { num: early, label: "in early development" },
    { num: tagCount, label: "tags" },
  ];
  for (const item of items) {
    const div = document.createElement("div");
    div.className = "stat";
    div.innerHTML = `<span class="stat-num">${item.num}</span><span class="stat-label">${item.label}</span>`;
    els.stats.appendChild(div);
  }
}

// the discipline tiles: All, then each discipline with its example picture and the number of projects
function renderCats() {
  const count = (id) => allProjects.filter((p) => disciplineOf(p) === id).length;
  const tile = (id, label, img, example, n) =>
    `<button type="button" class="cat${img ? "" : " cat-all"}" data-cat="${id}" aria-pressed="${(activeCat || "") === id}">` +
    (img ? `<img src="${img}" alt="" width="96" height="60" title="Example: ${escapeHtml(example)}">` : `<span class="cat-all-mark" aria-hidden="true">✳</span>`) +
    `<span class="cat-label">${escapeHtml(label)}</span><span class="cat-n">${n}</span></button>`;
  els.cats.innerHTML = tile("", "All", null, null, allProjects.length) +
    DISCIPLINES.map((d) => tile(d.id, d.label, d.img, d.example, count(d.id))).join("");
}
els.cats.addEventListener("click", (e) => {
  const b = e.target.closest(".cat"); if (!b) return;
  activeCat = b.dataset.cat || null;
  for (const t of els.cats.querySelectorAll(".cat")) t.setAttribute("aria-pressed", String((activeCat || "") === t.dataset.cat));
  try {
    const q = new URLSearchParams(location.search);
    if (activeCat) q.set("cat", activeCat); else q.delete("cat");
    history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : "") + location.hash);
  } catch (err) { /* the filter still works without the address */ }
  renderGrid();
});

// one dropdown: "All tags", then every tag in alphabetical order with the number of projects carrying it
function renderTagFilters() {
  const counts = new Map();
  for (const p of allProjects) for (const tag of p.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
  const tags = Array.from(counts.keys()).sort();
  els.tagFilter.innerHTML = "";

  els.tagFilter.appendChild(new Option(`All tags (${allProjects.length})`, ""));
  for (const tag of tags) els.tagFilter.appendChild(new Option(`${tag} (${counts.get(tag)})`, tag));
  els.tagFilter.value = activeTag || "";
}

function renderGrid() {
  const query = els.search.value.trim().toLowerCase();

  const filtered = allProjects.filter((p) => {
    const matchesTag = !activeTag || (p.tags || []).includes(activeTag);
    if (activeCat && disciplineOf(p) !== activeCat) return false;
    const haystack = `${p.title} ${p.description} ${(p.tags || []).join(" ")}`.toLowerCase();
    const matchesQuery = !query || haystack.includes(query);
    return matchesTag && matchesQuery;
  });

  // flagships first (in their "flagship" order), then the lab; early development gets its own section below
  els.grid.innerHTML = "";
  els.earlyGrid.innerHTML = "";
  els.flagshipGrid.innerHTML = "";
  els.empty.hidden = filtered.length !== 0;
  const early = filtered.filter(isEarly);
  const flagships = filtered.filter(isFlagship).sort((a, b) => a.flagship - b.flagship);
  const lab = filtered.filter((p) => !isEarly(p) && !isFlagship(p));
  for (const project of flagships) els.flagshipGrid.appendChild(buildCard(project));
  els.flagshipSection.hidden = flagships.length === 0;
  els.labHead.hidden = flagships.length === 0 || lab.length === 0;
  for (const project of lab) els.grid.appendChild(buildCard(project));
  for (const project of early) els.earlyGrid.appendChild(buildCard(project));
  els.earlySection.hidden = early.length === 0;
  updateMoreButtons();
}

function isEarly(p) { return p.status === "early"; }
function isFlagship(p) { return typeof p.flagship === "number" && !isEarly(p); }

function buildCard(project) {
  const node = els.template.content.cloneNode(true);

  node.querySelector(".card-title").textContent = project.title || "Untitled project";
  if (project.thumb) {
    const img = node.querySelector(".card-thumb");
    img.src = project.thumb;
    img.hidden = false;
  }
  node.querySelector(".card-date").textContent = formatDate(project.date);
  node.querySelector(".card-desc").textContent = project.description || "";
  if (isEarly(project)) {
    const badge = document.createElement("span");
    badge.className = "badge-early";
    badge.textContent = "Early development";
    node.querySelector(".card-top").after(badge);
  }

  const tagsEl = node.querySelector(".card-tags");
  for (const tag of project.tags || []) {
    const span = document.createElement("span");
    span.textContent = tag;
    tagsEl.appendChild(span);
  }

  const linksEl = node.querySelector(".card-links");
  const linkDefs = [
    { key: "repoUrl", label: "Repo ↗" },
    { key: "demoUrl", label: "Live demo ↗" },
  ];
  let hasLink = false;
  for (const { key, label } of linkDefs) {
    if (project[key]) {
      hasLink = true;
      const a = document.createElement("a");
      a.href = project[key];
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = label;
      linksEl.appendChild(a);
    }
  }
  if (!hasLink) {
    const span = document.createElement("span");
    span.className = "no-link";
    span.textContent = "Local project — not yet published";
    linksEl.appendChild(span);
  }

  // the whole card opens the project (live demo, else the repo); links and buttons inside keep their own action
  const card = node.querySelector(".card");
  const href = project.demoUrl || project.repoUrl;
  if (href) {
    card.dataset.href = href;
    card.tabIndex = 0;
    card.setAttribute("role", "link");
    card.setAttribute("aria-label", `Open ${project.title || "project"}`);
    card.addEventListener("click", (e) => {
      if (e.target.closest("a, button")) return;
      if (window.getSelection && String(window.getSelection())) return;   // selecting text, not choosing
      window.open(href, "_blank", "noopener");
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target === card) window.open(href, "_blank", "noopener");
    });
  }

  // "More" / "Less" for descriptions longer than the first few lines
  const more = node.querySelector(".card-more");
  more.addEventListener("click", () => {
    const open = card.classList.toggle("expanded");
    more.textContent = open ? "Less" : "More";
    more.setAttribute("aria-expanded", String(open));
  });

  return node;
}

// show "More" only where the description is actually cut off (re-checked when the layout changes)
function updateMoreButtons() {
  for (const card of document.querySelectorAll(".grid .card")) {
    if (card.classList.contains("expanded")) continue;
    const desc = card.querySelector(".card-desc");
    card.querySelector(".card-more").hidden = desc.scrollHeight <= desc.clientHeight + 1;
  }
}
window.addEventListener("resize", updateMoreButtons);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(updateMoreButtons);

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

els.search.addEventListener("input", renderGrid);
els.tagFilter.addEventListener("change", () => {
  activeTag = els.tagFilter.value || null;
  renderGrid();
});
