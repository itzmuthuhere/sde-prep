/* ============================================================
   build.mjs — zero-dependency build + validate for sde-prep
   ------------------------------------------------------------
   What it does:
     1. Parses every *.html page's Tracker.registerTopics(...) call
        and regenerates content-index.js (window.SDE_CONTENT) — the
        single static source of truth for the homepage dashboard
        totals and the Cmd/Ctrl+K command palette.
     2. Validates the site:
          - every built page in index.html's PAGES array exists
          - every page links to every other built page in its <nav>
          - every registered tracker group has a matching mount <div>
          - every internal href / #anchor resolves
          - the page id in registerTopics matches its filename
     Exits non-zero on any error so `npm run build` fails loudly.
     Warnings (thin content heuristics) do not fail the build.
   ============================================================ */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));
const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

const htmlFiles = readdirSync(ROOT).filter((f) => f.endsWith(".html")).sort();

/* ---------- slug: must match tracker.js exactly ---------- */
const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

/* ---------- extract a balanced (...) call argument list ---------- */
function extractCall(src, marker) {
  const start = src.indexOf(marker);
  if (start === -1) return null;
  let i = start + marker.length - 1; // points at "("
  let depth = 0;
  let inStr = null;
  let out = "";
  for (; i < src.length; i++) {
    const c = src[i];
    out += c;
    if (inStr) {
      if (c === "\\") {
        out += src[++i];
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") inStr = c;
    else if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) break;
    }
  }
  return out; // "( ... )"
}

/* ---------- per-page parse ---------- */
const pages = [];

for (const file of htmlFiles) {
  if (file === "index.html") continue;
  const src = readFileSync(join(ROOT, file), "utf8");
  const id = file.replace(/\.html$/, "");

  const titleMatch = src.match(/<title>([^<]*)<\/title>/i);
  const docTitle = titleMatch ? titleMatch[1].trim() : id;
  const h1Match = src.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const h1 = h1Match ? h1Match[1].replace(/<[^>]+>/g, "").trim() : docTitle;

  const call = extractCall(src, "Tracker.registerTopics(");
  if (!call) {
    warn(`${file}: no Tracker.registerTopics call found`);
    continue;
  }

  let parsed;
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      "return (function(){ let pageId,topics,opts;\n" +
        "const Tracker={registerTopics:function(a,b,c){pageId=a;topics=b;opts=c||{};}};\n" +
        "Tracker.registerTopics" +
        call +
        ";\n return {pageId,topics,opts};})();"
    );
    parsed = fn();
  } catch (e) {
    err(`${file}: could not parse registerTopics call — ${e.message}`);
    continue;
  }

  if (parsed.pageId !== id)
    err(`${file}: registerTopics page id "${parsed.pageId}" != filename id "${id}"`);

  // normalise flat-array form
  let groups = parsed.topics;
  if (Array.isArray(groups) && (groups.length === 0 || typeof groups[0] === "string")) {
    groups = [{ group: "Checklist", items: groups, mount: "#tracker" }];
  }

  const outGroups = groups.map((g) => {
    const gslug = slug(g.group || "items");
    const mount = g.mount || "#t-" + gslug;
    // validate the mount element exists
    const mid = mount.replace(/^#/, "");
    const hasMount = new RegExp(`id=["']${mid}["']`).test(src);
    if (!hasMount) err(`${file}: tracker group "${g.group}" mounts at ${mount} but no element has id="${mid}"`);
    return {
      group: g.group || "Items",
      slug: gslug,
      mount,
      items: (g.items || []).map((it) => ({ label: it, slug: slug(it) })),
    };
  });

  const itemCount = outGroups.reduce((n, g) => n + g.items.length, 0);

  pages.push({
    id,
    file,
    title: (parsed.opts && parsed.opts.pageTitle) || h1 || docTitle,
    h1,
    groups: outGroups,
    itemCount,
  });
}

