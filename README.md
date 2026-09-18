# sde-prep

**Live:** https://sde-prep-six.vercel.app — auto-deploys from `main`.

A self-contained study site for a Java-backend SDE interview prep run — one
roadmap, one page per subject, and a checklist that remembers what you've
finished. The study pages are static HTML/CSS/JS; your progress lives in
`localStorage` and never leaves the browser. A small Next.js app adds a live
AI mock-interview feature on top (see below) — everything else is untouched.

## Local preview

```bash
npm install
npm run dev
# → http://localhost:3000
```

`next dev` serves the static study pages from `public/` (unchanged, at the
same paths) alongside the Next.js routes (`/settings`, `/mock-interview`,
`/api/interview`). A `predev` hook regenerates `content-index.js` first.

## Build / validate

```bash
npm run build
```

This runs, in order:

1. **`build.mjs`** (via the `prebuild` hook, no dependencies) — regenerates
   **`public/content-index.js`** from each page's `Tracker.registerTopics(...)`
   call (the source of truth for the homepage progress dashboard and the
   <kbd>Cmd/Ctrl</kbd>+<kbd>K</kbd> command palette), and validates the site:
   missing nav links, tracker groups with no mount element, broken internal
   links/anchors, page-id mismatches, pages missing from `index.html`'s
   `PAGES` array. Exits non-zero on any error.
2. **`next build`** — compiles the mock-interview app.

`public/content-index.js` is committed so the static pages also work served
as plain files with no build step.

## Features

### Study site (static)

- **Progress dashboard** (`public/index.html`) — sums every page's checklist
  state, including pages this browser has never opened, from `content-index.js`.
- **Command palette** — <kbd>Cmd/Ctrl</kbd>+<kbd>K</kbd> (or `/`, or the Search
  button) searches page titles, topic names and every checklist item.
- **Dark / light theme** — toggled in the top bar, persisted per browser.
- **Responsive** — the nav collapses behind a hamburger below 900px.

### AI Mock Interview (Next.js)

- **`/settings`** — paste your own Anthropic API key. It's stored only in
  this browser's `localStorage` and sent only to this app's own
  `/api/interview` route, which forwards it to Anthropic for a single
  request and never logs or persists it. Using the feature incurs small
  pay-as-you-go costs on your own Anthropic account.
- **`/api/interview`** — server-side proxy to the Anthropic Messages API,
  streaming responses back to the client to avoid CORS and keep the key
  out of client-side network logs to third parties.
- **`/mock-interview`** — pick DSA, LLD, HLD, or Behavioral and a difficulty;
  a live AI interviewer presents one problem, waits for your approach before
  hinting, pushes back on suboptimal solutions, and asks realistic follow-ups.
  "Finish Interview" produces a structured hire/lean-hire/no-hire scorecard,
  saved with a timestamp to `localStorage` — the homepage shows your history
  and trend over time.

## Deploy (Vercel)

No environment variables are required (each visitor supplies their own
Anthropic key client-side). `vercel.json` sets `buildCommand: npm run build`;
Vercel auto-detects the Next.js framework and serves `public/` files,
the static-generated pages, and the `/api/interview` route together.
