// /api/insight.js
// Server-side proxy for the Claude API — required because browsers block
// direct calls to api.anthropic.com (CORS). The frontend sends the business
// snapshot here; this function calls Claude and returns the parsed JSON.

export const config = { maxDuration: 30 };

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { prompt } = req.body || {};
  if (!prompt) {
    return res.status(400).json({ error: "Missing prompt" });
  }

  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured on server" });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Claude API error:", data);
      return res.status(response.status).json({ error: data?.error?.message || "Claude API error" });
    }

    const raw = data.content?.map(b => b.text || "").join("") || "";
    const clean = raw.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      console.error("JSON parse failed. Raw response:", raw);
      return res.status(500).json({ error: "Could not parse Claude response as JSON" });
    }

    return res.status(200).json({ insight: parsed });
  } catch (err) {
    console.error("insight handler error:", err);
    return res.status(500).json({ error: err.message });
  }
}
