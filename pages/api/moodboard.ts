import type { NextApiRequest, NextApiResponse } from "next";

type Gender = "men" | "women" | "unisex";
type Category = "shoes" | "bottoms" | "tops" | "outerwear" | "accessories";

type ImageResult = {
  imageUrl: string;
  thumbnailUrl?: string;
  sourceUrl: string;
  title?: string;
  provider?: string;
  category?: Category;
  score?: number;
  query?: string;
};

type Candidate = {
  link: string;
  img: string;
  thumb?: string;
  title?: string;
  displayLink?: string;
  query?: string;
};

type CseImage = {
  contextLink?: string;
  thumbnailLink?: string;
};

type CseItem = {
  link?: string; // image URL (because searchType=image)
  title?: string;
  displayLink?: string;
  image?: CseImage; // contains contextLink + thumbnailLink
};


const VERSION = "moodboard-v23-SITE-ROTATION-PRODUCT-ONLY-2026-02-04";

// ---------- config ----------
const DEFAULT_DESIRED = 18;
const PER_DOMAIN_CAP = 3;
const PER_CATEGORY_MIN = 1; // try to get at least 1 from each category if possible

// Sites that actually return product pages reliably via CSE.
// (You can add/remove later; this set is a strong “works-now” baseline.)
const DEFAULT_SITES: string[] = [
  "ssense.com",
  "mrporter.com",
  "endclothing.com",
  "nordstrom.com",
  "saksfifthavenue.com",
  "neimanmarcus.com",
  "yoox.com",
  "ourlegacy.com",
];

// Domains we do NOT want (you said Farfetch domination was trash)
const BLOCKED_DOMAINS = new Set<string>([
  "farfetch.com",
  "www.farfetch.com",
]);

// Product URL allow rules per domain (keeps out editorials / category pages / blog pages)
function isLikelyProductUrl(domain: string, url: string, gender: Gender) {
  const u = url.toLowerCase();

  // general “bad” paths
  const bad =
    u.includes("/editorial/") ||
    u.includes("/magazine/") ||
    u.includes("/blog") ||
    u.includes("/stories") ||
    u.includes("/guide") ||
    u.includes("/market") ||
    u.includes("/journal") ||
    u.includes("/press") ||
    u.includes("/campaign") ||
    u.includes("/lookbook");

  if (bad) return false;

  if (domain.includes("ssense.com")) {
    // SSENSE product pages look like: /en-us/men/product/brand/item/########
    if (!u.includes("/men/product/") && gender === "men") return false;
    if (!u.includes("/women/product/") && gender === "women") return false;
    if (u.includes("/editorial/")) return false;
    return true;
  }

  if (domain.includes("mrporter.com")) {
    // MR PORTER product pages usually include /en-us/mens/product/ OR /en-us/mens/product/...
    return u.includes("/mens/product/");
  }

  if (domain.includes("endclothing.com")) {
    // END product pages often include /us/brand/product-name/########
    // Keep it loose but exclude obvious non-product
    return !u.includes("/features/") && !u.includes("/journal/");
  }

  if (domain.includes("nordstrom.com")) {
    // Nordstrom product pages usually have /s/slug/########
    return u.includes("/s/") && /\d{6,}/.test(u);
  }

  if (domain.includes("saksfifthavenue.com")) {
    // Saks product pages often include /product/...
    return u.includes("/product/");
  }

  if (domain.includes("neimanmarcus.com")) {
    // Neiman product: /p/slug-prod########## OR product.jsp?itemId=
    return u.includes("/p/") || u.includes("product.jsp?itemid=");
  }

  if (domain.includes("yoox.com")) {
    // Yoox product pages vary; keep loose but avoid obvious category pages
    return !u.includes("/shoponline/") ? true : true;
  }

  if (domain.includes("ourlegacy.com")) {
    // Our Legacy products generally under /product/...
    return u.includes("/product/");
  }

  // default: allow but keep other filters in place
  return true;
}

