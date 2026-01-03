// pages/api/moodboard.ts
import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";

const VERSION = "moodboard-v5-balanced-2026-01-02";

/* =======================
   Types
======================= */
type Category = "shoes" | "bottoms" | "tops" | "outerwear" | "accessories" | "other";

type ImageResult = {
  imageUrl: string;
  thumbnailUrl?: string;
  sourceUrl: string;
  title: string;
  provider?: string;
  score?: number;
  query?: string;
  category?: Category;
};

type Candidate = {
  title: string;
  link: string;   // page
  img: string;    // image
  thumb: string;  // thumbnail
  host: string;
  query: string;
  score: number;
  category: Category;          // guessed from title/url/query
  intendedCategory: Category;  // which bucket this query is for
};

/* =======================
   Helpers
======================= */
const clean = (s: any) => (typeof s === "string" ? s.trim() : "");
const normHost = (h: string) => clean(h).replace(/^www\./i, "").toLowerCase();
const toFirstString = (v: any) => (Array.isArray(v) ? v[0] : v);

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* =======================
   Filters / Rules
======================= */
const BLOCKED_DOMAINS = [
  "pinterest.", "pinimg.com",
  "twitter.", "x.com",
  "facebook.", "reddit.", "tumblr.",
  "wikipedia."
];

// Strongly exclude non-product / navigation / editorial pages
const EXCLUDE_INURL = [
  "/kids/", "/girls/", "/boys/", "/baby/",
  "/help/", "/support/", "/customer-service",
  "/press/", "/privacy", "/terms", "/policy",
  "size-guide", "size_guide", "returns", "shipping",
  "/blog", "/blogs", "/journal", "/stories", "/story", "/editorial", "/lookbook",
  "/search", "?q=", "&q=", "/category", "/categories",
  "/collections", "/collection",
  "/pages/", "/page/",
  "/store-locator", "/stores",
];

const EXCLUDE_TERMS = ["kids", "toddler", "boy", "girl", "baby"];

// Hotlink risk domains (prefer thumbs if we have them)
const HOTLINK_RISK = ["louisvuitton.com", "bottegaveneta.com", "versace.com", "moncler.com"];

/* =======================
   Category guesser
======================= */
function guessCategory(q: string, title: string, url: string): Category {
  const t = (q + " " + title + " " + url).toLowerCase();

  if (/(sneaker|sneakers|shoe|shoes|boot|boots|loafer|loafers|heel|heels|trainer|trainers|footwear)/.test(t)) return "shoes";
  if (/(bag|tote|crossbody|shoulder bag|wallet|belt|cap|hat|beanie|scarf|sunglasses|jewelry|necklace|ring|bracelet|watch)/.test(t)) return "accessories";
  if (/(coat|jacket|puffer|parka|blazer|outerwear|trench|bomber|overcoat|denim jacket|leather jacket)/.test(t)) return "outerwear";
  if (/(jean|jeans|denim|trouser|trousers|pant|pants|cargo|short|shorts|skirt|chinos)/.test(t)) return "bottoms";
  if (/(tee|t-shirt|tshirt|shirt|overshirt|top|hoodie|sweater|knit|crewneck|blouse|polo)/.test(t)) return "tops";
  return "other";
}

/* =======================
   Cache (per Vercel instance)
======================= */
type CacheVal = { at: number; data: any };
const CACHE_TTL_MS = 60_000;

const globalAny = globalThis as any;
if (!globalAny.__MOODBOARD_CACHE_V5) globalAny.__MOODBOARD_CACHE_V5 = new Map<string, CacheVal>();
const cache: Map<string, CacheVal> = globalAny.__MOODBOARD_CACHE_V5;

