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
- **Activity heatmap + streak** (`activity.js`) — a GitHub-style calendar
  heatmap of the last 6 months plus a current-streak counter, prominent on
  the homepage. Logs one event per local day whenever you check a checklist
  item, or a quiz/mock-test/AI-interview result is saved. See "Data
  contracts" below.
- **Command palette** — <kbd>Cmd/Ctrl</kbd>+<kbd>K</kbd> (or `/`, or the Search
  button) searches page titles, topic names and every checklist item.
- **Dark / light theme** — toggled in the top bar, persisted per browser.
- **Responsive** — the nav collapses behind a hamburger below 900px.

## Data contracts (for future prompts)

`index.html`'s **"Focus This Week"** widget (`focus.js`) reads localStorage
data it does not write. That data is expected to come from four other
features, each of which **owns one localStorage key** and must write to it
independently:

| Feature | Prompt | localStorage key |
|---|---|---|
| Quiz engine | 28 | `sdeprep:v1:quiz:results` |
| Review queue | 29 | `sdeprep:v1:review:queue` |
| Mock tests | 30 | `sdeprep:v1:mocktest:results` |
| AI interview scorer | 36 | `sdeprep:v1:interview:scorecards` |

All four keys live under the same `sdeprep:v1:` namespace `tracker.js`
already uses. `focus.js` tolerates a missing or malformed key, so the widget
just shows its empty state until a feature below actually exists — but when
you build one of them, write to the exact shape here or the widget won't
pick it up.

`activity.js` (the homepage heatmap/streak) also watches the quiz, mock-test
and AI-interview keys — it patches `localStorage.setItem` and logs an
activity event for today on any write to one of those three keys, so once
you build one of these features it starts feeding the heatmap automatically
with no extra call required. The one exception is the checklist: since
"checking an item" and "unchecking an item" both write the same
`sdeprep:v1:checks:*` key, `tracker.js` calls `Activity.log("checklist")`
explicitly on check (not uncheck) rather than relying on the generic
watcher.

**1) `sdeprep:v1:quiz:results`** — object keyed by `quizId`

```js
{ [quizId]: {
    title:  string,            // "Dynamic Programming Quiz"
    topic:  string,            // canonical label, used to merge with
                                // mock-test / interview signals
    pageId: string,            // matches an id in index.html's PAGES array
    anchor: string,            // in-page anchor on that page
    attempts: [ { score: number, total: number, ts: number } ]
                                // last element = most recent attempt
} }
```

**2) `sdeprep:v1:review:queue`** — object keyed by `cardId`

```js
{ [cardId]: {
    label:  string,            // topic/pattern label
    pageId: string,
    anchor: string,
    history: Array<"shaky" | "got-it">   // oldest first
} }
```

**3) `sdeprep:v1:mocktest:results`** — array, one entry per mock test sat

```js
[ { id: string, title: string, ts: number,
    topics: [ { topic: string, score: number, total: number,
                pageId: string, anchor: string } ]
} ]
```

**4) `sdeprep:v1:interview:scorecards`** — array, one entry per AI interview

```js
[ { id: string, title: string, ts: number,
    criteria: [ { skill: string, score: number, max: number,
                  pageId: string, anchor: string } ]
} ]
```

## Deploy (Vercel)

No environment variables are required. `vercel.json` sets
`buildCommand: npm run build` and `outputDirectory: "."` (the site is served
straight from the repo root). See the deploy commands below.
