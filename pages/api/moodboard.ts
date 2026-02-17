// pages/api/moodboard.ts
// Drop-in replacement. Paste the entire file.
//
// What this fixes:
// - Removes “vibe words” (minimal/date night/etc.) from PRODUCT queries so Google CSE returns results.
// - Works with multiple env var names (GOOGLE_CSE_API_KEY vs GOOGLE_CSE_KEY, GOOGLE_CSE_CX vs GOOGLE_CX, etc.).
// - Product-only filtering + blocks editorials/guide pages.
// - Domain rotation + per-domain cap + category diversity.
// - Returns { images, source, debug } like your logs.

import type { NextApiRequest, NextApiResponse } from "next";

type CseItem = {
  title?: string;
  link?: string;
  displayLink?: string;
  pagemap?: any;
};

type CseResponse = {
  items?: CseItem[];
  searchInformation?: {
    totalResults?: string;
  };
};

type Candidate = {
  link: string;
  img: string;
  thumb?: string;
  title?: string;
  displayLink?: string;
  query: string;
  domain: string;
  category: string;
  score: number;
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

const VERSION = "moodboard-v25-FIX-VIBE-TERMS-2026-02-16";

// ---------- ENV (support your various names) ----------
function getEnvAny(names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v && String(v).trim()) return String(v).trim();
  }
  return undefined;
}

function getCseKey(): string | undefined {
  return getEnvAny(["GOOGLE_CSE_API_KEY", "GOOGLE_CSE_KEY", "GOOGLE_API_KEY", "GOOGLE_KEY"]);
}

function getCseCx(): string | undefined {
  return getEnvAny(["GOOGLE_CSE_CX", "GOOGLE_CX", "GOOGLE_CUSTOM_SEARCH_CX", "CSE_CX", "CX"]);
}

// ---------- URL / DOMAIN HELPERS ----------
function domainOf(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function normUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    // Strip common tracking params
    const kill = new Set([
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "gclid",
      "fbclid",
      "mc_cid",
      "mc_eid",
    ]);
    for (const k of Array.from(u.searchParams.keys())) {
      if (kill.has(k)) u.searchParams.delete(k);
    }
    return u.toString();
  } catch {
    return url;
  }
}

function safeLower(s: string) {
  return (s || "").toLowerCase();
}

// ---------- IMAGE PICKING ----------
function pickThumb(it: CseItem): { img?: string; thumb?: string } {
  const pm = it?.pagemap;
  const cseImg = pm?.cse_image?.[0]?.src;
  const cseThumb = pm?.cse_thumbnail?.[0]?.src;

  // Some sites use "metatags" og:image
  const ogImg =
    pm?.metatags?.[0]?.["og:image"] ||
    pm?.metatags?.[0]?.["og:image:url"] ||
    pm?.metatags?.[0]?.["twitter:image"];

  const img = cseImg || ogImg || cseThumb;
  const thumb = cseThumb || img;

  return {
    img: img ? String(img) : undefined,
    thumb: thumb ? String(thumb) : undefined,
  };
}

// ---------- PROMPT CLEANING (THIS IS THE IMPORTANT FIX) ----------
function productSearchTerms(prompt: string) {
  const p = safeLower(prompt);

  // Keep only literal terms that appear on product pages
  const colorMatch = p.match(/\b(black|brown|tan|beige|grey|gray|navy|white)\b/);
  const color = colorMatch?.[1] || colorMatch?.[0] || "black";

  // Remove “vibe” words that do NOT appear on product pages, causing 0 results
  const banned = new Set([
    "minimal",
    "date",
    "night",
    "date-night",
    "datenight",
    "outfit",
    "vibe",
    "clean",
    "sleek",
    "classy",
    "simple",
    "elevated",
    "modern",
    "look",
    "lookbook",
    "style",
    "styling",
    "for",
    "the",
    "a",
    "an",
    "with",
    "and",
  ]);

  const tokens = p
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !banned.has(t));

  // Detect footwear intent
  const hasBoots = tokens.includes("boot") || tokens.includes("boots");
  const hasShoes = tokens.includes("shoe") || tokens.includes("shoes");

  const item = hasBoots ? "boots" : hasShoes ? "shoes" : "boots";

  return { color, item };
}

