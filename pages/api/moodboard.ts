// pages/api/moodboard.ts
import type { NextApiRequest, NextApiResponse } from "next";

type Gender = "men" | "women" | "unisex";

type Candidate = {
  link: string; // product page url
  img: string; // image url
  thumb: string; // thumbnail url
  title: string;
  displayLink: string;
  query: string;
  provider?: string;
  category?: string;
  score?: number;
};

type CseItem = any;

type CseResp = {
  items?: CseItem[];
};

function env(name: string) {
  return (process.env[name] || "").trim();
}

const GOOGLE_CSE_KEY =
  env("GOOGLE_CSE_API_KEY") ||
  env("GOOGLE_CSE_KEY") ||
  env("GOOGLE_API_KEY") ||
  env("GOOGLE_KEY");

const GOOGLE_CSE_CX =
  env("GOOGLE_CSE_CX") || env("GOOGLE_CSE_ID") || env("GOOGLE_CX") || env("GOOGLE_CX_ID");

const DEFAULT_DESIRED = 18;
const DEFAULT_PER_DOMAIN_CAP = 3;

// You can add more here. Keep it conservative.
const BLOCKED_DOMAINS = new Set<string>([
  "farfetch.com", // you mentioned blocking
]);

// Keywords to strip out junk categories (perfume, beauty, etc.)
const DEFAULT_NEGATIVES = [
  // beauty / fragrance
  "-perfume",
  "-fragrance",
  "-parfum",
  "-cologne",
  "-beauty",
  "-skincare",
  "-makeup",
  "-lipstick",
  "-foundation",
  "-serum",
  "-cream",
  "-candle",
  "-diffuser",
  // footwear we don’t want for boots prompts
  "-sandal",
  "-slide",
  "-thong",
  "-flip-flop",
  "-flip",
  // womens leakage for “men” prompts
  "-women",
  "-womens",
  "-female",
  // editorial / content pages
  "-editorial",
  "-guide",
  "-market",
  "-magazine",
  "-journal",
  "-blog",
  "-stories",
  "-lookbook",
  "-press",
  "-campaign",
  "-inurl:editorial",
  "-inurl:guide",
  "-inurl:market",
  "-inurl:magazine",
  "-inurl:blog",
  "-inurl:stories",
  "-inurl:lookbook",
  "-inurl:press",
  "-inurl:campaign",
];

