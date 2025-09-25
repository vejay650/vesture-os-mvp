// pages/api/moodboard.ts
import type { NextApiRequest, NextApiResponse } from "next";

type ImageResult = {
  imageUrl: string;
  sourceUrl: string;
  title: string;
  thumbnailUrl?: string;
  provider?: string;
};

// URL path allow/deny
const INCLUDE_INURL = [
  "product", "products", "prod", "shop", "shopping",
  "collection", "collections", "catalog", "lookbook",
  "men", "mens", "women", "womens", "unisex"
];

const EXCLUDE_INURL = [
  "blog", "story", "stories", "journal", "news",
  "/a/", "/help", "customer-service", "returns",
  "gift-card", "kids", "terms", "privacy", "size",
  "guide", "legal", "careers", "press"
];

const IMG_EXTS = [".jpg", ".jpeg", ".png", ".webp"];

function normalizeUrl(u: string) {
  try {
    return new URL(u);
  } catch {
    return null;
  }
}

function goodPath(url: string) {
  const u = normalizeUrl(url);
  if (!u) return false;
  const p = u.pathname.toLowerCase();
  const hasGood = INCLUDE_INURL.some(k => p.includes(k));
  const hasBad  = EXCLUDE_INURL.some(k => p.includes(k));
  if (hasBad) return false;
  if (!hasGood) return false;
  // Prefer images that look like product/editorial photos
  const hasExt = IMG_EXTS.some(ext => p.endsWith(ext));
  return hasExt || true; // set to true so we don't drop CDN images missing extension
}

function tokenScore(text: string, tokens: string[]) {
  const t = text.toLowerCase();
  let score = 0;
  for (const tok of tokens) {
    if (!tok) continue;
    const k = tok.toLowerCase();
    if (t.includes(k)) score += 1;
  }
  return score;
}

function buildQuery({
  event,
  mood,
  style,
  gender,
  sites,
}: {
  event?: string;
  mood?: string;
  style?: string;
  gender?: string;
  sites: string[];
}) {
  // Core intent tokens
  const intentBits = [event, mood, style, gender]
    .filter(Boolean)
    .map(s => String(s));

  // Encourage fashion imagery
  // (Use OR to let Google match one of these)
  const fashionBits = `(outfit OR "lookbook" OR "street style" OR "styled looks")`;

  // Build per-site clause: site:domain (inurl:product OR inurl:collection ...) -inurl:blog ...
  const inurlAllow = INCLUDE_INURL.map(k => `inurl:${k}`).join(" OR ");
  const inurlDeny  = EXCLUDE_INURL.map(k => `-inurl:${k}`).join(" ");

  const siteClauses = sites.map(d => {
    return `(site:${d} (${inurlAllow}) ${inurlDeny})`;
  });

  const siteFilter = siteClauses.join(" OR ");

  // Final query: tokens + fashion terms + site filters
  const base = (intentBits.join(" ") || "outfit").trim();
  // IMPORTANT: keep "outfit" in there to anchor relevance
  const q = `${base} ${fashionBits} ${siteFilter}`.trim();
  return q;
}

async function searchGoogleImages(q: string, wantCount = 18): Promise<ImageResult[]> {
  const key = process.env.GOOGLE_CSE_KEY!;
  const cx  = process.env.GOOGLE_CSE_ID!;
  if (!key || !cx) throw new Error("Missing GOOGLE_CSE_KEY or GOOGLE_CSE_ID");

  const pageSize = 10;
  const pages = Math.ceil(Math.min(wantCount, 30) / pageSize);

  const all: ImageResult[] = [];

  for (let i = 0; i < pages; i++) {
    const start = i * pageSize + 1; // 1, 11, 21 ...
    const url = new URL("https://www.googleapis.com/customsearch/v1");
    url.searchParams.set("q", q);
    url.searchParams.set("searchType", "image");
    url.searchParams.set("num", String(pageSize));
    url.searchParams.set("start", String(start));
    url.searchParams.set("imgType", "photo"); // avoid clipart, faces, etc.
    url.searchParams.set("safe", "active");
    url.searchParams.set("key", key);
    url.searchParams.set("cx", cx);

    const res = await fetch(url.toString());
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Google CSE error: ${res.status} ${t}`);
    }
    const data = await res.json();

    const items = (data.items || []).map((it: any) => ({
      imageUrl: it.link,
      sourceUrl: it.image?.contextLink || it.link,
      title: it.title || "",
      thumbnailUrl: it.image?.thumbnailLink,
      provider: normalizeUrl(it.link)?.hostname.replace(/^www\./, ""),
    })) as ImageResult[];

    all.push(...items);
  }

  return all;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { q, event, mood, style, gender, count = 18 } = (req.method === "GET" ? req.query : req.body) as any;

    const sites =
      (process.env.RETAILER_SITES || "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);

    if (sites.length === 0) {
      return res.status(500).json({ error: "No retailer sites configured (RETAILER_SITES)" });
    }

    // Prefer single free-text q, otherwise compose from fields
    const query = buildQuery({
      event: q || event,
      mood,
      style,
      gender,
      sites,
    });

    const raw = await searchGoogleImages(query, Number(count));

    // First level filter: path sanity (avoid blogs, help, etc.)
    let filtered = raw.filter(r => goodPath(r.sourceUrl) || goodPath(r.imageUrl));

    // (Optional) if still noisy, require provider host to be one of our sites
    const siteSet = new Set(sites.map(d => d.replace(/^www\./, "")));
    filtered = filtered.filter(r => {
      const host = normalizeUrl(r.sourceUrl || r.imageUrl)?.hostname.replace(/^www\./, "");
      return host ? siteSet.has(host) || [...siteSet].some(s => host.endsWith(s)) : false;
    });

    // Re-rank by simple keyword score
    const intentTokens = (q ? String(q) : [event, mood, style, gender].filter(Boolean).join(" "))
      .split(/\s+/)
      .filter(Boolean);

    const scored = filtered
      .map(item => {
        const text = `${item.title} ${item.provider ?? ""}`;
        return { item, score: tokenScore(text, intentTokens) };
      })
      .sort((a, b) => b.score - a.score)
      .map(x => x.item);

    // De-dup by image URL
    const seen = new Set<string>();
    const unique = scored.filter(x => {
      if (!x.imageUrl || seen.has(x.imageUrl)) return false;
      seen.add(x.imageUrl);
      return true;
    });

    res.status(200).json({
      query,
      images: unique.slice(0, Number(count)),
      source: "google-cse",
      page: { count: unique.length }
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Unexpected error" });
  }
}
