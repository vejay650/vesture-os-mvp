// pages/api/parse.ts
import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";

// --- 1) Simple local fallback parser (never fails) --------------------------
function cheapParse(q: string) {
  const text = q.toLowerCase();

  // crude gender detection
  let gender = "";
  if (/\bmen('|’)?s\b/.test(text) || /\bmens\b/.test(text)) gender = "men's";
  else if (/\bwomen('|’)?s\b/.test(text) || /\bwomens\b/.test(text)) gender = "women's";
  else if (/\bunisex\b/.test(text)) gender = "unisex";

  // split some common “event / mood / style” words
  const events = ["dinner", "wedding", "interview", "vacation", "party", "office", "work", "date"];
  const moods  = ["minimal", "casual", "elegant", "sporty", "cozy", "grunge", "clean", "preppy", "bold"];
  const styles = ["streetwear", "workwear", "techwear", "y2k", "vintage", "oversized", "tailored", "japanese"];

  const found = (list: string[]) => list.find(w => text.includes(w)) || "";

  const event = found(events);
  const mood  = found(moods);
  // include “japanese inspired” etc:
  let style  = found(styles) || (text.includes("japanese") ? "japanese streetwear" : "");

  // brand scrape (very light)
  const brandHints = [
    "nike","adidas","asics","new balance","uniqlo","our legacy","kapital",
    "prada","bottega veneta","cdg","comme des garcons","kith","supreme"
  ];
  const brands = brandHints.filter(b => text.includes(b));

  return { event, mood, style, gender, brands };
}

// --- 2) API handler ----------------------------------------------------------
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // accept either POST JSON or querystring
    const q =
      (req.method === "POST" ? req.body?.q : req.query?.q) as string | undefined;

    if (!q || !q.trim()) {
      return res.status(400).json({ error: "Missing q" });
    }

    // Allow disabling AI from env if you want: DISABLE_PARSE_AI=true
    const aiDisabled = process.env.DISABLE_PARSE_AI === "true";

    // default, cheap, always-works parse
    let parsed = cheapParse(q);

    // Only try OpenAI if enabled and we have a key
    if (!aiDisabled && process.env.OPENAI_API_KEY) {
      try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        // Use a model name that all paid keys have: gpt-4o-mini
        const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

        const prompt = `
Extract a JSON with:
- event (single word if possible)
- mood (single word)
- style (short phrase like "japanese streetwear" or "minimal workwear")
- gender (one of "men's", "women's", "unisex" or empty)
- brands (array of brand names if mentioned)
Only answer with JSON. Text: """${q}"""
`;

        // Either chat.completions or responses works; chat.completions is stable
        const completion = await openai.chat.completions.create({
          model,
          messages: [
            { role: "system", content: "You extract structured fashion intent." },
            { role: "user", content: prompt }
          ],
          temperature: 0.1
        });

        const raw = completion.choices?.[0]?.message?.content || "{}";
        const ai = JSON.parse(raw);

        // Merge AI fields over the cheap ones if present
        parsed = {
          event: ai.event || parsed.event,
          mood: ai.mood || parsed.mood,
          style: ai.style || parsed.style,
          gender: ai.gender || parsed.gender,
          brands: Array.isArray(ai.brands) ? ai.brands : parsed.brands || []
        };
      } catch (e: any) {
        // If OpenAI errors (e.g. invalid model), continue with cheapParse
        console.warn("AI parse failed; using fallback:", e?.message || e);
      }
    }

    return res.status(200).json({ q, ...parsed });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Unexpected error" });
  }
}
