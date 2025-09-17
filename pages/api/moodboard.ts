// pages/api/moodboard.ts
import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";

/**
 * This endpoint:
 * 1) asks GPT to structure an outfit concept with brand references
 * 2) turns that into an SDXL prompt
 * 3) calls Replicate to generate 1–2 images
 * 4) returns { imageUrls, outfit, references }
 */

type Body = {
  event?: string;
  mood?: string;
  style?: string;
  gender?: string;
  count?: number; // how many images to generate
};

const SMALL_LABELS_HINT = `
Smaller/indie labels to favor in suggestions:
- Kapital (Japan), Story Mfg, Our Legacy, Wales Bonner, A-Cold-Wall, Needles, Martine Rose, Kiko Kostadinov, JJJJound (collabs), Aimé Leon Dore.
`;

const BIG_BRANDS_HINT = `
Also include some well-known brands/retailers:
- Prada, CDG (Comme des Garçons), Acne Studios, COS, Farfetch catalog, Nike/Asics sneakers.
`;

const DEFAULT_NEGATIVE = "low quality, deformed, extra fingers, text, watermark, logo, collage of tiny tiles";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const {
      event = "",
      mood = "",
      style = "",
      gender = "",
      count = 1,
    } = (req.body || {}) as Body;

    const openaiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    const replicateKey = process.env.REPLICATE_API_TOKEN;

    if (!openaiKey) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    if (!replicateKey) return res.status(500).json({ error: "Missing REPLICATE_API_TOKEN" });

    // 1) Ask GPT for a structured outfit + brand references
    const client = new OpenAI({ apiKey: openaiKey });

    const prompt = `
You are a concise fashion stylist.

Create ONE outfit concept (title + 4 items) for:
- Event: ${event || "unspecified"}
- Mood: ${mood || "unspecified"}
- Style: ${style || "any"}
- Gender: ${gender || "any"}

Prioritize smaller/indie labels but mix in some known brands. Include 2–4 clickable reference links (Instagram brand pages or retailer listings like Farfetch).

Return ONLY JSON in this exact shape:
{
  "outfit_name": "string",
  "items": [
    { "piece": "string", "brand_examples": ["string", "string"] },
    { "piece": "string", "brand_examples": ["string"] },
    { "piece": "string", "brand_examples": ["string"] },
    { "piece": "string", "brand_examples": ["string"] }
  ],
  "references": ["https://...", "https://..."]
}

${SMALL_LABELS_HINT}
${BIG_BRANDS_HINT}
    `.trim();

    const c = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "Respond ONLY with valid JSON. No prose." },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
    });

    const content = c.choices?.[0]?.message?.content?.trim() || "{}";
    let outfitJson: any;
    try {
      outfitJson = JSON.parse(content);
    } catch {
      outfitJson = { outfit_name: "Curated Look", items: [], references: [] };
    }

    // 2) Build an SDXL prompt from the outfit
    const itemsLine =
      Array.isArray(outfitJson?.items) && outfitJson.items.length
        ? outfitJson.items
            .map(
              (it: any) =>
                `${it.piece}${
                  it.brand_examples?.length
                    ? ` (brands: ${it.brand_examples.join(", ")})`
                    : ""
                }`
            )
            .join(", ")
        : `${style} ${mood} outfit`;

    const sdxlPrompt = `
Editorial fashion lookbook photo, full body, ${gender || "unisex"} model.
${itemsLine}.
Refined styling, natural pose, studio lighting, 50mm lens feel, high detail, draped fabrics, realistic textures.
Trending street-lux aesthetic, clean background.
    `.trim();

    // 3) Call Replicate SDXL
    // Model reference: stability-ai/sdxl or replicate/sdxl - versions can change; this is a common default.
    const version = process.env.REPLICATE_SDXL_VERSION || "stability-ai/sdxl"; // you can pin a specific version string later

    const genCount = Math.max(1, Math.min(2, Number(count) || 1)); // 1–2 images for MVP

    const replicateRes = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Token ${replicateKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Note: You can swap to a specific SDXL version if you prefer.
        // Check your Replicate dashboard for the exact "version" for SDXL you want.
        version,
        input: {
          prompt: sdxlPrompt,
          negative_prompt: DEFAULT_NEGATIVE,
          num_outputs: genCount,
          // Optional tuning knobs:
          cfg_scale: 6.5,
          aspect_ratio: "1:1",
          output_format: "png",
        },
      }),
    });

    if (!replicateRes.ok) {
      const t = await replicateRes.text();
      return res.status(500).json({ error: "Replicate error", details: t });
    }

    const replicateData = await replicateRes.json();

    // Replicate returns a prediction object; we may need to poll the status URL until "succeeded".
    // For MVP, do a simple poll loop (max ~20s).
    let statusData = replicateData;
    const statusUrl = replicateData?.urls?.get as string | undefined;
    const started = Date.now();

    while (
      statusUrl &&
      statusData?.status &&
      ["starting", "processing", "pending"].includes(statusData.status) &&
      Date.now() - started < 20000
    ) {
      await new Promise((r) => setTimeout(r, 1500));
      const poll = await fetch(statusUrl, {
        headers: { Authorization: `Token ${replicateKey}` },
      });
      statusData = await poll.json();
    }

    if (statusData?.status !== "succeeded") {
      return res.status(200).json({
        imageUrls: [],
        outfit: outfitJson,
        references: outfitJson?.references || [],
        note: "Image generation still running or failed; try again.",
        status: statusData?.status || "unknown",
      });
    }

    const imageUrls: string[] = statusData?.output || [];

    return res.status(200).json({
      imageUrls,
      outfit: outfitJson,
      references: outfitJson?.references || [],
      prompt: sdxlPrompt,
      source: "replicate-sdxl",
    });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: err?.message || "Failed to generate moodboard." });
  }
}
