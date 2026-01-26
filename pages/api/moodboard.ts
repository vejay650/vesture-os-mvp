// pages/api/moodboard.ts
import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";

const VERSION = "moodboard-v14-OR-SITE-LIVE-2026-01-15";

type Category = "shoes" | "bottoms" | "tops" | "outerwear" | "accessories" | "other";

type Candidate = {
  id: string;
  title: string;
  link: string;
  img: string;
  host: string;
  query: string;
  guessedCategory: Category;
};

type ImageResult = {
  imageUrl: string;
  sourceUrl: string;
  title: string;
  provider: string;
  category: Category;
  score: number;
  query: string;
};

// ---------- Helpers ----------
const clean = (s: any) => (typeof s === "string" ? s.trim() : "");
const normHost = (h: string) => clean(h).replace(/^www\./i, "").toLowerCase();

const BLOCKED_DOMAINS = [
  "pinterest.", "pinimg.com", "reddit.", "twitter.", "x.com", "tumblr."
];

const WOMEN_BLOCK = ["women", "dress", "skirt", "bra", "lingerie"];

// ---------- Category Guess ----------
function guessCategory(text: string): Category {
  const t = text.toLowerCase();
  if (/boot|shoe|sneaker|loafer/.test(t)) return "shoes";
  if (/pant|trouser|jean|denim/.test(t)) return "bottoms";
  if (/shirt|tee|top|knit|blouse/.test(t)) return "tops";
  if (/jacket|coat|bomber|outerwear/.test(t)) return "outerwear";
  if (/belt|watch|bag|sunglass|hat/.test(t)) return "accessories";
  return "other";
}

// ---------- Query Builder ----------
function buildQueries(prompt: string, gender: string) {
  const base = prompt.toLowerCase();

  return [
    `${gender} minimal chelsea boots`,
    `${gender} tailored trousers`,
    `${gender} clean button-up shirt`,
    `${gender} lightweight jacket`,
    `${gender} leather belt`,
    `${gender} minimalist watch`,
  ];
}

// ---------- Google CSE OR-Site Search ----------
async function googleSearchOR(
  q: string,
  sites: string[],
  key: string,
  cx: string
): Promise<any[]> {

  const siteQuery = sites.map(s => `site:${s}`).join(" OR ");
  const url = new URL("https://www.googleapis.com/customsearch/v1");

  url.searchParams.set("q", `${q} (${siteQuery})`);
  url.searchParams.set("searchType", "image");
  url.searchParams.set("num", "10");
  url.searchParams.set("imgType", "photo");
  url.searchParams.set("safe", "active");
  url.searchParams.set("key", key);
  url.searchParams.set("cx", cx);

  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const data = await res.json();
  return data?.items || [];
}

// ---------- API ----------
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const qParam = clean(req.query.q);
    const gender = clean(req.query.gender) || "men";

    const key = clean(process.env.GOOGLE_CSE_KEY);
    const cx = clean(process.env.GOOGLE_CSE_ID);
    const sitesEnv = clean(process.env.RETAILER_SITES);

    if (!key || !cx || !sitesEnv) {
      return res.status(500).json({ error: "Missing ENV vars" });
    }

    const sites = sitesEnv.split(",").map(normHost).filter(Boolean);

    const queries = buildQueries(qParam, gender);
    const candidates: Candidate[] = [];

    const fetchDebug: any = {};

    for (const q of queries) {
      const items = await googleSearchOR(q, sites, key, cx);
      fetchDebug[q] = items.length;

      for (const it of items) {
        const img = clean(it?.link);
        const link = clean(it?.image?.contextLink || it?.displayLink);
        const title = clean(it?.title);

        if (!img || !link) continue;

        let host = "";
        try { host = normHost(new URL(link).hostname); } catch {}

        if (BLOCKED_DOMAINS.some(b => host.includes(b))) continue;
        if (gender.includes("men") && WOMEN_BLOCK.some(w => (title + link).toLowerCase().includes(w))) continue;

        const guessed = guessCategory(title + " " + link);

        candidates.push({
          id: `${host}-${img}`,
          title,
          link,
          img,
          host,
          query: q,
          guessedCategory: guessed
        });
      }
    }

    // ---------- Rerank via OpenAI ----------
    let ranked = [...candidates];
    const apiKey = clean(process.env.OPENAI_API_KEY);

    if (apiKey && ranked.length > 8) {
      try {
        const client = new OpenAI({ apiKey });
        const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

        const payload = ranked.slice(0, 40).map(c => ({
          id: c.id,
          title: c.title,
          host: c.host,
          category: c.guessedCategory,
          q: c.query
        }));

        const prompt = `
Return JSON ONLY:
{ "ranked_ids": ["id1","id2", ...] }

Rank by best match to prompt: "${qParam}"
Prefer fashion-forward, minimal, date-night suitable items.
Avoid cheap-looking or irrelevant items.
`.trim();

        const resp = await client.chat.completions.create({
          model,
          messages: [{ role: "system", content: prompt + JSON.stringify(payload) }],
          temperature: 0.15,
          max_tokens: 700,
        });

        const raw = resp.choices?.[0]?.message?.content || "";
        const parsed = JSON.parse(raw);
        const ids = parsed?.ranked_ids || [];

        ranked = ids.map((id: string) => ranked.find(r => r.id === id)).filter(Boolean) as Candidate[];
      } catch {}
    }

    // ---------- Diversity + Fill ----------
    const seen = new Set<string>();
    const domainCount = new Map<string, number>();
    const catCount: Record<Category, number> = {
      shoes: 0, bottoms: 0, tops: 0, outerwear: 0, accessories: 0, other: 0
    };

    const perDomainCap = 1;
    const desired = 16;

    const out: ImageResult[] = [];

    function take(c: Candidate) {
      const k = `${c.link}::${c.img}`;
      if (seen.has(k)) return false;

      if ((domainCount.get(c.host) || 0) >= perDomainCap) return false;

      seen.add(k);
      domainCount.set(c.host, (domainCount.get(c.host) || 0) + 1);
      catCount[c.guessedCategory]++;

      out.push({
        imageUrl: c.img,
        sourceUrl: c.link,
        title: c.title,
        provider: c.host,
        category: c.guessedCategory,
        score: 1,
        query: c.query
      });

      return true;
    }

    for (const c of ranked) {
      if (out.length >= desired) break;
      take(c);
    }

    // Emergency fill if low
    if (out.length < 8) {
      for (const c of ranked) {
        if (out.length >= desired) break;
        if (!seen.has(`${c.link}::${c.img}`)) take(c);
      }
    }

    return res.status(200).json({
      images: out,
      source: "google-cse",
      debug: {
        version: VERSION,
        prompt: qParam,
        queries,
        totalCandidates: candidates.length,
        domainsUsed: Array.from(domainCount.keys()),
        fetchCounts: fetchDebug
      }
    });

  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Unexpected error" });
  }
}
