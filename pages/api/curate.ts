// pages/api/curate.ts
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4.1";

    if (!apiKey) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    // For now, this is just a placeholder response.
    // Later, we’ll actually call OpenAI API with fetch().
    res.status(200).json({
      suggestion: `This is a test using model: ${model}`,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}
