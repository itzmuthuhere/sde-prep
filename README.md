# sde-prep

**Live:** https://sde-prep-six.vercel.app — auto-deploys from `main`.

A self-contained study site for a Java-backend SDE interview prep run — one
roadmap, one page per subject, and a checklist that remembers what you've
finished. Everything is static HTML/CSS/JS; your progress lives in
`localStorage` and never leaves the browser.

## Local preview

Any static file server works. With Node installed:

```bash
npm run dev
# → http://localhost:5173
```

## Build / validate

```bash
npm run build
```

`build.mjs` has no dependencies. It:

1. Regenerates **`content-index.js`** from each page's `Tracker.registerTopics(...)`
   call. That file is the single source of truth for the homepage progress
   dashboard totals and the <kbd>Cmd/Ctrl</kbd>+<kbd>K</kbd> command palette.
2. Validates the site and **exits non-zero** on any error: missing nav links,
   tracker groups with no mount element, broken internal links / anchors,
   page-id mismatches, pages missing from `index.html`'s `PAGES` array.

`content-index.js` is committed so the site also works as plain static files
with no build step.

## Features

- **Progress dashboard** (`index.html`) — sums every page's checklist state,
  including pages this browser has never opened, from `content-index.js`.
- **Command palette** — <kbd>Cmd/Ctrl</kbd>+<kbd>K</kbd> (or `/`, or the Search
  button) searches page titles, topic names and every checklist item.
- **Dark / light theme** — toggled in the top bar, persisted per browser.
- **Responsive** — the nav collapses behind a hamburger below 900px.

## Deploy (Vercel)

No environment variables are required. `vercel.json` sets
`buildCommand: npm run build` and `outputDirectory: "."` (the site is served
straight from the repo root). See the deploy commands below.
