// pages/api/moodboard.ts
import type { NextApiRequest, NextApiResponse } from "next";

type Gender = "men" | "women" | "unisex";

type ImageResult = {
  imageUrl: string;
  thumbnailUrl?: string;
  sourceUrl: string;
  title: string;
  provider: string;
  category: "shoes" | "bottoms" | "tops" | "outerwear" | "accessories" | "other";
  score: number;
  query: string;
};

type Candidate = {
  title: string;
  link: string;
  img: string;
  thumb?: string;
  host: string;
  query: string;
  category: ImageResult["category"];
};

const VERSION = "moodboard-v22-PASTEALL-CATEGORY-DIVERSITY-2026-02-04";

// ---------- Config ----------
const DEFAULT_DESIRED = 18;
const PER_DOMAIN_CAP = 3;
const MAX_PAGES = 2; // pages per query (each page = 10 results from CSE)
const NUM_PER_PAGE = 10;

const FARFETCH_BLOCKED = true; // you said you DON'T want farfetch dominating

// These words are poison for your use-case (Neiman returns tons of this)
const BLOCKED_WORDS = [
  "perfume",
  "parfum",
  "fragrance",
  "cologne",
  "beauty",
  "skincare",
  "makeup",
  "lipstick",
  "foundation",
  "serum",
  "cream",
  "shampoo",
  "conditioner",
  "sandal",
  "slide",
  "thong",
  "flip flop",
  "women",
  "womens",
  "female",
  "over-the-knee",
  "over the knee",
  "otk",
];

// SSENSE returns editorials constantly — block them
const BLOCKED_PATH_SNIPPETS = [
  "/editorial",
  "/market/",
  "/fashion/",
  "/guides/",
  "/guide/",
  "/blog",
  "/stories",
  "/lookbook",
  "/press",
  "/campaign",
];

// Negative terms appended to queries (helps before we even filter results)
const NEGATIVE_TERMS =
  `-perfume -fragrance -parfum -cologne -beauty -skincare -makeup ` +
  `-sandal -slide -thong -flip -women -womens -female -over-the-knee -otk ` +
  `-editorial -guide -market -magazine -journal -blog -stories -lookbook -press -campaign ` +
  `-inurl:editorial -inurl:guide -inurl:market -inurl:magazine -inurl:blog -inurl:stories -inurl:lookbook -inurl:press -inurl:campaign`;

// ---------- Helpers ----------
function toStr(x: unknown, fallback = ""): string {
  return typeof x === "string" ? x : fallback;
}

function normalizeHost(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    // sometimes "link" might be malformed; attempt minimal
    return url.replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "");
  }
}

function looksLikeProduct(title: string, link: string): boolean {
  const t = `${title} ${link}`.toLowerCase();

  // kill obvious non-product pages
  for (const p of BLOCKED_PATH_SNIPPETS) {
    if (t.includes(p)) return false;
  }

  // Neiman category pages and misc: we want product pages more than category pages,
  // but keep some categories if they still have a good image.
  // (we’ll still filter the junk below)
  return true;
}

function isBlockedCandidate(title: string, link: string): boolean {
  const t = `${title} ${link}`.toLowerCase();
  return BLOCKED_WORDS.some((w) => t.includes(w));
}

function inferCategory(q: string): ImageResult["category"] {
  const s = q.toLowerCase();

  if (
    s.includes("boot") ||
    s.includes("shoe") ||
    s.includes("loafer") ||
    s.includes("derby") ||
    s.includes("oxford") ||
    s.includes("sneaker")
  )
    return "shoes";

  if (
    s.includes("trouser") ||
    s.includes("pants") ||
    s.includes("jeans") ||
    s.includes("chinos") ||
    s.includes("slacks")
  )
    return "bottoms";

  if (
    s.includes("shirt") ||
    s.includes("tee") ||
    s.includes("t-shirt") ||
    s.includes("polo") ||
    s.includes("knit") ||
    s.includes("sweater")
  )
    return "tops";

  if (
    s.includes("jacket") ||
    s.includes("coat") ||
    s.includes("bomber") ||
    s.includes("overcoat") ||
    s.includes("blazer")
  )
    return "outerwear";

  if (
    s.includes("belt") ||
    s.includes("watch") ||
    s.includes("sunglass") ||
    s.includes("bag") ||
    s.includes("wallet")
  )
    return "accessories";

  return "other";
}