// ---------- PRODUCT-ONLY URL HEURISTICS ----------
const EDITORIAL_PATH_HINTS = [
  "/editorial",
  "/guide",
  "/market",
  "/magazine",
  "/journal",
  "/blog",
  "/stories",
  "/lookbook",
  "/press",
  "/campaign",
  "/feature",
  "/features",
  "/style-guide",
  "/news",
  "/trend",
  "/trends",
  "/fashion-shows",
];

const BLOCKED_DOMAINS = new Set<string>([
  // add any you hard-block
]);

function isEditorialUrl(url: string): boolean {
  const u = safeLower(url);
  if (EDITORIAL_PATH_HINTS.some((p) => u.includes(p))) return true;
  // query-string editorials
  if (u.includes("editorial")) return true;
  return false;
}

function isLikelyProductUrl(domain: string, url: string, gender: "men" | "women" | "unisex") {
  const u = safeLower(url);
  if (isEditorialUrl(u)) return false;

  // Must not be category nav pages
  const navHints = ["?nav", "/c.cat", "/category", "/categories", "/search", "/s?", "/collections"];
  if (navHints.some((h) => u.includes(h))) return false;

  // Domain-specific patterns
  if (domain.includes("ssense.com")) {
    // SSENSE product pages commonly: /en-us/men/product/brand/name/id
    return u.includes("/product/") && (u.includes("/men/") || u.includes("/women/") || u.includes("/unisex/"));
  }
  if (domain.includes("neimanmarcus.com")) {
    // product.jsp?itemId=prod...
    return u.includes("product.jsp") && (u.includes("itemid=") || u.includes("itemid=") || u.includes("prod"));
  }
  if (domain.includes("yoox.com")) {
    // many products have /item/ or /us/....
    return u.includes("/item/") || u.includes("cod10=") || u.includes("dept=");
  }
  if (domain.includes("mrporter.com")) {
    return u.includes("/en-us/mens/product/") || u.includes("/mens/product/");
  }
  if (domain.includes("endclothing.com")) {
    return u.includes("/products/") || u.includes("/product/");
  }
  if (domain.includes("nordstrom.com")) {
    return u.includes("/s/") && /\d{5,}/.test(u); // nordstrom product ids
  }
  if (domain.includes("saksfifthavenue.com")) {
    return u.includes("/product/") || u.includes("product/");
  }
  if (domain.includes("ourlegacy.com")) {
    return u.includes("/products/") || u.includes("/product/");
  }

  // Generic fallback: has a long numeric id or obvious product slug
  const hasId = /(\bprod\d+\b)|(\b\d{6,}\b)|([?&]pid=)|([?&]sku=)/i.test(url);
  const hasProductWord = u.includes("/product") || u.includes("/products/");
  return hasId || hasProductWord;
}

// ---------- QUERY BUILDING ----------
function buildCategoryQueries(prompt: string, gender: "men" | "women" | "unisex") {
  const { color, item } = productSearchTerms(prompt);

  // IMPORTANT: These are PRODUCT terms ONLY (no “date night/minimal”)
  // We keep “men/women” + color + item nouns.
  const who = gender === "women" ? "women" : gender === "unisex" ? "unisex" : "men";

  const queriesBuilt = [
    `${who} ${color} leather boots`,
    `${who} ${color} ankle boots`,
    `${who} ${color} dress boots`,
    `${who} ${color} tailored trousers`,
    `${who} ${color} straight leg trousers`,
    `${who} ${color} button-up shirt`,
    `${who} ${color} minimal shirt`,
    `${who} ${color} lightweight jacket`,
    `${who} ${color} bomber jacket`,
    `${who} ${color} leather belt`,
    `${who} minimalist watch ${color}`,
    `${who} ${color} sunglasses`,
  ];

  // If user didn’t mention boots at all, still keep footwear but broaden
  if (item === "shoes") {
    queriesBuilt.unshift(`${who} ${color} leather shoes`);
  }

  return { color, who, queriesBuilt };
}

// ---------- SCORING / FILTERING ----------
const NEGATIVE_TERMS = [
  // perfumes + beauty
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
  // obvious non-target shoes
  "sandal",
  "slide",
  "thong",
  "flip-flop",
  "flipflop",
  "flip",
  // women-only signals (for men searches)
  "over-the-knee",
  "otk",
  "womens",
  "women",
  "female",
];

