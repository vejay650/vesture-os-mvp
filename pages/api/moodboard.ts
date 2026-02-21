// pages/api/moodboard.ts
import type { NextApiRequest, NextApiResponse } from "next";

/**
 * moodboard-v26: WORKING image search + correct contextLink handling
 * Fixes:
 * - Uses searchType=image so we actually get images.
 * - Uses item.image.contextLink as the PRODUCT PAGE.
 * - Uses item.link as the IMAGE URL.
 * - Strips vibe words from product queries (no more 0 results due to "date night/minimal").
 * - Site rotation + per-domain cap + light category diversity.
 * - Debug now includes itemsSeen + keptCount per query.
 */

type CseImage = {
  contextLink?: string;     // product/page url
  thumbnailLink?: string;   // thumb
};

type CseItem = {
  title?: string;
  link?: string;            // image url (because searchType=image)
  displayLink?: string;     // host of the page
  image?: CseImage;
};

type CseResponse = {
  items?: CseItem[];
};

type Candidate = {
  pageUrl: string;   // product page
  imageUrl: string;  // image
  thumbUrl?: string;
  title?: string;
  provider: string;  // domain of product page
  category: string;
  score: number;
  query: string;
};

type OutImage = {
  imageUrl: string;
  thumbnailUrl?: string;
  sourceUrl: string;
  title?: string;
  provider?: string;
  category?: string;
  score?: number;
  query?: string;
};

const VERSION = "moodboard-v26-IMAGE-CSE-CONTEXTLINK-2026-02-16";

function getEnvAny(names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v && String(v).trim()) return String(v).trim();
  }
  return undefined;
}

const GOOGLE_KEY =
  getEnvAny(["GOOGLE_CSE_API_KEY", "GOOGLE_CSE_KEY", "GOOGLE_API_KEY", "GOOGLE_KEY"]) || "";

const GOOGLE_CX =
  getEnvAny(["GOOGLE_CSE_CX", "GOOGLE_CSE_ID", "GOOGLE_CX", "GOOGLE_CX_ID", "CX"]) || "";

// defaults
const DEFAULT_DESIRED = 18;
const DEFAULT_PER_DOMAIN_CAP = 3;
const MAX_PAGES_PER_QUERY = 1; // keep quota sane (10 results per query * many queries)
const NUM_PER_PAGE = 10;

// hard block farfetch unless you explicitly want it later
const BLOCKED_DOMAINS = new Set<string>(["farfetch.com", "www.farfetch.com"]);

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function safeLower(s: string) {
  return (s || "").toLowerCase();
}

// Editorals/content blockers
const EDITORIAL_HINTS = [
  "/editorial", "/guide", "/market", "/magazine", "/journal", "/blog",
  "/stories", "/lookbook", "/press", "/campaign", "/feature", "/features",
];

function isEditorialUrl(url: string) {
  const u = safeLower(url);
  return EDITORIAL_HINTS.some((h) => u.includes(h)) || u.includes("editorial");
}

// Strip "vibe" words that kill CSE results
function productSearchTerms(prompt: string) {
  const p = safeLower(prompt);
  const colorMatch = p.match(/\b(black|brown|tan|beige|grey|gray|navy|white)\b/);
  const color = colorMatch?.[0] || "black";

  const banned = new Set([
    "minimal", "date", "night", "datenight", "date-night",
    "outfit", "vibe", "clean", "sleek", "classy", "simple",
    "look", "style", "styling", "for", "with", "and", "the", "a", "an",
  ]);

  const tokens = p
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !banned.has(t));

  const hasBoots = tokens.includes("boot") || tokens.includes("boots");
  const hasShoes = tokens.includes("shoe") || tokens.includes("shoes");
  const item = hasBoots ? "boots" : hasShoes ? "shoes" : "boots";

  return { color, item };
}

// Lighter negatives (too many kills results)
const NEGATIVE_WORDS = [
  "perfume", "fragrance", "parfum", "cologne", "beauty", "skincare", "makeup",
  "serum", "foundation", "lipstick", "candle", "diffuser",
  "sandal", "slide", "thong", "flip-flop", "flipflop",
  "over-the-knee", "otk",
];

function withNegatives(q: string) {
  const neg = NEGATIVE_WORDS.map((w) => `-${w}`).join(" ");
  return `${q} ${neg}`.trim();
}

function guessCategory(q: string): string {
  const s = safeLower(q);
  if (s.includes("trouser") || s.includes("pants") || s.includes("jeans")) return "bottoms";
  if (s.includes("shirt") || s.includes("polo") || s.includes("tee")) return "tops";
  if (s.includes("jacket") || s.includes("bomber") || s.includes("coat") || s.includes("blazer")) return "outerwear";
  if (s.includes("belt") || s.includes("watch") || s.includes("sunglass") || s.includes("bag")) return "accessories";
  if (s.includes("boot") || s.includes("shoe") || s.includes("loafer")) return "shoes";
  return "other";
}