function scoreCandidate(c: Candidate, prompt: string): number {
  const t = `${c.title} ${c.link}`.toLowerCase();
  const p = prompt.toLowerCase();

  let score = 0;

  // prompt word overlap (simple but effective)
  const words = p.split(/\s+/).filter(Boolean);
  for (const w of words) {
    if (w.length < 3) continue;
    if (t.includes(w)) score += 2;
  }

  // prefer product-ish URL patterns
  if (c.link.includes("/product") || c.link.includes("product.jsp") || c.link.includes("/p/"))
    score += 6;
  if (c.link.includes("itemId=") || c.link.includes("prod")) score += 4;

  // penalize editorials/hubs
  for (const b of BLOCKED_PATH_SNIPPETS) {
    if (t.includes(b)) score -= 20;
  }

  // category preference slightly
  if (c.category !== "other") score += 3;

  return score;
}

function dedupeAndCap(
  candidates: Candidate[],
  desired: number,
  perDomainCap: number
): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const domainCounts: Record<string, number> = {};

  // diversity goal: force at least one per main category if possible
  const wantedCategories: ImageResult["category"][] = [
    "shoes",
    "bottoms",
    "tops",
    "outerwear",
    "accessories",
  ];

  const take = (c: Candidate): boolean => {
    const key = `${c.link}::${c.img}`;
    if (seen.has(key)) return false;
    const d = c.host;
    const count = domainCounts[d] ?? 0;
    if (count >= perDomainCap) return false;

    seen.add(key);
    domainCounts[d] = count + 1;
    out.push(c);
    return true;
  };

  // pass 1: fill categories
  for (const cat of wantedCategories) {
    if (out.length >= desired) break;
    const pick = candidates.find((c) => c.category === cat && !seen.has(`${c.link}::${c.img}`));
    if (pick) take(pick);
  }

  // pass 2: fill remaining
  for (const c of candidates) {
    if (out.length >= desired) break;
    take(c);
  }

  return out;
}

// ---------- Google CSE ----------
async function fetchCse(
  apiKey: string,
  cx: string,
  q: string,
  startIndex: number
): Promise<any> {
  const url =
    `https://www.googleapis.com/customsearch/v1` +
    `?key=${encodeURIComponent(apiKey)}` +
    `&cx=${encodeURIComponent(cx)}` +
    `&q=${encodeURIComponent(q)}` +
    `&searchType=image` +
    `&num=${NUM_PER_PAGE}` +
    `&start=${startIndex}`;

  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    const err = new Error(`CSE ${res.status}: ${txt.slice(0, 200)}`);
    (err as any).status = res.status;
    throw err;
  }
  return res.json();
}

// ---------- Query builder (THIS IS THE BIG FIX) ----------
function buildCategoryQueries(prompt: string, gender: Gender) {
  // IMPORTANT:
  // We do NOT repeat the prompt in every query.
  // We derive category queries from prompt vibe + minimal constraints.

  const g = gender === "women" ? "women" : "men";

  // Lightweight prompt parsing for color/style
  const p = prompt.toLowerCase();
  const isBlack = p.includes("black");
  const isMinimal = p.includes("minimal");
  const isDateNight = p.includes("date night") || p.includes("dinner") || p.includes("evening");

  const color = isBlack ? "black" : "";
  const vibe = `${isMinimal ? "minimal" : ""} ${isDateNight ? "date night" : ""}`.trim();

  // Category-specific queries. Boots only in footwear set.
  const footwearQueries = [
    `${g} ${color} leather boots ${vibe}`.trim(),
    `${g} ${color} ankle boots ${isMinimal ? "minimal" : ""}`.trim(),
    `${g} ${color} dress boots ${isDateNight ? "date night" : ""}`.trim(),
  ].filter(Boolean);

  const pantsQueries = [
    `${g} ${color} tailored trousers ${isMinimal ? "minimal" : ""}`.trim(),
    `${g} ${color} straight leg trousers ${vibe}`.trim(),
    `${g} ${color} dress pants ${isDateNight ? "date night" : ""}`.trim(),
  ].filter(Boolean);

  const topQueries = [
    `${g} ${color ? color : ""} button-up shirt ${isMinimal ? "minimal" : ""}`.trim(),
    `${g} knit polo ${vibe}`.trim(),
    `${g} ${color ? color : ""} minimal shirt`.trim(),
  ].filter(Boolean);

  const outerwearQueries = [
    `${g} ${color} lightweight jacket ${isMinimal ? "minimal" : ""}`.trim(),
    `${g} ${color} bomber jacket ${vibe}`.trim(),
  ].filter(Boolean);

  const accessoryQueries = [
    `${g} ${color} leather belt ${isMinimal ? "minimal" : ""}`.trim(),
    `${g} minimalist watch ${color}`.trim(),
    `${g} ${color} sunglasses ${vibe}`.trim(),
  ].filter(Boolean);

  // Return a blended list (we'll still cap + diversify later)
  const all = [
    ...footwearQueries,
    ...pantsQueries,
    ...topQueries,
    ...outerwearQueries,
    ...accessoryQueries,
  ];

  return { all, footwearQueries, pantsQueries, topQueries, outerwearQueries, accessoryQueries };
}

