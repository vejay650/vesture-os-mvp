// pages/api/moodboard.ts
import type { NextApiRequest, NextApiResponse } from "next";

type ImageResult = {
  imageUrl: string;
  thumbnailUrl?: string;
  sourceUrl: string;
  title?: string;
  provider?: string;
  category?: string;
  score?: number;
  query?: string;
};

type Candidate = {
  imageUrl: string;
  thumbnailUrl?: string;
  sourceUrl: string;
  title: string;
  provider: string;
  query: string;
  category: string;
  score: number;
};

const VERSION = "moodboard-v21-PRODUCT-FILTER-DIVERSITY-2026-02-02";

const DEFAULT_SITES = [
  // keep these; they tend to return product imagery through CSE/PSE
  "ssense.com",
  "yoox.com",
  "neimanmarcus.com",
  "mrporter.com",
  "endclothing.com",
  "nordstrom.com",
];

// If your Programmable Search Engine is set to “Sites to search”
// you do NOT need site: operators. Your CSE already restricts.
function getRetailerSites(): string[] {
  const raw = (process.env.RETAILER_SITES || "").trim();
  const list = raw
    ? raw
        .split(/[,\n]/g)
        .map((s) => s.trim())
        .filter(Boolean)
    : DEFAULT_SITES;

  // normalize (remove protocol, www, paths)
  const norm = list
    .map((s) => s.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0])
    .filter(Boolean);

  // unique
  return Array.from(new Set(norm));
}

function getEnv(name: string): string {
  const v = process.env[name];
  return (v || "").trim();
}

