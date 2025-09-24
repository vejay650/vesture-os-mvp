// pages/api/moodboard.ts
import type { NextApiRequest, NextApiResponse } from "next";

type ImageResult = {
  imageUrl: string;
  sourceUrl: string;
  title: string;
  thumbnailUrl?: string;
  provider?: string;
};

function sanitize(text?: string) {
  return (text || "").toString().trim();
}

function buildQuery({
  event,
  mood,
  style,
  gender,
  brands,
  sites,
}: {
  event?: string;
  mood?: string;
  style?: string;
  gender?: string;
  brands?: string[];
  sites?: string[];
}) {
  const parts = [event, mood, style, gender].map(sanitize).filter(Boolean);
  let q = (parts.join(" ") || "outfit").trim();
  if (brands && brands.length) q += " " + brands.map(sanitize).join(" ");

  // Only add site filters if we actually have sites configured.
  if (sites && sites.length > 0) {
    const siteFilter = sites.map((s) => `site:${s}`).join(" OR ");
    q = `${q} outfit ${siteFilter}`;
  } else {
    q = `${q} outfit`;
  }
  return q;
}

async function searchGoogleImages(query: string, count = 12, start = 1): Promise<ImageResult[]> {
  const key = process.env.GOOGLE_CSE_KEY;
  const cx = process.env.GOOGLE_CSE_ID;
  if (!key || !cx) {
    throw new Error(
      "Missing GOOGLE_CSE_KEY or GOOGLE_CSE_ID. Add them in Vercel → Settings → Environment Variables."
    );
  }

  // Google caps num at 10 per request; start is 1-based index
  const num = Math.max(1, Math.min(10, Number(count) || 10));
  const startIdx = Math.max(1, Math.min(91, Number(start) || 1)); // CSE allows up to ~100 results

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("q", query);
  url.searchParams.set("searchType", "image");
  url.searchParams.set("num", String(num));
  url.searchParams.set("start", String(startIdx));
  url.searchParams.set("key", key);
  url.searchParams.set("cx", cx);
  // (SafeSearch + site restrictions are primarily controlled in your CSE; we keep this simple.)

  const res = await fetch(url.toString());
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Google CSE error ${res.status}: ${t}`);
  }
  const data = await res.json();

  const items: any[] = Array.isArray(data?.items) ? data.items : [];
  const results: ImageResult[] = items.map((it) => ({
    imageUrl: it.link,
    sourceUrl: it.image?.contextLink || it.link,
    title: it.title,
    thumbnailUrl: it.image?.thumbnailLink,
    provider: (() => {
      try {
        return new URL(it.link).hostname.replace(/^www\./, "");
      } catch {
        return undefined;
      }
    })(),
  }));

  return results;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Accept POST (recommended) and GET (for quick manual tests with query string)
  const isPost = req.method === "POST";
  if (!isPost && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Read inputs from body (POST) or query (GET) for convenience
    const src: any = isPost ? req.body || {} : req.query || {};
    const event = sanitize(src.event);
    const mood = sanitize(src.mood);
    const style = sanitize(src.style);
    const gender = sanitize(src.gender);
    const brands = Array.isArray(src.brands)
      ? src.brands.map(sanitize)
      : typeof src.brands === "string" && src.brands.length
      ? src.brands.split(",").map(sanitize)
      : undefined;

    const count = Number(src.count) || 12;
    const start = Number(src.start) || 1;

    // If you didn't pass any of event/mood/style, we still proceed (fallback query)
    const sites =
      (process.env.RETAILER_SITES || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

    const query = buildQuery({ event, mood, style, gender, brands, sites: sites.length ? sites : undefined });

    const images = await searchGoogleImages(query, count, start);

    // Dedup by image URL
    const seen = new Set<string>();
    const unique = images.filter((x) => {
      if (!x.imageUrl || seen.has(x.imageUrl)) return false;
      seen.add(x.imageUrl);
      return true;
    });

    return res.status(200).json({
      query,
      images: unique,
      source: "google-cse",
      page: { start, count: Math.min(count, 10) },
    });
  } catch (err: any) {
    return res.status(500).json({
      error: err?.message || "Unexpected error",
    });
  }
}
