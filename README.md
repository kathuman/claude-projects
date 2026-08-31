# Claude Projects

A small static site that gathers the projects I build with [Claude](https://claude.com) into one browsable page — searchable, filterable by tag, light/dark theme.

**Live site (after publishing):** `https://kathuman.github.io/claude-projects/`

## Adding a new project

Open [`projects.json`](projects.json) and add an entry to the array:

```json
{
  "title": "Project Name",
  "description": "One or two sentences on what it does.",
  "date": "2026-08-31",
  "tags": ["python", "cli"],
  "repoUrl": "https://github.com/kathuman/project-repo",
  "demoUrl": "https://kathuman.github.io/project-repo/"
}
```

Notes:
- `date` uses `YYYY-MM-DD` — the list is sorted newest first.
- `tags` populates the filter chips automatically; use whatever lowercase words make sense.
- `repoUrl` and `demoUrl` are both optional — set either to `null` (or omit it) if it doesn't apply yet. A card with neither shows a "not yet published" badge instead of dead links.

Commit and push — GitHub Pages redeploys automatically within a minute or two.

```bash
git add projects.json
git commit -m "Add <project name>"
git push
```

## Publishing this site (one-time setup)

This repo was prepared locally and hasn't been pushed yet. To publish it:

1. Create a new **public** repo on GitHub named `claude-projects` (or any name — update `githubRepo` in [`assets/app.js`](assets/app.js) if you pick something else).
2. Point this local repo at it and push:
   ```bash
   git remote add origin https://github.com/kathuman/claude-projects.git
   git branch -M main
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`. Save.
4. After a minute, the site is live at `https://kathuman.github.io/claude-projects/`.

If you'd rather this be your main personal site (served at the bare `https://kathuman.github.io/`), rename the GitHub repo to exactly `kathuman.github.io` instead — Pages serves that special repo name at the root domain with no `/claude-projects/` path segment.

## Local preview

Any static file server works, e.g.:

```bash
python -m http.server 8000
```

then open `http://localhost:8000`.

## Structure

```
index.html        — page markup
assets/style.css  — styling (light + dark themes)
assets/app.js     — loads projects.json, search/filter/theme logic
projects.json     — the actual project data — edit this to add projects
```

## Sub-apps

Some projects are self-contained web apps that live in their own folder here and
are served straight from GitHub Pages:

```
scientific-calculator/index.html   — https://kathuman.github.io/claude-projects/scientific-calculator/
rubiks-cube/index.html             — https://kathuman.github.io/claude-projects/rubiks-cube/
```

Sub-apps may vendor third-party code under `<folder>/vendor/` (kept in-repo so the
app has no runtime CDN dependency); the licence sits beside it.

To add one, drop a folder with an `index.html` at the repo root and point the
project's `demoUrl` at `https://kathuman.github.io/claude-projects/<folder>/`.