function withNegativeTerms(q: string) {
  // keep these lighter than your older “-inurl:” wall; too many exclusions can kill results
  return `${q} product ${NEGATIVE_TERMS.map((t) => `-${t}`).join(" ")}`;
}

function guessCategory(q: string): string {
  const s = safeLower(q);
  if (s.includes("trousers") || s.includes("pants")) return "bottoms";
  if (s.includes("shirt") || s.includes("polo")) return "tops";
  if (s.includes("jacket") || s.includes("bomber")) return "outerwear";
  if (s.includes("belt")) return "accessories";
  if (s.includes("watch")) return "accessories";
  if (s.includes("sunglasses")) return "accessories";
  if (s.includes("boots") || s.includes("shoes")) return "shoes";
  return "other";
}

function scoreCandidate(c: Candidate) {
  let s = 0;

  // Prefer product-like paths
  if (/\/product|\/products|product\.jsp|itemid=|cod10=|pid=|sku=/i.test(c.link)) s += 10;

  // Prefer having an image
  if (c.img) s += 5;

  // Small boost for matching category keywords
  const u = safeLower(c.link);
  if (c.category === "shoes" && (u.includes("boot") || u.includes("shoe"))) s += 3;
  if (c.category === "bottoms" && (u.includes("trouser") || u.includes("pant"))) s += 3;
  if (c.category === "tops" && (u.includes("shirt") || u.includes("polo"))) s += 3;
  if (c.category === "outerwear" && (u.includes("jacket") || u.includes("bomber"))) s += 3;
  if (c.category === "accessories" && (u.includes("belt") || u.includes("watch") || u.includes("sunglass")))
    s += 3;

  // Penalize obvious non-product/editorial
  if (isEditorialUrl(c.link)) s -= 50;

  // Penalize perfumes/beauty if they slip in
  const title = safeLower(c.title || "");
  if (NEGATIVE_TERMS.some((t) => title.includes(t))) s -= 25;

  return s;
}

// ---------- GOOGLE CSE FETCH ----------
async function fetchCse(q: string, start: number, key: string, cx: string): Promise<CseResponse> {
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", key);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", q);
  url.searchParams.set("start", String(start));
  // Turn off safe search for shopping results
  url.searchParams.set("safe", "off");

  const r = await fetch(url.toString());
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`CSE error ${r.status}: ${txt.slice(0, 240)}`);
  }
  return (await r.json()) as CseResponse;
}

