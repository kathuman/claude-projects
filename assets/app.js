// ---------------------------------------------------------------------------
// Site configuration — edit these two values if you rename/move the repo.
// ---------------------------------------------------------------------------
const SITE_CONFIG = {
  githubUsername: "kathuman",
  githubRepo: "claude-projects",
};

const els = {
  grid: document.getElementById("grid"),
  search: document.getElementById("searchInput"),
  tagFilters: document.getElementById("tagFilters"),
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
  if (saved === "light" || saved === "dark") {
    document.documentElement.setAttribute("data-theme", saved);
  }
})();

els.themeToggle.addEventListener("click", () => {
  const root = document.documentElement;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const current = root.getAttribute("data-theme") || (prefersDark ? "dark" : "light");
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
  const items = [
    { num: allProjects.length, label: "projects" },
    { num: tagCount, label: "tags" },
  ];
  for (const item of items) {
    const div = document.createElement("div");
    div.className = "stat";
    div.innerHTML = `<span class="stat-num">${item.num}</span><span class="stat-label">${item.label}</span>`;
    els.stats.appendChild(div);
  }
}

function renderTagFilters() {
  const tags = Array.from(new Set(allProjects.flatMap((p) => p.tags || []))).sort();
  els.tagFilters.innerHTML = "";

  const allChip = makeTagChip("All", null);
  els.tagFilters.appendChild(allChip);

  for (const tag of tags) {
    els.tagFilters.appendChild(makeTagChip(tag, tag));
  }
}

function makeTagChip(label, tagValue) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "tag-chip" + (activeTag === tagValue ? " active" : "");
  btn.textContent = label;
  btn.addEventListener("click", () => {
    activeTag = activeTag === tagValue ? null : tagValue;
    renderTagFilters();
    renderGrid();
  });
  return btn;
}

function renderGrid() {
  const query = els.search.value.trim().toLowerCase();

  const filtered = allProjects.filter((p) => {
    const matchesTag = !activeTag || (p.tags || []).includes(activeTag);
    const haystack = `${p.title} ${p.description} ${(p.tags || []).join(" ")}`.toLowerCase();
    const matchesQuery = !query || haystack.includes(query);
    return matchesTag && matchesQuery;
  });

  els.grid.innerHTML = "";
  els.empty.hidden = filtered.length !== 0;

  for (const project of filtered) {
    els.grid.appendChild(buildCard(project));
  }
}

function buildCard(project) {
  const node = els.template.content.cloneNode(true);

  node.querySelector(".card-title").textContent = project.title || "Untitled project";
  node.querySelector(".card-date").textContent = formatDate(project.date);
  node.querySelector(".card-desc").textContent = project.description || "";

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

  return node;
}

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
