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
  rawQ,
}: {
  event?: string;
  mood?: string;
  style?: string;
  gender?: string;
  brands?: string[];
  sites: string[];
  rawQ?: string;
}) {
  // If a raw query was provided, just use it directly.
  if (rawQ && rawQ.trim()) {
    const siteFilter = sites.map((s) => `site:${s}`).join(" OR ");
    return `${rawQ.trim()} outfit ${siteFilter}`;
  }

  // Otherwise construct from fields
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
  url.searchParams.set("num", String(Math.min(count, 10))); // Google caps 10 per request
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

function normalizeHost(u: string) {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { event, mood, style, gender, brands, count = 12 } = body;
    // Accept q from body or query (so GET links work too)
    const rawQ: string | undefined = body.q ?? (typeof req.query.q === "string" ? req.query.q : undefined);

    const sites = (process.env.RETAILER_SITES || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (sites.length === 0) {
      return res.status(500).json({ error: "No retailer sites configured (RETAILER_SITES)" });
    }

    // If no structured fields but rawQ exists, proceed with rawQ.
    if (!event && !style && !mood && !(rawQ && rawQ.trim())) {
      return res.status(400).json({ error: "Provide at least one of: event, mood, style, or q" });
    }

    const query = buildQuery({ event, mood, style, gender, brands, sites, rawQ });

    let images = await searchGoogleImages(query, count);

    // Dedup + keep within allowed domains
    const seen = new Set<string>();
    const siteSet = new Set(sites.map((d) => d.replace(/^www\./, "")));

    images = images.filter((x) => {
      if (!x.imageUrl || seen.has(x.imageUrl)) return false;
      seen.add(x.imageUrl);

      const host = normalizeHost(x.sourceUrl || x.imageUrl);
      if (!host) return false;

      // allow exact host or suffix match
      return siteSet.has(host) || Array.from(siteSet).some((s) => host.endsWith(s));
    });

    res.status(200).json({ query, images, source: "google-cse" });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Unexpected error" });
  }
}
