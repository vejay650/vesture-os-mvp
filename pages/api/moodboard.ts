// pages/api/moodboard.ts
import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";

const VERSION = "moodboard-v12-STABLE-FINAL-2026-01-15";

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

function uniq(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    const k = String(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

function hash32(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const isFarfetch = (host: string) => host.includes("farfetch.com");

/* =======================
   Filters / Rules
======================= */
const BLOCKED_DOMAINS = [
  "pinterest.",
  "pinimg.com",
  "twitter.",
  "x.com",
  "facebook.",
  "reddit.",
  "tumblr.",
  "wikipedia.",
];

const EXCLUDE_INURL = [
  "/kids/",
  "/girls/",
  "/boys/",
  "/baby/",
  "/help/",
  "/support/",
  "/customer-service",
  "/press/",
  "/privacy",
  "/terms",
  "/policy",
  "size-guide",
  "size_guide",
  "returns",
  "shipping",
  "/blog",
  "/blogs",
  "/journal",
  "/stories",
  "/story",
  "/editorial",
  "/lookbook",
  "/search",
  "?q=",
  "&q=",
  "/category",
  "/categories",
  "/collections",
  "/collection",
  "/pages/",
  "/page/",
  "/store-locator",
  "/stores",
  "/pages/shop",
  "/shop-all",
  "/shopall",
];

const EXCLUDE_TERMS = ["kids", "toddler", "boy", "girl", "baby"];

const HOTLINK_RISK = ["louisvuitton.com", "bottegaveneta.com", "versace.com", "moncler.com"];

/* =======================
   Gender hard filter
======================= */
function isWomenItem(title: string, url: string): boolean {
  const t = (title + " " + url).toLowerCase();
  return (
    t.includes("/women") ||
    t.includes("/womens") ||
    t.includes("women") ||
    t.includes("womens") ||
    t.includes("female") ||
    t.includes("dress") ||
    t.includes("skirt") ||
    t.includes("bra") ||
    t.includes("lingerie") ||
    t.includes("heels") ||
    t.includes("stiletto")
  );
}
function isMenItem(title: string, url: string): boolean {
  const t = (title + " " + url).toLowerCase();
  return t.includes("/men") || t.includes("/mens") || t.includes("men") || t.includes("mens") || t.includes("male");
}
function genderReject(title: string, url: string, gender: string): boolean {
  const g = (gender || "").toLowerCase();
  if (g.includes("men")) return isWomenItem(title, url); // men mode: reject women-coded items
  if (g.includes("women")) return isMenItem(title, url); // women mode: reject men-coded items
  return false; // unisex
}

/* =======================
   Category guesser
======================= */
function guessCategory(q: string, title: string, url: string): Category {
  const t = (q + " " + title + " " + url).toLowerCase();

  if (/(sneaker|sneakers|shoe|shoes|boot|boots|loafer|loafers|trainer|trainers|footwear)/.test(t)) return "shoes";
  if (
    /(bag|tote|crossbody|shoulder bag|wallet|belt|cap|hat|beanie|scarf|sunglasses|jewelry|necklace|ring|bracelet|watch)/.test(
      t
    )
  )
    return "accessories";
  if (/(coat|jacket|puffer|parka|blazer|outerwear|trench|bomber|overcoat|denim jacket|leather jacket)/.test(t))
    return "outerwear";
  if (/(jean|jeans|denim|trouser|trousers|pant|pants|cargo|short|shorts|chinos)/.test(t)) return "bottoms";
  if (/(tee|t-shirt|tshirt|shirt|overshirt|top|hoodie|sweater|knit|crewneck|polo)/.test(t)) return "tops";
  return "other";
}

/* =======================
   Product-ish scoring
======================= */
function productishBoost(url: string): number {
  const u = (url || "").toLowerCase();

  // kill nav/editorial pages
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
  )
    return -40;

  // boost product paths
  if (
    u.includes("/product") ||
    u.includes("/products") ||
    u.includes("/p/") ||
    u.includes("/item/") ||
    u.includes("/dp/") ||
    u.includes("/sku/")
  )
    return 24;

  return 0;
}

/* =======================
   Cache (per Vercel instance)
======================= */
type CacheVal = { at: number; data: any };
const CACHE_TTL_MS = 60_000;

const globalAny = globalThis as any;
if (!globalAny.__MOODBOARD_CACHE_V12) globalAny.__MOODBOARD_CACHE_V12 = new Map<string, CacheVal>();
const cache: Map<string, CacheVal> = globalAny.__MOODBOARD_CACHE_V12;

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
   Google CSE
======================= */
async function googleImageSearchOnce(q: string, key: string, cx: string, num: number) {
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("q", q);
  url.searchParams.set("searchType", "image");
  url.searchParams.set("num", String(Math.min(10, Math.max(1, num)))); // max 10
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
   OpenAI: query generator
======================= */
async function aiQueries(prompt: string, gender: string): Promise<string[]> {
  const apiKey = clean(process.env.OPENAI_API_KEY);
  if (!apiKey) return [];
  const client = new OpenAI({ apiKey });
  const model = clean(process.env.OPENAI_MODEL) || "gpt-4o-mini";

  const sys = `
Return ONLY valid JSON:
{ "queries": ["...","...","...","...","...","..."] }

Create EXACTLY 6 short product search queries (3–8 words each) for retail shopping.
Rules:
- Must include one of: men / women / unisex
- Keep prompt meaning (color/material/vibe)
- Category order:
  1) shoes
  2) bottoms
  3) tops
  4) outerwear
  5) accessories
  6) wildcard standout item
- If prompt is footwear-heavy, only 2 of 6 may be footwear.

Gender hint: "${gender}"
Prompt: "${prompt}"
`.trim();

  const resp = await client.chat.completions.create({
    model,
    messages: [{ role: "system", content: sys }],
    temperature: 0.15,
    max_tokens: 420,
  });

  const content = resp.choices?.[0]?.message?.content?.trim() || "";
  const parsed = safeJsonParse(content);
  const arr = Array.isArray(parsed?.queries) ? (parsed.queries as any[]) : [];
  const qs = arr.map((x) => String(x ?? "").trim()).filter(Boolean) as string[];
  return uniq(qs).slice(0, 6);
}

function fallbackQueries(prompt: string, gender: string): string[] {
  const gLc = (gender || "").toLowerCase();
  const g =
    gLc.includes("women") ? "women" : gLc.includes("men") ? "men" : "unisex";

  const p = (prompt || "").toLowerCase().split(/\s+/).slice(0, 6).join(" ");
  const P = p ? ` ${p}` : "";

  return uniq([
    `minimal chelsea boots ${g}${P}`,
    `tailored trousers ${g}${P}`,
    `clean button-up shirt ${g}${P}`,
    `sleek bomber jacket ${g}${P}`,
    `leather belt ${g}${P}`,
    `minimal sunglasses ${g}${P}`,
  ]).slice(0, 6);
}

/* =======================
   OpenAI rerank (optional)
======================= */
async function aiRerank(prompt: string, gender: string, items: Candidate[]) {
  const apiKey = clean(process.env.OPENAI_API_KEY);
  if (!apiKey) return { ids: [] as string[], ok: false as const, reason: "missing OPENAI_API_KEY" };

  const shortlist = items.slice(0, 30);
  if (shortlist.length < 8) return { ids: [] as string[], ok: false as const, reason: "not enough candidates" };

  const client = new OpenAI({ apiKey });
  const model = clean(process.env.OPENAI_MODEL) || "gpt-4o-mini";

  const payload = shortlist.map((c) => ({
    id: c.id,
    title: c.title.slice(0, 120),
    host: c.host,
    url: c.link.slice(0, 160),
    cat: c.guessedCategory,
    q: c.query.slice(0, 80),
  }));

  const sys = `
Return ONLY valid JSON:
{ "ranked_ids": ["id1","id2", ...] }

Rank by BEST match to prompt + correct product type.
Hard rules:
- Penalize wrong-category items heavily.
- Penalize non-product pages.
- Farfetch must be ranked last if present (but we already block it).

Gender hint: "${gender}"
Prompt: "${prompt}"
Candidates: ${JSON.stringify(payload)}
`.trim();

  try {
    const resp = await client.chat.completions.create({
      model,
      messages: [{ role: "system", content: sys }],
      temperature: 0.1,
      max_tokens: 900,
    });

    const content = resp.choices?.[0]?.message?.content?.trim() || "";
    const parsed = safeJsonParse(content);
    const arr = Array.isArray(parsed?.ranked_ids) ? (parsed.ranked_ids as any[]) : [];
    const ids = arr.map((x) => String(x ?? "").trim()).filter(Boolean) as string[];

    if (ids.length >= 5) return { ids, ok: true as const, reason: undefined as string | undefined };
    return { ids, ok: false as const, reason: `rerank too few ids (${ids.length})` };
  } catch (e: any) {
    return { ids: [] as string[], ok: false as const, reason: e?.message || "rerank error" };
  }
}

/* =======================
   Site rotation
======================= */
function pickSitesForQuery(allSites: string[], prompt: string, q: string, max: number): string[] {
  const key = `${prompt.toLowerCase()}::${q.toLowerCase()}`;
  const h = hash32(key);

  // remove farfetch entirely from rotation
  const src = allSites.filter((s) => !s.includes("farfetch.com"));
  if (!src.length) return [];

  const start = h % src.length;
  const picked: string[] = [];
  for (let i = 0; i < src.length && picked.length < max; i++) {
    picked.push(src[(start + i) % src.length]);
  }
  return uniq(picked).slice(0, max);
}

/* =======================
   Handler
======================= */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");

  const input: any = req.method === "POST" ? (req.body || {}) : (req.query || {});
  const qVal = toFirstString(input.q);
  const prompt = clean(input.prompt || qVal || "");
  const gender = clean(input.gender || "unisex");
  const cb = clean(input.cb || "");

  if (!prompt) return res.status(400).json({ error: "Missing prompt (send 'prompt' or 'q')" });

  const cseKey = clean(process.env.GOOGLE_CSE_KEY);
  const cseCx = clean(process.env.GOOGLE_CSE_ID);
  if (!cseKey || !cseCx) return res.status(500).json({ error: "Missing GOOGLE_CSE_KEY or GOOGLE_CSE_ID" });

  const sites = clean(process.env.RETAILER_SITES || "")
    .split(",")
    .map(normHost)
    .filter(Boolean)
    .filter((s) => !s.includes("farfetch.com")); // hard remove farfetch

  if (!sites.length) return res.status(500).json({ error: "RETAILER_SITES is empty (or only farfetch)" });

  const cacheKey = `v12:${VERSION}:${gender}:${prompt.toLowerCase()}:${cb}`;
  const cached = getCache(cacheKey);
  if (cached) return res.status(200).json(cached);

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

  const SITES_PER_QUERY = 6;
  const NUM_PER_SITE = 10; // BIGGEST POOL (max per CSE request)

  // Retrieve
  for (let qi = 0; qi < queries.length; qi++) {
    const q = queries[qi];
    const intendedCategory = intendedByIndex[Math.min(qi, intendedByIndex.length - 1)];

    const sitesForThisQuery = pickSitesForQuery(sites, prompt, q, SITES_PER_QUERY);
    fetchDebug[q] = { sites: sitesForThisQuery, statusCodes: [] as number[], itemsSeen: 0 };

    for (let si = 0; si < sitesForThisQuery.length; si++) {
      const site = sitesForThisQuery[si];

      const search = `${q} product -pinterest -editorial -review -lookbook -collection -collections site:${site}`;
      const { items, status } = await googleImageSearchOnce(search, cseKey, cseCx, NUM_PER_SITE);

      fetchDebug[q].statusCodes.push(status);
      fetchDebug[q].itemsSeen += items.length;

      if (status === 429) { saw429 = true; break; }
      if (status === 403) { saw403 = true; break; }

      for (let i = 0; i < items.length; i++) {
        const it = items[i];

        const img = String(it?.link ?? "");
        const thumb = String(it?.image?.thumbnailLink ?? "");
        const link = String(it?.image?.contextLink ?? "");
        const title = String(it?.title ?? "");

        if (!img || !link) continue;

        let host = "";
        try {
          host = normHost(new URL(link).hostname);
        } catch {
          continue;
        }

        // hard block farfetch (again)
        if (isFarfetch(host)) continue;

        if (BLOCKED_DOMAINS.some((b) => host.includes(b))) continue;
        if (!sites.some((s) => host === s || host.endsWith(s))) continue;

        const urlLc = link.toLowerCase();
        const titleLc = title.toLowerCase();

        if (EXCLUDE_INURL.some((x) => urlLc.includes(x))) continue;
        if (EXCLUDE_TERMS.some((x) => titleLc.includes(x))) continue;

        // hard gender reject (fixes women items leaking into men)
        if (genderReject(title, link, gender)) continue;

        // score
        let score = 0;
        score += productishBoost(link);

        const tokens = q.toLowerCase().split(/\s+/).filter((t: string) => t.length >= 3);
        const text = (title + " " + link).toLowerCase();
        for (let t = 0; t < tokens.length; t++) {
          if (text.includes(tokens[t])) score += 2;
        }

        const guessed = guessCategory(q, title, link);

        // strong category enforcement
        if (guessed === intendedCategory) score += 10;
        else score -= 8;

        // nav-ish title penalty
        if (/(^shop\b|homepage|new arrivals|sale$)/i.test(title)) score -= 20;

        // small boosts for known indexable sources
        if (/(ssense|ourlegacy|nepenthes|neimanmarcus|yoox|stockx|supreme)/.test(host)) score += 2;

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

    if (saw429 || saw403) break;
  }

  // If rate limited, return debug
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
        note: saw429 ? "Google CSE rate limit — increase quota/billing or reduce traffic." : "403 — check key/cx permissions.",
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
  let rerankReason: string | undefined;

  const rr = await aiRerank(prompt, gender, deduped);
  let ranked: Candidate[] = deduped;

  if (rr.ok) {
    rerankSource = "openai";
    const byId = new Map<string, Candidate>();
    for (const c of deduped) byId.set(c.id, c);

    const fromAi: Candidate[] = [];
    for (const id of rr.ids) {
      const c = byId.get(id);
      if (c) fromAi.push(c);
    }
    const seen = new Set(fromAi.map((x) => x.id));
    for (const c of deduped) if (!seen.has(c.id)) fromAi.push(c);
    ranked = fromAi;
  } else {
    rerankReason = rr.reason;
  }

  // Selection (diversify)
  const desired = 18;
  const perDomainCap = 1;

  const capByCat: Record<Category, number> = {
    shoes: 5,
    bottoms: 5,
    tops: 5,
    outerwear: 4,
    accessories: 4,
    other: 3,
  };

  const out: ImageResult[] = [];
  const seenKey = new Set<string>();
  const domainCount = new Map<string, number>();
  const catCount = new Map<Category, number>();

  function canTake(c: Candidate): boolean {
    const k = `${c.link}::${c.img}`;
    if (seenKey.has(k)) return false;

    // final hard block farfetch (safety)
    if (isFarfetch(c.host)) return false;

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
    seenKey.add(k);
    domainCount.set(c.host, (domainCount.get(c.host) || 0) + 1);
    catCount.set(c.guessedCategory, (catCount.get(c.guessedCategory) || 0) + 1);

    const risky = HOTLINK_RISK.some((d2) => c.host.endsWith(d2));
    const imageUrl = risky && c.thumb ? c.thumb : c.img;

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

  // Ensure one per core category first
  const core: Category[] = ["shoes", "bottoms", "tops", "outerwear", "accessories"];
  for (const cat of core) {
    for (const c of ranked) {
      if (c.guessedCategory !== cat) continue;
      if (take(c)) break;
    }
  }

  // Fill remaining
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
      farfetchBlocked: true,
      inventory: { SITES_PER_QUERY, NUM_PER_SITE },
    },
  };

  setCache(cacheKey, response);
  return res.status(200).json(response);
}
