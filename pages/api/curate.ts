// pages/api/curate.ts
import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";

type CurateBody = {
  event?: string;
  mood?: string;
  style?: string;   // e.g., streetwear, minimal
  gender?: string;  // e.g., men's / women's / unisex
};

const mockSuggestions = [
  "Black turtleneck + tailored trousers + white sneakers",
  "Oversized blazer + graphic tee + straight-leg jeans",
  "Denim jacket + plain tee + chinos + loafers",
  "Silk blouse + midi skirt + ankle boots",
  "Minimal crewneck + pleated trousers + leather loafers"
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body: CurateBody = (req.body || {}) as CurateBody;
  const { event, mood, style, gender } = body;

  if (!event || !mood) {
    return res.status(400).json({ error: "Please include 'event' and 'mood' in the request body." });
  }

  // Toggle mock quickly via env or missing key
  const useMock =
    String(process.env.USE_MOCK || "").toLowerCase() === "true" ||
    !process.env.OPENAI_API_KEY;

  // If mock: return 3 random picks
  if (useMock) {
    const picks = [...mockSuggestions]
      .sort(() => Math.random() - 0.5)
      .slice(0, 3);
    return res.status(200).json({
      suggestions: picks,
      source: "mock"
    });
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    const prompt = `
You are a concise fashion stylist.
Create exactly 3 short outfit suggestions (one sentence each).
Context:
- Event: ${event}
- Mood: ${mood}
- Style: ${style || "any"}
- Gender: ${gender || "any"}

Return ONLY valid JSON in this exact shape:
{
  "suggestions": [
    "outfit suggestion 1",
    "outfit suggestion 2",
    "outfit suggestion 3"
  ]
}
`.trim();

    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "Respond only with valid JSON. No prose." },
        { role: "user", content: prompt }
      ],
      temperature: 0.7
    });

    const content = completion.choices?.[0]?.message?.content?.trim() || "";
    let json;
    try {
      json = JSON.parse(content);
    } catch {
      // Fallback: try to salvage list from lines if the model didn't return JSON perfectly
      const lines = content
        .split("\n")
        .map(s => s.replace(/^[\s\-\*\d\.\)]+/, "").trim())
        .filter(Boolean);
      json = { suggestions: lines.slice(0, 3) };
    }

    if (!json?.suggestions || !Array.isArray(json.suggestions)) {
      return res.status(200).json({
        suggestions: [
          ...mockSuggestions.sort(() => Math.random() - 0.5).slice(0, 3),
        ],
        source: "fallback"
      });
    }

    return res.status(200).json({ suggestions: json.suggestions, source: "openai", model });
  } catch (err: any) {
    // Graceful fallback on errors/quota
    const picks = [...mockSuggestions]
      .sort(() => Math.random() - 0.5)
      .slice(0, 3);
    return res.status(200).json({
      suggestions: picks,
      source: "fallback",
      note: err?.message || "Error calling OpenAI; returning mock suggestions."
    });
  }
}
