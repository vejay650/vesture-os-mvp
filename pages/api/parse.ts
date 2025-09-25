// pages/api/parse.ts
import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Very simple parser that tries to pull out event, mood, style, gender from a free-text query.
 * (You can swap this for an OpenAI-powered parser later.)
 */
function naiveParse(q: string) {
  const lower = q.toLowerCase();

  // crude lists you can tune
  const moods = ["casual", "elegant", "minimal", "chill", "cozy", "bold"];
  const styles = ["streetwear", "workwear", "japanese", "vintage", "classic", "y2k", "techwear"];
  const genders = ["men", "men's", "womens", "women", "women's", "unisex"];

  const foundMood = moods.find((m) => lower.includes(m)) || "";
  const foundStyle =
    styles.find((s) => lower.includes(s)) ||
    (lower.includes("japanese workwear") ? "japanese workwear" : "");
  const foundGender = genders.find((g) => lower.includes(g)) || "";

  // naive event: look for words after “for” or “to a”
  let event = "";
  const forIdx = lower.indexOf(" for ");
  if (forIdx >= 0) {
    event = lower.slice(forIdx + 5).split(/[.,;!]/)[0].trim();
  }
  if (!event) {
    const toAIdx = lower.indexOf(" to a ");
    if (toAIdx >= 0) event = lower.slice(toAIdx + 5).split(/[.,;!]/)[0].trim();
  }

  return {
    event: event || "",
    mood: foundMood,
    style: foundStyle || (lower.includes("workwear") ? "workwear" : ""),
    gender: foundGender || "",
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { q } = (req.body || {}) as { q?: string };
    if (!q || !q.trim()) return res.status(400).json({ error: "Missing q" });

    // If you later want to use OpenAI here, you can—this endpoint will still be the same.
    const parsed = naiveParse(q);
    return res.status(200).json(parsed);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Unexpected error" });
  }
}
