/* ============================================================
   activity.js — daily activity log + GitHub-style heatmap
   ------------------------------------------------------------
   Logs one timestamp bucket per local calendar day whenever you
   do any of the following, anywhere on the site:

     - check (not uncheck) a checklist item        [tracker.js]
     - a quiz records an attempt                    -> sdeprep:v1:quiz:results
     - a mock test result is saved                  -> sdeprep:v1:mocktest:results
     - an AI interview scorecard is saved            -> sdeprep:v1:interview:scorecards

   The three result-based sources aren't built yet (see README.md
   "Data contracts"), so instead of requiring each of those future
   features to remember to call Activity.log(), this file watches
   localStorage writes to their keys directly and logs on any
   write — those keys only get written when a real attempt/result
   exists, so a write always means "did the thing today." Once
   those features ship, activity gets recorded automatically with
   no coordination required.

   Storage shape, key "sdeprep:v1:activity:days":
     { "YYYY-MM-DD": count }   // count = number of logged events that day

   Public API:
     Activity.log(source)          -> record one event for today
     Activity.getDays()            -> { "YYYY-MM-DD": count }
     Activity.currentStreak()      -> integer, see note below
     Activity.activeDaysInRange(n) -> # of distinct active days in last n days
     Activity.render(mountSel)     -> draws the heatmap + streak into mountSel
   ============================================================ */

