// pages/api/moodboard.ts
import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";

const VERSION = "moodboard-v17-PROMPT-DRIVEN-NO-HARDCODE-2026-01-25";

type Category = "shoes" | "bottoms" | "tops" | "outerwear" | "accessories" | "other";

type Candidate = {
  id: string;
  title: string;
  link: string;
  img: string;
  host: string;
  query: string;
  cat: Category;
  score0: number;
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

const clean = (s: any) => (typeof s === "string" ? s.trim() : "");
const normHost = (h: string) => clean(h).replace(/^www\./i, "").toLowerCase();

const BLOCKED_DOMAINS = ["pinterest.", "pinimg.com", "reddit.", "twitter.", "x.com", "tumblr."];

const EXCLUDE_PATH_PARTS = [
  "/editorial", "/editors", "/magazine", "/journal", "/blog", "/stories", "/story",
  "/guide", "/guides", "/help", "/customer-service", "/customer_service", "/support",
  "/about", "/privacy", "/terms", "/policies", "/lookbook", "/press", "/news", "/campaign", "/campaigns"
];

function isNonProductPage(url: string): boolean {
  const u = (url || "").toLowerCase();
  for (let i = 0; i < EXCLUDE_PATH_PARTS.length; i++) {
    if (u.includes(EXCLUDE_PATH_PARTS[i])) return true;
  }
  if (/(ultimate|best|top-\d+|how-to|what-is|style-guide|trend|trends)/.test(u)) return true;
  return false;
}

function isBlockedDomain(host: string): boolean {
  for (let i = 0; i < BLOCKED_DOMAINS.length; i++) {
    if (host.includes(BLOCKED_DOMAINS[i])) return true;
  }
  return false;
}

function guessCategory(text: string): Category {
  const t = (text || "").toLowerCase();
  if (/(boot|boots|shoe|shoes|sneaker|sneakers|loafer|loafers|derby|oxford|moc|clog)/.test(t)) return "shoes";
  if (/(pant|pants|trouser|trousers|jean|jeans|denim|chino|chinos|cargo|slacks)/.test(t)) return "bottoms";
  if (/(shirt|tee|t-shirt|top|knit|sweater|hoodie|polo|button-up|button down|blouse)/.test(t)) return "tops";
  if (/(jacket|coat|bomber|outerwear|parka|blazer|overcoat|trench)/.test(t)) return "outerwear";
  if (/(belt|watch|bag|sunglass|sunglasses|hat|cap|beanie|scarf|wallet|jewelry|bracelet|ring)/.test(t)) return "accessories";
  return "other";
}

function dedupeWords(input: string): string {
  const raw = (input || "").toLowerCase().replace(/[^\w\s-]/g, " ");
  const parts = raw.split(/\s+/).filter(Boolean);

  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < parts.length; i++) {
    const w = parts[i];
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out.join(" ").trim();
}

// pull “shoe intent” from prompt so we don’t guess wrong
function detectFocus(prompt: string) {
  const p = (prompt || "").toLowerCase();
  return {
    wantsShoes: /(boot|boots|shoe|shoes|sneaker|sneakers|loafer|loafers|derby|oxford)/.test(p),
    wantsBottoms: /(pants|trousers|jeans|denim|chinos|slacks|cargo)/.test(p),
    wantsTops: /(shirt|tee|t-shirt|button-up|button down|sweater|knit|hoodie|polo)/.test(p),
    wantsOuterwear: /(jacket|coat|bomber|blazer|trench|overcoat)/.test(p),
    wantsAccessories: /(belt|watch|bag|sunglass|sunglasses|hat|cap|beanie|scarf|jewelry)/.test(p)
  };
}

function productishBoost(link: string): number {
  const u = (link || "").toLowerCase();
  let s = 0;
  // common product patterns
  if (u.includes("/product")) s += 10;
  if (u.includes("/products")) s += 8;
  if (u.includes("/item")) s += 8;
  if (u.includes("/p/")) s += 6;
  if (u.includes("/dp/")) s += 6;
  if (u.includes("/sku")) s += 6;

  // penalize likely non-product pages
  if (isNonProductPage(u)) s -= 25;
  return s;
}

function urlKeyForPage(link: string): string {
  try {
    const u = new URL(link);
    return `${normHost(u.hostname)}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return link;
  }
}

function pickSiteChunk(allSites: string[], chunkSize: number, chunkIndex: number): string[] {
  if (!allSites.length) return [];
  const start = (chunkIndex * chunkSize) % allSites.length;
  const out: string[] = [];
  for (let i = 0; i < Math.min(chunkSize, allSites.length); i++) {
    out.push(allSites[(start + i) % allSites.length]);
  }
  return out;
}

async function googleSearchOR(q: string, sites: string[], key: string, cx: string): Promise<any[]> {
  if (!sites.length) return [];
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

// ✅ PROMPT-DRIVEN queries (no hardcoded chelsea boots)
function buildQueriesFromPrompt(prompt: string, gender: string): string[] {
  const g = (gender || "men").toLowerCase().includes("women") ? "women" : "men";
  const p = dedupeWords(prompt);

  const f = detectFocus(p);

  // base phrase should always include the prompt
  const base = `${g} ${p}`.trim();

  // If prompt already specifies a product type (boots, jeans, blazer), we don’t force categories.
  // But we still add a few “support pieces” so moodboards aren’t only shoes/pants.
  const qs: string[] = [];
  qs.push(`${base} product`.trim()); // broad pull

  if (f.wantsShoes) qs.push(`${g} ${p} shoes`.trim());
  if (f.wantsBottoms) qs.push(`${g} ${p} trousers`.trim());
  if (f.wantsTops) qs.push(`${g} ${p} shirt`.trim());
  if (f.wantsOuterwear) qs.push(`${g} ${p} jacket`.trim());
  if (f.wantsAccessories) qs.push(`${g} ${p} belt watch`.trim());

  // support items (always helpful for outfits)
  qs.push(`${g} minimal trousers ${p}`.trim());
  qs.push(`${g} clean button-up ${p}`.trim());
  qs.push(`${g} lightweight jacket ${p}`.trim());
  qs.push(`${g} leather belt ${p}`.trim());

  // de-dupe queries
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i < qs.length; i++) {
    const q = dedupeWords(qs[i]);
    if (!q) continue;
    if (seen.has(q)) continue;
    seen.add(q);
    out.push(q);
  }

  return out.slice(0, 8);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const qParam = clean(req.query.q);
    const gender = clean(req.query.gender) || "men";

    if (!qParam) {
      return res.status(200).json({
        images: [],
        source: "google-cse",
        debug: { version: VERSION, note: "Missing q param. Example: /api/moodboard?q=minimal+date+night" }
      });
    }

    const key = clean(process.env.GOOGLE_CSE_KEY);
    const cx = clean(process.env.GOOGLE_CSE_ID);
    const sitesEnv = clean(process.env.RETAILER_SITES);

    const allowFarfetch = clean(process.env.ALLOW_FARFETCH).toLowerCase() === "true";
    const farfetchBlocked = !allowFarfetch;

    if (!key || !cx || !sitesEnv) {
      return res.status(500).json({
        error: "Missing ENV vars (GOOGLE_CSE_KEY, GOOGLE_CSE_ID, RETAILER_SITES)",
        debug: { version: VERSION }
      });
    }

    let sites = sitesEnv.split(",").map(normHost).filter(Boolean);

    if (farfetchBlocked) {
      sites = sites.filter((s) => s !== "farfetch.com" && !s.endsWith(".farfetch.com"));
    }

    if (!sites.length) {
      return res.status(500).json({
        error: "RETAILER_SITES empty after filtering",
        debug: { version: VERSION, farfetchBlocked }
      });
    }

    const queries = buildQueriesFromPrompt(qParam, gender);

    const candidates: Candidate[] = [];
    const fetchCounts: Record<string, number> = {};

    const SITES_PER_QUERY = 6;
    const CHUNKS_PER_QUERY = 2;
    const MAX_ITEMS_PER_QUERY = 16;

    for (let qi = 0; qi < queries.length; qi++) {
      const q = queries[qi];
      let seenThisQuery = 0;

      for (let chunk = 0; chunk < CHUNKS_PER_QUERY; chunk++) {
        const chunkSites = pickSiteChunk(sites, SITES_PER_QUERY, qi + chunk);
        const items = await googleSearchOR(q, chunkSites, key, cx);

        fetchCounts[`${q}__chunk${chunk}`] = items.length;

        for (let ii = 0; ii < items.length; ii++) {
          const it = items[ii];
          const img = clean(it?.link);
          const link = clean(it?.image?.contextLink || "");
          const title = clean(it?.title);

          if (!img || !link) continue;

          let host = "";
          try {
            host = normHost(new URL(link).hostname);
          } catch {
            continue;
          }

          if (isBlockedDomain(host)) continue;

          // hard-block farfetch
          if (farfetchBlocked) {
            if (host.includes("farfetch.com")) continue;
            if ((img || "").toLowerCase().includes("farfetch-contents.com")) continue;
          }

          // hard-block editorial/blog/guide
          if (isNonProductPage(link)) continue;

          const cat = guessCategory(title + " " + link);
          const pageKey = urlKeyForPage(link);

          const baseScore = 1 + productishBoost(link);

          candidates.push({
            id: `${host}::${pageKey}`,
            title,
            link,
            img,
            host,
            query: q,
            cat,
            score0: baseScore
          });

          seenThisQuery++;
          if (seenThisQuery >= MAX_ITEMS_PER_QUERY) break;
        }

        if (seenThisQuery >= MAX_ITEMS_PER_QUERY) break;
      }
    }

    // heuristic sort
    candidates.sort((a, b) => (b.score0 - a.score0));

    let ranked = candidates.slice(0);
    let rerankSource: "none" | "openai" | "heuristic" = "heuristic";

    // Optional rerank with OpenAI (only if you have key)
    const apiKey = clean(process.env.OPENAI_API_KEY);
    if (apiKey && ranked.length > 12) {
      try {
        const client = new OpenAI({ apiKey });
        const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

        const payload = ranked.slice(0, 50).map((c) => ({
          id: c.id,
          title: c.title,
          host: c.host,
          category: c.cat,
          q: c.query
        }));

        const prompt =
          `Return JSON ONLY: {"ranked_ids":["id1","id2",...]}.\n` +
          `Rank by best match to user prompt: "${qParam}".\n` +
          `Favor product pages and clear product titles. Avoid guides/editorial.\n` +
          JSON.stringify(payload);

        const resp = await client.chat.completions.create({
          model,
          messages: [{ role: "system", content: prompt }],
          temperature: 0.1,
          max_tokens: 650
        });

        const raw = resp.choices?.[0]?.message?.content || "";
        const parsed = JSON.parse(raw);
        const ids = (Array.isArray(parsed?.ranked_ids) ? parsed.ranked_ids : []).map((x: any) => String(x));

        if (ids.length) {
          const map = new Map<string, Candidate>();
          for (let i = 0; i < ranked.length; i++) map.set(ranked[i].id, ranked[i]);

          const reordered: Candidate[] = [];
          const used = new Set<string>();
          for (let i = 0; i < ids.length; i++) {
            const hit = map.get(ids[i]);
            if (hit && !used.has(hit.id)) {
              reordered.push(hit);
              used.add(hit.id);
            }
          }
          for (let i = 0; i < ranked.length; i++) {
            const c = ranked[i];
            if (!used.has(c.id)) reordered.push(c);
          }
          ranked = reordered;
          rerankSource = "openai";
        }
      } catch {
        rerankSource = "heuristic";
      }
    }

    // Output selection: domain diversity + category variety
    const desired = 16;
    const perDomainCap = 2;

    const domainCount = new Map<string, number>();
    const seen = new Set<string>();
    const out: ImageResult[] = [];

    const wantedOrder: Category[] = ["shoes","bottoms","tops","outerwear","accessories","shoes","bottoms","tops","outerwear"];

    const canTake = (c: Candidate) => {
      if (seen.has(c.id)) return false;
      const dc = domainCount.get(c.host) || 0;
      if (dc >= perDomainCap) return false;
      return true;
    };

    const take = (c: Candidate) => {
      seen.add(c.id);
      domainCount.set(c.host, (domainCount.get(c.host) || 0) + 1);
      out.push({
        imageUrl: c.img,
        sourceUrl: c.link,
        title: c.title,
        provider: c.host,
        category: c.cat,
        score: c.score0,
        query: c.query
      });
    };

    // category pass
    for (let i = 0; i < wantedOrder.length && out.length < desired; i++) {
      const cat = wantedOrder[i];
      const pick = ranked.find((c) => c.cat === cat && canTake(c));
      if (pick) take(pick);
    }

    // fill pass
    for (let i = 0; i < ranked.length && out.length < desired; i++) {
      const c = ranked[i];
      if (canTake(c)) take(c);
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
        rerankSource,
        farfetchBlocked,
        fetchCounts
      }
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Unexpected error" });
  }
}
