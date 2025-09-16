// pages/api/curate.ts
import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { event, mood } = req.body || {};

    if (!event || !mood) {
      return res.status(400).json({ error: "Missing event or mood in request body" });
    }

    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a fashion stylist AI that suggests concise outfit ideas." },
        { role: "user", content: `Suggest an outfit for a ${event} with a ${mood} vibe.` },
      ],
      temperature: 0.7,
    });

    const suggestion = completion.choices?.[0]?.message?.content?.trim() || "No suggestion generated.";
    res.status(200).json({ suggestion, source: "openai" });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
}

