import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { event, vibe, budget, palette } = req.query;

  if (!event || !vibe || !budget || !palette) {
    return res.status(400).json({ error: "Missing query params" });
  }

  try {
    const prompt = `Suggest 3 stylish outfits for ${event}, vibe ${vibe}, budget ${budget}, colors ${palette}.`;

    const completion = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1",
      input: prompt,
    });

    const outfits = completion.output[0].content[0].text.split("\n").filter(Boolean);

    res.status(200).json({ outfits });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch AI response" });
  }
}