// Domain product URL rules (keep permissive but block editorials)
function isLikelyProductUrl(domain: string, url: string, gender: string) {
  const u = safeLower(url);
  if (!domain) return false;
  if (BLOCKED_DOMAINS.has(domain)) return false;
  if (isEditorialUrl(u)) return false;

  // Men filter (best effort)
  if (gender === "men" && (u.includes("/women") || u.includes("/womens"))) return false;

  // Site-specific patterns
  if (domain.includes("ssense.com")) return u.includes("/product/");
  if (domain.includes("neimanmarcus.com")) return u.includes("product.jsp");
  if (domain.includes("yoox.com")) return u.includes("/item") || u.includes("cod10=") || u.includes("dept=");
  if (domain.includes("mrporter.com")) return u.includes("/mens/product/");
  if (domain.includes("endclothing.com")) return u.includes("/products/") || u.includes("/product/");
  if (domain.includes("nordstrom.com")) return u.includes("/s/") && /\d{5,}/.test(u);
  if (domain.includes("saksfifthavenue.com")) return u.includes("/product/") || u.includes("/pdp/");
  if (domain.includes("ourlegacy.com")) return u.includes("/product/") || u.includes("/products/");

  // fallback: allow if contains product-ish hint
  return u.includes("/product") || u.includes("itemid=") || /prod\d+/.test(u) || /\d{6,}/.test(u);
}

function scoreCandidate(prompt: string, c: Candidate): number {
  const p = safeLower(prompt);
  const title = safeLower(c.title || "");
  const url = safeLower(c.pageUrl);

  let s = 0;

  // prompt token overlap (light)
  const toks = p.split(/\s+/).filter(Boolean).slice(0, 6);
  for (const t of toks) {
    if (t.length < 3) continue;
    if (title.includes(t)) s += 2;
    if (url.includes(t)) s += 1;
  }

  // product-ish URL bonus
  if (/\/product|product\.jsp|itemid=|cod10=|sku=|pid=/i.test(c.pageUrl)) s += 8;

  // category bonus
  if (c.category !== "other") s += 2;

  // penalize negative words if they sneak in
  for (const w of NEGATIVE_WORDS) if (title.includes(w)) s -= 15;

  return s;
}

async function fetchCseImage(q: string, start: number): Promise<CseResponse> {
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", GOOGLE_KEY);
  url.searchParams.set("cx", GOOGLE_CX);
  url.searchParams.set("q", q);
  url.searchParams.set("searchType", "image");
  url.searchParams.set("num", String(NUM_PER_PAGE));
  url.searchParams.set("start", String(start));
  url.searchParams.set("safe", "off");

  const r = await fetch(url.toString());
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`CSE ${r.status}: ${txt.slice(0, 220)}`);
  }
  return (await r.json()) as CseResponse;
}