function getCache(key: string): any | null {
  const v = cache.get(key);
  if (!v) return null;
  if (Date.now() - v.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return v.data;
}
function setCache(key: string, data: any) {
  cache.set(key, { at: Date.now(), data });
}

/* =======================
   Product URL scoring
======================= */
function productishBoost(url: string): number {
  const u = (url || "").toLowerCase();

  // HARD penalty for navigation/editorial pages
  if (
    u.includes("/pages/") ||
    u.includes("/page/") ||
    u.includes("/search") ||
    u.includes("/collections") ||
    u.includes("/collection") ||
    u.includes("/blog") ||
    u.includes("/journal") ||
    u.includes("/editorial") ||
    u.includes("/lookbook")
  ) return -30;

  // Strong boost for product-ish urls
  if (
    u.includes("/product") ||
    u.includes("/products") ||
    u.includes("/p/") ||
    u.includes("/item/") ||
    u.includes("/dp/") ||
    u.includes("/sku/") ||
    u.includes("/shop/") // some stores use /shop/ for product
  ) return 22;

  return 0;
}

/* =======================
   Google CSE (single request)
======================= */
async function googleImageSearchOnce(q: string, key: string, cx: string, num: number) {
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("q", q);
  url.searchParams.set("searchType", "image");
  url.searchParams.set("num", String(Math.min(10, Math.max(1, num))));
  url.searchParams.set("start", "1");
  url.searchParams.set("key", key);
  url.searchParams.set("cx", cx);
  url.searchParams.set("imgType", "photo");
  url.searchParams.set("imgSize", "large");
  url.searchParams.set("safe", "active");

  const res = await fetch(url.toString());
  const status = res.status;
  if (!res.ok) return { items: [] as any[], status };

  const data = await res.json();
  const items = (data?.items || []) as any[];
  return { items, status };
}

/* =======================
   OpenAI → 6 category-balanced queries (TS-safe)
======================= */
async function aiQueries(prompt: string, gender: string): Promise<string[]> {
  const apiKey = clean(process.env.OPENAI_API_KEY);
  if (!apiKey) return [];

  const client = new OpenAI({ apiKey });
  const model = clean(process.env.OPENAI_MODEL) || "gpt-4o-mini";

  const system = `
You convert a fashion prompt into EXACTLY 6 retail product search queries.
Return ONLY valid JSON: { "queries": ["...", "...", "...", "...", "...", "..."] }

Rules:
- Each query 3–8 words.
- MUST cover these categories IN THIS ORDER:
  1) shoes
  2) bottoms
  3) tops
  4) outerwear
  5) accessory
  6) wildcard standout item
- Keep the prompt vibe (colors, style words like minimal/streetwear/date night).
- If prompt mentions one category (e.g. boots), only 2 of 6 may be footwear.
- Every query MUST include gender word: "men" or "women" or "unisex".

Gender hint: "${gender}"
Prompt: "${prompt}"
`.trim();

  const resp = await client.chat.completions.create({
    model,
    messages: [{ role: "system", content: system }],
    temperature: 0.25,
  });

  const content = resp.choices?.[0]?.message?.content?.trim() || "";

  try {
    const parsed: any = JSON.parse(content);
    const arr: any[] = Array.isArray(parsed?.queries) ? parsed.queries : [];
    const qs: string[] = arr
      .map((x: any) => String(x ?? "").trim())
      .filter((s: string) => s.length > 0);
    return Array.from(new Set<string>(qs)).slice(0, 6);
  } catch {
    return [];
  }
}

function fallbackQueries(prompt: string, gender: string): string[] {
  const gLc = (gender || "").toLowerCase();
  const g =
    gLc.includes("women") || gLc.includes("female") ? "women" :
    gLc.includes("men") || gLc.includes("male") ? "men" :
    "unisex";

  const p = (prompt || "").toLowerCase().split(/\s+/).slice(0, 6).join(" ");
  const P = p ? ` ${p}` : "";

  // category order: shoes, bottoms, tops, outerwear, accessory, wildcard
  return [
    `black boots${P} ${g}`,
    `tailored trousers${P} ${g}`,
    `button-up shirt${P} ${g}`,
    `minimal blazer${P} ${g}`,
    `leather belt${P} ${g}`,
    `statement jacket${P} ${g}`,
  ].map((s) => s.trim()).slice(0, 6);
}

/* =======================
   Main Handler
======================= */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");

  const input: any = req.method === "POST" ? (req.body || {}) : (req.query || {});
  const qVal = toFirstString(input.q);
  const prompt = clean(input.prompt || qVal || "");
  const gender = clean(input.gender || "unisex");

  if (!prompt) return res.status(400).json({ error: "Missing prompt (send 'prompt' or 'q')" });

  const cseKey = clean(process.env.GOOGLE_CSE_KEY);
  const cseCx = clean(process.env.GOOGLE_CSE_ID);
  if (!cseKey || !cseCx) return res.status(500).json({ error: "Missing GOOGLE_CSE_KEY or GOOGLE_CSE_ID" });

  const sites = clean(process.env.RETAILER_SITES || "")
    .split(",")
    .map(normHost)
    .filter(Boolean);

  if (!sites.length) return res.status(500).json({ error: "RETAILER_SITES is empty" });

  const cacheKey = `v5:${VERSION}:${gender}:${prompt.toLowerCase()}`;
  const cached = getCache(cacheKey);
  if (cached) return res.status(200).json(cached);

  // Keep Google calls low
  const MAX_SITE_GROUPS = 2; // do not exceed
  const GROUP_SIZE = 4;
  const siteGroups = chunk(sites, GROUP_SIZE)
    .slice(0, MAX_SITE_GROUPS)
    .map((g) => g.map((s) => `site:${s}`).join(" OR "));

  // Build balanced queries
  let queries: string[] = [];
  let querySource: "openai" | "fallback" = "fallback";

  const aq = await aiQueries(prompt, gender);
  if (aq.length === 6) {
    queries = aq;
    querySource = "openai";
  } else {
    queries = fallbackQueries(prompt, gender);
    querySource = "fallback";
  }

  // intended category by index (because we forced category order)
  const intended: Category[] = ["shoes", "bottoms", "tops", "outerwear", "accessories", "other"];

  const candidates: Candidate[] = [];
  const fetchDebug: Record<string, any> = {};
  let saw429 = false;
  let saw403 = false;

  // Max requests: 6 queries * 2 groups = 12
  outer: for (let qi = 0; qi < queries.length; qi++) {
    const q = queries[qi];
    const intendedCategory = intended[Math.min(qi, intended.length - 1)];

    fetchDebug[q] = { groupsTried: 0, statusCodes: [] as number[], itemsSeen: 0 };

    for (let gi = 0; gi < siteGroups.length; gi++) {
      const groupFilter = siteGroups[gi];
      fetchDebug[q].groupsTried += 1;

      // Product-first intent + avoid editorial
      const search = `${q} product photo -pinterest -editorial -review (${groupFilter})`;
      const { items, status } = await googleImageSearchOnce(search, cseKey, cseCx, 10);

      fetchDebug[q].statusCodes.push(status);
      fetchDebug[q].itemsSeen += items.length;

      if (status === 429) { saw429 = true; break outer; }
      if (status === 403) { saw403 = true; break outer; }

      for (let i = 0; i < items.length; i++) {
        const it = items[i];

        const img: string = String((it as any)?.link ?? "");
        const thumb: string = String((it as any)?.image?.thumbnailLink ?? "");
        const link: string = String((it as any)?.image?.contextLink ?? "");
        const title: string = String((it as any)?.title ?? "");
        if (!img || !link) continue;

        let host = "";
        try { host = normHost(new URL(link).hostname); } catch { continue; }

        if (BLOCKED_DOMAINS.some((b) => host.includes(b))) continue;
        if (!sites.some((s) => host === s || host.endsWith(s))) continue;

        const urlLc = link.toLowerCase();
        const titleLc = title.toLowerCase();

        // remove junk urls/titles
        if (EXCLUDE_INURL.some((x) => urlLc.includes(x))) continue;
        if (EXCLUDE_TERMS.some((x) => titleLc.includes(x))) continue;

        // scoring
        let score = 0;

        // very strong preference for product pages
        score += productishBoost(link);

        // token overlap score
        const tokens = q.toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
        const text = (title + " " + link).toLowerCase();
        for (let t = 0; t < tokens.length; t++) if (text.includes(tokens[t])) score += 2;

        // small domain tuning
        if (host.includes("farfetch")) score -= 3; // stop farfetch domination
        if (host.includes("ssense")) score += 1;
        if (host.includes("neimanmarcus")) score += 1;
        if (host.includes("nepenthes")) score += 1;

        // category match bonus (so query 2 returns bottoms etc)
        const cat = guessCategory(q, title, link);
        if (cat === intendedCategory) score += 5;

        // penalize obvious non-product titles
        if (/(shop|home|homepage|new arrivals|sale)$/i.test(title)) score -= 10;

        candidates.push({
          title,
          link,
          img,
          thumb,
          host,
          query: q,
          score,
          category: cat,
          intendedCategory,
        });
      }
    }
  }

  // Rank by score
  candidates.sort((a, b) => b.score - a.score);

  /* =======================
     Selection Strategy
     1) Guarantee at least 1 from each main category if possible
     2) Then fill remaining with caps + domain diversity
  ======================= */

  const desired = 18;
  const out: ImageResult[] = [];
  const seen = new Set<string>();
  const domainCount = new Map<string, number>();
  const catCount = new Map<Category, number>();

  const perDomainCap = 3;
  const capByCat: Record<Category, number> = {
    shoes: 4,
    bottoms: 4,
    tops: 4,
    outerwear: 3,
    accessories: 3,
    other: 2,
  };

  function pushCandidate(c: Candidate) {
    const k = `${c.link}::${c.img}`;
    if (seen.has(k)) return false;

    const d = domainCount.get(c.host) || 0;
    if (d >= perDomainCap) return false;

    const cc = catCount.get(c.category) || 0;
    const cap = capByCat[c.category] ?? 3;
    if (cc >= cap) return false;

    // Prefer thumbs for risky brands if available
    const risky = HOTLINK_RISK.some((d2) => c.host.endsWith(d2));
    const imageUrl = risky && c.thumb ? c.thumb : c.img;

    seen.add(k);
    domainCount.set(c.host, d + 1);
    catCount.set(c.category, cc + 1);

    out.push({
      imageUrl,
      thumbnailUrl: c.thumb || undefined,
      sourceUrl: c.link,
      title: c.title,
      provider: c.host,
      score: c.score,
      query: c.query,
      category: c.category,
    });

    return true;
  }

  // Pass 1: ensure core categories appear
  const core: Category[] = ["shoes", "bottoms", "tops", "outerwear", "accessories"];
  for (let ci = 0; ci < core.length; ci++) {
    const cat = core[ci];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (c.category !== cat) continue;
      if (pushCandidate(c)) break;
    }
  }

  // Pass 2: fill remaining with best-scoring while respecting caps
  for (let i = 0; i < candidates.length && out.length < desired; i++) {
    pushCandidate(candidates[i]);
  }

  const response = {
    images: out,
    source: "google-cse",
    debug: {
      version: VERSION,
      prompt,
      querySource,
      queries,
      totalCandidates: candidates.length,
      saw429,
      saw403,
      domainCounts: Object.fromEntries(domainCount.entries()),
      categoryCounts: Object.fromEntries(catCount.entries()),
      fetch: fetchDebug,
      note: saw429
        ? "Google CSE rate-limited (429). Try again in a minute or reduce traffic."
        : saw403
          ? "Google CSE forbidden (403). Check API key restrictions/billing."
          : undefined,
    },
  };

  setCache(cacheKey, response);
  return res.status(200).json(response);
}
