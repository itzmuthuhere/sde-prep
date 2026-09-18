"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import SiteHeader from "@/app/components/SiteHeader";
import {
  Difficulty,
  InterviewType,
  Scorecard,
  SCORECARD_SYSTEM_PROMPT,
  buildSystemPrompt,
  loadApiKey,
  saveScorecardRecord,
} from "@/app/lib/interview";

type ChatMessage = { role: "user" | "assistant"; content: string };
type Phase = "setup" | "chatting" | "finishing" | "finished";

const TYPES: InterviewType[] = ["DSA", "LLD", "HLD", "Behavioral"];
const DIFFICULTIES: Difficulty[] = ["Easy", "Medium", "Hard"];
const VERDICT_LABEL: Record<string, string> = {
  hire: "Hire",
  lean_hire: "Lean Hire",
  lean_no_hire: "Lean No Hire",
  no_hire: "No Hire",
};

export default function MockInterviewPage() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [type, setType] = useState<InterviewType>("DSA");
  const [difficulty, setDifficulty] = useState<Difficulty>("Medium");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [scorecardRaw, setScorecardRaw] = useState<string | null>(null);

  const logRef = useRef<HTMLDivElement>(null);
  const systemPromptRef = useRef<string>("");

  useEffect(() => {
    setHasKey(!!loadApiKey());
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  async function streamAssistantReply(conversation: ChatMessage[]) {
    const apiKey = loadApiKey();
    setStreaming(true);
    setError(null);
    setMessages((m) => [...m, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/interview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiKey,
          system: systemPromptRef.current,
          messages: conversation,
          max_tokens: 1024,
          stream: true,
        }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error?.message || `Request failed with status ${res.status}.`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const evt of events) {
          const dataLine = evt.split("\n").find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          const payload = dataLine.slice(5).trim();
          if (!payload) continue;

          let obj: any;
          try {
            obj = JSON.parse(payload);
          } catch {
            continue;
          }

          if (obj.type === "content_block_delta" && obj.delta?.type === "text_delta") {
            const chunk: string = obj.delta.text;
            setMessages((m) => {
              const copy = [...m];
              const last = copy[copy.length - 1];
              copy[copy.length - 1] = { ...last, content: last.content + chunk };
              return copy;
            });
          } else if (obj.type === "error") {
            throw new Error(obj.error?.message || "The model returned an error.");
          }
        }
      }
    } catch (e: any) {
      setError(e?.message || "Something went wrong talking to the interviewer.");
      setMessages((m) => {
        // drop the empty placeholder bubble if nothing streamed into it
        const copy = [...m];
        if (copy.length && copy[copy.length - 1].role === "assistant" && !copy[copy.length - 1].content) {
          copy.pop();
        }
        return copy;
      });
    } finally {
      setStreaming(false);
    }
  }

  async function handleStart() {
    if (!loadApiKey()) {
      setHasKey(false);
      return;
    }
    systemPromptRef.current = buildSystemPrompt(type, difficulty);
    const opening: ChatMessage[] = [
      { role: "user", content: "I'm ready to begin. Please present the problem." },
    ];
    setMessages(opening);
    setPhase("chatting");
    await streamAssistantReply(opening);
  }

  async function handleSend() {
    const text = draft.trim();
    if (!text || streaming) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setDraft("");
    await streamAssistantReply(next);
  }

  async function handleFinish() {
    if (streaming) return;
    setPhase("finishing");
    setError(null);
    const apiKey = loadApiKey();
    const conversation: ChatMessage[] = [
      ...messages,
      { role: "user", content: "Let's end the interview here. Please give me your scorecard." },
    ];

    try {
      const res = await fetch("/api/interview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiKey,
          system: SCORECARD_SYSTEM_PROMPT,
          messages: conversation,
          max_tokens: 1024,
          stream: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || `Request failed with status ${res.status}.`);

      const text: string = data.content?.[0]?.text || "";
      const match = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
      let parsed: Scorecard | null = null;
      if (match) {
        try {
          parsed = JSON.parse(match[1]);
        } catch {
          parsed = null;
        }
      }

      saveScorecardRecord({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        type,
        difficulty,
        scorecard: parsed,
        rawText: parsed ? undefined : text,
      });

      setScorecard(parsed);
      setScorecardRaw(parsed ? null : text);
      setPhase("finished");
    } catch (e: any) {
      setError(e?.message || "Could not generate the scorecard.");
      setPhase("chatting");
    }
  }

  function handleRestart() {
    setPhase("setup");
    setMessages([]);
    setScorecard(null);
    setScorecardRaw(null);
    setError(null);
  }

  return (
    <>
      <SiteHeader active="interview" />
      <main className="wrap">
        <h1>Mock Interview</h1>
        <p className="lede">
          A live AI interviewer, powered by your own Anthropic API key. It will not solve the
          problem for you.
        </p>

        {hasKey === false && (
          <div className="callout warn">
            No Anthropic API key found. <Link href="/settings">Add one on the Settings page</Link>{" "}
            before starting.
          </div>
        )}

        {phase === "setup" && (
          <>
            <div className="setup-grid">
              <fieldset className="option-group">
                <legend>Interview type</legend>
                <div className="option-row">
                  {TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`chip${type === t ? " is-active" : ""}`}
                      onClick={() => setType(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset className="option-group">
                <legend>Difficulty</legend>
                <div className="option-row">
                  {DIFFICULTIES.map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={`chip${difficulty === d ? " is-active" : ""}`}
                      onClick={() => setDifficulty(d)}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
            <button className="btn-primary" type="button" onClick={handleStart} disabled={hasKey === false}>
              Start Interview
            </button>
          </>
        )}

        {(phase === "chatting" || phase === "finishing") && (
          <div className="chat-shell">
            <div className="option-row">
              <span className="pill">{type}</span>
              <span className="pill">{difficulty}</span>
            </div>

            <div className="chat-log" ref={logRef}>
              {messages.map((m, i) => (
                <div key={i} className={`chat-msg ${m.role === "assistant" ? "interviewer" : "candidate"}`}>
                  <span className="role-tag">{m.role === "assistant" ? "Interviewer" : "You"}</span>
                  {m.content || (streaming && i === messages.length - 1 ? "…" : "")}
                </div>
              ))}
            </div>

            {error && <div className="status-line err">{error}</div>}

            <div className="chat-input-row">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type your response…"
                disabled={streaming || phase === "finishing"}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />
              <button
                className="btn-primary"
                type="button"
                onClick={handleSend}
                disabled={streaming || phase === "finishing" || !draft.trim()}
              >
                Send
              </button>
            </div>

            <div className="chat-actions">
              <button className="btn-secondary" type="button" onClick={handleRestart} disabled={phase === "finishing"}>
                Abandon session
              </button>
              <button
                className="btn-primary"
                type="button"
                onClick={handleFinish}
                disabled={streaming || phase === "finishing" || messages.length < 2}
              >
                {phase === "finishing" ? <>Grading… <span className="spinner-dot" /></> : "Finish Interview"}
              </button>
            </div>
          </div>
        )}

        {phase === "finished" && (
          <div>
            <h2>Scorecard</h2>
            {scorecard ? (
              <div className="scorecard">
                <span className={`scorecard-verdict ${scorecard.verdict}`}>
                  {VERDICT_LABEL[scorecard.verdict] || scorecard.verdict}
                </span>
                <div className="scorecard-section">
                  <h4>Problem-solving approach</h4>
                  <p>{scorecard.problemSolvingApproach}</p>
                </div>
                <div className="scorecard-section">
                  <h4>Correctness</h4>
                  <p>{scorecard.correctness}</p>
                </div>
                <div className="scorecard-section">
                  <h4>Communication clarity</h4>
                  <p>{scorecard.communicationClarity}</p>
                </div>
                <div className="scorecard-section">
                  <h4>Handling of follow-ups</h4>
                  <p>{scorecard.handlingOfFollowUps}</p>
                </div>
                <div className="scorecard-section">
                  <h4>Reasoning</h4>
                  <p>{scorecard.reasoning}</p>
                </div>
                <div className="scorecard-section">
                  <h4>Strengths</h4>
                  <p>{scorecard.strengths?.join(" · ")}</p>
                </div>
                <div className="scorecard-section">
                  <h4>Areas to improve</h4>
                  <p>{scorecard.improvementAreas?.join(" · ")}</p>
                </div>
              </div>
            ) : (
              <div className="callout warn">
                <strong>Couldn&apos;t parse a structured scorecard.</strong> Here&apos;s the
                interviewer&apos;s raw feedback:
                <p style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{scorecardRaw}</p>
              </div>
            )}
            <p className="small muted" style={{ marginTop: 12 }}>
              Saved to your history on the <Link href="/">homepage dashboard</Link>.
            </p>
            <button className="btn-primary" type="button" onClick={handleRestart} style={{ marginTop: 10 }}>
              Start another interview
            </button>
          </div>
        )}
      </main>
    </>
  );
}
