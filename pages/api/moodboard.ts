// pages/api/moodboard.ts
import type { NextApiRequest, NextApiResponse } from "next";

type ImageResult = {
  imageUrl: string;
  sourceUrl: string;
  title: string;
  thumbnailUrl?: string;
  provider?: string;
  width?: number;
  height?: number;
};

const BLOCKED_DOMAINS = [
  "pinterest.", "pinimg.com", "twitter.com", "x.com",
  "facebook.com", "wikipedia.org", "reddit.com", "tumblr.com",
  "youtube.com", "tiktok.com", "blogger.com", "medium.com",
];

const NON_PRODUCT_HINTS = [
  "lookbook", "editorial", "news", "press", "runway",
  "magazine", "journal", "story", "guide", "blog",
];

const PRODUCT_HINTS = [
  "/product", "/products", "/shop", "/collections", "/item",
  "/catalog", "/p/", "/store", "sku=", "pid=", "prodid=",
];

const MIN_W = 500;
const MIN_H = 500;

function normHost(host: string) {
  return host.replace(/^www\./i, "").toLowerCase();
}

function cleanUrl(u?: string | null) {
  if (!u) return "";
  try {
    const url = new URL(u);
    url.hash = "";
    url.search = "";
    return url.toString();
  } catch {
    return u;
  }
}