/* ---------- cross-check against index.html PAGES ---------- */
const indexSrc = readFileSync(join(ROOT, "index.html"), "utf8");
const pagesArrRaw = extractCall("x" + indexSrc.slice(indexSrc.indexOf("var PAGES")), "=");
let indexPages = [];
try {
  const arrText = indexSrc.slice(indexSrc.indexOf("var PAGES"));
  const arrStart = arrText.indexOf("[");
  let depth = 0,
    end = -1,
    inStr = null;
  for (let i = arrStart; i < arrText.length; i++) {
    const c = arrText[i];
    if (inStr) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") inStr = c;
    else if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  // eslint-disable-next-line no-new-func
  indexPages = new Function("return " + arrText.slice(arrStart, end + 1))();
} catch (e) {
  err(`index.html: could not parse PAGES array — ${e.message}`);
}

const builtIds = new Set(indexPages.filter((p) => p.built).map((p) => p.id));

for (const p of indexPages) {
  if (p.built && !htmlFiles.includes(p.file))
    err(`index.html PAGES: built page "${p.id}" -> ${p.file} does not exist`);
}
for (const p of pages) {
  if (!indexPages.some((ip) => ip.id === p.id))
    warn(`${p.file}: page id "${p.id}" is not listed in index.html PAGES array`);
}

/* ---------- nav completeness: every page links every built page ---------- */
const allLinkTargets = [
  "index.html",
  ...indexPages.filter((p) => p.built).map((p) => p.file),
];
for (const file of htmlFiles) {
  const src = readFileSync(join(ROOT, file), "utf8");
  const navMatch = src.match(/<nav[^>]*>([\s\S]*?)<\/nav>/i);
  if (file !== "index.html") {
    if (!navMatch) {
      err(`${file}: no <nav> block`);
      continue;
    }
    const hrefs = [...navMatch[1].matchAll(/href=["']([^"']+)["']/g)].map((m) => m[1]);
    for (const t of allLinkTargets) {
      if (!hrefs.includes(t)) err(`${file}: <nav> is missing a link to ${t}`);
    }
  }
}

/* ---------- internal link + anchor resolution ---------- */
for (const file of htmlFiles) {
  const src = readFileSync(join(ROOT, file), "utf8");
  const ids = new Set([...src.matchAll(/id=["']([^"']+)["']/g)].map((m) => m[1]));
  const hrefs = [...src.matchAll(/href=["']([^"']+)["']/g)].map((m) => m[1]);
  for (const h of hrefs) {
    if (/^(https?:|mailto:|tel:|data:)/.test(h)) continue;
    const [path, anchor] = h.split("#");
    if (path && path !== file && !path.startsWith("/")) {
      if (path.endsWith(".html") && !htmlFiles.includes(path))
        err(`${file}: link to missing local file ${path}`);
    }
    if (anchor && (!path || path === file)) {
      if (!ids.has(anchor)) err(`${file}: in-page anchor #${anchor} has no target`);
    }
  }
}

/* ---------- thin-content heuristic (warnings only) ---------- */
for (const file of htmlFiles) {
  if (file === "index.html" || file === "roadmap.html") continue;
  const src = readFileSync(join(ROOT, file), "utf8");
  const sections = [...src.matchAll(/<section[^>]*class="[^"]*topic[^"]*"[^>]*>([\s\S]*?)<\/section>/g)];
  for (const s of sections) {
    const body = s[1];
    const text = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const idm = s[0].match(/id=["']([^"']+)["']/);
    const sid = idm ? idm[1] : "?";
    const paras = (body.match(/<p[\s>]/g) || []).length;
    const rich = /<pre[\s>]|<table[\s>]|class="[^"]*\bbox\b/.test(body);
    // Flag only sections that are genuinely under-written: little prose AND
    // none of the usual supporting elements (code, table, callout).
    if (text.length < 600 && !rich)
      warn(`${file} #${sid}: thin — ${text.length} chars of text, ${paras} <p>, no code/table/box`);
  }
}

/* ---------- write content-index.js ---------- */
const indexData = pages
  .filter((p) => builtIds.size === 0 || builtIds.has(p.id))
  .map((p) => ({
    id: p.id,
    file: p.file,
    title: p.title,
    groups: p.groups.map((g) => ({
      group: g.group,
      slug: g.slug,
      mount: g.mount,
      items: g.items.map((it) => it.label),
    })),
  }));

const banner =
  "/* AUTO-GENERATED by build.mjs from each page's Tracker.registerTopics call.\n" +
  "   Do not edit by hand — run `npm run build` to regenerate.\n" +
  "   Powers: homepage dashboard totals (counts every page, even unvisited)\n" +
  "   and the Cmd/Ctrl+K command palette (search.js). */\n";

writeFileSync(
  join(ROOT, "content-index.js"),
  banner +
    "window.SDE_CONTENT = " +
    JSON.stringify(indexData, null, 2) +
    ";\n",
  "utf8"
);

/* ---------- report ---------- */
const totalItems = indexData.reduce(
  (n, p) => n + p.groups.reduce((m, g) => m + g.items.length, 0),
  0
);
console.log(`content-index.js: ${indexData.length} pages, ${totalItems} checklist items`);

if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const w of warnings) console.log("  ⚠ " + w);
}
if (errors.length) {
  console.log(`\n${errors.length} error(s):`);
  for (const e of errors) console.log("  ✗ " + e);
  process.exit(1);
}
console.log("\n✓ build ok");
