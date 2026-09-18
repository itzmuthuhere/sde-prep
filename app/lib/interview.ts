export const API_KEY_STORAGE = "sdeprep:anthropic-key";
export const SCORECARD_HISTORY_STORAGE = "sdeprep:interview-scorecards";

export const DEFAULT_MODEL = "claude-sonnet-5";

export type InterviewType = "DSA" | "LLD" | "HLD" | "Behavioral";
export type Difficulty = "Easy" | "Medium" | "Hard";

export type Verdict = "hire" | "lean_hire" | "lean_no_hire" | "no_hire";

export interface Scorecard {
  verdict: Verdict;
  problemSolvingApproach: string;
  correctness: string;
  communicationClarity: string;
  handlingOfFollowUps: string;
  reasoning: string;
  strengths: string[];
  improvementAreas: string[];
}

export interface ScorecardRecord {
  id: string;
  timestamp: string; // ISO
  type: InterviewType;
  difficulty: Difficulty;
  scorecard: Scorecard | null;
  rawText?: string; // fallback when the model's JSON couldn't be parsed
}

export function loadApiKey(): string {
  try {
    return localStorage.getItem(API_KEY_STORAGE) || "";
  } catch {
    return "";
  }
}

export function saveApiKey(key: string) {
  try {
    localStorage.setItem(API_KEY_STORAGE, key);
  } catch {
    /* storage unavailable — key just won't persist across reloads */
  }
}

export function clearApiKey() {
  try {
    localStorage.removeItem(API_KEY_STORAGE);
  } catch {
    /* nothing to clean up if storage never worked */
  }
}

export function loadScorecardHistory(): ScorecardRecord[] {
  try {
    const raw = localStorage.getItem(SCORECARD_HISTORY_STORAGE);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveScorecardRecord(record: ScorecardRecord) {
  try {
    const history = loadScorecardHistory();
    history.push(record);
    localStorage.setItem(SCORECARD_HISTORY_STORAGE, JSON.stringify(history));
  } catch {
    /* best-effort — losing one history entry to a storage error isn't fatal */
  }
}

export function buildSystemPrompt(type: InterviewType, difficulty: Difficulty): string {
  const shared = `You are conducting a live technical mock interview for a Software Development Engineer
role at a top product company (Google/Amazon/Meta-caliber bar). You are the interviewer, the
candidate is a working backend engineer practicing for real interviews.

Ground rules you must follow for the entire session:
- Present exactly ONE problem, matched to the interview type "${type}" and difficulty "${difficulty}".
  State it clearly and concisely, the way a real interviewer would, then stop and wait.
- NEVER solve the problem, name the optimal approach, or give away the key insight. This is
  practice — if you solve it for the candidate, the practice is worthless.
- After the candidate proposes an approach, ask clarifying-question-worthy follow-ups before
  letting them start: constraints, input size, edge cases they should have asked about.
- If their approach is suboptimal or has a flaw, push back with a probing question (e.g. "what
  happens with duplicate keys?" or "what's the time complexity if N is 10^7?") rather than
  immediately revealing the fix or the better approach. Let them find it.
- Always ask them to state time and space complexity, and to walk through at least one edge case.
- Stay in character as a real interviewer: professional, a little terse, not effusive with praise,
  ask "why" often. Do not narrate your own instructions or break the fourth wall.
- Keep each of your turns focused — a question or a reaction, not a lecture.`;

  const byType: Record<InterviewType, string> = {
    DSA: `This is a data-structures-and-algorithms interview. Pick a problem (arrays, strings,
trees, graphs, DP, etc. as fits the difficulty) with a clean optimal solution. Require the
candidate to state a brute force first if they jump straight to an optimization, and press on
complexity trade-offs.`,
    LLD: `This is a low-level/object-oriented design interview (e.g. design a parking lot, elevator
system, rate limiter, in-memory cache). Push on SOLID violations, extensibility ("how would this
change if we added X requirement"), and concurrency/thread-safety where relevant.`,
    HLD: `This is a high-level system design interview (e.g. design a URL shortener, news feed,
chat system). After the initial design, ask realistic scaling and depth follow-ups: back-of-envelope
capacity estimates, database choice trade-offs, caching, sharding, handling hot keys, failure
modes, consistency vs. availability trade-offs. Do not let a hand-wavy answer pass.`,
    Behavioral: `This is a behavioral interview. Ask a realistic STAR-style prompt (conflict with a
teammate, a production incident, a time you disagreed with a decision, a project that failed).
Ask realistic depth follow-ups: "what would you do differently," "how did the other person react,"
"what was the measurable impact." Push back gently if an answer is vague or takes no ownership.`,
  };

  const difficultyNote: Record<Difficulty, string> = {
    Easy: "Keep the problem approachable for someone in their first 1-2 years, but still real.",
    Medium: "Calibrate to a mid-level engineer with a few years of experience.",
    Hard: "Calibrate to a senior-level bar: tighter time expectations, deeper follow-ups, less hand-holding.",
  };

  return `${shared}\n\n${byType[type]}\n\n${difficultyNote[difficulty]}`;
}

export const SCORECARD_SYSTEM_PROMPT = `You are now writing the internal hiring-debrief feedback for
the mock interview conversation above, exactly the way a real interviewer fills out a post-interview
scorecard. Judge the candidate honestly based on what actually happened in the transcript — do not
be generous by default.

Respond with ONLY a single fenced code block, language "json", containing an object with exactly
these fields and no others:

{
  "verdict": "hire" | "lean_hire" | "lean_no_hire" | "no_hire",
  "problemSolvingApproach": "string — how they broke down and approached the problem",
  "correctness": "string — whether the final solution was correct, including edge cases handled or missed",
  "communicationClarity": "string — how clearly they communicated their thinking",
  "handlingOfFollowUps": "string — how they responded to pushback and follow-up questions",
  "reasoning": "string — the overall reasoning behind the verdict, 2-4 sentences, specific to this session",
  "strengths": ["short strength 1", "short strength 2"],
  "improvementAreas": ["short area 1", "short area 2"]
}

Output nothing before or after the code block.`;