function fileExt(u: string) {
  try {
    const p = new URL(u).pathname.toLowerCase();
    const m = p.match(/\.(jpg|jpeg|png|webp)$/i);
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

function baseFilename(u: string) {
  try {
    const p = new URL(u).pathname;
    return p.split("/").pop() || "";
  } catch {
    return "";
  }
}

function containsAny(hay: string, needles: string[]) {
  const H = hay.toLowerCase();
  return needles.some((n) => H.includes(n.toLowerCase()));
}

function buildQuery({
  q,
  event,
  mood,
  style,
  gender,
  sites,
}: {
  q?: string;
  event?: string;
  mood?: string;
  style?: string;
  gender?: string;
  sites: string[];
}) {
  const terms: string[] = [];
  if (q) terms.push(q);
  if (event) terms.push(event);
  if (mood) terms.push(mood);
  if (style) terms.push(style);
  if (gender) terms.push(gender);

  // product bias terms
  terms.push("outfit");
  terms.push("shop");

  // restrict to your sites
  const siteFilter = sites.map((s) => `site:${s}`).join(" OR ");

  // steer Google towards product/category pages
  const inurlBias = "(inurl:product OR inurl:products OR inurl:shop OR inurl:collections OR inurl:item OR inurl:catalog OR inurl:p/)";

  // soft-block some noisy sources
  const domainBlocks = BLOCKED_DOMAINS.map((d) => `-site:${d}`).join(" ");

  const core = terms.filter(Boolean).join(" ");

  // Example final query:
  // "oversized japanese streetwear outfit shop (inurl:product ... ) site:brand1 OR site:brand2 ... -site:pinterest ..."
  const qstr = `${core} ${inurlBias} ${siteFilter} ${domainBlocks}`.trim();
  return qstr;
}

async function searchGoogleImages(query: string, count = 18): Promise<ImageResult[]> {
  const key = process.env.GOOGLE_CSE_KEY!;
  const cx  = process.env.GOOGLE_CSE_ID!;
  if (!key || !cx) throw new Error("Missing GOOGLE_CSE_KEY or GOOGLE_CSE_ID");

  // Google CSE returns at most 10 images per call. We'll page as needed.
  const want = Math.min(count, 30);
  const out: ImageResult[] = [];

  for (let start = 1; start <= want; start += 10) {
    const url = new URL("https://www.googleapis.com/customsearch/v1");
    url.searchParams.set("q", query);
    url.searchParams.set("searchType", "image");
    url.searchParams.set("num", String(Math.min(10, want - (start - 1))));
    url.searchParams.set("start", String(start));
    url.searchParams.set("imgType", "photo"); // bias to photos (not clipart)
    url.searchParams.set("imgSize", "large"); // large images
    url.searchParams.set("key", key);
    url.searchParams.set("cx", cx);

    const res = await fetch(url.toString());
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Google CSE error: ${res.status} ${t}`);
    }
    const data = await res.json();
    const items = data.items || [];
    for (const it of items) {
      const link = it.link as string;
      const ctx  = (it.image?.contextLink || it.link) as string;
      const host = normHost(new URL(ctx).hostname);
      out.push({
        imageUrl: link,
        sourceUrl: ctx,
        title: it.title,
        thumbnailUrl: it.image?.thumbnailLink,
        provider: host,
        width: it.image?.width ? Number(it.image.width) : undefined,
        height: it.image?.height ? Number(it.image.height) : undefined,
      });
    }
  }
  return out;
}

function filterAndRank(raw: ImageResult[], sites: string[], userWords: string[]) {
  const siteSet = new Set(sites.map((s) => s.toLowerCase()));
  const words = userWords.map((w) => w.toLowerCase()).filter(Boolean);

  // 1) Drop blocked domains + small/odd files + non jpg/png
  let results = raw.filter((r) => {
    if (!r.imageUrl || !r.sourceUrl) return false;

    const host = normHost(new URL(r.sourceUrl).hostname);
    if ([...BLOCKED_DOMAINS].some((d) => host.includes(d))) return false;

    const ext = fileExt(r.imageUrl);
    if (!["jpg", "jpeg", "png", "webp"].includes(ext)) return false;

    const w = r.width || 0;
    const h = r.height || 0;
    if (w && h && (w < MIN_W || h < MIN_H)) return false;

    return true;
  });

  // 2) Keep only allowed retailers (host endsWith any site in RETAILER_SITES)
  results = results.filter((r) => {
    const host = normHost(new URL(r.sourceUrl).hostname);
    return [...siteSet].some((s) => host.endsWith(s));
  });

  // 3) Prefer product-like URLs; drop obvious editorial/blog if we have enough left
  const looksNonProduct = (u: string) =>
    containsAny(u, NON_PRODUCT_HINTS);

  const looksProducty = (u: string) =>
    containsAny(u, PRODUCT_HINTS);

  // If we have a lot, cull non-product pages
  if (results.length > 10) {
    const strong = results.filter((r) => looksProducty(r.sourceUrl) || looksProducty(r.imageUrl));
    if (strong.length >= 8) results = strong;
    else results = results.filter((r) => !looksNonProduct(r.sourceUrl) && !looksNonProduct(r.imageUrl));
  }

  // 4) Scoring
  const score = (r: ImageResult) => {
    let s = 0;

    const url = (r.sourceUrl + " " + r.imageUrl + " " + (r.title || "")).toLowerCase();
    for (const w of words) {
      if (url.includes(w)) s += 3;
    }
    if (looksProducty(r.sourceUrl) || looksProducty(r.imageUrl)) s += 10;
    if (looksNonProduct(r.sourceUrl) || looksNonProduct(r.imageUrl)) s -= 4;

    // prefer bigger images a bit
    if (r.width && r.height) {
      const area = r.width * r.height;
      if (area > 1200 * 1200) s += 2;
      if (area > 1600 * 1600) s += 2;
    }

    return s;
  };

  // 5) Deduplicate (image URL, file name, and canonical page URL)
  const seenImg = new Set<string>();
  const seenFile = new Set<string>();
  const seenPage = new Set<string>();
  const dedup: ImageResult[] = [];

  for (const r of results.sort((a, b) => score(b) - score(a))) {
    const imgKey = cleanUrl(r.imageUrl);
    const pageKey = cleanUrl(r.sourceUrl);
    const fileKey = baseFilename(r.imageUrl).toLowerCase();

    if (seenImg.has(imgKey)) continue;
    if (fileKey && seenFile.has(fileKey)) continue;
    if (seenPage.has(pageKey)) continue;

    seenImg.add(imgKey);
    if (fileKey) seenFile.add(fileKey);
    seenPage.add(pageKey);
    dedup.push(r);
  }

  return dedup;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const {
      q,
      event,
      mood,
      style,
      gender,
      count = 18,
    } = (req.method === "POST" ? req.body : req.query) as Record<string, any>;

    // retailer allow-list
    const sites = (process.env.RETAILER_SITES || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (sites.length === 0) {
      return res.status(500).json({ error: "No retailer sites configured (RETAILER_SITES)" });
    }

    if (!q && !event && !mood && !style) {
      return res.status(400).json({ error: "Provide q or one of: event, mood, style" });
    }

    const query = buildQuery({ q, event, mood, style, gender, sites });
    const userWords = (q || `${event} ${mood} ${style} ${gender}`).split(/\s+/).filter(Boolean);

    const raw = await searchGoogleImages(query, Number(count));
    const images = filterAndRank(raw, sites, userWords).slice(0, Number(count) || 18);

    res.status(200).json({ query, images, source: "google-cse" });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Unexpected error" });
  }
}
