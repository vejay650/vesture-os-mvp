import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    return res.status(200).json({
      status: "alive",
      model: process.env.OPENAI_MODEL || "gpt-4.1",
    });
  }

  try {
    const { event, mood } = req.body || {};

    if (!event || !mood) {
      return res.status(400).json({ error: "Missing event or mood in request body" });
    }

    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1",
      messages: [
        { role: "system", content: "You are a fashion stylist AI that suggests outfits." },
        { role: "user", content: `Suggest an outfit for a ${event} with a ${mood} vibe.` },
      ],
    });

    const suggestion = completion.choices?.[0]?.message?.content ?? "No suggestion available.";
    return res.status(200).json({ suggestion });
  } catch (error: any) {
    // show a safe error for debugging (no secrets logged)
    return res.status(500).json({ error: error?.message || "Unknown error" });
  }
}
