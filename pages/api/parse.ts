// pages/api/parse.ts
import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";

export type ParsedQuery = {
  event?: string;             // e.g. "dinner", "wedding", "lookbook"
  mood?: string;              // e.g. "minimal", "elegant", "grungy"
  style?: string;             // e.g. "japanese workwear", "streetwear"
  gender?: string;            // "men's" | "women's" | "unisex" | undefined
  items: string[];            // e.g. ["oversized pants", "graphic tee", "sneakers"]
};

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const q = (req.body?.q || req.query?.q || "").toString().trim();
    if (!q) return res.status(400).json({ error: "Missing q" });

    // Short, structured prompt that forces JSON only
    const sys =
      "You extract fashion intent from a short sentence. Output compact JSON only. " +
      "Infer at most one event, one mood, one style, and (men's|women's|unisex) if present. " +
      "Return up to 4 garment categories the user likely wants (e.g. 'oversized pants', 'graphic tee', 'loafers', 'sneakers', 'denim jacket').";

    const usr = `Text: "${q}"
Return JSON with keys: event, mood, style, gender, items (array). Example:
{"event":"dinner","mood":"minimal","style":"japanese workwear","gender":"unisex","items":["oversized pants","loafers","boxy tee"]}`;

    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: usr },
      ],
      temperature: 0.2,
    });

    const raw = completion.choices?.[0]?.message?.content?.trim() || "{}";
    let parsed: ParsedQuery;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { items: [] } as ParsedQuery;
    }

    // Normalize types
    parsed.items = Array.isArray(parsed.items) ? parsed.items.slice(0, 6) : [];
    if (parsed.gender) {
      const g = parsed.gender.toLowerCase();
      if (!["men's", "women's", "unisex"].includes(g)) parsed.gender = undefined;
      else parsed.gender = g as "men's" | "women's" | "unisex";
    }

    res.status(200).json({ q, parsed });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Unexpected error" });
  }
}
