// pages/api/moodboard.ts
import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";

const VERSION = "moodboard-v14b-OR-SITE-ES5FIX-2026-01-15";

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

const BLOCKED_DOMAINS = ["pinterest.", "pinimg.com", "reddit.", "twitter.", "x.com", "tumblr."];

// light guard to avoid obvious women-only terms if user set men
const WOMEN_BLOCK = ["women", "womens", "dress", "skirt", "bra", "lingerie", "heels", "stiletto"];

// ---------- Category Guess ----------
function guessCategory(text: string): Category {
  const t = (text || "").toLowerCase();
  if (/(boot|boots|shoe|shoes|sneaker|sneakers|loafer|loafers|chelsea)/.test(t)) return "shoes";
  if (/(pant|pants|trouser|trousers|jean|jeans|denim|chino|chinos|cargo)/.test(t)) return "bottoms";
  if (/(shirt|tee|t-shirt|top|knit|sweater|hoodie|polo|button-up)/.test(t)) return "tops";
  if (/(jacket|coat|bomber|outerwear|parka|blazer|overcoat)/.test(t)) return "outerwear";
  if (/(belt|watch|bag|sunglass|sunglasses|hat|cap|beanie|scarf|wallet)/.test(t)) return "accessories";
  return "other";
}

// ---------- Query Builder (simple + reliable) ----------
function buildQueries(prompt: string, gender: string) {
  const g = (gender || "men").toLowerCase().includes("women") ? "women" : "men";
  const p = (prompt || "").trim();

  // We’re using short keyword phrases (CSE-friendly)
  return [
    `${g} minimal chelsea boots ${p}`.trim(),
    `${g} tailored trousers ${p}`.trim(),
    `${g} clean button-up shirt ${p}`.trim(),
    `${g} lightweight jacket ${p}`.trim(),
    `${g} leather belt ${p}`.trim(),
    `${g} minimalist watch ${p}`.trim(),
  ];
}

// ---------- Google CSE OR-Site Search ----------
async function googleSearchOR(q: string, sites: string[], key: string, cx: string): Promise<any[]> {
  const siteQuery = sites.map((s) => `site:${s}`).join(" OR ");
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
  return (data?.items || []) as any[];
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
      return res.status(500).json({
        error: "Missing ENV vars (GOOGLE_CSE_KEY, GOOGLE_CSE_ID, RETAILER_SITES)",
        debug: { version: VERSION }
      });
    }

    const sites = sitesEnv
      .split(",")
      .map(normHost)
      .filter(Boolean);

    if (!sites.length) {
      return res.status(500).json({
        error: "RETAILER_SITES is empty",
        debug: { version: VERSION }
      });
    }

    const queries = buildQueries(qParam, gender);

    const candidates: Candidate[] = [];
    const fetchCounts: Record<string, number> = {};

    for (let qi = 0; qi < queries.length; qi++) {
      const q = queries[qi];
      const items = await googleSearchOR(q, sites, key, cx);
      fetchCounts[q] = items.length;

      for (let ii = 0; ii < items.length; ii++) {
        const it = items[ii];
        const img = clean(it?.link);
        const link = clean(it?.image?.contextLink || it?.image?.context || it?.displayLink || "");
        const title = clean(it?.title);

        if (!img || !link) continue;

        let host = "";
        try {
          host = normHost(new URL(link).hostname);
        } catch {
          continue;
        }

        // block noisy domains
        let blocked = false;
        for (let b = 0; b < BLOCKED_DOMAINS.length; b++) {
          if (host.includes(BLOCKED_DOMAINS[b])) {
            blocked = true;
            break;
          }
        }
        if (blocked) continue;

        // men guard
        if (gender.toLowerCase().includes("men")) {
          const blob = (title + " " + link).toLowerCase();
          let womenHit = false;
          for (let w = 0; w < WOMEN_BLOCK.length; w++) {
            if (blob.includes(WOMEN_BLOCK[w])) {
              womenHit = true;
              break;
            }
          }
          if (womenHit) continue;
        }

        const guessed = guessCategory(title + " " + link);

        candidates.push({
          id: `${host}::${img}`,
          title,
          link,
          img,
          host,
          query: q,
          guessedCategory: guessed
        });
      }
    }

    // ---------- Rerank via OpenAI (optional) ----------
    let ranked: Candidate[] = candidates.slice(0);

    const apiKey = clean(process.env.OPENAI_API_KEY);
    if (apiKey && ranked.length > 10) {
      try {
        const client = new OpenAI({ apiKey });
        const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

        const payload = ranked.slice(0, 40).map((c) => ({
          id: c.id,
          title: c.title,
          host: c.host,
          category: c.guessedCategory,
          q: c.query
        }));

        const rerankPrompt =
          `Return JSON ONLY: {"ranked_ids":["id1","id2",...]}.\n` +
          `Rank by best match to prompt: "${qParam}".\n` +
          `Prefer minimal/date-night items; avoid irrelevant/cheap.\n` +
          `Here are candidates:\n` +
          JSON.stringify(payload);

        const resp = await client.chat.completions.create({
          model,
          messages: [{ role: "system", content: rerankPrompt }],
          temperature: 0.15,
          max_tokens: 700
        });

        const raw = resp.choices?.[0]?.message?.content || "";
        const parsed = JSON.parse(raw);
        const ids: string[] = Array.isArray(parsed?.ranked_ids) ? parsed.ranked_ids : [];

        if (ids.length) {
          const map = new Map<string, Candidate>();
          for (let i = 0; i < ranked.length; i++) map.set(ranked[i].id, ranked[i]);

          const reordered: Candidate[] = [];
          for (let i = 0; i < ids.length; i++) {
            const hit = map.get(ids[i]);
            if (hit) reordered.push(hit);
          }
          // add any leftovers
          for (let i = 0; i < ranked.length; i++) {
            const c = ranked[i];
            if (!ids.includes(c.id)) reordered.push(c);
          }
          ranked = reordered;
        }
      } catch {
        // ignore rerank failures and keep heuristic order
      }
    }

    // ---------- Diversity + Fill ----------
    const seen = new Set<string>();
    const domainCount = new Map<string, number>();
    const desired = 16;
    const perDomainCap = 1;

    const out: ImageResult[] = [];

    const take = (c: Candidate): boolean => {
      const k = `${c.link}::${c.img}`;
      if (seen.has(k)) return false;

      const dc = domainCount.get(c.host) || 0;
      if (dc >= perDomainCap) return false;

      seen.add(k);
      domainCount.set(c.host, dc + 1);

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
    };

    for (let i = 0; i < ranked.length && out.length < desired; i++) {
      take(ranked[i]);
    }

    // emergency fill: loosen perDomainCap if still low
    if (out.length < 8) {
      const relaxedCap = 3;
      for (let i = 0; i < ranked.length && out.length < desired; i++) {
        const c = ranked[i];
        const k = `${c.link}::${c.img}`;
        if (seen.has(k)) continue;
        const dc = domainCount.get(c.host) || 0;
        if (dc >= relaxedCap) continue;
        seen.add(k);
        domainCount.set(c.host, dc + 1);
        out.push({
          imageUrl: c.img,
          sourceUrl: c.link,
          title: c.title,
          provider: c.host,
          category: c.guessedCategory,
          score: 1,
          query: c.query
        });
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
        fetchCounts
      }
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Unexpected error" });
  }
}