function dedupe<T>(arr: T[], keyFn: (t: T) => string) {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of arr) {
    const k = keyFn(x);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

// Main
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const prompt = String((req.query.prompt || (req.body as any)?.prompt || "") as string).trim();
    const genderRaw = String((req.query.gender || (req.body as any)?.gender || "men") as string).toLowerCase();
    const gender = (["men", "women", "unisex"].includes(genderRaw) ? genderRaw : "men") as
      | "men"
      | "women"
      | "unisex";

    const desired = Math.min(Math.max(Number(req.query.desired || (req.body as any)?.desired || DEFAULT_DESIRED), 6), 30);
    const perDomainCap = Math.min(Math.max(Number(req.query.perDomainCap || (req.body as any)?.perDomainCap || DEFAULT_PER_DOMAIN_CAP), 1), 10);

    if (!GOOGLE_KEY || !GOOGLE_CX) {
      return res.status(200).json({
        images: [],
        source: "google-cse",
        debug: {
          version: VERSION,
          lastError: { message: "Missing GOOGLE_CSE_KEY/GOOGLE_CSE_API_KEY or GOOGLE_CX/GOOGLE_CSE_CX" },
        },
      });
    }

    if (!prompt) {
      return res.status(200).json({
        images: [],
        source: "google-cse",
        debug: { version: VERSION, note: "Missing prompt" },
      });
    }

    // sites
    const sitesParam = (req.query.sites || (req.body as any)?.sites || []) as string[] | string;
    const sitesFromReq = Array.isArray(sitesParam)
      ? sitesParam
      : typeof sitesParam === "string" && sitesParam
      ? sitesParam.split(",")
      : [];

    const sites = (sitesFromReq.length ? sitesFromReq : [
      "ssense.com",
      "yoox.com",
      "neimanmarcus.com",
      "mrporter.com",
      "endclothing.com",
      "nordstrom.com",
      "saksfifthavenue.com",
      "ourlegacy.com",
    ])
      .map((s) => s.trim().replace(/^https?:\/\//, "").replace(/^www\./, ""))
      .filter(Boolean);

    // Build product queries WITHOUT vibe words
    const { color, who, queriesBuilt } = (() => {
      const { color } = productSearchTerms(prompt);
      const who = gender === "women" ? "women" : gender === "unisex" ? "unisex" : "men";
      const qb = [
        `${who} ${color} leather boots`,
        `${who} ${color} ankle boots`,
        `${who} ${color} dress boots`,
        `${who} ${color} tailored trousers`,
        `${who} ${color} straight leg trousers`,
        `${who} ${color} button-up shirt`,
        `${who} ${color} shirt`,
        `${who} ${color} lightweight jacket`,
        `${who} ${color} bomber jacket`,
        `${who} ${color} leather belt`,
        `${who} minimalist watch ${color}`,
        `${who} ${color} sunglasses`,
      ];
      return { color, who, queriesBuilt: qb };
    })();

    const debugFetch: Record<string, { pagesTried: number; itemsSeen: number; kept: number }> = {};
    const candidates: Candidate[] = [];

    // rotation: query -> site -> page(s)
    for (const baseQuery of queriesBuilt) {
      const category = guessCategory(baseQuery);

      for (const site of sites) {
        // keep the site constraint *inside* the query
        const q = `${withNegatives(baseQuery)} site:${site}`.trim();
        debugFetch[q] = debugFetch[q] || { pagesTried: 0, itemsSeen: 0, kept: 0 };

        for (let page = 0; page < MAX_PAGES_PER_QUERY; page++) {
          const start = 1 + page * 10;
          debugFetch[q].pagesTried += 1;

          let resp: CseResponse;
          try {
            resp = await fetchCseImage(q, start);
          } catch {
            continue;
          }

          const items = resp.items || [];
          debugFetch[q].itemsSeen += items.length;

          for (const it of items) {
            // image url
            const imageUrl = (it.link || "").trim();
            // product page
            const pageUrl = (it.image?.contextLink || "").trim();
            if (!imageUrl || !pageUrl) continue;

            const domain = domainOf(pageUrl);
            if (!domain) continue;
            if (!domain.endsWith(site)) continue; // enforce the site you asked for
            if (BLOCKED_DOMAINS.has(domain)) continue;
            if (!isLikelyProductUrl(domain, pageUrl, gender)) continue;

            const thumbUrl = (it.image?.thumbnailLink || "").trim();

            const c: Candidate = {
              pageUrl,
              imageUrl,
              thumbUrl: thumbUrl || undefined,
              title: it.title,
              provider: domain,
              category,
              score: 0,
              query: baseQuery,
            };

            c.score = scoreCandidate(prompt, c);
            candidates.push(c);
            debugFetch[q].kept += 1;
          }
        }
      }
    }

    // dedupe
    const deduped = dedupe(candidates, (c) => `${c.pageUrl}::${c.imageUrl}`);

    // sort
    deduped.sort((a, b) => b.score - a.score);

    // enforce per-domain cap + light category balancing
    const domainCounts: Record<string, number> = {};
    const categoryCounts: Record<string, number> = {};
    const final: Candidate[] = [];

    for (const c of deduped) {
      if (final.length >= desired) break;

      const d = c.provider;
      const dc = domainCounts[d] || 0;
      if (dc >= perDomainCap) continue;

      const cc = categoryCounts[c.category] || 0;
      const catCap = Math.max(2, Math.ceil(desired / 4)); // keep it flexible
      if (cc >= catCap) continue;

      domainCounts[d] = dc + 1;
      categoryCounts[c.category] = cc + 1;
      final.push(c);
    }

    const images: OutImage[] = final.map((c) => ({
      imageUrl: c.imageUrl,
      thumbnailUrl: c.thumbUrl,
      sourceUrl: c.pageUrl,
      title: c.title,
      provider: c.provider,
      category: c.category,
      score: c.score,
      query: c.query,
    }));

    return res.status(200).json({
      images,
      source: "google-cse",
      debug: {
        version: VERSION,
        prompt,
        gender,
        desired,
        perDomainCap,
        sitesUsed: sites,
        colorUsed: color,
        queriesBuilt,
        totalCandidates: candidates.length,
        totalDeduped: deduped.length,
        domainCounts,
        categoryCounts,
        fetch: debugFetch,
      },
    });
  } catch (e: any) {
    return res.status(200).json({
      images: [],
      source: "google-cse",
      debug: {
        version: VERSION,
        lastError: { message: e?.message || String(e) },
      },
    });
  }
}
