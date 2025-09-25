// pages/api/moodboard.ts
import type { NextApiRequest, NextApiResponse } from "next";

type ImageResult = {
  imageUrl: string;
  sourceUrl: string;
  title: string;
  thumbnailUrl?: string;
  provider?: string;
};

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
  sites: string[];
}) {
  const parts = [event, mood, style, gender].filter(Boolean);
  let q = (parts.join(" ") || "outfit").trim();
  if (brands && brands.length) q += " " + brands.join(" ");
  const siteFilter = sites.map((s) => `site:${s}`).join(" OR ");
  return `${q} outfit ${siteFilter}`;
}

async function searchGoogleImages(query: string, count = 12): Promise<ImageResult[]> {
  const key = process.env.GOOGLE_CSE_KEY!;
  const cx = process.env.GOOGLE_CSE_ID!;
  if (!key || !cx) throw new Error("Missing GOOGLE_CSE_KEY or GOOGLE_CSE_ID");

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("q", query);
  url.searchParams.set("searchType", "image");
  url.searchParams.set("num", String(Math.min(count, 10))); // Google caps at 10 per request
  url.searchParams.set("key", key);
  url.searchParams.set("cx", cx);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Google CSE error: ${res.status} ${t}`);
  }
  const data = await res.json();

  const results: ImageResult[] = (data.items || []).map((it: any) => ({
    imageUrl: it.link,
    sourceUrl: it.image?.contextLink || it.link,
    title: it.title,
    thumbnailUrl: it.image?.thumbnailLink,
    provider: new URL(it.link).hostname.replace(/^www\./, ""),
  }));
  return results;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { q, event, mood, style, gender, brands, count = 12 } = req.body || {};

    // Sites come from RETAILER_SITES (comma-separated hostnames)
    const sites =
      (process.env.RETAILER_SITES || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

    if (sites.length === 0) {
      return res.status(500).json({ error: "No retailer sites configured (RETAILER_SITES)" });
    }

    // if q is provided by the search bar, use it directly + restrict to sites
    // otherwise build from event/mood/style/gender
    const text = (q || "").trim();
    const query = text
      ? `${text} outfit ${sites.map((s) => `site:${s}`).join(" OR ")}`
      : buildQuery({ event, mood, style, gender, brands, sites });

    const images = await searchGoogleImages(query, count);

    // Dedup by image URL
    const seen = new Set<string>();
    const unique = images.filter((x) => {
      if (!x.imageUrl || seen.has(x.imageUrl)) return false;
      seen.add(x.imageUrl);
      return true;
    });

    res.status(200).json({
      query,
      images: unique,
      source: "google-cse",
      page: { start: 1, count: unique.length },
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Unexpected error" });
  }
}
