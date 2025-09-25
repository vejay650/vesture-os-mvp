// pages/api/moodboard.ts
import type { NextApiRequest, NextApiResponse } from "next";

type ImageResult = {
  imageUrl: string;
  sourceUrl: string;
  title: string;
  thumbnailUrl?: string;
  provider?: string;
};

// --- helpers -------------------------------------------------------------

function normalizeUrl(u?: string): URL | null {
  try {
    if (!u) return null;
    return new URL(u);
  } catch {
    return null;
  }
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function uniq<T>(arr: T[], key: (x: T) => string) {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of arr) {
    const k = key(x);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

// --- Google CSE ----------------------------------------------------------

async function searchGoogleImages(query: string, start: number, num: number): Promise<ImageResult[]> {
  const key = process.env.GOOGLE_CSE_KEY!;
  const cx = process.env.GOOGLE_CSE_ID!;
  if (!key || !cx) throw new Error("Missing GOOGLE_CSE_KEY or GOOGLE_CSE_ID");

  // Google returns at most 10 items per call
  num = clamp(num, 1, 10);

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("q", query);
  url.searchParams.set("searchType", "image");
  url.searchParams.set("safe", "active");
  url.searchParams.set("num", String(num));
  url.searchParams.set("start", String(start));
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
    provider: normalizeUrl(it.link)?.hostname.replace(/^www\./, ""),
  }));
  return results;
}

// --- Query building ------------------------------------------------------

type Intent = {
  event?: string;
  mood?: string;
  style?: string;
  gender?: string;
  items?: string[];
};

function buildSiteFilter(sites: string[]) {
  return sites.map((s) => `site:${s}`).join(" OR ");
}

function buildBaseString({ event, mood, style, gender }: Intent) {
  // Only include defined tokens
  const parts = [event, mood, style, gender].filter(Boolean);
  return parts.join(" ").trim();
}

function buildQueries(intent: Intent, sites: string[]) {
  const base = buildBaseString(intent);
  const siteFilter = buildSiteFilter(sites);
  const queries: string[] = [];

  // Base query
  queries.push(`${base} outfit ${siteFilter}`.trim());

  // Per-garment queries to increase diversity
  const items = (intent.items || []).slice(0, 6);
  for (const item of items) {
    const q = `${item} ${base} outfit ${siteFilter}`.trim();
    queries.push(q);
  }
  return uniq(queries.filter(Boolean), (q) => q);
}

// --- Handler -------------------------------------------------------------

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // payload can come from /api/parse or direct manual fields
    const {
      q,
      event,
      mood,
      style,
      gender,
      items = [],
      target = 24,          // desired images to return
    } = (req.body || {}) as Intent & { q?: string; target?: number };

    const intent: Intent = {
      event,
      mood,
      style,
      gender,
      items: Array.isArray(items) ? items : [],
    };

    if (!intent.event && !intent.mood && !intent.style && !q) {
      return res.status(400).json({ error: "Provide q or one of: event, mood, style" });
    }

    // If only q is provided, treat it like a rough base signal.
    if (q && !intent.event && !intent.mood && !intent.style) {
      intent.style = q;
    }

    // Sites whitelist
    const sites =
      (process.env.RETAILER_SITES || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

    if (sites.length === 0) {
      return res.status(500).json({ error: "No retailer sites configured (RETAILER_SITES)" });
    }

    // Build multiple queries (base + per garment)
    const queries = buildQueries(intent, sites);

    // Pull images in small batches across queries
    const want = clamp(Number(target) || 24, 6, 48);
    const perCall = 8; // 8 per request (<=10)
    const results: ImageResult[] = [];
    let start = 1;

    outer: for (const q of queries) {
      for (let page = 0; page < 2; page++) {   // 2 pages per query (tune as needed)
        const batch = await searchGoogleImages(q, start, perCall);
        results.push(...batch);
        if (results.length >= want * 2) break outer; // stop early if we have enough to prune
        start += perCall;
      }
      start = 1; // reset pagination for next query
    }

    // Dedup by URL & trim giant duplicates from same host
    let filtered = uniq(results, (r) => r.imageUrl);

    // Strong whitelist by hostname endsWith(whitelistedSite)
    const siteSet = new Set(sites);
    filtered = filtered.filter((r) => {
      const host = normalizeUrl(r.sourceUrl || r.imageUrl)?.hostname.replace(/^www\./, "");
      if (!host) return false;
      if (siteSet.has(host)) return true;
      // allow subdomains like cdn.sanity.io when root is in the list
      return Array.from(siteSet).some((s) => host.endsWith(s));
    });

    // Cap duplicates from the same host to keep variety
    const hostCount = new Map<string, number>();
    const diverse: ImageResult[] = [];
    const hostCap = 6; // at most N images per host

    for (const img of filtered) {
      const host = (normalizeUrl(img.sourceUrl || img.imageUrl)?.hostname || "").replace(/^www\./, "");
      const count = hostCount.get(host) || 0;
      if (count >= hostCap) continue;
      hostCount.set(host, count + 1);
      diverse.push(img);
      if (diverse.length >= want) break;
    }

    res.status(200).json({
      queries,
      count: diverse.length,
      images: diverse,
      source: "google-cse",
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Unexpected error" });
  }
}