// Quick domain extraction
function domainOf(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// --- IMAGE PICKING (fixes your build error: always uses "it" arg) ---
function pickImageLinks(it: any) {
  const pm = it?.pagemap;
  const cseImg = pm?.cse_image?.[0]?.src;
  const cseThumb = pm?.cse_thumbnail?.[0]?.src;

  const imageUrl =
    pm?.metatags?.[0]?.["og:image"] ||
    pm?.metatags?.[0]?.["twitter:image"] ||
    cseImg ||
    it?.image?.thumbnailLink ||
    "";

  const thumbUrl = it?.image?.thumbnailLink || cseThumb || imageUrl || "";
  const pageUrl = (it?.link || "").trim();

  return { imageUrl: String(imageUrl || ""), thumbUrl: String(thumbUrl || ""), pageUrl };
}

// --- PRODUCT URL HEURISTICS (works on PRODUCT PAGE URL, not CDN image url) ---
function isLikelyProductUrl(domain: string, url: string, gender: Gender): boolean {
  const u = url.toLowerCase();

  // hard block common non-product paths
  const nonProductHints = [
    "/editorial",
    "/blog",
    "/stories",
    "/journal",
    "/magazine",
    "/guide",
    "/market",
    "/campaign",
    "/press",
    "/lookbook",
    "/search",
    "/collections", // often collection, not product
    "/category",
    "/categories",
    "/brands",
    "/brand",
    "/designer",
    "/designers",
    "/sale/", // sale can be product, but often listing pages; still allow if it looks like product
  ];

  // If it contains clear “listing page” signals and lacks “product” signals, reject.
  const looksListing =
    nonProductHints.some((p) => u.includes(p)) &&
    !u.includes("/product/") &&
    !u.includes("product.jsp") &&
    !u.includes("/p/");

  if (looksListing) return false;

  // Domain-specific product patterns (keep flexible)
  if (domain.includes("ssense.com")) {
    // SSENSE product pages usually: /men/product/brand/item/ID or /en-us/men/product/...
    return u.includes("/product/");
  }
  if (domain.includes("neimanmarcus.com")) {
    // product.jsp?itemId=... or /p/...prod...
    return u.includes("product.jsp?itemid=") || u.includes("/p/") || u.includes("prod");
  }
  if (domain.includes("saksfifthavenue.com")) {
    return u.includes("/product/") || u.includes("/pdp/");
  }
  if (domain.includes("nordstrom.com")) {
    return u.includes("/s/") || u.includes("/sr");
  }
  if (domain.includes("mrporter.com")) {
    return u.includes("/product/") || u.includes("/en-us/") || u.includes("/en-us/mens/product/");
  }
  if (domain.includes("endclothing.com")) {
    return u.includes("/products/") || u.includes("/product/");
  }
  if (domain.includes("yoox.com")) {
    return u.includes("/item") || u.includes("/us/") || u.includes("cod10=");
  }
  if (domain.includes("ourlegacy.com")) {
    return u.includes("/product/") || u.includes("/products/");
  }

  // Generic fallback: must not end with "/" and should not be a pure category
  // This is permissive because we’re already filtering later.
  const badEndings = ["/", ".html/"];
  if (badEndings.some((e) => u.endsWith(e))) {
    // still allow if it contains “/product/”
    if (!u.includes("/product/")) return false;
  }

  // If men prompt, try to avoid womens-only paths
  if (gender === "men" && (u.includes("/women") || u.includes("/womens"))) return false;

  return true;
}

// --- CATEGORY GUESS (optional) ---
function inferCategoryFromQuery(q: string): string | undefined {
  const s = q.toLowerCase();
  if (s.includes("boot") || s.includes("shoe") || s.includes("chelsea") || s.includes("loafer"))
    return "shoes";
  if (s.includes("trouser") || s.includes("pants") || s.includes("denim") || s.includes("jean"))
    return "bottoms";
  if (s.includes("shirt") || s.includes("button-up") || s.includes("polo") || s.includes("tee"))
    return "tops";
  if (s.includes("jacket") || s.includes("coat") || s.includes("bomber")) return "outerwear";
  if (s.includes("belt")) return "accessories";
  if (s.includes("watch")) return "accessories";
  if (s.includes("sunglasses")) return "accessories";
  return undefined;
}

// --- SCORE (simple heuristic to prefer tighter matches) ---
function scoreCandidate(c: Candidate, prompt: string): number {
  const p = prompt.toLowerCase();
  const t = (c.title || "").toLowerCase();
  const u = (c.link || "").toLowerCase();

  let s = 0;
  const tokens = p.split(/\s+/).filter(Boolean);

  for (const tok of tokens) {
    if (t.includes(tok)) s += 2;
    if (u.includes(tok)) s += 1;
  }

  // prefer “boots” when prompt says boots
  if (p.includes("boot") && (t.includes("boot") || u.includes("boot"))) s += 8;

  // penalize obvious off-category junk
  const bad = ["eau de parfum", "parfum", "cologne", "fragrance", "set", "treatment", "serum"];
  if (bad.some((b) => t.includes(b))) s -= 50;

  return s;
}

async function fetchCse(q: string, start: number): Promise<CseResp> {
  if (!GOOGLE_CSE_KEY || !GOOGLE_CSE_CX) {
    const missing = !GOOGLE_CSE_KEY ? "GOOGLE_CSE_KEY/API_KEY" : "GOOGLE_CSE_CX/ID";
    throw Object.assign(new Error(`Missing ${missing}`), { status: 500 });
  }

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", GOOGLE_CSE_KEY);
  url.searchParams.set("cx", GOOGLE_CSE_CX);
  url.searchParams.set("q", q);
  url.searchParams.set("start", String(start));
  // Image search ON (you enabled it in PSE)
  url.searchParams.set("searchType", "image");
  url.searchParams.set("num", "10");
  url.searchParams.set("safe", "active");

  const r = await fetch(url.toString());
  const text = await r.text();

  if (!r.ok) {
    const err = new Error(`CSE HTTP ${r.status}: ${text.slice(0, 250)}`);
    (err as any).status = r.status;
    throw err;
  }

  return JSON.parse(text) as CseResp;
}

function addNegatives(raw: string) {
  return `${raw} ${DEFAULT_NEGATIVES.join(" ")}`.trim();
}

function normalizeSites(sites: string[]) {
  return (sites || [])
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .map((x) => x.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""));
}