// ---------- HANDLER ----------
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const prompt = String((req.query.prompt || req.body?.prompt || "") as string).trim();
    const genderRaw = String((req.query.gender || req.body?.gender || "men") as string).toLowerCase();
    const gender = (["men", "women", "unisex"].includes(genderRaw) ? genderRaw : "men") as
      | "men"
      | "women"
      | "unisex";

    const desired = Number(req.query.desired || req.body?.desired || 18) || 18;
    const perDomainCap = Number(req.query.perDomainCap || req.body?.perDomainCap || 3) || 3;

    // Site list (you can pass sites[]=... or sites in body); otherwise default safe retail sites
    const sitesParam = (req.query.sites || req.body?.sites || []) as string[] | string;
    const sitesUsed: string[] = Array.isArray(sitesParam)
      ? sitesParam
      : typeof sitesParam === "string" && sitesParam
      ? sitesParam.split(",")
      : [];

    const defaultSites = [
      "ssense.com",
      "yoox.com",
      "neimanmarcus.com",
      "mrporter.com",
      "endclothing.com",
      "nordstrom.com",
      "saksfifthavenue.com",
      "ourlegacy.com",
    ];

    const sites = (sitesUsed.length ? sitesUsed : defaultSites)
      .map((s) => s.trim().replace(/^https?:\/\//, "").replace(/^www\./, ""))
      .filter(Boolean);

    const key = getCseKey();
    const cx = getCseCx();

    if (!key || !cx) {
      return res.status(200).json({
        images: [],
        source: "google-cse",
        debug: {
          version: VERSION,
          prompt,
          gender,
          desired,
          perDomainCap,
          sitesUsed: sites,
          lastError: { message: "Missing GOOGLE_CSE_API_KEY/GOOGLE_CSE_KEY or GOOGLE_CSE_CX/GOOGLE_CX" },
        },
      });
    }

    const { queriesBuilt } = buildCategoryQueries(prompt, gender);

    // We’ll attach site:domain during rotation, not inside queriesBuilt
    const queriesSent: string[] = [];
    const collected: Candidate[] = [];

    const maxPagesPerSite = 1; // keep fast and predictable
    const startAt = 1;

    // Rotation: query -> site -> page
    for (const q0 of queriesBuilt) {
      if (collected.length >= desired * 3) break; // gather extra for filtering
      const category = guessCategory(q0);

      for (const site of sites) {
        if (collected.length >= desired * 3) break;

        for (let page = 0; page < maxPagesPerSite; page++) {
          const start = startAt + page * 10;
          const q = `${withNegativeTerms(q0)} site:${site}`;
          queriesSent.push(q);

          let resp: CseResponse;
          try {
            resp = await fetchCse(q, start, key, cx);
          } catch {
            continue;
          }

          const items = resp.items || [];
          for (const it of items) {
            const linkRaw = it.link || "";
            if (!linkRaw) continue;

            const link = normUrl(linkRaw);
            const domain = domainOf(link);
            if (!domain) continue;
            if (BLOCKED_DOMAINS.has(domain)) continue;

            // Must match the site we asked for (CSE sometimes returns CDN etc.)
            if (!domain.endsWith(site)) continue;

            if (isEditorialUrl(link)) continue;

            const { img, thumb } = pickThumb(it);
            if (!img) continue;

            // HARD product gate (only keep product pages)
            if (!isLikelyProductUrl(domain, link, gender)) continue;

            const cand: Candidate = {
              link,
              img,
              thumb,
              title: it.title,
              displayLink: it.displayLink,
              query: q0,
              domain,
              category,
              score: 0,
            };

            cand.score = scoreCandidate(cand);
            collected.push(cand);
          }
        }
      }
    }

    // Dedup by product URL + image URL
    const seen = new Set<string>();
    const deduped: Candidate[] = [];
    for (const c of collected) {
      const k = `${c.link}|${c.img}`;
      if (seen.has(k)) continue;
      seen.add(k);
      deduped.push(c);
    }

    // Sort by score desc
    deduped.sort((a, b) => b.score - a.score);

    // Enforce per-domain cap + category diversity
    const domainCounts: Record<string, number> = {};
    const categoryCounts: Record<string, number> = {};
    const final: Candidate[] = [];

    for (const c of deduped) {
      if (final.length >= desired) break;

      const dCount = domainCounts[c.domain] || 0;
      if (dCount >= perDomainCap) continue;

      // Light category diversity: don’t let one category take everything
      const catCount = categoryCounts[c.category] || 0;
      const catCap = Math.max(2, Math.ceil(desired / 5)); // e.g., for 18 => cap ~4
      if (catCount >= catCap) continue;

      domainCounts[c.domain] = dCount + 1;
      categoryCounts[c.category] = catCount + 1;
      final.push(c);
    }

    const images: OutImage[] = final.map((c) => ({
      imageUrl: c.img,
      thumbnailUrl: c.thumb,
      sourceUrl: c.link,
      title: c.title,
      provider: c.domain,
      category: c.category,
      score: c.score,
      query: c.query,
    }));

    // Debug counts for quick sanity
    const fetchDebug: Record<string, { pagesTried: number; itemsSeen: number }> = {};
    for (const qs of queriesSent) {
      // compress debug by the "base query without start"
      const keyQ = qs;
      if (!fetchDebug[keyQ]) fetchDebug[keyQ] = { pagesTried: 0, itemsSeen: 0 };
      fetchDebug[keyQ].pagesTried += 1;
      // We don’t have itemsSeen per request without tracking; keep pagesTried.
    }

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
        queriesBuilt,
        // show queriesSent but keep it reasonably sized
        queriesSent: queriesSent.slice(0, 40),
        totalCandidates: collected.length,
        totalDeduped: deduped.length,
        domainCounts,
        categoryCounts,
        ms: undefined,
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
