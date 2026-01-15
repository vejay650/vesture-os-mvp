// pages/api/moodboard.ts
import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";

const VERSION = "moodboard-v8-pasteall-2026-01-14";

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

function safeJsonParse(txt: string): any | null {
  try {
    return JSON.parse(txt);
  } catch {
    const m = txt.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
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

// Exclude non-product / nav / editorial pages
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
  "/pages/shop",
  "/shop-all", "/shopall",
];

const EXCLUDE_TERMS = ["kids", "toddler", "boy", "girl", "baby"];

// Brands that often hotlink/block full images; thumb is safer
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

  // nav/editorial penalty
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
  ) return -40;

  // product-ish boost
  if (
    u.includes("/product") ||
    u.includes("/products") ||
    u.includes("/p/") ||
    u.includes("/item/") ||
    u.includes("/dp/") ||
    u.includes("/sku/")
  ) return 24;

  return 0;
}

/* =======================
   Cache (per Vercel instance)
======================= */
type CacheVal = { at: number; data: any };
const CACHE_TTL_MS = 60_000;

const globalAny = globalThis as any;
if (!globalAny.__MOODBOARD_CACHE_V8) globalAny.__MOODBOARD_CACHE_V8 = new Map<string, CacheVal>();
const cache: Map<string, CacheVal> = globalAny.__MOODBOARD_CACHE_V8;

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
- Preserve prompt meaning (colors, materials, vibe)

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
    temperature: 0.15,
    max_tokens: 400,
  });

  const content = resp.choices?.[0]?.message?.content?.trim() || "";
  const parsed = safeJsonParse(content);
  const arr: any[] = Array.isArray(parsed?.queries) ? parsed.queries : [];
  const qs: string[] = arr.map((x: any) => String(x ?? "").trim()).filter(Boolean);
  return Array.from(new Set<string>(qs)).slice(0, 6);
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
    `minimal watch${P} ${g}`,
  ].map(s => s.trim()).slice(0, 6);
}

