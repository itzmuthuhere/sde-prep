"use client";

import { useEffect, useState } from "react";
import SiteHeader from "@/app/components/SiteHeader";
import { clearApiKey, loadApiKey, saveApiKey } from "@/app/lib/interview";

type TestState = { kind: "idle" | "testing" | "ok" | "err"; message?: string };

export default function SettingsPage() {
  const [key, setKey] = useState("");
  const [savedKey, setSavedKey] = useState("");
  const [reveal, setReveal] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: "idle" });

  useEffect(() => {
    const existing = loadApiKey();
    setKey(existing);
    setSavedKey(existing);
  }, []);

  function handleSave() {
    saveApiKey(key.trim());
    setSavedKey(key.trim());
    setTest({ kind: "idle" });
  }

  function handleClear() {
    clearApiKey();
    setKey("");
    setSavedKey("");
    setTest({ kind: "idle" });
  }

  async function handleTest() {
    const trimmed = key.trim();
    if (!trimmed) {
      setTest({ kind: "err", message: "Enter a key first." });
      return;
    }
    setTest({ kind: "testing" });
    try {
      const res = await fetch("/api/interview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiKey: trimmed,
          system: "Reply with exactly one word: pong.",
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 8,
          stream: false,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const message = data?.error?.message || `Request failed with status ${res.status}.`;
        setTest({ kind: "err", message });
        return;
      }
      setTest({ kind: "ok", message: "Key works — got a response from the Anthropic API." });
    } catch {
      setTest({ kind: "err", message: "Network error while reaching /api/interview." });
    }
  }

  const dirty = key.trim() !== savedKey;

  return (
    <>
      <SiteHeader active="settings" />
      <main className="wrap">
        <h1>Settings</h1>
        <p className="lede">Bring your own Anthropic API key to use the mock-interview feature.</p>

        <div className="callout warn">
          <strong>This key is yours, and it stays on your device.</strong> It is saved only in this
          browser&apos;s <code>localStorage</code> — never on a server, never in a database, never
          in any log. When you use the mock-interview feature, your browser sends the key to this
          site&apos;s own <code>/api/interview</code> route, which forwards it directly to
          Anthropic&apos;s API for that single request and then discards it. Using this feature
          will incur small pay-as-you-go API charges on <strong>your own</strong> Anthropic account
          — see{" "}
          <a href="https://www.anthropic.com/pricing#api" target="_blank" rel="noreferrer">
            Anthropic&apos;s pricing
          </a>
          . Clearing your browser data or clicking &quot;Clear key&quot; below removes it completely.
        </div>

        <label className="field-label" htmlFor="api-key">
          Anthropic API key
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            id="api-key"
            className="text-input"
            type={reveal ? "text" : "password"}
            placeholder="sk-ant-..."
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <button className="btn-secondary" type="button" onClick={() => setReveal((r) => !r)}>
            {reveal ? "Hide" : "Show"}
          </button>
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          Don&apos;t have one? Create it at{" "}
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
            console.anthropic.com/settings/keys
          </a>
          .
        </p>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
          <button className="btn-primary" type="button" onClick={handleSave} disabled={!dirty}>
            Save key
          </button>
          <button className="btn-secondary" type="button" onClick={handleTest} disabled={test.kind === "testing"}>
            {test.kind === "testing" ? "Testing…" : "Test connection"}
          </button>
          {savedKey && (
            <button className="btn-danger" type="button" onClick={handleClear}>
              Clear key
            </button>
          )}
        </div>

        {test.kind === "ok" && <div className="status-line ok">{test.message}</div>}
        {test.kind === "err" && <div className="status-line err">{test.message}</div>}

        <p className="small muted" style={{ marginTop: 24 }}>
          {savedKey ? "A key is currently saved in this browser." : "No key saved yet."}
        </p>
      </main>
    </>
  );
}
