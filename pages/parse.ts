// pages/api/parse.ts
import type { NextApiRequest, NextApiResponse } from "next";

type ParsedFields = {
  event: string;
  mood: string;
  style: string;
  gender: "men's" | "women's" | "unisex" | "";
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { q } = req.body || {};
  if (!q || typeof q !== "string" || !q.trim()) {
    return res.status(400).json({ error: "Provide q: string" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  if (!apiKey) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

  const system = `
You extract wardrobe query fields from natural language into strict JSON.

Rules:
- Always return valid JSON with keys: event, mood, style, gender.
- event: short phrase (e.g., "wedding", "dinner", "job interview").
- mood: vibe/adj (e.g., "minimal", "elegant", "casual").
- style: style family (e.g., "japanese workwear", "streetwear", "preppy").
- gender: "men's" | "women's" | "unisex" (default "unisex" if unclear).
- Do not add extra keys or commentary.
`;

  const user = `Text: ${q}\nReturn JSON only.`;

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: system.trim() },
          { role: "user", content: user },
        ],
      }),
    });

    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({ error: `OpenAI error ${r.status}: ${t}` });
    }

    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content || "{}";
    let parsed: ParsedFields;
    try {
      parsed = JSON.parse(content);
    } catch {
      // fallback: try to extract with a second pass if model returned code fences
      const m = content.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : { event: "", mood: "", style: "", gender: "unisex" };
    }

    // normalize fields
    const out: ParsedFields = {
      event: (parsed.event || "").trim(),
      mood: (parsed.mood || "").trim(),
      style: (parsed.style || "").trim(),
      gender: (parsed.gender || "unisex") as ParsedFields["gender"],
    };

    return res.status(200).json(out);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Unexpected error" });
  }
}