/* =======================
   OpenAI: reranker (FIXED)
======================= */
async function aiRerank(
  prompt: string,
  gender: string,
  items: Candidate[]
): Promise<{ ids: string[]; ok: boolean; reason?: string; raw?: string }> {
  const apiKey = clean(process.env.OPENAI_API_KEY);
  if (!apiKey) return { ids: [], ok: false, reason: "missing OPENAI_API_KEY" };

  // smaller payload -> more reliable output
  const shortlist = items.slice(0, 30);
  if (shortlist.length < 8) return { ids: [], ok: false, reason: "not enough candidates" };

  const client = new OpenAI({ apiKey });
  const model = clean(process.env.OPENAI_MODEL) || "gpt-4o-mini";

  const payload = shortlist.map((c) => ({
    id: c.id,
    title: c.title.slice(0, 120),
    host: c.host,
    url: c.link.slice(0, 180),
    cat: c.guessedCategory,
    q: c.query.slice(0, 80),
  }));

  const system = `
Return ONLY valid JSON:
{ "ranked_ids": ["id1","id2", ...] }

Rank candidates by best match to the prompt and vibe.
Important:
- Return AT LEAST 18 ids if possible, up to 30.
- Diversity: shoes/bottoms/tops/outerwear/accessories should appear early.
- Penalize nav/editorial pages (shop, collections, blog).
- Strongly penalize farfetch unless it's a perfect match.

Gender hint: "${gender}"
Prompt: "${prompt}"
Candidates: ${JSON.stringify(payload)}
`.trim();

  try {
    const resp = await client.chat.completions.create({
      model,
      messages: [{ role: "system", content: system }],
      temperature: 0.1,
      max_tokens: 900,
    });

    const content = resp.choices?.[0]?.message?.content?.trim() || "";
    const parsed = safeJsonParse(content);

    const arr: any[] = Array.isArray(parsed?.ranked_ids) ? parsed.ranked_ids : [];
    const ids: string[] = arr.map((x: any) => String(x ?? "").trim()).filter(Boolean);

    // ✅ accept shorter lists so rerank actually activates
    if (ids.length >= 5) return { ids, ok: true, raw: content };

    return { ids, ok: false, reason: `rerank ids too short (${ids.length})`, raw: content };
  } catch (e: any) {
    return { ids: [], ok: false, reason: e?.message || "rerank error" };
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

  const cacheKey = `v8:${VERSION}:${gender}:${prompt.toLowerCase()}`;
  const cached = getCache(cacheKey);
  if (cached) return res.status(200).json(cached);

  // Search first 20 sites (5 groups x 4 sites)
  const GROUP_SIZE = 4;
  const MAX_SITE_GROUPS = 5;
  const siteGroups = chunk(sites, GROUP_SIZE)
    .slice(0, MAX_SITE_GROUPS)
    .map((g) => g.map((s) => `site:${s}`).join(" OR "));

  // Queries
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

      const search = `${q} product -pinterest -editorial -review -lookbook (${groupFilter})`;
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

        let score = 0;
        score += productishBoost(link);

        const tokens = q.toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
        const text = (title + " " + link).toLowerCase();
        for (let t = 0; t < tokens.length; t++) if (text.includes(tokens[t])) score += 2;

        // push away farfetch
        if (host.includes("farfetch")) score -= 12;

        // small boosts for good sites
        if (host.includes("ssense")) score += 2;
        if (host.includes("neimanmarcus")) score += 2;
        if (host.includes("nepenthes")) score += 2;
        if (host.includes("ourlegacy")) score += 2;

        const guessed = guessCategory(q, title, link);
        if (guessed === intendedCategory) score += 5;

        if (/(^shop\b|homepage|new arrivals|sale$)/i.test(title)) score -= 20;

        const id = `${host}::${link}::${img}`;
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

  if (saw429 || saw403) {
    const response = {
      images: [] as ImageResult[],
      source: "google-cse",
      debug: {
        version: VERSION,
        prompt,
        querySource,
        rerankSource: "none",
        rerankReason: saw429 ? "429 rate limit" : "403 forbidden",
        queries,
        totalCandidates: candidates.length,
        saw429,
        saw403,
        fetch: fetchDebug,
      },
    };
    setCache(cacheKey, response);
    return res.status(200).json(response);
  }

  // Dedup
  const dedupMap = new Map<string, Candidate>();
  for (const c of candidates) {
    const k = `${c.link}::${c.img}`;
    const prev = dedupMap.get(k);
    if (!prev || c.heuristicScore > prev.heuristicScore) dedupMap.set(k, c);
  }
  const deduped = Array.from(dedupMap.values());
  deduped.sort((a, b) => b.heuristicScore - a.heuristicScore);

  // Rerank
  let rerankSource: "openai" | "heuristic" = "heuristic";
  let rerankReason: string | undefined = undefined;

  const rr = await aiRerank(prompt, gender, deduped);
  if (rr.ok) {
    rerankSource = "openai";
  } else {
    rerankReason = rr.reason;
  }

  let ranked: Candidate[] = [];
  if (rerankSource === "openai") {
    const byId = new Map<string, Candidate>();
    for (const c of deduped) byId.set(c.id, c);

    for (const id of rr.ids) {
      const c = byId.get(id);
      if (c) ranked.push(c);
    }

    const seenId = new Set(ranked.map(r => r.id));
    for (const c of deduped) if (!seenId.has(c.id)) ranked.push(c);
  } else {
    ranked = deduped;
  }

  // Selection caps
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

  function canTake(c: Candidate): boolean {
    const k = `${c.link}::${c.img}`;
    if (seen.has(k)) return false;

    // HARD cap: only 1 Farfetch tile total
    if (c.host.includes("farfetch.com")) {
      const f = domainCount.get("farfetch.com") || 0;
      if (f >= 1) return false;
    }

    const d = domainCount.get(c.host) || 0;
    if (d >= perDomainCap) return false;

    const cc = catCount.get(c.guessedCategory) || 0;
    const cap = capByCat[c.guessedCategory] ?? 3;
    if (cc >= cap) return false;

    return true;
  }

  function take(c: Candidate): boolean {
    if (!canTake(c)) return false;

    const k = `${c.link}::${c.img}`;
    const d = domainCount.get(c.host) || 0;
    const cc = catCount.get(c.guessedCategory) || 0;

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

  // ensure core categories show first
  const core: Category[] = ["shoes", "bottoms", "tops", "outerwear", "accessories"];
  for (const cat of core) {
    for (const c of ranked) {
      if (c.guessedCategory !== cat) continue;
      if (take(c)) break;
    }
  }

  // fill remaining
  for (const c of ranked) {
    if (out.length >= desired) break;
    take(c);
  }

  const response = {
    images: out,
    source: "google-cse",
    debug: {
      version: VERSION,
      prompt,
      querySource,
      rerankSource,
      rerankReason,
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
