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

// Some brands block hotlinking; prefer thumbnails when available
const HOTLINK_RISK = ["louisvuitton.com", "bottegaveneta.com", "versace.com", "moncler.com"];

/* =======================
   Category guesser (balance)
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
   Google CSE image search
======================= */
async function googleImageSearch(q: string, count: number, key: string, cx: string): Promise<any[]> {
  const results: any[] = [];
  let start = 1;

  while (results.length < count && start <= 91) {
    const url = new URL("https://www.googleapis.com/customsearch/v1");
    url.searchParams.set("q", q);
    url.searchParams.set("searchType", "image");
    url.searchParams.set("num", String(Math.min(10, count - results.length)));
    url.searchParams.set("start", String(start));
    url.searchParams.set("key", key);
    url.searchParams.set("cx", cx);

    // image hints
    url.searchParams.set("imgType", "photo");
    url.searchParams.set("imgSize", "large");
    url.searchParams.set("safe", "active");

    const res = await fetch(url.toString());
    if (!res.ok) break;

    const data = await res.json();
    const items = (data?.items || []) as any[];
    if (!items.length) break;

    results.push(...items);
    start += items.length;
  }

  return results;
}

/* =======================
   Fallback queries (when OpenAI missing)
   - include the user's prompt so it's not generic
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
    `jacket${P} ${g}`,
    `shirt${P} ${g}`,
    `pants${P} ${g}`,
    `sneakers${P} ${g}`,
    `bag${P} ${g}`,
  ];
}

/* =======================
   OpenAI → smart product queries
======================= */
async function aiQueries(opts: { prompt: string; gender: string; retailerSites: string[] }): Promise<string[]> {
  const { prompt, gender, retailerSites } = opts;

  const apiKey = clean(process.env.OPENAI_API_KEY);
  if (!apiKey) return [];

  const client = new OpenAI({ apiKey });
  const model = clean(process.env.OPENAI_MODEL) || "gpt-4o-mini";

  const system = `
You are an expert fashion stylist AND shopping assistant.
Convert a user's free-text style prompt into specific, searchable PRODUCT queries (not full outfits).
Return ONLY valid JSON.
- Produce 10 to 12 queries.
- Each query: 3–7 words, product-oriented, include key attributes from prompt (style, colors, fabrics, vibe).
- Force category coverage: at least 2 tops, 2 bottoms, 2 outerwear, 2 shoes, 1 accessory.
- Avoid generic words like "outfit" unless paired with a product.
Gender hint: "${gender}"
Retailer context (do not mention): ${retailerSites.join(", ")}
JSON shape: { "queries": ["..."] }
`.trim();

  const user = `User prompt: "${prompt}"`;

  const resp = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.35,
  });

  const content = resp.choices?.[0]?.message?.content?.trim() || "";

  let parsed: any = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    const lines = content
      .split("\n")
      .map((s) => s.replace(/^[\s\-\*\d\.\)]+/, "").trim())
      .filter(Boolean);
    parsed = { queries: lines };
  }

  const arr = Array.isArray(parsed?.queries) ? parsed.queries : [];
  const asStrings: string[] = arr
    .map((x: any) => String(x ?? "").trim())
    .filter((x: string) => !!x);

  return Array.from(new Set(asStrings)).slice(0, 12);
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
  res.setHeader("Cache-Control", "no-store");

  try {
    const input: any = req.method === "POST" ? (req.body || {}) : (req.query || {});
    const qVal = toFirstString(input.q);
    const prompt = clean(input.prompt || qVal || "");
    const gender = clean(input.gender || "unisex");

    const countVal = toFirstString(input.count);
    const desired = Math.min(Math.max(Number(countVal) || 18, 6), 36);

    if (!prompt) {
      return res.status(400).json({ error: "Missing prompt (send 'prompt' or 'q')" });
    }

    const cseKey = clean(process.env.GOOGLE_CSE_KEY);
    const cseCx = clean(process.env.GOOGLE_CSE_ID);
    if (!cseKey || !cseCx) {
      return res.status(500).json({ error: "Missing GOOGLE_CSE_KEY or GOOGLE_CSE_ID" });
    }

    const sites = clean(process.env.RETAILER_SITES || "")
      .split(",")
      .map(normHost)
      .filter(Boolean);

    if (!sites.length) {
      return res.status(500).json({ error: "RETAILER_SITES is empty" });
    }

    // 1) Generate smart product queries
    let queries: string[] = [];
    let querySource: "openai" | "fallback" = "fallback";

    try {
      const q = await aiQueries({ prompt, gender, retailerSites: sites });
      if (q.length >= 8) {
        queries = q;
        querySource = "openai";
      }
    } catch {
      // ignore
    }

    if (!queries.length) {
      queries = fallbackQueries(prompt, gender);
      querySource = "fallback";
    }

    // 2) SEARCH WITHOUT giant site:OR filter (key fix)
    // Then filter results by allowed hosts in code.
    const perQuery = Math.max(6, Math.ceil(desired / Math.min(queries.length, 8)));
    const candidates: Candidate[] = [];

    for (let qi = 0; qi < queries.length; qi++) {
      const q = queries[qi];

      // Make the search product-focused and broad
      const search = `${q} product photo -pinterest -editorial -review -lookbook`;

      const items = await googleImageSearch(search, perQuery * 4, cseKey, cseCx);

      for (let i = 0; i < items.length; i++) {
        const it = items[i];

        const img: string = String((it as any)?.link ?? "");
        const thumb: string = String((it as any)?.image?.thumbnailLink ?? "");
        const link: string = String((it as any)?.image?.contextLink ?? "");
        const title: string = String((it as any)?.title ?? "");

        if (!img || !link) continue;

        let host = "";
        try {
          host = normHost(new URL(link).hostname);
        } catch {
          continue;
        }

        if (BLOCKED_DOMAINS.some((b) => host.includes(b))) continue;

        // ✅ whitelist filter happens here (replaces giant OR query)
        if (!sites.some((s) => host === s || host.endsWith(s))) continue;

        const urlLc = link.toLowerCase();
        const titleLc = title.toLowerCase();
        if (containsAny(urlLc, EXCLUDE_INURL)) continue;
        if (containsAny(titleLc, EXCLUDE_TERMS)) continue;

        let score = 0;
        score += productishBoost(link);

        const qTokens = q.toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
        const text = (title + " " + link).toLowerCase();
        for (let t = 0; t < qTokens.length; t++) {
          if (text.includes(qTokens[t])) score += 2;
        }

        if (host.includes("farfetch")) score -= 2;
        if (host.includes("ssense")) score += 1;
        if (host.includes("nepenthes")) score += 1;

        candidates.push({ title, link, img, thumb, host, query: q, score });
      }
    }

    candidates.sort((a, b) => b.score - a.score);

    // 3) Diversify + category balance
    const perDomainCap = desired <= 12 ? 2 : 3;
    const farfetchCap = desired <= 12 ? 2 : 3;

    const catCaps: Record<Category, number> = {
      tops: 5,
      bottoms: 5,
      outerwear: 4,
      shoes: 3,
      accessories: 3,
      other: 3,
    };
    const catCounts = new Map<Category, number>();

    const domainCount = new Map<string, number>();
    const seen = new Set<string>();
    const output: ImageResult[] = [];
    let farfetchCount = 0;

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];

      const domCount = domainCount.get(c.host) || 0;
      if (domCount >= perDomainCap) continue;
      if (c.host.includes("farfetch") && farfetchCount >= farfetchCap) continue;

      const dedupeKey = `${c.link}::${c.img}`;
      if (seen.has(dedupeKey)) continue;

      const cat = guessCategory(c.query, c.title, c.link);
      const cc = catCounts.get(cat) || 0;
      if (cc >= (catCaps[cat] ?? 3)) continue;

      seen.add(dedupeKey);

      const risky = HOTLINK_RISK.some((d) => c.host.endsWith(d));
      const imageUrl = risky && c.thumb ? c.thumb : c.img;

      domainCount.set(c.host, domCount + 1);
      catCounts.set(cat, cc + 1);
      if (c.host.includes("farfetch")) farfetchCount++;

      output.push({
        imageUrl,
        thumbnailUrl: c.thumb || undefined,
        sourceUrl: c.link,
        title: c.title,
        provider: c.host,
        score: c.score,
        query: c.query,
        category: cat,
      });

      if (output.length >= desired) break;
    }

    return res.status(200).json({
      images: output,
      source: "google-cse",
      debug: {
        prompt,
        desired,
        querySource,
        queries,
        farfetchCap,
        perDomainCap,
        domainCounts: Object.fromEntries(domainCount.entries()),
        categoryCounts: Object.fromEntries(Array.from(catCounts.entries())),
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Unexpected error" });
  }
}
