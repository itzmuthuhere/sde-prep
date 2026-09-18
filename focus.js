/* ============================================================
   focus.js — "Focus This Week" homepage widget
   ------------------------------------------------------------
   Surfaces the 3–5 weakest topics/patterns on every homepage load,
   recomputed live from whatever practice data already sits in
   localStorage. Nothing here is cached or stored by this file —
   it only reads.

   Data is expected to come from four other features, each of
   which OWNS one localStorage key and writes to it independently.
   This file defines that contract; it does not populate it.

     - Prompt 28 (quiz engine)          -> sdeprep:v1:quiz:results
     - Prompt 29 (review queue)         -> sdeprep:v1:review:queue
     - Prompt 30 (mock tests)           -> sdeprep:v1:mocktest:results
     - Prompt 36 (AI interview scorer)  -> sdeprep:v1:interview:scorecards

   All four keys live under the same "sdeprep:v1:" namespace
   tracker.js already uses, so Tracker.resetAll()-style housekeeping
   and devtools inspection stay in one place.

   ---------------- Data contract ----------------

   1) sdeprep:v1:quiz:results  — object keyed by quizId
      { [quizId]: {
          title:  string,            // "Dynamic Programming Quiz"
          topic:  string,            // canonical label, used to merge
                                      // with mock-test / interview signals
          pageId: string,            // matches an id in index.html PAGES
          anchor: string,            // in-page anchor on that page
          attempts: [ { score: number, total: number, ts: number } ]
                                      // last element = most recent attempt
      } }

   2) sdeprep:v1:review:queue  — object keyed by cardId
      { [cardId]: {
          label:  string,            // topic/pattern label
          pageId: string,
          anchor: string,
          history: Array<"shaky" | "got-it">   // oldest first
      } }

   3) sdeprep:v1:mocktest:results  — array, one entry per mock test sat
      [ { id: string, title: string, ts: number,
          topics: [ { topic: string, score: number, total: number,
                      pageId: string, anchor: string } ]
      } ]

   4) sdeprep:v1:interview:scorecards  — array, one entry per AI interview
      [ { id: string, title: string, ts: number,
          criteria: [ { skill: string, score: number, max: number,
                        pageId: string, anchor: string } ]
      } ]

   Every reader below tolerates a missing/malformed key, so the widget
   just shows its empty state until those four features exist.
   ============================================================ */