function uniqueBy<T>(arr: T[], keyFn: (t: T) => string) {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of arr) {
    const k = keyFn(it);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

function capPerDomain(items: Candidate[], cap: number) {
  const counts: Record<string, number> = {};
  const out: Candidate[] = [];
  for (const c of items) {
    const d = domainOf(c.link);
    counts[d] = counts[d] || 0;
    if (counts[d] >= cap) continue;
    counts[d] += 1;
    out.push(c);
  }
  return { out, counts };
}

function diversifyByCategory(items: Candidate[], desired: number) {
  const byCat: Record<string, Candidate[]> = {};
  for (const c of items) {
    const k = c.category || "other";
    byCat[k] = byCat[k] || [];
    byCat[k].push(c);
  }

  // round-robin pick
  const cats = Object.keys(byCat);
  const out: Candidate[] = [];
  let i = 0;
  while (out.length < desired && cats.length > 0) {
    const cat = cats[i % cats.length];
    const bucket = byCat[cat];
    const next = bucket.shift();
    if (next) out.push(next);
    // remove empty buckets
    const still = cats.filter((c) => (byCat[c] || []).length > 0);
    if (still.length !== cats.length) {
      // reset index if cats changed
      i = 0;
      for (const c of cats) if (!still.includes(c)) delete byCat[c];
    }
    if (still.length === 0) break;
    // continue with updated cats
    i += 1;
    (cats as any).length = 0;
    cats.push(...still);
  }

  return out;
}

// Site-by-site rotation (Step 3): try each site for each query until we have enough pool.
async function gatherCandidatesForQuery(
  prompt: string,
  gender: Gender,
  sites: string[],
  rawQuery: string,
  maxPagesPerSite: number,
  debugFetch: any
): Promise<Candidate[]> {
  const out: Candidate[] = [];

  const normalizedSites = normalizeSites(sites);

  // If sites empty, we’ll still try (no site: filter) — useful for debugging or “entire web” engines.
  const siteList = normalizedSites.length ? normalizedSites : [""];

  for (const site of siteList) {
    if (out.length >= 25) break; // enough pool for this query

    const q = site ? `${addNegatives(rawQuery)} site:${site}` : addNegatives(rawQuery);
    const cacheKey = `cse:${q}`;

    // Basic debug metrics
    debugFetch[q] = debugFetch[q] || { pagesTried: 0, itemsSeen: 0 };

    const collected: Candidate[] = [];

    for (let page = 0; page < maxPagesPerSite; page++) {
      const start = 1 + page * 10;
      debugFetch[q].pagesTried += 1;

      const resp = await fetchCse(q, start);
      const items = resp.items || [];
      debugFetch[q].itemsSeen += items.length;

      for (const it of items) {
        const pageUrl = (it.link || "").trim();
        if (!pageUrl) continue;

        const domain = domainOf(pageUrl);
        if (!domain) continue;
        if (BLOCKED_DOMAINS.has(domain)) continue;

        const { imageUrl, thumbUrl, pageUrl: normalizedPageUrl } = pickImageLinks(it);
        const finalPageUrl = (normalizedPageUrl || pageUrl).trim();
        if (!finalPageUrl || !imageUrl) continue;

        // product-only rules on PRODUCT PAGE url (not the image CDN)
        if (!isLikelyProductUrl(domainOf(finalPageUrl), finalPageUrl, gender)) continue;

        const cand: Candidate = {
          link: finalPageUrl,
          img: imageUrl,
          thumb: thumbUrl || "",
          title: it.title || "",
          displayLink: it.displayLink || domain,
          query: q,
          provider: domain,
          category: inferCategoryFromQuery(rawQuery),
        };

        cand.score = scoreCandidate(cand, prompt);
        collected.push(cand);
      }
    }

    // Dedup inside site attempt, then add to out
    const deduped = uniqueBy(collected, (c) => c.link);
    out.push(...deduped);
  }

  return uniqueBy(out, (c) => c.link);
}

// --- MAIN HANDLER ---
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const body = req.method === "POST" ? req.body : req.query;

    const prompt = String(body?.prompt || "").trim();
    const gender = (String(body?.gender || "men").trim().toLowerCase() as Gender) || "men";

    const desired = Number(body?.desired || DEFAULT_DESIRED);
    const perDomainCap = Number(body?.perDomainCap || DEFAULT_PER_DOMAIN_CAP);

    // If you pass sites from the client, it will use them.
    // If not, it will fall back to RETAILER_SITES env (comma-separated).
    const sitesFromReq: string[] = Array.isArray(body?.sites) ? body.sites : [];
    const sitesFromEnv = env("RETAILER_SITES")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const sites = normalizeSites(sitesFromReq.length ? sitesFromReq : sitesFromEnv);

    // Build “variants” (Step 2): broader net but still “product” focused via negatives + product url gate
    const base = prompt || "black minimal date night boots";
    const queriesBuilt = [
      `men ${base} leather boots`,
      `men ${base} ankle boots`,
      `men ${base} dress boots`,
      `men ${base} tailored trousers`,
      `men ${base} straight leg trousers`,
      `men ${base} button-up shirt`,
      `men ${base} minimal shirt`,
      `men ${base} lightweight jacket`,
      `men ${base} bomber jacket`,
      `men ${base} leather belt`,
      `men ${base} minimalist watch`,
      `men ${base} sunglasses`,
    ];

    const debugFetch: any = {};
    const allCandidates: Candidate[] = [];

    // Site rotation per query (Step 3)
    for (const rawQuery of queriesBuilt) {
      const got = await gatherCandidatesForQuery(base, gender, sites, rawQuery, 1, debugFetch);
      allCandidates.push(...got);
    }

    // Global dedupe
    let deduped = uniqueBy(allCandidates, (c) => c.link);

    // Sort by score desc
    deduped.sort((a, b) => (b.score || 0) - (a.score || 0));

    // Cap per-domain
    const capped = capPerDomain(deduped, perDomainCap);

    // Category diversity (best effort)
    const diversified = diversifyByCategory(capped.out, desired);

    const images = diversified.slice(0, desired).map((c) => ({
      imageUrl: c.img,
      thumbnailUrl: c.thumb,
      sourceUrl: c.link,
      title: c.title,
      provider: c.provider || domainOf(c.link),
      category: c.category,
      score: c.score,
      query: c.query,
    }));

    res.status(200).json({
      images,
      source: "google-cse",
      debug: {
        version: "moodboard-v24-FULL-FILE-2026-02-10",
        prompt: base,
        gender,
        desired,
        perDomainCap,
        sitesUsed: sites,
        queriesBuilt,
        totalCandidates: allCandidates.length,
        totalDeduped: deduped.length,
        domainCounts: capped.counts,
        fetch: debugFetch,
      },
    });
  } catch (e: any) {
    const msg = String(e?.message || e);
    const status = Number(e?.status || 500);
    res.status(status).json({
      images: [],
      source: "google-cse",
      debug: {
        version: "moodboard-v24-FULL-FILE-2026-02-10",
        usedWebFallback: false,
        lastError: { message: msg },
      },
    });
  }
}
