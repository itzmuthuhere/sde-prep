/* ============================================================
   search.js — command-menu style search + mobile nav toggle
   ------------------------------------------------------------
   - Injects a "Search" button + a hamburger nav toggle into the
     top bar of every page (so page headers don't each need editing).
   - Cmd/Ctrl+K (or clicking Search) opens a command palette that
     fuzzy-matches page titles and every topic / checklist label
     from content-index.js (window.SDE_CONTENT).
   - Enter / click navigates to the page, deep-linking to the
     relevant tracker group where possible.
   - The hamburger collapses the nav on narrow screens.
   No dependencies. Progressive: if content-index.js is missing,
   the palette still lists pages from the nav links.
   ============================================================ */
(function () {
  "use strict";

  /* ---------- build the flat search index ---------- */
  function buildIndex() {
    var rows = [];
    var seenPages = {};
    var catalog = window.SDE_CONTENT || [];

    catalog.forEach(function (p) {
      seenPages[p.file] = true;
      rows.push({ kind: "page", title: p.title, page: p.file, hint: "Page" });
      (p.groups || []).forEach(function (g) {
        var anchor = (g.mount || "").replace(/^#/, "");
        rows.push({
          kind: "topic",
          title: g.group,
          page: p.file,
          anchor: anchor,
          hint: p.title,
        });
        (g.items || []).forEach(function (label) {
          rows.push({
            kind: "item",
            title: label,
            page: p.file,
            anchor: anchor,
            hint: p.title + "  ·  " + g.group,
          });
        });
      });
    });

    // fall back: any nav link not covered by the catalog
    document.querySelectorAll(".topbar nav a").forEach(function (a) {
      var href = a.getAttribute("href");
      if (!href || seenPages[href] || href === "index.html") return;
      seenPages[href] = true;
      rows.push({ kind: "page", title: a.textContent.trim(), page: href, hint: "Page" });
    });

    return rows;
  }

  /* ---------- scoring: subsequence + word-boundary bonus ---------- */
  function score(query, text) {
    query = query.toLowerCase();
    text = text.toLowerCase();
    if (!query) return 0;
    var qi = 0, ti = 0, first = -1, last = -1, boundaryHits = 0;
    while (qi < query.length && ti < text.length) {
      if (query[qi] === text[ti]) {
        if (first === -1) first = ti;
        last = ti;
        if (ti === 0 || /[^a-z0-9]/.test(text[ti - 1])) boundaryHits++;
        qi++;
      }
      ti++;
    }
    if (qi < query.length) return -1; // not all chars matched
    var span = last - first + 1;
    var exact = text.indexOf(query);
    var s = 1000 - span + boundaryHits * 30 + (query.length / text.length) * 40;
    if (exact !== -1) s += 200 - exact;
    if (text === query) s += 500;
    return s;
  }

  /* ---------- palette DOM ---------- */
  var overlay, input, listEl, rows, results = [], active = 0, INDEX = null;

  function ensurePalette() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.className = "cmdk-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="cmdk">' +
      '  <input class="cmdk-input" type="text" autocomplete="off" spellcheck="false" ' +
      '         placeholder="Search pages, topics and checklist items…" aria-label="Search" />' +
      '  <ul class="cmdk-list" role="listbox"></ul>' +
      '  <div class="cmdk-foot"><kbd>↑</kbd><kbd>↓</kbd> navigate · <kbd>↵</kbd> open · <kbd>esc</kbd> close</div>' +
      "</div>";
    document.body.appendChild(overlay);
    input = overlay.querySelector(".cmdk-input");
    listEl = overlay.querySelector(".cmdk-list");

    overlay.addEventListener("mousedown", function (e) {
      if (e.target === overlay) close();
    });
    input.addEventListener("input", function () { runQuery(input.value); });
    input.addEventListener("keydown", onKey);
  }

  function iconFor(kind) {
    if (kind === "page") return "▤";
    if (kind === "topic") return "▸";
    return "○";
  }

  function render() {
    listEl.innerHTML = "";
    if (!results.length) {
      var li = document.createElement("li");
      li.className = "cmdk-empty";
      li.textContent = "No matches";
      listEl.appendChild(li);
      return;
    }
    results.forEach(function (r, i) {
      var li = document.createElement("li");
      li.className = "cmdk-item" + (i === active ? " is-active" : "");
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", i === active ? "true" : "false");
      li.innerHTML =
        '<span class="cmdk-ico">' + iconFor(r.kind) + "</span>" +
        '<span class="cmdk-main"><span class="cmdk-title"></span>' +
        '<span class="cmdk-hint"></span></span>' +
        '<span class="cmdk-kind">' + r.kind + "</span>";
      li.querySelector(".cmdk-title").textContent = r.title;
      li.querySelector(".cmdk-hint").textContent = r.hint || "";
      li.addEventListener("click", function () { go(r); });
      li.addEventListener("mousemove", function () {
        if (active !== i) { active = i; paintActive(); }
      });
      listEl.appendChild(li);
    });
  }

  function paintActive() {
    var items = listEl.querySelectorAll(".cmdk-item");
    items.forEach(function (el, i) {
      el.classList.toggle("is-active", i === active);
      el.setAttribute("aria-selected", i === active ? "true" : "false");
    });
    var cur = items[active];
    if (cur) cur.scrollIntoView({ block: "nearest" });
  }

  function runQuery(q) {
    q = (q || "").trim();
    if (!INDEX) INDEX = buildIndex();
    if (!q) {
      // default view: just the pages
      results = INDEX.filter(function (r) { return r.kind === "page"; }).slice(0, 30);
    } else {
      var scored = [];
      for (var i = 0; i < INDEX.length; i++) {
        var r = INDEX[i];
        var s = Math.max(score(q, r.title), score(q, (r.hint || "")) - 120);
        if (s > 0) scored.push({ r: r, s: s });
      }
      scored.sort(function (a, b) { return b.s - a.s; });
      results = scored.slice(0, 40).map(function (x) { return x.r; });
    }
    active = 0;
    render();
  }

  function go(r) {
    if (!r) return;
    var url = r.page + (r.anchor ? "#" + r.anchor : "");
    close();
    var here = location.pathname.split("/").pop() || "index.html";
    if (r.page === here && r.anchor) {
      var t = document.getElementById(r.anchor);
      if (t) { t.scrollIntoView({ behavior: "smooth", block: "start" }); location.hash = r.anchor; return; }
    }
    location.href = url;
  }

  function onKey(e) {
    if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, results.length - 1); paintActive(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); paintActive(); }
    else if (e.key === "Enter") { e.preventDefault(); go(results[active]); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  }

  function open() {
    ensurePalette();
    INDEX = buildIndex();
    overlay.hidden = false;
    document.documentElement.classList.add("cmdk-open");
    input.value = "";
    runQuery("");
    setTimeout(function () { input.focus(); }, 0);
  }
  function close() {
    if (!overlay) return;
    overlay.hidden = true;
    document.documentElement.classList.remove("cmdk-open");
  }
  function toggle() { overlay && !overlay.hidden ? close() : open(); }

  /* ---------- inject top-bar controls ---------- */
  function injectControls() {
    var inner = document.querySelector(".topbar-inner");
    if (!inner) return;
    var nav = inner.querySelector("nav");
    var themeBtn = inner.querySelector("[data-theme-toggle]");

    if (nav && !inner.querySelector("[data-nav-toggle]")) {
      var burger = document.createElement("button");
      burger.type = "button";
      burger.className = "nav-toggle";
      burger.setAttribute("data-nav-toggle", "");
      burger.setAttribute("aria-label", "Toggle navigation");
      burger.setAttribute("aria-expanded", "false");
      burger.innerHTML = "<span></span><span></span><span></span>";
      inner.insertBefore(burger, nav);
      burger.addEventListener("click", function () {
        var open = document.querySelector(".topbar").classList.toggle("nav-open");
        burger.setAttribute("aria-expanded", open ? "true" : "false");
      });
      // close the menu after choosing a destination
      nav.addEventListener("click", function (e) {
        if (e.target.tagName === "A") {
          document.querySelector(".topbar").classList.remove("nav-open");
          burger.setAttribute("aria-expanded", "false");
        }
      });
    }

    if (!inner.querySelector("[data-search-open]")) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "search-btn";
      btn.setAttribute("data-search-open", "");
      btn.setAttribute("aria-label", "Search (Ctrl+K)");
      btn.innerHTML = '<span class="search-btn-ico" aria-hidden="true">⌕</span>' +
        '<span class="search-btn-txt">Search</span>' +
        '<kbd class="search-btn-kbd">' + (isMac() ? "⌘" : "Ctrl") + " K</kbd>";
      if (themeBtn) inner.insertBefore(btn, themeBtn);
      else inner.appendChild(btn);
      btn.addEventListener("click", open);
    }
  }

  function isMac() {
    return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
  }

  /* ---------- global hotkey ---------- */
  document.addEventListener("keydown", function (e) {
    var k = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && k === "k") { e.preventDefault(); toggle(); }
    else if (k === "/" && !/^(input|textarea|select)$/i.test((e.target.tagName || "")) && !e.metaKey && !e.ctrlKey) {
      e.preventDefault(); open();
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectControls);
  } else {
    injectControls();
  }

  /* Trackers mount on DOMContentLoaded, which can leave a #t-… anchor at zero
     height when the browser first tries to jump to it. Re-resolve the hash
     once everything has settled. */
  window.addEventListener("load", function () {
    var h = (location.hash || "").replace(/^#/, "");
    if (!h) return;
    var t = document.getElementById(h);
    if (t) setTimeout(function () { t.scrollIntoView({ block: "start" }); }, 60);
  });

  window.SearchPalette = { open: open, close: close, toggle: toggle };
})();
