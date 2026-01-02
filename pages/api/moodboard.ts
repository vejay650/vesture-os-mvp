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

const containsAny = (hay: string, needles: string[]) => {
  const lc = (hay || "").toLowerCase();
  for (let i = 0; i < needles.length; i++) {
    if (lc.includes(needles[i].toLowerCase())) return true;
  }
  return false;
};

const toFirstString = (v: any) => (Array.isArray(v) ? v[0] : v);

/* =======================
   Filters / Rules
======================= */
const EXCLUDE_INURL = [
  "/kids/",
  "/girls/",
  "/boys/",
  "/baby/",
  "/help/",
  "/blog/",
  "/story/",
  "/stories/",
  "/press/",
  "/account/",
  "/privacy",
  "/terms",
  "size-guide",
  "size_guide",
  "guide",
  "policy",
  "/lookbook",
  "/editorial",
  "/review",
  "/reviews",
];

const EXCLUDE_TERMS = ["kids", "toddler", "boy", "girl", "baby"];

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

// These often block hotlinking. We'll prefer thumbnails when available.
const HOTLINK_RISK = ["louisvuitton.com", "bottegaveneta.com", "versace.com", "moncler.com"];

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
   Heuristic fallback (if OpenAI missing/fails)
======================= */
function fallbackQueries(prompt: string, gender: string) {
  const lc = (prompt || "").toLowerCase();
  const gLc = (gender || "").toLowerCase();
  const g =
    gLc.includes("women") || gLc.includes("female")
      ? "women"
      : gLc.includes("men") || gLc.includes("male")
      ? "men"
      : "unisex";

  const isDate = /(date|date night|night out|evening|dinner|drinks|party)/i.test(lc);
  const isGame = /(game|stadium|arena|courtside|match)/i.test(lc);
  const isOversized = /(oversized|baggy|wide|relaxed)/i.test(lc);
  const isStreetwear = /(streetwear|street|urban)/i.test(lc);
  const isJapanese = /(japanese|tokyo|harajuku)/i.test(lc);

  const mods = [
    isOversized ? "oversized" : "",
    isStreetwear ? "streetwear" : "",
    isJapanese ? "japanese" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const M = mods ? ` ${mods}` : "";

  if (isDate && isGame) {
    return [
      `turtleneck${M} ${g}`,
      `tailored trousers${M} ${g}`,
      `leather jacket${M} ${g}`,
      `white leather sneakers${M} ${g}`,
      `crossbody bag${M} ${g}`,
      `minimal chain necklace${M} ${g}`,
    ];
  }

  if (isDate) {
    return [
      `tailored blazer${M} ${g}`,
      `silk satin top${M} ${g}`,
      `dark straight leg jeans${M} ${g}`,
      `leather ankle boots${M} ${g}`,
      `small shoulder bag${M} ${g}`,
      `minimal jewelry${M} ${g}`,
    ];
  }

  return [
    `jacket${M} ${g}`,
    `top${M} ${g}`,
    `pants${M} ${g}`,
    `shoes${M} ${g}`,
    `bag${M} ${g}`,
  ];
}

/* =======================
   OpenAI → smart item queries
======================= */
async function aiQueries(opts: {
  prompt: string;
  gender: string;
  retailerSites: string[];
}) {
  const { prompt, gender, retailerSites } = opts;

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  // Keep it deterministic-ish, but not identical every time
  const temperature = 0.4;

  const system = `
You are an expert fashion stylist AND shopping assistant.
Your job: convert a user's free-text style prompt into a list of specific, searchable product queries.
The queries must be product/category focused (NOT full outfits), so a retailer image search returns items.

Rules:
- Return ONLY valid JSON.
- Produce 8 to 12 queries.
- Each query should be short (3–7 words), product-oriented, and include key attributes from the prompt (style, colors, fabric, vibe).
- Include a balanced mix: tops, bottoms, outerwear, footwear, and accessories.
- Avoid generic words like "outfit", "look", "aesthetic" unless paired with product.
- If user prompt implies an occasion (date night, game, office), tailor the items appropriately.
- If prompt is vague, infer tasteful defaults.
- Use gender hint: "${gender}".
- Retailers available (for context only): ${retailerSites.join(", ")}.
JSON shape:
{ "queries": ["query 1", "query 2", ...] }
`.trim();

  const user = `User prompt: "${prompt}"`;

  const resp = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature,
  });

  const content = resp.choices?.[0]?.message?.content?.trim() || "";
  let parsed: any = null;

  try {
    parsed = JSON.parse(content);
  } catch {
    // salvage: split lines
    const lines = content
      .split("\n")
      .map((s) => s.replace(/^[\s\-\*\d\.\)]+/, "").trim())
      .filter(Boolean);
    parsed = { queries: lines };
  }

  const queries = Array.isArray(parsed?.queries) ? parsed.queries.map(clean).filter(Boolean) : [];
  const uniq = Array.from(new Set(queries)).slice(0, 12);

  return uniq;
}

