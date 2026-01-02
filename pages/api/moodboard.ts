// pages/api/moodboard.ts
import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";

/* =======================
   Types
======================= */
type ImageResult = {
  imageUrl: string;
  thumbnailUrl?: string;
  sourceUrl: string;
  title: string;
  provider?: string;
  score?: number;
  query?: string;
  category?: string;
};

type Candidate = {
  title: string;
  link: string;
  img: string;
  thumb: string;
  host: string;
  query: string;
  score: number;
};

/* =======================
   Helpers
======================= */
const clean = (s: any) => (typeof s === "string" ? s.trim() : "");
const normHost = (h: string) => clean(h).replace(/^www\./i, "").toLowerCase();
const toFirstString = (v: any) => (Array.isArray(v) ? v[0] : v);

const containsAny = (hay: string, needles: string[]) => {
  const lc = (hay || "").toLowerCase();
  for (let i = 0; i < needles.length; i++) {
    if (lc.includes(needles[i].toLowerCase())) return true;
  }
  return false;
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* =======================
   Filters / Rules
======================= */
const EXCLUDE_INURL = [
  "/kids/", "/girls/", "/boys/", "/baby/",
  "/help/", "/blog/", "/story/", "/stories/", "/press/",
  "/account/", "/privacy", "/terms",
  "size-guide", "size_guide", "guide", "policy",
  "/lookbook", "/editorial", "/review", "/reviews",
];

const EXCLUDE_TERMS = ["kids", "toddler", "boy", "girl", "baby"];

const BLOCKED_DOMAINS = [
  "pinterest.", "pinimg.com",
  "twitter.", "x.com",
  "facebook.", "reddit.", "tumblr.",
  "wikipedia.",
];

const HOTLINK_RISK = ["louisvuitton.com", "bottegaveneta.com", "versace.com", "moncler.com"];

/* =======================
   Category guesser
======================= */
type Category = "tops" | "bottoms" | "outerwear" | "shoes" | "accessories" | "other";

function guessCategory(q: string, title: string, url: string): Category {
  const t = (q + " " + title + " " + url).toLowerCase();

  if (/(sneaker|sneakers|shoe|shoes|boot|boots|loafer|loafers|heel|heels|trainer|trainers|footwear)/.test(t)) return "shoes";
  if (/(bag|tote|crossbody|shoulder bag|wallet|belt|cap|hat|beanie|scarf|sunglasses|jewelry|necklace|ring|bracelet)/.test(t)) return "accessories";
  if (/(coat|jacket|puffer|parka|blazer|outerwear|trench|bomber|denim jacket|leather jacket)/.test(t)) return "outerwear";
  if (/(jean|jeans|denim|trouser|trousers|pant|pants|cargo|short|shorts|skirt)/.test(t)) return "bottoms";
  if (/(tee|t-shirt|tshirt|shirt|overshirt|top|hoodie|sweater|knit|crewneck|blouse)/.test(t)) return "tops";
  return "other";
}

/* =======================
   Simple in-memory cache (per Vercel instance)
======================= */
type CacheVal = { at: number; data: any };
const CACHE_TTL_MS = 60_000; // 60s
const globalAny = globalThis as any;
if (!globalAny.__MOODBOARD_CACHE) globalAny.__MOODBOARD_CACHE = new Map<string, CacheVal>();
const cache: Map<string, CacheVal> = globalAny.__MOODBOARD_CACHE;

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
   Google CSE image search (single call, no pagination)
======================= */
async function googleImageSearchOnce(q: string, key: string, cx: string, num: number): Promise<{ items: any[]; status: number }> {
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

  if (!res.ok) return { items: [], status };
  const data = await res.json();
  const items = (data?.items || []) as any[];
  return { items, status };
}

/* =======================
   Fallback queries (6 max)
======================= */
function fallbackQueries(prompt: string, gender: string): string[] {
  const gLc = (gender || "").toLowerCase();
  const g =
    gLc.includes("women") || gLc.includes("female") ? "women" :
    gLc.includes("men") || gLc.includes("male") ? "men" :
    "unisex";

  const p = (prompt || "").toLowerCase().split(/\s+/).slice(0, 6).join(" ");
  const P = p ? ` ${p}` : "";

  return [
    `boots${P} ${g}`,
    `blazer${P} ${g}`,
    `shirt${P} ${g}`,
    `trousers${P} ${g}`,
    `jacket${P} ${g}`,
    `belt${P} ${g}`,
  ];
}

/* =======================
   OpenAI → 6 strong product queries
======================= */
async function aiQueries(prompt: string, gender: string): Promise<string[]> {
  const apiKey = clean(process.env.OPENAI_API_KEY);
  if (!apiKey) return [];
  const client = new OpenAI({ apiKey });
  const model = clean(process.env.OPENAI_MODEL) || "gpt-4o-mini";

  const system = `
Convert the user's prompt into EXACTLY 6 product-style search queries.
Rules:
- 3–7 words each
- Product-focused (boots, blazer, trousers, shirt, jacket, bag, belt, etc.)
- Cover categories: shoes, tops, bottoms, outerwear, accessory (at least 1 each)
Return ONLY valid JSON: { "queries": ["...", "...", ...] }
Gender hint: "${gender}"
`.trim();

  const resp = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: `Prompt: "${prompt}"` },
    ],
    temperature: 0.3,
  });

  const content = resp.choices?.[0]?.message?.content?.trim() || "";
  try {
    const parsed = JSON.parse(content);
    const arr = Array.isArray(parsed?.queries) ? parsed.queries : [];
    const qs = arr.map((x: any) => String(x ?? "").trim()).filter(Boolean);
    return Array.from(new Set(qs)).slice(0, 6);
  } catch {
    return [];
  }
}

