// pages/api/moodboard.ts
import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";

const VERSION = "moodboard-v6-rerank-2026-01-03";

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
  id: string;
  title: string;
  link: string;
  img: string;
  thumb?: string;
  host: string;
  query: string;
  intendedCategory: Category;
  guessedCategory: Category;
  heuristicScore: number;
};

/* =======================
   Helpers
======================= */
const clean = (s: any): string => (typeof s === "string" ? s.trim() : "");
const normHost = (h: string): string => clean(h).replace(/^www\./i, "").toLowerCase();
const toFirstString = (v: any): string => (Array.isArray(v) ? String(v[0] ?? "") : String(v ?? ""));

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

// Strongly exclude non-product / nav / editorial pages
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
  "/pages/shop", // kills Supreme shop/nav pages
];

const EXCLUDE_TERMS = ["kids", "toddler", "boy", "girl", "baby"];

// Some brands hotlink / block image URLs. If thumb exists, prefer it.
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
   Product-ish scoring
======================= */
function productishBoost(url: string): number {
  const u = (url || "").toLowerCase();

  // HARD penalty for nav/editorial pages
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
    u.includes("/sku/")
  ) return 22;

  return 0;
}

/* =======================
   Cache (per Vercel instance)
======================= */
type CacheVal = { at: number; data: any };
const CACHE_TTL_MS = 90_000;

const globalAny = globalThis as any;
if (!globalAny.__MOODBOARD_CACHE_V6) globalAny.__MOODBOARD_CACHE_V6 = new Map<string, CacheVal>();
const cache: Map<string, CacheVal> = globalAny.__MOODBOARD_CACHE_V6;

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
   Google CSE (single call)
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
   OpenAI: query generator (balanced)
