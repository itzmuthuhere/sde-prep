/* ============================================================
   tracker.js — localStorage-backed checklist + progress module
   ------------------------------------------------------------
   Usage on a content page:

     Tracker.registerTopics("phase0-fundamentals", [
       { group: "Loops", mount: "#t-loops", items: ["Factorial of N", "Sum of digits"] },
       { group: "Functions", mount: "#t-fns", items: ["power(a,b) recursive"] }
     ], { pageTitle: "Phase 0: Fundamentals" });

   Or the simple form (single flat list, mounts into #tracker):

     Tracker.registerTopics("some-page", ["Item A", "Item B", "Item C"]);

   The homepage dashboard uses:
     Tracker.summaryByPage()   -> { pageId: {pageTitle, total, done, pct} }
     Tracker.overall()         -> { total, done, pct }

   Theme:
     Tracker.initTheme()       -> wires up any [data-theme-toggle] button
     Tracker.toggleTheme()
   ============================================================ */

(function (global) {
  "use strict";

  var NS = "sdeprep:v1:";
  var MANIFEST_KEY = NS + "manifest";
  var THEME_KEY = "sdeprep:theme";

  /* ---------- safe storage ---------- */
  function lsGet(key) {
    try { return global.localStorage.getItem(key); } catch (e) { return null; }
  }
  function lsSet(key, val) {
    try { global.localStorage.setItem(key, val); } catch (e) { /* private mode / quota */ }
  }
  function readJSON(key, fallback) {
    var raw = lsGet(key);
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }
  function writeJSON(key, obj) { lsSet(key, JSON.stringify(obj)); }

  /* ---------- helpers ---------- */
  function slug(s) {
    return String(s).toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  }
  function pct(done, total) {
    return total === 0 ? 0 : Math.round((done / total) * 100);
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ---------- manifest ----------
     manifest[pageId] = {
       pageTitle: "…",
       groups: { groupSlug: { title, items: ["itemSlug", …], labels: {slug:label} } }
     }
     Checked state is stored separately per page:
       NS + "checks:" + pageId  ->  { itemSlug: true }
  */
  function getManifest() { return readJSON(MANIFEST_KEY, {}); }
  function setManifest(m) { writeJSON(MANIFEST_KEY, m); }

  function checksKey(pageId) { return NS + "checks:" + pageId; }
  function getChecks(pageId) { return readJSON(checksKey(pageId), {}); }
  function setChecks(pageId, obj) { writeJSON(checksKey(pageId), obj); }

  /* Record a page's topic structure into the manifest so the dashboard
     can count pages that haven't been opened in this browser yet as soon
     as they ARE opened once. (A page never opened simply reports 0 via the
     homepage's static page list.) */
  function recordManifest(pageId, pageTitle, groups) {
    var m = getManifest();
    var entry = m[pageId] || { pageTitle: pageId, groups: {} };
    if (pageTitle) entry.pageTitle = pageTitle;
    groups.forEach(function (g) {
      var gs = slug(g.group || "items");
      var labels = {};
      var itemSlugs = (g.items || []).map(function (it) {
        var s = slug(it);
        labels[s] = it;
        return s;
      });
      entry.groups[gs] = { title: g.group || "Items", items: itemSlugs, labels: labels };
    });
    m[pageId] = entry;
    setManifest(m);
  }

  /* ---------- counting ---------- */
  function countPage(pageId) {
    var m = getManifest();
    var entry = m[pageId];
    if (!entry) return { total: 0, done: 0 };
    var checks = getChecks(pageId);
    var total = 0, done = 0;
    Object.keys(entry.groups).forEach(function (gs) {
      entry.groups[gs].items.forEach(function (itemSlug) {
        total++;
        if (checks[itemSlug]) done++;
      });
    });
    return { total: total, done: done };
  }

  /* ---------- counting from the STATIC catalog (content-index.js) ----------
     summaryByPage()/overall() only see pages that have been opened in this
     browser (they read the manifest, which a page writes on load). The
     homepage dashboard needs totals for EVERY page up front, so it passes the
     build-time catalog (window.SDE_CONTENT) here. "done" still comes from the
     per-page checks in localStorage, so ticking an item on any page is
     reflected on the dashboard immediately. */
  function countPageStatic(pageId, groups) {
    var checks = getChecks(pageId);
    var total = 0, done = 0;
    (groups || []).forEach(function (g) {
      (g.items || []).forEach(function (label) {
        total++;
        if (checks[slug(label)]) done++;
      });
    });
    return { total: total, done: done };
  }

  function summaryFromCatalog(catalog) {
    var out = {};
    (catalog || []).forEach(function (p) {
      var c = countPageStatic(p.id, p.groups);
      out[p.id] = {
        pageTitle: p.title || p.id,
        total: c.total,
        done: c.done,
        pct: pct(c.done, c.total)
      };
    });
    return out;
  }

  function overallFromCatalog(catalog) {
    var s = summaryFromCatalog(catalog);
    var total = 0, done = 0;
    Object.keys(s).forEach(function (k) { total += s[k].total; done += s[k].done; });
    return { total: total, done: done, pct: pct(done, total) };
  }

  function summaryByPage() {
    var m = getManifest();
    var out = {};
    Object.keys(m).forEach(function (pageId) {
      var c = countPage(pageId);
      out[pageId] = {
        pageTitle: m[pageId].pageTitle || pageId,
        total: c.total,
        done: c.done,
        pct: pct(c.done, c.total)
      };
    });
    return out;
  }

  function overall() {
    var s = summaryByPage();
    var total = 0, done = 0;
    Object.keys(s).forEach(function (k) { total += s[k].total; done += s[k].done; });
    return { total: total, done: done, pct: pct(done, total) };
  }

  /* ---------- rendering ---------- */
  var widgets = [];      // {pageId, groupSlug, refresh}
  var mountMap = {};      // "pageId/groupSlug" -> mount selector or element

  function fireUpdate() {
    try {
      document.dispatchEvent(new CustomEvent("tracker:update", { detail: overall() }));
    } catch (e) { /* old browser */ }
  }

  function renderGroup(pageId, groupSlug) {
    var m = getManifest();
    var g = m[pageId] && m[pageId].groups[groupSlug];
    if (!g) return null;

    var mountSel = mountMap[pageId + "/" + groupSlug] || ("#t-" + groupSlug);
    var host = typeof mountSel === "string" ? document.querySelector(mountSel) : mountSel;
    if (!host) return null;

    host.innerHTML = "";
    var box = el("div", "tracker");

    var head = el("div", "tracker-head");
    head.appendChild(el("span", "t-title", g.title));
    var count = el("span", "t-count");
    head.appendChild(count);
    box.appendChild(head);

    var bar = el("div", "tracker-bar");
    var fill = el("div", "tracker-fill");
    bar.appendChild(fill);
    box.appendChild(bar);

    var list = el("ul", "tracker-list");
    g.items.forEach(function (itemSlug) {
      var li = el("li");
      var label = el("label");
      var input = el("input");
      input.type = "checkbox";
      input.dataset.item = itemSlug;
      var span = el("span", null, g.labels[itemSlug] || itemSlug);
      label.appendChild(input);
      label.appendChild(span);
      li.appendChild(label);
      list.appendChild(li);

      input.addEventListener("change", function () {
        var checks = getChecks(pageId);
        if (input.checked) checks[itemSlug] = true;
        else delete checks[itemSlug];
        setChecks(pageId, checks);
        refresh();
        fireUpdate();
      });
    });
    box.appendChild(list);
    host.appendChild(box);

    function refresh() {
      var checks = getChecks(pageId);
      var done = 0;
      list.querySelectorAll("input[type=checkbox]").forEach(function (cb) {
        var on = !!checks[cb.dataset.item];
        cb.checked = on;
        if (on) done++;
      });
      var total = g.items.length;
      count.textContent = done + " / " + total + "  ·  " + pct(done, total) + "%";
      fill.style.width = pct(done, total) + "%";
    }

    refresh();
    return refresh;
  }

  /* ---------- public: registerTopics ---------- */
  function registerTopics(pageId, topics, opts) {
    opts = opts || {};
    var pageTitle = opts.pageTitle || document.title || pageId;

    // Normalise: flat array of strings -> single group mounted at #tracker
    var groups;
    if (Array.isArray(topics) && (topics.length === 0 || typeof topics[0] === "string")) {
      groups = [{ group: opts.groupTitle || "Checklist", items: topics, mount: opts.mount || "#tracker" }];
    } else {
      groups = topics.map(function (g) { return g; });
    }

    recordManifest(pageId, pageTitle, groups);

    // remember where each group should render (kept in memory, not persisted)
    groups.forEach(function (g) {
      var gs = slug(g.group || "items");
      mountMap[pageId + "/" + gs] = g.mount || ("#t-" + gs);
    });

    function renderAll() {
      groups.forEach(function (g) {
        var gs = slug(g.group || "items");
        var refresh = renderGroup(pageId, gs);
        if (refresh) widgets.push({ pageId: pageId, groupSlug: gs, refresh: refresh });
      });
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", renderAll);
    } else {
      renderAll();
    }
  }

  /* Re-sync every widget on this page (e.g. after a reset or a storage event) */
  function refreshAll() {
    widgets.forEach(function (w) { try { w.refresh(); } catch (e) {} });
  }

  /* ---------- reset ---------- */
  function resetPage(pageId) {
    setChecks(pageId, {});
    refreshAll();
    fireUpdate();
  }
  function resetAll() {
    var m = getManifest();
    Object.keys(m).forEach(function (pid) { setChecks(pid, {}); });
    refreshAll();
    fireUpdate();
  }

  /* ---------- theme ---------- */
  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") || lsGet(THEME_KEY) || "dark";
  }
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    lsSet(THEME_KEY, t);
    document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
      btn.textContent = t === "dark" ? "☀ Light" : "☾ Dark";
      btn.setAttribute("aria-label", "Switch to " + (t === "dark" ? "light" : "dark") + " theme");
    });
  }
  function toggleTheme() { applyTheme(currentTheme() === "dark" ? "light" : "dark"); }
  function initTheme() {
    applyTheme(currentTheme());
    document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
      btn.addEventListener("click", toggleTheme);
    });
  }

  /* keep multiple open tabs in sync */
  global.addEventListener("storage", function (e) {
    if (!e.key) return;
    if (e.key === THEME_KEY && e.newValue) applyTheme(e.newValue);
    if (e.key.indexOf(NS) === 0) { refreshAll(); fireUpdate(); }
  });

  /* ---------- export ---------- */
  global.Tracker = {
    registerTopics: registerTopics,
    summaryByPage: summaryByPage,
    overall: overall,
    countPage: countPage,
    countPageStatic: countPageStatic,
    summaryFromCatalog: summaryFromCatalog,
    overallFromCatalog: overallFromCatalog,
    refreshAll: refreshAll,
    resetPage: resetPage,
    resetAll: resetAll,
    initTheme: initTheme,
    toggleTheme: toggleTheme,
    _slug: slug
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initTheme);
  } else {
    initTheme();
  }
})(window);