(function (global) {
  "use strict";

  var NS = "sdeprep:v1:";
  var ACTIVITY_KEY = NS + "activity:days";
  var WATCHED_KEYS = {};
  WATCHED_KEYS[NS + "quiz:results"] = "quiz";
  WATCHED_KEYS[NS + "mocktest:results"] = "mocktest";
  WATCHED_KEYS[NS + "interview:scorecards"] = "interview";

  var DAY_MS = 24 * 60 * 60 * 1000;
  var WEEKS_SHOWN = 26; // ~6 months

  /* ---------- safe storage ---------- */
  function lsGet(key) {
    try { return global.localStorage.getItem(key); } catch (e) { return null; }
  }
  function readJSON(key, fallback) {
    var raw = lsGet(key);
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }
  function writeJSON(key, obj) {
    try { global.localStorage.setItem(key, JSON.stringify(obj)); } catch (e) { /* private mode / quota */ }
  }

  /* ---------- date helpers (local calendar day, not UTC) ---------- */
  function pad2(n) { return n < 10 ? "0" + n : "" + n; }
  function dateStr(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function startOfDay(d) {
    var n = new Date(d);
    n.setHours(0, 0, 0, 0);
    return n;
  }
  function addDays(d, n) {
    var r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  }

  /* ---------- core log ---------- */
  function getDays() { return readJSON(ACTIVITY_KEY, {}); }

  function log() {
    var days = getDays();
    var key = dateStr(new Date());
    days[key] = (days[key] || 0) + 1;
    writeJSON(ACTIVITY_KEY, days);
    try {
      document.dispatchEvent(new CustomEvent("activity:update", { detail: days }));
    } catch (e) { /* old browser */ }
  }

  /* watch writes to the three result keys that don't exist yet — any write
     to one of them means an attempt/result was just saved, i.e. activity.

     The "already installed" guard is a property on the wrapper FUNCTION,
     not on localStorage itself: Storage objects proxy any property name
     that isn't an existing interface member (getItem, setItem, ...) through
     to a real, persisted storage entry (`localStorage.foo = 1` behaves like
     `setItem('foo', '1')`). A guard flag stored that way would survive
     navigation and wrongly tell the next page's fresh Storage wrapper
     (JS-level overrides don't survive navigation) that it's already
     patched, silently disabling the watcher on every page after the first. */
  function installWatcher() {
    if (!global.localStorage) return;
    var current = global.localStorage.setItem;
    if (current && current.__sdeprepPatched) return;
    var realSetItem = current.bind(global.localStorage);
    var patched = function (key, value) {
      realSetItem(key, value);
      if (key !== ACTIVITY_KEY && WATCHED_KEYS[key]) log();
    };
    patched.__sdeprepPatched = true;
    global.localStorage.setItem = patched;
  }
  try { installWatcher(); } catch (e) { /* private mode */ }

  /* ---------- streak ----------
     Counts consecutive active days ending today. If today has no
     activity yet, the streak isn't broken until the day actually
     passes with nothing logged — so it starts from yesterday instead
     of showing 0 the moment you open the site in the morning. */
  function currentStreak() {
    var days = getDays();
    var cursor = startOfDay(new Date());
    if (!days[dateStr(cursor)]) cursor = addDays(cursor, -1);
    var streak = 0;
    while (days[dateStr(cursor)]) {
      streak++;
      cursor = addDays(cursor, -1);
    }
    return streak;
  }

  function activeDaysInRange(n) {
    var days = getDays();
    var cursor = startOfDay(new Date());
    var count = 0;
    for (var i = 0; i < n; i++) {
      if (days[dateStr(cursor)]) count++;
      cursor = addDays(cursor, -1);
    }
    return count;
  }

  /* ---------- level bucketing for cell color ---------- */
  function levelFor(count) {
    if (!count) return 0;
    if (count <= 2) return 1;
    if (count <= 4) return 2;
    if (count <= 7) return 3;
    return 4;
  }

  /* ---------- rendering ---------- */
  var MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  function el(tag, cls) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  function render(mountSel) {
    var host = typeof mountSel === "string" ? document.querySelector(mountSel) : mountSel;
    if (!host) return;

    var days = getDays();
    var today = startOfDay(new Date());

    // Grid always ends on today (whichever weekday that is) and starts on
    // the Sunday on/before ~6 months ago — so the number of weeks varies
    // (26-27) depending on where today falls in its week, same as GitHub.
    var approxStart = addDays(today, -(WEEKS_SHOWN * 7 - 1));
    var gridStart = addDays(approxStart, -approxStart.getDay()); // snap back to Sunday
    var numWeeks = Math.ceil((Math.round((today - gridStart) / DAY_MS) + 1) / 7);

    host.innerHTML = "";
    var wrap = el("div", "heatmap-wrap");

    var streak = currentStreak();
    var streakRow = el("div", "streak-row");
    var badge = el("div", "streak-badge");
    badge.innerHTML =
      '<span class="streak-flame">' + (streak > 0 ? "🔥" : "💤") + "</span>" +
      '<span class="streak-count">' + streak + "</span>" +
      '<span class="streak-label">day' + (streak === 1 ? "" : "s") + " streak</span>";
    streakRow.appendChild(badge);
    var sub = el("span", "streak-sub");
    sub.textContent = activeDaysInRange(WEEKS_SHOWN * 7) + " active days in the last 6 months";
    streakRow.appendChild(sub);
    wrap.appendChild(streakRow);

    var scroll = el("div", "heatmap-scroll");
    var inner = el("div", "heatmap-inner");

    // month labels, one per column where the month changes
    var monthsRow = el("div", "heatmap-months");
    monthsRow.style.gridTemplateColumns = "repeat(" + numWeeks + ", 1fr)";
    var weeks = [];
    var lastMonth = -1;
    for (var w = 0; w < numWeeks; w++) {
      var weekStart = addDays(gridStart, w * 7);
      var label = el("span", "heatmap-month-label");
      if (weekStart.getMonth() !== lastMonth) {
        label.textContent = MONTH_NAMES[weekStart.getMonth()];
        lastMonth = weekStart.getMonth();
      }
      monthsRow.appendChild(label);
      weeks.push(weekStart);
    }
    inner.appendChild(monthsRow);

    var grid = el("div", "heatmap-grid");
    grid.style.gridTemplateColumns = "repeat(" + numWeeks + ", 1fr)";
    weeks.forEach(function (weekStart) {
      var col = el("div", "heatmap-col");
      for (var d = 0; d < 7; d++) {
        var day = addDays(weekStart, d);
        var cell = el("div", "heatmap-cell");
        if (day > today) {
          cell.classList.add("is-future");
        } else {
          var count = days[dateStr(day)] || 0;
          cell.dataset.level = levelFor(count);
          cell.title = dateStr(day) + " — " + count + (count === 1 ? " event" : " events");
        }
        col.appendChild(cell);
      }
      grid.appendChild(col);
    });
    inner.appendChild(grid);

    var legend = el("div", "heatmap-legend");
    var less = el("span", "heatmap-legend-text");
    less.textContent = "Less";
    legend.appendChild(less);
    for (var lvl = 0; lvl <= 4; lvl++) {
      var sw = el("span", "heatmap-cell heatmap-swatch");
      sw.dataset.level = lvl;
      legend.appendChild(sw);
    }
    var more = el("span", "heatmap-legend-text");
    more.textContent = "More";
    legend.appendChild(more);

    scroll.appendChild(inner);
    wrap.appendChild(scroll);
    wrap.appendChild(legend);
    host.appendChild(wrap);
  }

  function wireLiveUpdates(mountSel) {
    document.addEventListener("activity:update", function () { render(mountSel); });
    global.addEventListener("storage", function (e) {
      if (e.key === ACTIVITY_KEY) render(mountSel);
    });
  }

  global.Activity = {
    log: log,
    getDays: getDays,
    currentStreak: currentStreak,
    activeDaysInRange: activeDaysInRange,
    render: render,
    wireLiveUpdates: wireLiveUpdates
  };
})(window);