// These negatives stop perfume/beauty/etc poisoning results (esp department stores)
const NEGATIVE_TERMS = [
  "perfume",
  "fragrance",
  "parfum",
  "cologne",
  "beauty",
  "skincare",
  "makeup",
  "lipstick",
  "foundation",
  "serum",
  "cream",
  "candle",
  "diffuser",
  "sandal",
  "slide",
  "thong",
  "flip-flop",
  "over-the-knee",
  "otk",
];

// ---------- tiny cache (serverless-safe best effort) ----------
const CACHE_TTL_MS = 1000 * 60 * 10; // 10 min

type CacheEntry = { at: number; data: any };
const g: any = globalThis as any;
if (!g.__moodboardCache) g.__moodboardCache = new Map<string, CacheEntry>();
const cache: Map<string, CacheEntry> = g.__moodboardCache;

function cacheGet(key: string) {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return e.data;
}
function cacheSet(key: string, data: any) {
  cache.set(key, { at: Date.now(), data });
}

// ---------- helpers ----------
function pickImageLinks(it: any): { imageUrl?: string; thumbUrl?: string; pageUrl?: string } {
  const pageUrl = it?.link || "";

  const pm = it?.pagemap;
  const cseImg = pm?.cse_image?.[0]?.src;
  const cseThumb = pm?.cse_thumbnail?.[0]?.src;

  // fallback: some results only have "image" object
  const fallbackImg = it?.image?.thumbnailLink || it?.image?.contextLink;
  const fallbackThumb = it?.image?.thumbnailLink;

  const imageUrl = cseImg || fallbackImg || "";
  const thumbUrl = cseThumb || fallbackThumb || "";

  return { imageUrl, thumbUrl, pageUrl };
}
 {
  const pm = it?.pagemap;
  const cseImg = pm?.cse_image?.[0]?.src;
  const cseThumb = pm?.cse_thumbnail?.[0]?.src;

  // sometimes OG image is better
  const ogImg = pm?.metatags?.[0]?.["og:image"];

  const img = ogImg || cseImg;
  const thumb = cseThumb || ogImg || cseImg;

  return { img, thumb };
}

function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normalizePrompt(p: any) {
  return String(p || "").trim();
}

function detectCategory(q: string): Category | undefined {
  const s = q.toLowerCase();
  if (/(boot|shoe|loafer|chelsea|ankle|derby)/.test(s)) return "shoes";
  if (/(trouser|pants|jeans|chino|slack)/.test(s)) return "bottoms";
  if (/(shirt|tee|t-shirt|polo|knit|sweater)/.test(s)) return "tops";
  if (/(jacket|coat|bomber|blazer|parka|outerwear)/.test(s)) return "outerwear";
  if (/(belt|watch|sunglass|bag|wallet|scarf|accessor)/.test(s)) return "accessories";
  return undefined;
}

