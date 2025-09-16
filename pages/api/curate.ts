// pages/api/curate.ts
import { NextApiRequest, NextApiResponse } from "next";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  // Later, this will call GPT/Stable Diffusion/etc.
  // For now, it’s just a placeholder response.
  res.status(200).json({
    suggestion: "Black turtleneck + tailored trousers + white sneakers",
  });
}
