// pages/api/moodboard.ts
import type { NextApiRequest, NextApiResponse } from "next";

type ImageResult = {
  imageUrl: string;
  sourceUrl: string;
  title: string;
  provider?: string;
};

// ---------- tuning ----------
const BLOCKED_DOMAINS = [
  "pinterest.", "pinimg.com", "twitter.com", "x.com",
  "facebook.com", "wikipedia.org", "reddit.com", "tumblr.com",
  "youtube.com", "tiktok.com", "blogger.com", "medium.com",
];

const INCLUDE_INURL = [
  "product", "products", "prod", "shop", "store",
  "collections", "collection", "catalog", "item", "p/",
  "men", "mens", "women", "womens", "unisex"
];

const EXCLUDE_INURL = [
  "kids", "kid", "boys", "boy", "girls", "girl",
  "junior", "baby", "infant", "toddler",
  "lookbook", "editorial", "runway",
  "story", "stories", "journal", "news", "press",
  "guide", "size", "help", "faq", "terms", "privacy", "careers", "magazine"
];

const EXCLUDE_TERMS = [
  "kids", "kid", "boys", "boy", "girls", "girl",
  "junior", "baby", "infant", "toddler"
];

const WANT_COUNT_DEFAULT = 24;

// ---------- helpers ----------
function normHost(h: string) { return h.replace(/^www\./i, "").toLowerCase(); }
function cleanUrl(u: string) {
  try { const x = new URL(u); x.hash=""; x.search=""; return x.toString(); } catch { return u; }
}
function containsAny(s: string, list: string[]) {
  const t = s.toLowerCase();
  return list.some(w => t.includes(w.toLowerCase()));
}
function buildSiteFilter(sites: string[]) {
  return sites.map(s => `site:${s}`).join(" OR ");
}

function buildWebQuery(
  { q, event, mood, style, gender, sites }:
  { q?: string; event?: string; mood?: string; style?: string; gender?: string; sites: string[] }
) {
  const bits: string[] = [];
  if (q && q.trim()) bits.push(q.trim());
  else {
    if (event) bits.push(event);
    if (mood)  bits.push(mood);
    if (style) bits.push(style);
    if (gender) bits.push(gender);
  }
  // anchor to fashion shopping
  bits.push("outfit", "shop");

  const allow = "(" + INCLUDE_INURL.map(k => `inurl:${k}`).join(" OR ") + ")";
  const deny  = EXCLUDE_INURL.map(k => `-inurl:${k}`).join(" ");
  const site  = buildSiteFilter(sites);

  const core = bits.filter(Boolean).join(" ");
  const qstr = `${core} ${allow} ${site} ${deny}`.trim();
  const excl = EXCLUDE_TERMS.join(","); // for CSE excludeTerms param
  return { qstr, excludeTerms: excl };
}

async function googleWebSearch(qstr: string, excludeTerms: string, start: number, num: number) {
  const key = process.env.GOOGLE_CSE_KEY!;
  const cx  = process.env.GOOGLE_CSE_ID!;
  if (!key || !cx) throw new Error("Missing GOOGLE_CSE_KEY or GOOGLE_CSE_ID");

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("q", qstr);
  url.searchParams.set("num", String(Math.min(num, 10)));
  url.searchParams.set("start", String(start));      // 1, 11, 21...
  url.searchParams.set("key", key);
  url.searchParams.set("cx", cx);
  if (excludeTerms) url.searchParams.set("excludeTerms", excludeTerms);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Google CSE web error: ${res.status} ${t}`);
  }
  const data = await res.json();
  return (data.items || []) as any[];
}

function extractImageFromItem(it: any): string | null {
  // Prefer cse_image (CSE already parsed OG image)
  const pm = it.pagemap || {};
  const cseImg = Array.isArray(pm.cse_image) && pm.cse_image[0]?.src;
  if (cseImg) return cseImg as string;

  // Fallback: common meta tags if present
  const meta = Array.isArray(pm.metatags) && pm.metatags[0];
  if (meta?.["og:image"]) return meta["og:image"];
  if (meta?.["twitter:image"]) return meta["twitter:image"];

  return null;
}

function scoreCandidate(title: string, url: string, userWords: string[]) {
  let s = 0;
  const full = (title + " " + url).toLowerCase();

  // keyword match boosts
  for (const w of userWords) if (w && full.includes(w.toLowerCase())) s += 2;

  // producty URL boosts
  if (containsAny(url, INCLUDE_INURL)) s += 6;

  // editorial/blog penalties
  if (containsAny(url, EXCLUDE_INURL)) s -= 4;

  return s;
}

// ---------- API handler ----------
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const payload = (req.method === "POST" ? req.body : req.query) as any;
    const { q, event, mood, style, gender } = payload;
    const count = Math.max(6, Math.min(Number(payload?.count) || WANT_COUNT_DEFAULT, 48));

    // retailer allow list
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

    const { qstr, excludeTerms } = buildWebQuery({ q, event, mood, style, gender, sites });
    const userWords = (q || `${event} ${mood} ${style} ${gender}` || "")
      .split(/\s+/)
      .map((t: string) => t.trim())
      .filter(Boolean);

    // Pull multiple pages of **web** results (not image results)
    const rawItems: any[] = [];
    for (let start = 1; start <= 21; start += 10) { // pages at 1, 11, 21
      const batch = await googleWebSearch(qstr, excludeTerms, start, 10);
      rawItems.push(...batch);
      if (rawItems.length >= 30) break;
    }

    // Map → candidates
    let candidates = rawItems.map((it) => {
      const link: string = it.link;
      const img  = extractImageFromItem(it);
      const title: string = it.title || "";
      const host = normHost(new URL(link).hostname);
      return { link, img, title, host };
    });

    // Filter: allowed hosts only (endsWith any site), block noisy domains, remove kids/editorial
    const siteSet = new Set(sites.map(s => s.toLowerCase()));
    candidates = candidates.filter(c => {
      if (!c.img || !c.link) return false;
      if (BLOCKED_DOMAINS.some(d => c.host.includes(d))) return false;

      const allowed = Array.from(siteSet).some(s => c.host === s || c.host.endsWith(s));
      if (!allowed) return false;

      const url = (c.link + "").toLowerCase();
      if (containsAny(url, EXCLUDE_INURL)) return false;

      return true;
    });

    // Score & sort
    candidates.sort((a, b) =>
      scoreCandidate(b.title, b.link, userWords) - scoreCandidate(a.title, a.link, userWords)
    );

    // De-duplicate by image URL and page URL (normalized)
    const seenImg = new Set<string>();
    const seenPage = new Set<string>();
    const images: ImageResult[] = [];
    for (const c of candidates) {
      const imgKey = cleanUrl(c.img);
      const pageKey = cleanUrl(c.link);
      if (!imgKey || !pageKey) continue;
      if (seenImg.has(imgKey) || seenPage.has(pageKey)) continue;
      seenImg.add(imgKey); seenPage.add(pageKey);
      images.push({
        imageUrl: c.img,
        sourceUrl: c.link,
        title: c.title,
        provider: c.host
      });
      if (images.length >= count) break;
    }

    return res.status(200).json({ query: qstr, images, source: "google-cse-web" });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Unexpected error" });
  }
}
