// pages/api/curate.ts
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { event, mood } = req.body; // Expect input like { "event": "date night", "mood": "casual" }

    // Call OpenAI API
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1",
        messages: [
          {
            role: "system",
            content: "You are a fashion stylist AI. Suggest stylish outfit combinations based on the event and mood."
          },
          {
            role: "user",
            content: `Suggest an outfit for a ${event} with a ${mood} vibe.`
          }
        ],
      }),
    });

    const data = await response.json();

    const suggestion = data.choices?.[0]?.message?.content || "No suggestion available.";

    res.status(200).json({ suggestion });

  } catch (error: any) {
    console.error("Error in /api/curate:", error);
    res.status(500).json({ error: "Failed to generate outfit suggestion." });
  }
}