function scoreCandidate(prompt: string, query: string, c: Candidate): number {
  const p = prompt.toLowerCase();
  const t = (c.title || "").toLowerCase();
  const l = (c.link || "").toLowerCase();

  let s = 0;

  // reward matching main prompt terms
  const tokens = p.split(/\s+/).filter(Boolean).slice(0, 6);
  for (const tok of tokens) {
    if (tok.length < 3) continue;
    if (t.includes(tok)) s += 3;
    if (l.includes(tok)) s += 2;
  }

  // reward product-ish signals
  if (/prod\d+/.test(l) || /itemid=/.test(l) || /\/product\//.test(l) || /\/p\//.test(l)) s += 6;

  // penalize obvious non-product
  if (l.includes("/editorial/") || l.includes("/blog") || l.includes("/magazine")) s -= 20;

  // penalize perfume etc
  for (const bad of NEGATIVE_TERMS) {
    if (t.includes(bad) || l.includes(bad)) s -= 12;
  }

  // small reward: query category mention shows intent
  if (query.toLowerCase().includes("boots") || query.toLowerCase().includes("trousers")) s += 2;

  return s;
}

function buildQueries(prompt: string, gender: Gender) {
  // prompt-driven: we do NOT hardcode “chelsea boots” anymore.
  // We always create a balanced “outfit board” around the prompt.
  const base = prompt;

  const q = [
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

  // if women selected, swap the “men …” prefix. keep the rest identical.
  if (gender === "women") return q.map((x) => x.replace(/^men\s+/, "women "));
  if (gender === "unisex") return q.map((x) => x.replace(/^men\s+/, ""));
  return q;
}

function addNegatives(query: string) {
  // DO NOT include "site:" here — we do site rotation separately
  const neg = NEGATIVE_TERMS.map((t) => `-${t}`).join(" ");
  return `${query} product ${neg}`;
}

async function fetchCse(query: string, start: number) {
  const apiKey =
    process.env.GOOGLE_CSE_API_KEY ||
    process.env.GOOGLE_CSE_KEY ||
    process.env.GOOGLE_API_KEY;

  const cx =
    process.env.GOOGLE_CSE_CX ||
    process.env.GOOGLE_CX ||
    process.env.GOOGLE_CX_ID;

  if (!apiKey || !cx) {
    throw new Error("Missing GOOGLE_CSE_API_KEY/GOOGLE_CSE_KEY or GOOGLE_CSE_CX/GOOGLE_CX");
  }

  const url =
    "https://www.googleapis.com/customsearch/v1" +
    `?key=${encodeURIComponent(apiKey)}` +
    `&cx=${encodeURIComponent(cx)}` +
    `&q=${encodeURIComponent(query)}` +
    `&searchType=image` +
    `&num=10` +
    `&start=${start}`;

  const r = await fetch(url);
  const text = await r.text();
  if (!r.ok) {
    const err = new Error(`CSE HTTP ${r.status}: ${text.slice(0, 250)}`);
    (err as any).status = r.status;
    throw err;
  }
  return JSON.parse(text) as CseResp;
}

// Site-by-site rotation: this is the key fix.
async function gatherCandidatesForQuery(
  prompt: string,
  gender: Gender,
  sites: string[],
  rawQuery: string,
  maxPagesPerSite: number,
  debugFetch: any
): Promise<Candidate[]> {
  const out: Candidate[] = [];

  for (const site of sites) {
    if (out.length >= 25) break; // enough pool for this query

    const q = `${addNegatives(rawQuery)} site:${site}`;
    const cacheKey = `cse:${q}`;

    const cached = cacheGet(cacheKey);
    if (cached) {
      out.push(...cached);
      continue;
    }

    const collected: Candidate[] = [];

    for (let page = 0; page < maxPagesPerSite; page++) {
      const start = 1 + page * 10;
      try {
        const resp = await fetchCse(q, start);
        const items = resp.items || [];
        for (const it of items) {
  const pageUrl = (it.link || "").trim();
  if (!pageUrl) continue;

  const domain = domainOf(pageUrl);
  if (!domain) continue;
  if (BLOCKED_DOMAINS.has(domain)) continue;

  const { imageUrl, thumbUrl, pageUrl: normalizedPageUrl } = pickImageLinks(it);

  const finalPageUrl = (normalizedPageUrl || pageUrl).trim();
  if (!finalPageUrl || !imageUrl) continue;

  // run product-only rules on PRODUCT PAGE URL (not the image CDN)
  if (!isLikelyProductUrl(domainOf(finalPageUrl), finalPageUrl, gender)) continue;

  collected.push({
    link: finalPageUrl,
    img: imageUrl,
    thumb: thumbUrl || "",
    title: it.title || "",
    displayLink: it.displayLink || domain,
    query: q,
  });
}

        }
      } catch (e: any) {
        // don’t nuke everything — just record and continue to next site
        debugFetch[q] = debugFetch[q] || { pagesTried: 0, itemsSeen: 0, error: "" };
        debugFetch[q].error = String(e?.message || e);
        break;
      }
    }

    debugFetch[q] = { pagesTried: maxPagesPerSite, itemsSeen: collected.length };

    cacheSet(cacheKey, collected);
    out.push(...collected);
  }

  return out;
}

function finalize(
  prompt: string,
  gender: Gender,
  desired: number,
  candidates: Candidate[],
  queriesBuilt: string[],
  queriesSent: string[],
  ms: number,
  debugFetch: any
) {
  const seen = new Set<string>();
  const domainCount: Record<string, number> = {};
  const catCount: Record<string, number> = {};
  const results: ImageResult[] = [];

  // score + sort
  const scored = candidates
    .map((c) => {
      const domain = domainOf(c.link);
      const q = c.query || "";
      return {
        c,
        domain,
        cat: detectCategory(q) || detectCategory(c.title || "") || "accessories",
        s: scoreCandidate(prompt, q, c),
      };
    })
    .sort((a, b) => b.s - a.s);

  // first pass: try to ensure category diversity
  const neededCats = new Set<Category>(["shoes", "bottoms", "tops", "outerwear", "accessories"]);
  const take = (item: typeof scored[number]) => {
    const c = item.c;
    const key = `${c.link}::${c.img}`;
    if (seen.has(key)) return false;

    const d = item.domain || "unknown";
    if ((domainCount[d] || 0) >= PER_DOMAIN_CAP) return false;

    const cat = item.cat as Category;
    seen.add(key);

    domainCount[d] = (domainCount[d] || 0) + 1;
    catCount[cat] = (catCount[cat] || 0) + 1;

    results.push({
      imageUrl: c.img,
      thumbnailUrl: c.thumb,
      sourceUrl: c.link,
      title: c.title,
      provider: d,
      category: cat,
      score: item.s,
      query: c.query,
    });

    return true;
  };

  // satisfy one per category if possible
  for (const cat of Array.from(neededCats)) {
    if (results.length >= desired) break;
    if ((catCount[cat] || 0) >= PER_CATEGORY_MIN) continue;

    const pick = scored.find((x) => x.cat === cat && (domainCount[x.domain] || 0) < PER_DOMAIN_CAP);
    if (pick) take(pick);
  }

  // fill remainder with best overall
  for (const item of scored) {
    if (results.length >= desired) break;
    take(item);
  }

  return {
    images: results,
    source: "google-cse",
    debug: {
      version: VERSION,
      prompt,
      gender,
      desired,
      perDomainCap: PER_DOMAIN_CAP,
      sitesUsed: DEFAULT_SITES,
      queriesBuilt,
      queriesSent,
      totalCandidates: candidates.length,
      totalDeduped: results.length,
      domainCounts: domainCount,
      categoryCounts: catCount,
      farfetchBlocked: true,
      fetch: debugFetch,
      ms,
    },
  };
}

// ---------- handler ----------
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const t0 = Date.now();

  try {
    const prompt = normalizePrompt(req.query.prompt);
    const gender = (normalizePrompt(req.query.gender) as Gender) || "men";
    const desired = Math.max(6, Math.min(30, Number(req.query.desired || DEFAULT_DESIRED)));

    if (!prompt) {
      return res.status(200).json({
        images: [],
        source: "google-cse",
        debug: {
          version: VERSION,
          error: "Missing prompt",
        },
      });
    }

    const sites = DEFAULT_SITES;

    const queriesBuilt = buildQueries(prompt, gender);
    const queriesSent: string[] = [];
    const debugFetch: any = {};

    // gather candidates with strict site rotation
    let candidates: Candidate[] = [];

    // keep it fast: fewer pages per site, more sites = better diversity
    const MAX_PAGES_PER_SITE = 1;

    for (const raw of queriesBuilt) {
      if (candidates.length >= 220) break; // cap work
      // record “sent” without site: (cleaner debug)
      queriesSent.push(addNegatives(raw));

      const got = await gatherCandidatesForQuery(
        prompt,
        gender,
        sites,
        raw,
        MAX_PAGES_PER_SITE,
        debugFetch
      );
      candidates = candidates.concat(got);
    }

    const out = finalize(
      prompt,
      gender,
      desired,
      candidates,
      queriesBuilt,
      queriesSent,
      Date.now() - t0,
      debugFetch
    );

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json(out);
  } catch (e: any) {
    return res.status(200).json({
      images: [],
      source: "google-cse",
      debug: {
        version: VERSION,
        error: String(e?.message || e),
      },
    });
  }
}