function domainOf(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function lc(s: string): string {
  return (s || "").toLowerCase();
}

// Hard blocks: these are the things currently poisoning your results
const BLOCK_WORDS = [
  // beauty / fragrance
  "eau de parfum",
  "parfum",
  "perfume",
  "cologne",
  "fragrance",
  "skincare",
  "skin",
  "serum",
  "foundation",
  "makeup",
  "lipstick",
  "mascara",
  "beauty",
  "grooming",
  "shampoo",
  "conditioner",

  // women / kids (Neiman especially)
  "women",
  "womens",
  "woman",
  "ladies",
  "lady",
  "girl",
  "kids",
  "kid",
  "toddler",
  "baby",

  // editorial / content pages
  "editorial",
  "lookbook",
  "campaign",
  "journal",
  "magazine",
  "guide",
  "stories",
  "blog",
  "press",
  "trend",
  "trends",
];

const BLOCK_PATH_HINTS = [
  "/editorial",
  "/stories",
  "/blog",
  "/journal",
  "/magazine",
  "/guide",
  "/press",
  "/campaign",
  "/lookbook",
  "/news",
  "/style",
  "/market",
];

// Product-ish URL signals (light heuristic, but works well)
const PRODUCT_URL_HINTS = [
  // Neiman / Nordstrom
  "itemid=",
  "/p/",
  "prod",
  // SSENSE
  "/men/product/",
  // Mr Porter
  "/product/",
  // END.
  "/products/",
  // Yoox (varies, but often has item)
  "cod10=",
  "dept=",
];

function isBlockedByText(title: string, url: string): boolean {
  const t = lc(title);
  const u = lc(url);
  for (const w of BLOCK_WORDS) {
    if (t.includes(w) || u.includes(w)) return true;
  }
  for (const p of BLOCK_PATH_HINTS) {
    if (u.includes(p)) return true;
  }
  return false;
}

function looksLikeProductPage(title: string, url: string): boolean {
  const u = lc(url);
  // avoid category pages
  if (u.includes("/cat") || u.includes("category=") || u.includes("/categories/")) return false;

  // allow if url has common product signals
  for (const h of PRODUCT_URL_HINTS) {
    if (u.includes(h)) return true;
  }

  // fallback: many product pages have long IDs/strings
  const hasLongToken = u.split("/").some((seg) => seg.length >= 20);
  return hasLongToken;
}

function categoryFromQuery(q: string): string {
  const s = lc(q);
  if (s.includes("boot") || s.includes("shoe") || s.includes("loafer") || s.includes("derby")) return "shoes";
  if (s.includes("trouser") || s.includes("pants") || s.includes("jean") || s.includes("chino")) return "bottoms";
  if (s.includes("shirt") || s.includes("tee") || s.includes("t-shirt") || s.includes("button-up") || s.includes("knit")) return "tops";
  if (s.includes("jacket") || s.includes("coat") || s.includes("outerwear") || s.includes("bomber")) return "outerwear";
  return "accessories";
}

// Simple scoring: reward matches, punish junk
function scoreCandidate(c: Candidate, prompt: string): number {
  const p = lc(prompt);
  const t = lc(c.title);
  const u = lc(c.sourceUrl);

  let score = 0;

  // Strongly prefer product-ish pages
  if (looksLikeProductPage(c.title, c.sourceUrl)) score += 20;
  else score -= 30;

  // Penalize blocked categories (double safety)
  if (isBlockedByText(c.title, c.sourceUrl)) score -= 80;

  // Reward if the prompt words appear
  const words = p.split(/\s+/).filter(Boolean);
  const hits = words.filter((w) => w.length >= 3 && (t.includes(w) || u.includes(w))).length;
  score += hits * 6;

  // Boots prompt: reward boots/shoes pages
  if (p.includes("boot") && (t.includes("boot") || u.includes("boot"))) score += 10;
  if (p.includes("black") && (t.includes("black") || u.includes("black"))) score += 6;
  if (p.includes("minimal") && (t.includes("minimal") || t.includes("sleek") || t.includes("clean"))) score += 6;

  // Domain balance: slight penalty to Neiman so it doesn’t hog top slots
  if (c.provider === "neimanmarcus.com") score -= 6;

  return score;
}

async function cseImageSearch(params: {
  q: string;
  start?: number;
  num?: number;
}): Promise<any> {
  const key = getEnv("GOOGLE_CSE_API_KEY") || getEnv("GOOGLE_CSE_KEY") || getEnv("GOOGLE_API_KEY");
  const cx = getEnv("GOOGLE_CSE_CX") || getEnv("GOOGLE_CSE_ID") || getEnv("GOOGLE_CX");

  if (!key || !cx) {
    throw new Error("Missing GOOGLE_CSE_API_KEY or GOOGLE_CSE_CX");
  }

  const num = params.num ?? 10;
  const start = params.start ?? 1;

  const url =
    "https://www.googleapis.com/customsearch/v1" +
    `?key=${encodeURIComponent(key)}` +
    `&cx=${encodeURIComponent(cx)}` +
    `&searchType=image` +
    `&safe=active` +
    `&num=${encodeURIComponent(String(num))}` +
    `&start=${encodeURIComponent(String(start))}` +
    `&q=${encodeURIComponent(params.q)}`;

  const r = await fetch(url);
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    const err = new Error(`CSE HTTP ${r.status}: ${text.slice(0, 240)}`);
    // @ts-ignore
    err.status = r.status;
    throw err;
  }
  return r.json();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const gender = (String((req.query.gender ?? (req.body as any)?.gender) || "men") || "men").toLowerCase();
    const promptRaw = String((req.query.prompt ?? (req.body as any)?.prompt) || "").trim();

    if (!promptRaw) {
      return res.status(200).json({
        images: [],
        source: "google-cse",
        debug: { version: VERSION, error: "Missing prompt. Provide ?prompt=..." },
      });
    }

    const prompt = promptRaw;

    // Category-aware queries. No “chelsea” hardcoding.
    const queries = [
      `${gender} ${prompt} boots`,
      `${gender} ${prompt} shoes`,
      `${gender} ${prompt} trousers`,
      `${gender} ${prompt} button-up shirt`,
      `${gender} ${prompt} jacket`,
      `${gender} ${prompt} leather belt`,
      `${gender} ${prompt} watch`,
    ];

    const SITES = getRetailerSites();

    // We don’t put site: here (since PSE already restricts),
    // but we DO enforce allowed domains after we fetch.
    const allowedDomains = new Set(SITES.map((s) => s.replace(/^www\./, "")));

    const desired = Number(req.query.desired || 18) || 18;
    const perDomainCap = Number(req.query.perDomainCap || 3) || 3;

    const candidates: Candidate[] = [];
    const fetchDebug: Record<string, any> = {};

    // Fetch 2 pages per query (start=1,11)
    for (const q of queries) {
      const key = `${q}`;
      fetchDebug[key] = { pages: 0, itemsSeen: 0, domains: {} as Record<string, number> };

      for (const start of [1, 11]) {
        const data = await cseImageSearch({ q, start, num: 10 });
        fetchDebug[key].pages += 1;

        const items = Array.isArray(data?.items) ? data.items : [];
        fetchDebug[key].itemsSeen += items.length;

        for (const it of items) {
          const imageUrl: string = it?.link || "";
          const sourceUrl: string = it?.image?.contextLink || it?.image?.thumbnailLink || "";
          const title: string = String(it?.title || it?.snippet || "").trim();
          const provider = domainOf(sourceUrl) || domainOf(imageUrl);

          if (!imageUrl || !sourceUrl || !provider) continue;

          // Hard allowlist: only take results from your retail sites
          if (!allowedDomains.has(provider)) continue;

          // Remove junk immediately
          if (isBlockedByText(title, sourceUrl)) continue;

          // Must look like product page (stops SSENSE editorials + Neiman perfumes)
          if (!looksLikeProductPage(title, sourceUrl)) continue;

          fetchDebug[key].domains[provider] = (fetchDebug[key].domains[provider] || 0) + 1;

          const c: Candidate = {
            imageUrl,
            thumbnailUrl: it?.image?.thumbnailLink,
            sourceUrl,
            title: title || provider,
            provider,
            query: q,
            category: categoryFromQuery(q),
            score: 0,
          };
          candidates.push(c);
        }
      }
    }

    // Dedup by (sourceUrl + imageUrl)
    const seen = new Set<string>();
    const deduped: Candidate[] = [];
    for (const c of candidates) {
      const k = `${c.sourceUrl}::${c.imageUrl}`;
      if (seen.has(k)) continue;
      seen.add(k);
      deduped.push(c);
    }

    // Score + sort
    for (const c of deduped) c.score = scoreCandidate(c, prompt);
    deduped.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    // Diversity + category fill
    const out: ImageResult[] = [];
    const domainCounts: Record<string, number> = {};
    const catCounts: Record<string, number> = {};

    const takeCandidate = (c: Candidate): boolean => {
      const d = c.provider;
      const cat = c.category;

      if ((domainCounts[d] || 0) >= perDomainCap) return false;

      // avoid having ONLY shoes etc
      // first pass: try to keep categories balanced
      domainCounts[d] = (domainCounts[d] || 0) + 1;
      catCounts[cat] = (catCounts[cat] || 0) + 1;

      out.push({
        imageUrl: c.imageUrl,
        thumbnailUrl: c.thumbnailUrl,
        sourceUrl: c.sourceUrl,
        title: c.title,
        provider: c.provider,
        category: c.category,
        score: c.score,
        query: c.query,
      });
      return true;
    };

    // Pass 1: ensure breadth across categories (up to 1 per category first)
    const wantedCats = ["shoes", "bottoms", "tops", "outerwear", "accessories"];
    for (const cat of wantedCats) {
      for (const c of deduped) {
        if (out.length >= desired) break;
        if (c.category !== cat) continue;
        if ((catCounts[cat] || 0) >= 1) continue;
        if (takeCandidate(c)) break;
      }
    }

    // Pass 2: fill remaining, still respecting per-domain cap
    for (const c of deduped) {
      if (out.length >= desired) break;
      takeCandidate(c);
    }

    return res.status(200).json({
      images: out,
      source: "google-cse",
      debug: {
        version: VERSION,
        prompt,
        gender,
        desired,
        perDomainCap,
        sites: Array.from(allowedDomains),
        queries,
        totalCandidates: candidates.length,
        totalDeduped: deduped.length,
        domainCounts,
        categoryCounts: catCounts,
        fetch: fetchDebug,
      },
    });
  } catch (e: any) {
    return res.status(200).json({
      images: [],
      source: "google-cse",
      debug: {
        version: VERSION,
        error: e?.message || String(e),
      },
    });
  }
}