======================= */
async function aiQueries(prompt: string, gender: string): Promise<string[]> {
  const apiKey = clean(process.env.OPENAI_API_KEY);
  if (!apiKey) return [];

  const client = new OpenAI({ apiKey });
  const model = clean(process.env.OPENAI_MODEL) || "gpt-4o-mini";

  const system = `
Return ONLY valid JSON: { "queries": ["...", "...", "...", "...", "...", "..."] }

Generate EXACTLY 6 product search queries for retail sites.
Each query MUST:
- Be 3–8 words
- Include gender word: "men" or "women" or "unisex"
- Preserve prompt meaning (colors, materials, vibe, culture words like japanese, minimal, date night)

Category order MUST be:
1) shoes
2) bottoms
3) tops
4) outerwear
5) accessory
6) wildcard standout item

If prompt mentions one category (like boots), only TWO of the 6 may be footwear.

Gender hint: "${gender}"
Prompt: "${prompt}"
`.trim();

  const resp = await client.chat.completions.create({
    model,
    messages: [{ role: "system", content: system }],
    temperature: 0.2,
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

  const p = (prompt || "").toLowerCase().split(/\s+/).slice(0, 5).join(" ");
  const P = p ? ` ${p}` : "";

  return [
    `minimal boots${P} ${g}`,
    `tailored trousers${P} ${g}`,
    `clean shirt${P} ${g}`,
    `sleek blazer${P} ${g}`,
    `leather belt${P} ${g}`,
    `statement jacket${P} ${g}`,
  ].map(s => s.trim()).slice(0, 6);
}

/* =======================
   OpenAI: reranker (the intelligence)
======================= */
async function aiRerank(prompt: string, gender: string, items: Candidate[]): Promise<string[]> {
  const apiKey = clean(process.env.OPENAI_API_KEY);
  if (!apiKey) return [];

  // Limit tokens/cost: rerank only top N candidates
  const TOP_N = 60;
  const shortlist = items.slice(0, TOP_N);

  const client = new OpenAI({ apiKey });
  const model = clean(process.env.OPENAI_MODEL) || "gpt-4o-mini";

  const payload = shortlist.map((c) => ({
    id: c.id,
    title: c.title,
    url: c.link,
    host: c.host,
    guessedCategory: c.guessedCategory,
    intendedCategory: c.intendedCategory,
    query: c.query,
  }));

  const system = `
You are a fashion retail reranker. Your job: rank candidates by how well they match the user's prompt.

Return ONLY valid JSON:
{ "ranked_ids": ["id1","id2", ...] }

Rules:
- Prioritize items that strongly match the prompt meaning and vibe.
- Prefer REAL product pages over navigation/editorial pages.
- Maintain diversity across categories in the top ranks (shoes/bottoms/tops/outerwear/accessories).
- If prompt includes a specific item (e.g. boots), shoes can lead but should not dominate all results.
- Penalize irrelevant categories, wrong vibe, generic "shop" pages.

Gender hint: "${gender}"
Prompt: "${prompt}"
Candidates: ${JSON.stringify(payload)}
`.trim();

  const resp = await client.chat.completions.create({
    model,
    messages: [{ role: "system", content: system }],
    temperature: 0.1,
  });

  const content = resp.choices?.[0]?.message?.content?.trim() || "";
  try {
    const parsed: any = JSON.parse(content);
    const arr: any[] = Array.isArray(parsed?.ranked_ids) ? parsed.ranked_ids : [];
    const ids: string[] = arr.map((x: any) => String(x ?? "").trim()).filter(Boolean);
    return ids;
  } catch {
    return [];
  }
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

  const cacheKey = `v6:${VERSION}:${gender}:${prompt.toLowerCase()}`;
  const cached = getCache(cacheKey);
  if (cached) return res.status(200).json(cached);

  // Keep Google calls low
  const MAX_SITE_GROUPS = 2;
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

  const intendedByIndex: Category[] = ["shoes", "bottoms", "tops", "outerwear", "accessories", "other"];

  const candidates: Candidate[] = [];
  const fetchDebug: Record<string, any> = {};
  let saw429 = false;
  let saw403 = false;

  // Retrieve candidates
  outer: for (let qi = 0; qi < queries.length; qi++) {
    const q = queries[qi];
    const intendedCategory = intendedByIndex[Math.min(qi, intendedByIndex.length - 1)];

    fetchDebug[q] = { groupsTried: 0, statusCodes: [] as number[], itemsSeen: 0 };

    for (let gi = 0; gi < siteGroups.length; gi++) {
      const groupFilter = siteGroups[gi];
      fetchDebug[q].groupsTried += 1;

      // Strong "product" intent + avoid junk
      const search = `${q} product photo -pinterest -editorial -review -lookbook (${groupFilter})`;
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
        if (EXCLUDE_INURL.some((x) => urlLc.includes(x))) continue;
        if (EXCLUDE_TERMS.some((x) => titleLc.includes(x))) continue;

        // Heuristic score (pre-rerank filter)
        let score = 0;
        score += productishBoost(link);

        const tokens = q.toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
        const text = (title + " " + link).toLowerCase();
        for (let t = 0; t < tokens.length; t++) if (text.includes(tokens[t])) score += 2;

        // soften farfetch domination
        if (host.includes("farfetch")) score -= 4;
        if (host.includes("ssense")) score += 1;
        if (host.includes("neimanmarcus")) score += 1;
        if (host.includes("nepenthes")) score += 1;

        const guessed = guessCategory(q, title, link);
        if (guessed === intendedCategory) score += 4;

        // kill obvious nav pages by title
        if (/(^shop\b|homepage|new arrivals|sale$)/i.test(title)) score -= 12;

        const id = `${host}::${link}::${img}`; // stable
        candidates.push({
          id,
          title,
          link,
          img,
          thumb: thumb || undefined,
          host,
          query: q,
          intendedCategory,
          guessedCategory: guessed,
          heuristicScore: score,
        });
      }
    }
  }

  // If rate limited, return debug cleanly
  if (saw429 || saw403) {
    const response = {
      images: [] as ImageResult[],
      source: "google-cse",
      debug: {
        version: VERSION,
        prompt,
        querySource,
        queries,
        totalCandidates: candidates.length,
        saw429,
        saw403,
        fetch: fetchDebug,
        note: saw429
          ? "Google CSE rate-limited (429). Try again in ~60s or reduce traffic."
          : "Google CSE forbidden (403). Check API key restrictions/billing.",
      },
    };
    setCache(cacheKey, response);
    return res.status(200).json(response);
  }

  // Deduplicate by link + image
  const dedupMap = new Map<string, Candidate>();
  for (const c of candidates) {
    const k = `${c.link}::${c.img}`;
    const prev = dedupMap.get(k);
    if (!prev || c.heuristicScore > prev.heuristicScore) dedupMap.set(k, c);
  }
  const deduped = Array.from(dedupMap.values());

  // Sort by heuristic first (so reranker sees better set)
  deduped.sort((a, b) => b.heuristicScore - a.heuristicScore);

  // RERANK (the intelligence)
  let rerankSource: "openai" | "heuristic" = "heuristic";
  const rankedIds = await aiRerank(prompt, gender, deduped);
  if (rankedIds.length > 5) rerankSource = "openai";

  let ranked: Candidate[] = [];
  if (rerankSource === "openai") {
    const byId = new Map<string, Candidate>();
    for (const c of deduped) byId.set(c.id, c);
    for (const id of rankedIds) {
      const c = byId.get(id);
      if (c) ranked.push(c);
    }
    // append anything not returned by model
    const seenId = new Set(ranked.map(r => r.id));
    for (const c of deduped) if (!seenId.has(c.id)) ranked.push(c);
  } else {
    ranked = deduped;
  }

  // Selection with category + domain diversity
  const desired = 18;
  const perDomainCap = 3;
  const capByCat: Record<Category, number> = {
    shoes: 4,
    bottoms: 4,
    tops: 4,
    outerwear: 3,
    accessories: 3,
    other: 2,
  };

  const out: ImageResult[] = [];
  const seen = new Set<string>();
  const domainCount = new Map<string, number>();
  const catCount = new Map<Category, number>();

  function pick(c: Candidate): boolean {
    const k = `${c.link}::${c.img}`;
    if (seen.has(k)) return false;

    const d = domainCount.get(c.host) || 0;
    if (d >= perDomainCap) return false;

    const cc = catCount.get(c.guessedCategory) || 0;
    const cap = capByCat[c.guessedCategory] ?? 3;
    if (cc >= cap) return false;

    const risky = HOTLINK_RISK.some((d2) => c.host.endsWith(d2));
    const imageUrl = risky && c.thumb ? c.thumb : c.img;

    seen.add(k);
    domainCount.set(c.host, d + 1);
    catCount.set(c.guessedCategory, cc + 1);

    out.push({
      imageUrl,
      thumbnailUrl: c.thumb,
      sourceUrl: c.link,
      title: c.title,
      provider: c.host,
      score: c.heuristicScore,
      query: c.query,
      category: c.guessedCategory,
    });
    return true;
  }

  // Ensure core categories appear first if possible
  const core: Category[] = ["shoes", "bottoms", "tops", "outerwear", "accessories"];
  for (const cat of core) {
    for (const c of ranked) {
      if (c.guessedCategory !== cat) continue;
      if (pick(c)) break;
    }
  }

  // Fill remaining
  for (const c of ranked) {
    if (out.length >= desired) break;
    pick(c);
  }

  const response = {
    images: out,
    source: "google-cse",
    debug: {
      version: VERSION,
      prompt,
      querySource,
      rerankSource,
      queries,
      totalCandidates: candidates.length,
      totalDeduped: deduped.length,
      domainCounts: Object.fromEntries(domainCount.entries()),
      categoryCounts: Object.fromEntries(catCount.entries()),
      fetch: fetchDebug,
    },
  };

  setCache(cacheKey, response);
  return res.status(200).json(response);
}
