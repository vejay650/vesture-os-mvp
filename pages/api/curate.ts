// pages/api/curate.ts
import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // from Vercel environment variables
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { event, mood } = req.body;

    if (!event || !mood) {
      return res.status(400).json({ error: "Missing event or mood in request body" });
    }

    // Call GPT to generate outfit suggestions
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1",
      messages: [
        {
          role: "system",
          content: "You are a fashion stylist AI that suggests outfits.",
        },
        {
          role: "user",
          content: `Suggest an outfit for a ${event} with a ${mood} vibe.`,
        },
      ],
    });

    const suggestion = completion.choices[0].message?.content || "No suggestion generated.";

    res.status(200).json({ suggestion });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
}