/* =======================
   Product-ish boost
======================= */
function productishBoost(url: string): number {
  const u = (url || "").toLowerCase();
  if (
    u.includes("/product") ||
    u.includes("/products") ||
    u.includes("/p/") ||
    u.includes("/item/") ||
    u.includes("/shop/") ||
    u.includes("/dp/") ||
    u.includes("/sku/")
  ) return 10;
  return 0;
}

/* =======================
   API Handler
======================= */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // short CDN cache helps reduce repeat hits; still fresh
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");

  try {
    const input: any = req.method === "POST" ? (req.body || {}) : (req.query || {});
    const qVal = toFirstString(input.q);
    const prompt = clean(input.prompt || qVal || "");
    const gender = clean(input.gender || "unisex");
    const desired = 18;

    if (!prompt) return res.status(400).json({ error: "Missing prompt (send 'prompt' or 'q')" });

    const cseKey = clean(process.env.GOOGLE_CSE_KEY);
    const cseCx = clean(process.env.GOOGLE_CSE_ID);
    if (!cseKey || !cseCx) return res.status(500).json({ error: "Missing GOOGLE_CSE_KEY or GOOGLE_CSE_ID" });

    const sites = clean(process.env.RETAILER_SITES || "")
      .split(",")
      .map(normHost)
      .filter(Boolean);

    if (!sites.length) return res.status(500).json({ error: "RETAILER_SITES is empty" });

    const cacheKey = `v1:${gender}:${prompt.toLowerCase()}`;
    const cached = getCache(cacheKey);
    if (cached) return res.status(200).json(cached);

    // group site filters but only try top 2 groups to reduce calls
    const siteGroups = chunk(sites, 4).slice(0, 2).map((g) => g.map((s) => `site:${s}`).join(" OR "));

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

    const candidates: Candidate[] = [];
    const fetchDebug: Record<string, any> = {};
    let saw429 = false;

    // Only 6 queries * 2 groups = 12 google requests max
    for (let qi = 0; qi < queries.length; qi++) {
      const q = queries[qi];
      fetchDebug[q] = { statusCodes: [] as number[], itemsSeen: 0, groupsTried: 0 };

      for (let gi = 0; gi < siteGroups.length; gi++) {
        const groupFilter = siteGroups[gi];
        fetchDebug[q].groupsTried += 1;

        const search = `${q} product photo -pinterest -editorial -review (${groupFilter})`;
        const { items, status } = await googleImageSearchOnce(search, cseKey, cseCx, 10);
        fetchDebug[q].statusCodes.push(status);
        fetchDebug[q].itemsSeen += items.length;

        if (status === 429) {
          saw429 = true;
          continue;
        }

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
          if (containsAny(urlLc, EXCLUDE_INURL)) continue;
          if (containsAny(titleLc, EXCLUDE_TERMS)) continue;

          let score = productishBoost(link);
          const tokens = q.toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
          const text = (title + " " + link).toLowerCase();
          for (let t = 0; t < tokens.length; t++) if (text.includes(tokens[t])) score += 2;

          if (host.includes("farfetch")) score -= 2;
          if (host.includes("ssense")) score += 1;
          if (host.includes("nepenthes")) score += 1;

          candidates.push({ title, link, img, thumb, host, query: q, score });
        }
      }
    }

    candidates.sort((a, b) => b.score - a.score);

    // balance
    const perDomainCap = 3;
    const farfetchCap = 3;
    const domainCount = new Map<string, number>();
    const catCounts = new Map<Category, number>();
    const catCaps: Record<Category, number> = { tops: 5, bottoms: 5, outerwear: 4, shoes: 4, accessories: 3, other: 3 };
    const seen = new Set<string>();
    const out: ImageResult[] = [];
    let farfetchCount = 0;

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const dc = domainCount.get(c.host) || 0;
      if (dc >= perDomainCap) continue;
      if (c.host.includes("farfetch") && farfetchCount >= farfetchCap) continue;

      const k = `${c.link}::${c.img}`;
      if (seen.has(k)) continue;

      const cat = guessCategory(c.query, c.title, c.link);
      const cc = catCounts.get(cat) || 0;
      if (cc >= (catCaps[cat] ?? 3)) continue;

      seen.add(k);

      const risky = HOTLINK_RISK.some((d) => c.host.endsWith(d));
      const imageUrl = risky && c.thumb ? c.thumb : c.img;

      domainCount.set(c.host, dc + 1);
      catCounts.set(cat, cc + 1);
      if (c.host.includes("farfetch")) farfetchCount++;

      out.push({
        imageUrl,
        thumbnailUrl: c.thumb || undefined,
        sourceUrl: c.link,
        title: c.title,
        provider: c.host,
        score: c.score,
        query: c.query,
        category: cat,
      });

      if (out.length >= desired) break;
    }

    const response = {
      images: out,
      source: "google-cse",
      debug: {
        prompt,
        querySource,
        queries,
        totalCandidates: candidates.length,
        saw429,
        domainCounts: Object.fromEntries(domainCount.entries()),
        categoryCounts: Object.fromEntries(Array.from(catCounts.entries())),
        fetch: fetchDebug,
        note: saw429
          ? "Google CSE is rate-limiting (429). Reduced calls + caching enabled. If still empty, increase quota or use fewer site groups."
          : undefined,
      },
    };

    setCache(cacheKey, response);
    return res.status(200).json(response);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Unexpected error" });
  }
}