function withNegatives(q: string) {
  return `${q} ${NEGATIVE_TERMS}`.trim();
}

function parseSites(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((x) => toStr(x).trim())
      .filter(Boolean)
      .map((s) => s.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, ""));
  }
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, ""));
  }
  return [];
}

function isFarfetch(host: string) {
  return host.includes("farfetch.");
}

// ---------- API Handler ----------
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const started = Date.now();

  // Accept both GET and POST
  const prompt =
    toStr(req.method === "POST" ? (req.body as any)?.prompt : (req.query.prompt as any), "").trim();

  const genderRaw =
    toStr(req.method === "POST" ? (req.body as any)?.gender : (req.query.gender as any), "men")
      .trim()
      .toLowerCase();

  const gender: Gender =
    genderRaw === "women" ? "women" : genderRaw === "unisex" ? "unisex" : "men";

  const desired =
    Number(req.method === "POST" ? (req.body as any)?.desired : (req.query.desired as any)) ||
    DEFAULT_DESIRED;

  // Sites can come from request, but keep it optional.
  // If empty, we search entire web (but your CSE must allow it).
  const sitesRaw = req.method === "POST" ? (req.body as any)?.sites : (req.query.sites as any);
  const sites = parseSites(sitesRaw);

  // ENV: support your naming
  const apiKey =
    process.env.GOOGLE_CSE_API_KEY ||
    process.env.GOOGLE_CSE_KEY ||
    process.env.GOOGLE_API_KEY ||
    "";

  const cx = process.env.GOOGLE_CSE_CX || process.env.GOOGLE_CX || "";

  if (!apiKey || !cx) {
    return res.status(200).json({
      images: [],
      source: "google-cse",
      debug: {
        version: VERSION,
        prompt,
        gender,
        desired,
        sites,
        usedWebFallback: true,
        farfetchBlocked: FARFETCH_BLOCKED,
        lastError: { message: "Missing GOOGLE_CSE_API_KEY/GOOGLE_CSE_KEY or GOOGLE_CSE_CX/GOOGLE_CX" },
      },
    });
  }

  if (!prompt) {
    // Don’t auto-fill the search bar / don’t hardcode a prompt
    return res.status(200).json({
      images: [],
      source: "google-cse",
      debug: {
        version: VERSION,
        prompt,
        gender,
        desired,
        sites,
        note: "No prompt provided.",
      },
    });
  }

  const built = buildCategoryQueries(prompt, gender);
  const rawQueries = built.all;

  // If sites are provided, we do site-by-site, because Google behaves better than (site:a OR site:b)
  // If sites are empty, we search the whole web.
  const queriesFinal: { q: string; category: ImageResult["category"]; site?: string }[] = [];

  const addQuery = (q: string, category: ImageResult["category"], site?: string) => {
    // add negatives and "product" hint
    // "product" helps a bit, but not required
    const base = `${q} product`.trim();
    const final = withNegatives(base);
    queriesFinal.push({ q: final + (site ? ` site:${site}` : ""), category, site });
  };

  // Build per-category set with category labels
  const categorySets: { qs: string[]; category: ImageResult["category"] }[] = [
    { qs: built.footwearQueries, category: "shoes" },
    { qs: built.pantsQueries, category: "bottoms" },
    { qs: built.topQueries, category: "tops" },
    { qs: built.outerwearQueries, category: "outerwear" },
    { qs: built.accessoryQueries, category: "accessories" },
  ];

  if (sites.length > 0) {
    // rotate sites across queries for diversity
    let si = 0;
    for (const set of categorySets) {
      for (const q of set.qs) {
        const site = sites[si % sites.length];
        si += 1;
        addQuery(q, set.category, site);
      }
    }
  } else {
    // whole web
    for (const set of categorySets) {
      for (const q of set.qs) addQuery(q, set.category);
    }
  }

  const debugFetch: Record<
    string,
    { pages: number; itemsSeen: number; domains: Record<string, number> }
  > = {};

  const candidates: Candidate[] = [];
  let saw429 = false;

  for (const item of queriesFinal) {
    const key = item.q;
    debugFetch[key] = { pages: 0, itemsSeen: 0, domains: {} };

    for (let page = 0; page < MAX_PAGES; page++) {
      const startIndex = 1 + page * NUM_PER_PAGE;

      try {
        const data = await fetchCse(apiKey, cx, item.q, startIndex);
        debugFetch[key].pages += 1;

        const items = Array.isArray(data?.items) ? (data.items as any[]) : [];
        debugFetch[key].itemsSeen += items.length;

        for (const it of items) {
          const link = toStr(it?.image?.contextLink, toStr(it?.link, ""));
          const img = toStr(it?.link, "");
          const title = toStr(it?.title, "");
          const thumb = toStr(it?.image?.thumbnailLink, "");

          if (!link || !img) continue;

          const host = normalizeHost(link);

          if (FARFETCH_BLOCKED && isFarfetch(host)) continue;
          if (isBlockedCandidate(title, link)) continue;
          if (!looksLikeProduct(title, link)) continue;

          debugFetch[key].domains[host] = (debugFetch[key].domains[host] ?? 0) + 1;

          candidates.push({
            title,
            link,
            img,
            thumb: thumb || undefined,
            host,
            query: item.q,
            category: item.category,
          });
        }
      } catch (e: any) {
        const status = Number(e?.status || 0);
        if (status === 429) saw429 = true;
        // If rate-limited, stop early to avoid burning quota
        break;
      }
    }
  }

  // Score + sort
  const scored = candidates
    .map((c) => ({
      ...c,
      _score: scoreCandidate(c, prompt),
    }))
    .sort((a, b) => b._score - a._score);

  // Dedupe + per-domain cap + diversity
  const final = dedupeAndCap(
    scored.map(({ _score, ...c }) => c),
    desired,
    PER_DOMAIN_CAP
  );

  // Convert to output
  const images: ImageResult[] = final.map((c) => ({
    imageUrl: c.img,
    thumbnailUrl: c.thumb,
    sourceUrl: c.link,
    title: c.title,
    provider: c.host,
    category: c.category,
    score: scoreCandidate(c, prompt),
    query: c.query,
  }));

  // Final post-filter safety (catch any stragglers)
  const cleaned = images.filter((img) => !isBlockedCandidate(img.title, img.sourceUrl));

  const domainCounts: Record<string, number> = {};
  for (const img of cleaned) {
    domainCounts[img.provider] = (domainCounts[img.provider] ?? 0) + 1;
  }

  const categoryCounts: Record<string, number> = {};
  for (const img of cleaned) {
    categoryCounts[img.category] = (categoryCounts[img.category] ?? 0) + 1;
  }

  return res.status(200).json({
    images: cleaned,
    source: "google-cse",
    debug: {
      version: VERSION,
      prompt,
      gender,
      desired,
      perDomainCap: PER_DOMAIN_CAP,
      sites,
      queriesBuilt: rawQueries,
      queriesSent: queriesFinal.map((q) => q.q),
      totalCandidates: candidates.length,
      totalDeduped: cleaned.length,
      domainCounts,
      categoryCounts,
      saw429,
      farfetchBlocked: FARFETCH_BLOCKED,
      fetch: debugFetch,
      ms: Date.now() - started,
    },
  });
}
