// pages/api/moodboard.ts
import type { NextApiRequest, NextApiResponse } from "next";

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

/* =======================
   Filters / Rules
======================= */
const EXCLUDE_INURL = [
  "/kids/", "/girls/", "/boys/", "/baby/",
  "/help/", "/blog/", "/story/", "/stories/", "/press/",
  "/account/", "/privacy", "/terms",
  "size-guide", "size_guide", "guide", "policy",
  "/lookbook", "/editorial", "/review", "/reviews"
];

const EXCLUDE_TERMS = ["kids", "toddler", "boy", "girl", "baby"];

const BLOCKED_DOMAINS = [
  "pinterest.", "pinimg.com",
  "twitter.", "x.com",
  "facebook.", "reddit.", "tumblr.",
  "wikipedia."
];

const HOTLINK_RISK = [
  "louisvuitton.com",
  "bottegaveneta.com",
  "versace.com",
  "moncler.com"
];

/* =======================
   Sentence → Item Queries
======================= */
function buildItemQueries(prompt: string, gender: string) {
  const lc = (prompt || "").toLowerCase();

  const isDate = /(date|date night|night out|evening|dinner|drinks|party)/i.test(lc);
  const isGame = /(game|stadium|arena|courtside|match)/i.test(lc);

  const gLc = (gender || "").toLowerCase();
  const g =
    gLc.includes("women") || gLc.includes("female") ? "women" :
    gLc.includes("men") || gLc.includes("male") ? "men" :
    "unisex";

  // A little extra understanding for common fashion prompts
  const isOversized = /(oversized|baggy|wide)/i.test(lc);
  const isJapanese = /(japanese|tokyo|harajuku)/i.test(lc);
  const isStreetwear = /(streetwear|street|urban)/i.test(lc);

  if (isDate && isGame) {
    return [
      `black fitted turtleneck ${g}`,
      `tailored dark trousers ${g}`,
      `leather jacket ${g}`,
      `clean white leather sneakers ${g}`,
      `minimal shoulder bag ${g}`,
      `silver chain necklace ${g}`
    ];
  }

  if (isDate) {
    return [
      `tailored blazer ${g}`,
      `silk satin top ${g}`,
      `dark straight leg jeans ${g}`,
      `leather ankle boots ${g}`,
      `minimal jewelry ${g}`
    ];
  }

  // If user says "oversized japanese streetwear"
  if (isOversized && (isJapanese || isStreetwear)) {
    return [
      `oversized jacket ${g} streetwear`,
      `wide leg trousers ${g}`,
      `oversized graphic tee ${g}`,
      `technical sneakers ${g}`,
      `crossbody bag ${g}`
    ];
  }

  // General fallback
  return [
    `clean knit top ${g}`,
    `straight leg jeans ${g}`,
    `tailored trousers ${g}`,
    `clean sneakers ${g}`,
    `jacket ${g}`
  ];
}

/* =======================
   Google Image Search
======================= */
async function googleImageSearch(
  q: string,
  count: number,
  key: string,
  cx: string
): Promise<any[]> {
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
    if (!data?.items?.length) break;

    results.push(...data.items);
    start += data.items.length;
  }

  return results;
}

/* =======================
   API Handler
======================= */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Support POST (body) and GET (query)
    const input: any = req.method === "POST" ? (req.body || {}) : (req.query || {});

    // ✅ Extra-compatible prompt extraction:
    // - accepts prompt OR q
    // - handles q arrays (?q=a&q=b)
    const qVal = Array.isArray(input.q) ? input.q[0] : input.q;
    const prompt = clean(input.prompt || qVal || "");

    const gender = clean(input.gender || "unisex");

    const countVal = Array.isArray(input.count) ? input.count[0] : input.count;
    const desired = Math.min(Math.max(Number(countVal) || 18, 6), 36);

    if (!prompt) {
      return res.status(400).json({ error: "Missing prompt (send 'prompt' or 'q')" });
    }

    const key = clean(process.env.GOOGLE_CSE_KEY);
    const cx = clean(process.env.GOOGLE_CSE_ID);
    if (!key || !cx) {
      return res.status(500).json({ error: "Missing GOOGLE_CSE_KEY or GOOGLE_CSE_ID" });
    }

    const sites = clean(process.env.RETAILER_SITES || "")
      .split(",")
      .map(normHost)
      .filter(Boolean);

    if (!sites.length) {
      return res.status(500).json({ error: "RETAILER_SITES is empty" });
    }

    const siteFilter = sites.map(s => `site:${s}`).join(" OR ");

    const queries = buildItemQueries(prompt, gender);
    const perQuery = Math.max(6, Math.ceil(desired / queries.length));

    let candidates: Candidate[] = [];

    for (const q of queries) {
      const search = `${q} -pinterest -editorial -review (${siteFilter})`;
      const items = await googleImageSearch(search, perQuery * 3, key, cx);

      for (const it of items) {
        // ✅ HARD TypeScript-safe extraction (prevents unknown→string errors on Vercel)
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

        if (BLOCKED_DOMAINS.some(b => host.includes(b))) continue;
        if (!sites.some(s => host === s || host.endsWith(s))) continue;
        if (containsAny(link, EXCLUDE_INURL)) continue;
        if (containsAny(title, EXCLUDE_TERMS)) continue;

        candidates.push({ title, link, img, thumb, host, query: q });
      }
    }

    // Score + rank
    const scored = candidates
      .map(c => {
        const productBoost = /\/product|\/products|\/p\/|\/item\/|\/shop\/|\/sku\//i.test(c.link) ? 8 : 0;
        const farfetchPenalty = c.host.includes("farfetch") ? -2 : 0;
        return { ...c, score: productBoost + farfetchPenalty };
      })
      .sort((a, b) => (b.score as number) - (a.score as number));

    // Diversify results by domain
    const domainCap = desired <= 12 ? 2 : 3;
    const domainCount = new Map<string, number>();
    const seen = new Set<string>();
    const output: ImageResult[] = [];

    for (const c of scored) {
      const count = domainCount.get(c.host) || 0;
      if (count >= domainCap) continue;

      const dedupeKey = `${c.link}::${c.img}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const risky = HOTLINK_RISK.some(d => c.host.endsWith(d));
      const imageUrl = risky && c.thumb ? c.thumb : c.img;

      domainCount.set(c.host, count + 1);

      output.push({
        imageUrl,
        thumbnailUrl: c.thumb || undefined,
        sourceUrl: c.link,
        title: c.title,
        provider: c.host,
        score: c.score,
        query: c.query
      });

      if (output.length >= desired) break;
    }

    return res.status(200).json({
      images: output,
      source: "google-cse",
      debug: {
        prompt,
        desired,
        queries,
        domainCap,
        domainCounts: Object.fromEntries(domainCount.entries())
      }
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Unexpected error" });
  }
}
