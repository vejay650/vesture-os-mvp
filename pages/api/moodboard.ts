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
  const lc = hay.toLowerCase();
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
  const lc = prompt.toLowerCase();

  const isDate = /(date|night out|evening|dinner|drinks)/i.test(lc);
  const isGame = /(game|stadium|arena|courtside)/i.test(lc);

  const g =
    gender.includes("women") ? "women" :
    gender.includes("men") ? "men" :
    "unisex";

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
    const body: any = req.method === "POST" ? req.body : req.query;

    const prompt = clean(body.prompt || "");
    const gender = clean(body.gender || "unisex");
    const desired = Math.min(Math.max(Number(body.count) || 18, 6), 36);

    if (!prompt) {
      return res.status(400).json({ error: "Missing prompt" });
    }

    const key = process.env.GOOGLE_CSE_KEY;
    const cx = process.env.GOOGLE_CSE_ID;
    if (!key || !cx) {
      return res.status(500).json({ error: "Missing Google CSE env vars" });
    }

    const sites = clean(process.env.RETAILER_SITES || "")
      .split(",")
      .map(normHost)
      .filter(Boolean);

    const siteFilter = sites.map(s => `site:${s}`).join(" OR ");

    const queries = buildItemQueries(prompt, gender);
    const perQuery = Math.ceil(desired / queries.length);

    let candidates: Candidate[] = [];

    for (const q of queries) {
      const search = `${q} -pinterest -editorial (${siteFilter})`;
      const items = await googleImageSearch(search, perQuery * 3, key, cx);

      for (const it of items) {
        // ✅ HARD TypeScript-safe extraction
        const img: string = String((it as any)?.link ?? "");
        const thumb: string = String((it as any)?.image?.thumbnailLink ?? "");
        const link: string = String(
          (it as any)?.image?.contextLink ??
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

    // Rank + diversify
    const scored = candidates
      .map(c => ({
        ...c,
        score: (c.host.includes("farfetch") ? -2 : 0) + (c.link.includes("/product") ? 8 : 0)
      }))
      .sort((a, b) => b.score - a.score);

    const domainCap = 3;
    const domainCount = new Map<string, number>();
    const seen = new Set<string>();
    const output: ImageResult[] = [];

    for (const c of scored) {
      const count = domainCount.get(c.host) || 0;
      if (count >= domainCap) continue;

      const key = `${c.link}::${c.img}`;
      if (seen.has(key)) continue;
      seen.add(key);

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
      source: "google-cse"
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Unexpected error" });
  }
}