(function (global) {
  "use strict";

  var QUIZ_KEY = "sdeprep:v1:quiz:results";
  var REVIEW_KEY = "sdeprep:v1:review:queue";
  var MOCKTEST_KEY = "sdeprep:v1:mocktest:results";
  var INTERVIEW_KEY = "sdeprep:v1:interview:scorecards";

  var MIN_ITEMS = 3;
  var MAX_ITEMS = 5;
  var WEAKNESS_THRESHOLD = 0.25; // ignore anything scoring ~75%+ with no shaky marks

  /* ---------- safe storage ---------- */
  function readJSON(key, fallback) {
    var raw;
    try { raw = global.localStorage.getItem(key); } catch (e) { return fallback; }
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }

  function normTopic(s) {
    return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  /* ---------- one signal per (source, topic) ----------
     { topicKey, topic, pageId, anchor, weakness (0..1), reason, ts, source } */
  function collectSignals() {
    var signals = [];

    // Prompt 28 — quiz scores
    var quizzes = readJSON(QUIZ_KEY, {});
    Object.keys(quizzes || {}).forEach(function (id) {
      var q = quizzes[id] || {};
      var attempts = q.attempts || [];
      if (!attempts.length) return;
      var last = attempts[attempts.length - 1];
      if (!last || !last.total) return;
      var ratio = last.score / last.total;
      var topic = q.topic || q.title || id;
      signals.push({
        topicKey: normTopic(topic),
        topic: topic,
        pageId: q.pageId,
        anchor: q.anchor,
        weakness: 1 - ratio,
        reason: "scored " + last.score + "/" + last.total + " on the " + (q.title || topic),
        ts: last.ts || 0,
        source: "quiz"
      });
    });

    // Prompt 30 — mock-test results, per topic
    var mocks = readJSON(MOCKTEST_KEY, []);
    (Array.isArray(mocks) ? mocks : []).forEach(function (test) {
      (test.topics || []).forEach(function (t) {
        if (!t || !t.total) return;
        var ratio = t.score / t.total;
        signals.push({
          topicKey: normTopic(t.topic),
          topic: t.topic,
          pageId: t.pageId,
          anchor: t.anchor,
          weakness: 1 - ratio,
          reason: "scored " + t.score + "/" + t.total + " on " + t.topic + " in " + (test.title || "a mock test"),
          ts: test.ts || 0,
          source: "mocktest"
        });
      });
    });

    // Prompt 36 — AI interview scorecards, per criterion
    var interviews = readJSON(INTERVIEW_KEY, []);
    (Array.isArray(interviews) ? interviews : []).forEach(function (card) {
      (card.criteria || []).forEach(function (c) {
        if (!c || !c.max) return;
        var ratio = c.score / c.max;
        signals.push({
          topicKey: normTopic(c.skill),
          topic: c.skill,
          pageId: c.pageId,
          anchor: c.anchor,
          weakness: 1 - ratio,
          reason: "scored " + c.score + "/" + c.max + " on " + c.skill + " in your AI interview scorecard",
          ts: card.ts || 0,
          source: "interview"
        });
      });
    });

    // Prompt 29 — review queue, repeated "shaky" marks
    var queue = readJSON(REVIEW_KEY, {});
    Object.keys(queue || {}).forEach(function (id) {
      var card = queue[id] || {};
      var hist = card.history || [];
      var shakyCount = hist.filter(function (h) { return h === "shaky"; }).length;
      if (!shakyCount) return;
      var lastIsShaky = hist[hist.length - 1] === "shaky";
      var weakness = Math.min(1, 0.35 + shakyCount * 0.25 + (lastIsShaky ? 0.1 : 0));
      var label = card.label || id;
      var times = shakyCount === 1 ? "once" : shakyCount + " times";
      signals.push({
        topicKey: normTopic(label),
        topic: label,
        pageId: card.pageId,
        anchor: card.anchor,
        weakness: weakness,
        reason: "marked shaky " + times + " on " + label + " in your review queue",
        ts: Date.now(),
        source: "review"
      });
    });

    return signals;
  }

  /* ---------- merge signals into one row per topic ----------
     Keep the single worst reason to display; a topic flagged by more
     than one source is a stronger signal, so nudge its priority up. */
  function mergeByTopic(signals) {
    var byTopic = {};
    signals.forEach(function (s) {
      if (!s.topicKey) return;
      var row = byTopic[s.topicKey];
      if (!row) {
        row = byTopic[s.topicKey] = {
          topic: s.topic,
          pageId: s.pageId,
          anchor: s.anchor,
          weakness: 0,
          reason: "",
          ts: 0,
          sources: {}
        };
      }
      row.sources[s.source] = true;
      // worst single signal wins the displayed reason + link
      if (s.weakness >= row.weakness) {
        row.weakness = s.weakness;
        row.reason = s.reason;
        row.pageId = s.pageId || row.pageId;
        row.anchor = s.anchor || row.anchor;
      }
      if (s.ts > row.ts) row.ts = s.ts;
    });

    return Object.keys(byTopic).map(function (k) {
      var row = byTopic[k];
      var sourceCount = Object.keys(row.sources).length;
      row.priority = Math.min(1, row.weakness + 0.05 * (sourceCount - 1));
      return row;
    });
  }

  /* ---------- rank + pick 3-5 ----------
     Only surfaces genuine gaps: rows below WEAKNESS_THRESHOLD are
     dropped even if that leaves fewer than MIN_ITEMS on the page. */
  function weakestTopics() {
    var rows = mergeByTopic(collectSignals())
      .filter(function (r) { return r.weakness >= WEAKNESS_THRESHOLD; })
      .sort(function (a, b) {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return b.ts - a.ts;
      });
    return rows.slice(0, MAX_ITEMS);
  }

  /* ---------- link resolution ---------- */
  function resolveHref(pageId, anchor, catalog) {
    if (!pageId) return null;
    var file = null;
    (catalog || []).forEach(function (p) {
      if (p.id === pageId) file = p.file;
    });
    if (!file) return null;
    return anchor ? file + "#" + anchor : file;
  }

  /* ---------- rendering ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function render(mountSel, catalog) {
    var host = typeof mountSel === "string" ? document.querySelector(mountSel) : mountSel;
    if (!host) return;

    var rows = weakestTopics();
    host.innerHTML = "";

    if (!rows.length) {
      var empty = el("div", "focus-empty");
      empty.textContent =
        "No weak spots detected yet. Once you've sat a quiz, a mock test, or an AI " +
        "interview, or reviewed a few cards, this'll start pointing at your actual gaps.";
      host.appendChild(empty);
      return;
    }

    var list = el("ul", "focus-list");
    rows.forEach(function (row) {
      var li = el("li", "focus-item");

      var top = el("div", "focus-top");
      top.appendChild(el("span", "focus-topic", row.topic));
      li.appendChild(top);

      li.appendChild(el("div", "focus-reason", row.reason.charAt(0).toUpperCase() + row.reason.slice(1) + "."));

      var href = resolveHref(row.pageId, row.anchor, catalog);
      if (href) {
        var a = el("a", "focus-link", "Review this →");
        a.href = href;
        li.appendChild(a);
      }

      list.appendChild(li);
    });
    host.appendChild(list);
  }

  global.Focus = {
    weakestTopics: weakestTopics,
    render: render
  };
})(window);
