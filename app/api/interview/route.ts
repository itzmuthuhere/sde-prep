import { DEFAULT_MODEL } from "@/app/lib/interview";

export const dynamic = "force-dynamic";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

interface InterviewRequestBody {
  apiKey?: string;
  model?: string;
  system?: string;
  messages?: { role: "user" | "assistant"; content: string }[];
  max_tokens?: number;
  stream?: boolean;
}

// This route is a pure server-side pass-through: the client's own Anthropic API
// key travels in the request body for this single call only. It is never
// logged, written to disk, or forwarded anywhere except api.anthropic.com.
export async function POST(req: Request) {
  let body: InterviewRequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }

  const { apiKey, model, system, messages, max_tokens, stream } = body;

  if (!apiKey || typeof apiKey !== "string") {
    return jsonError("Missing Anthropic API key. Add one on the Settings page.", 400);
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonError("Missing conversation messages.", 400);
  }

  let upstream: Response;
  try {
    upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        system,
        messages,
        max_tokens: max_tokens || 1024,
        stream: stream !== false,
      }),
    });
  } catch {
    return jsonError("Could not reach the Anthropic API. Check your network connection.", 502);
  }

  // Forward Anthropic's response verbatim (status, content-type, and body —
  // streamed SSE bytes or a JSON error) without buffering or inspecting it.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") || "application/json",
      "cache-control": "no-cache, no-transform",
    },
  });
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