/* =======================
   Product-ish signals
======================= */
function productishBoost(url: string) {
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
  // prevent caching so prompts don’t “stick”
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

    // Build site filter for CSE
    const siteFilter = sites.map((s) => `site:${s}`).join(" OR ");

    // 1) Make smart queries (OpenAI) with fallback
    let queries: string[] = [];
    let querySource: "openai" | "fallback" = "fallback";

    const hasOpenAI = !!clean(process.env.OPENAI_API_KEY);
    if (hasOpenAI) {
      try {
        const q = await aiQueries({ prompt, gender, retailerSites: sites });
        if (q.length >= 6) {
          queries = q;
          querySource = "openai";
        }
      } catch {
        // fall through
      }
    }

    if (!queries.length) {
      queries = fallbackQueries(prompt, gender);
      querySource = "fallback";
    }

    // 2) Pull images per query
    const perQuery = Math.max(6, Math.ceil(desired / Math.min(queries.length, 8)));
    const candidates: Candidate[] = [];

    for (let qi = 0; qi < queries.length; qi++) {
      const q = queries[qi];

      // Make the search strongly product-item oriented
      const search = `${q} -pinterest -editorial -review -lookbook (${siteFilter})`;

      // fetch extra so strict filtering still leaves enough
      const items = await googleImageSearch(search, perQuery * 3, cseKey, cseCx);

      for (let i = 0; i < items.length; i++) {
        const it = items[i];

        // ✅ HARD TypeScript-safe extraction
        const img: string = String((it as any)?.link ?? "");
        const thumb: string = String((it as any)?.image?.thumbnailLink ?? "");
        const link: string = String(
          (it as any)?.image?.contextLink ??
            (it as any)?.image?.context ??
            (it as any)?.displayLink ??
            ""
        );
        const title: string = String((it as any)?.title ?? "");

        if (!img || !link) continue;

        let host = "";
        try {
          host = normHost(new URL(link).hostname);
        } catch {
          continue;
        }

        // hard block socials/noise
        if (BLOCKED_DOMAINS.some((b) => host.includes(b))) continue;

        // must be in whitelist (allow subdomains)
        if (!sites.some((s) => host === s || host.endsWith(s))) continue;

        const urlLc = link.toLowerCase();
        const titleLc = title.toLowerCase();
        if (containsAny(urlLc, EXCLUDE_INURL)) continue;
        if (containsAny(titleLc, EXCLUDE_TERMS)) continue;

        // scoring
        let score = 0;
        score += productishBoost(link);

        // reward matching query words (simple)
        const qTokens = q.toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
        const text = (title + " " + link).toLowerCase();
        for (let t = 0; t < qTokens.length; t++) {
          if (text.includes(qTokens[t])) score += 2;
        }

        // diversity nudges
        if (host.includes("farfetch")) score -= 2;
        if (host.includes("ssense")) score += 1;

        candidates.push({ title, link, img, thumb, host, query: q, score });
      }
    }

    // 3) Rank + diversify + dedupe
    candidates.sort((a, b) => b.score - a.score);

    const perDomainCap = desired <= 12 ? 2 : 3;
    const farfetchCap = desired <= 12 ? 2 : 3;

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
      seen.add(dedupeKey);

      const risky = HOTLINK_RISK.some((d) => c.host.endsWith(d));
      const imageUrl = risky && c.thumb ? c.thumb : c.img;

      domainCount.set(c.host, domCount + 1);
      if (c.host.includes("farfetch")) farfetchCount++;

      output.push({
        imageUrl,
        thumbnailUrl: c.thumb || undefined,
        sourceUrl: c.link,
        title: c.title,
        provider: c.host,
        score: c.score,
        query: c.query,
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
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Unexpected error" });
  }
}
