/* ============================================================
   interview-history.js — homepage widget for the mock-interview
   feature (app/mock-interview, app/settings under Next.js).
   Reads localStorage key "sdeprep:interview-scorecards", written
   by the mock-interview page after each finished session. Same
   origin as this static page, so localStorage is shared.
   ============================================================ */
(function (global) {
  "use strict";

  var STORAGE_KEY = "sdeprep:interview-scorecards";

  var VERDICT_SCORE = { no_hire: 10, lean_no_hire: 35, lean_hire: 65, hire: 90 };
  var VERDICT_LABEL = { no_hire: "No Hire", lean_no_hire: "Lean No Hire", lean_hire: "Lean Hire", hire: "Hire" };
  var VERDICT_CLASS = { no_hire: "bad", lean_no_hire: "warn", lean_hire: "good", hire: "good" };

  function loadHistory() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function fmtDate(iso) {
    try {
      var d = new Date(iso);
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
        " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    } catch (e) {
      return iso;
    }
  }

  function sparkline(records) {
    var recent = records.slice(-20);
    if (recent.length < 2) return "";
    var w = 320, h = 48, pad = 4;
    var step = (w - pad * 2) / (recent.length - 1);
    var points = recent.map(function (r, i) {
      var score = r.scorecard ? VERDICT_SCORE[r.scorecard.verdict] || 50 : 50;
      var x = pad + i * step;
      var y = h - pad - (score / 100) * (h - pad * 2);
      return x.toFixed(1) + "," + y.toFixed(1);
    });
    return (
      '<svg class="interview-spark" viewBox="0 0 ' + w + " " + h + '" width="' + w + '" height="' + h + '" preserveAspectRatio="none">' +
      '<polyline points="' + points.join(" ") + '" fill="none" stroke="var(--accent)" stroke-width="2" />' +
      "</svg>"
    );
  }

  function render(mountId) {
    var mount = document.getElementById(mountId);
    if (!mount) return;
    var history = loadHistory();

    if (history.length === 0) {
      mount.innerHTML =
        '<p class="muted small">No mock interviews yet. <a href="/mock-interview">Start one →</a></p>';
      return;
    }

    var recent = history.slice().reverse().slice(0, 6);
    var hireLike = history.filter(function (r) {
      return r.scorecard && (r.scorecard.verdict === "hire" || r.scorecard.verdict === "lean_hire");
    }).length;

    var rows = recent.map(function (r) {
      var verdict = r.scorecard ? r.scorecard.verdict : null;
      var badge = verdict
        ? '<span class="interview-badge ' + (VERDICT_CLASS[verdict] || "") + '">' + VERDICT_LABEL[verdict] + "</span>"
        : '<span class="interview-badge">Unscored</span>';
      return (
        '<div class="interview-row">' +
        '<div class="interview-row-main"><strong>' + r.type + "</strong> · " + r.difficulty + "</div>" +
        '<div class="interview-row-meta">' + fmtDate(r.timestamp) + "</div>" +
        badge +
        "</div>"
      );
    });

    mount.innerHTML =
      '<div class="interview-summary">' +
      "<div>" + sparkline(history) + "</div>" +
      "<div class=\"meta\">" + history.length + " session" + (history.length === 1 ? "" : "s") +
      " · " + hireLike + " of " + history.length + " scored Hire / Lean Hire</div>" +
      "</div>" +
      '<div class="interview-list">' + rows.join("") + "</div>" +
      '<p class="small" style="margin-top:10px"><a href="/mock-interview">Start another interview →</a></p>';
  }

  global.InterviewHistory = { render: render, loadHistory: loadHistory };
})(window);
