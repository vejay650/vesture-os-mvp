// pages/api/moodboard.ts
import type { NextApiRequest, NextApiResponse } from "next";

/** ---------- Types ---------- */
type ImageResult = {
  imageUrl: string;
  sourceUrl: string;
  title: string;
  thumbnailUrl?: string;
  provider?: string; // normalized host
};

type Candidate = {
  title: string;
  link: string; // product/page url
  img: string;  // image url
  host: string; // normalized host
};

/** ---------- Small helpers ---------- */
const clean = (s: any) => (typeof s === "string" ? s.trim() : "");
const normHost = (h: string) => clean(h).replace(/^www\./i, "").toLowerCase();
const containsAny = (hay: string, needles: string[]) => {
  const lc = hay.toLowerCase();
  for (let i = 0; i < needles.length; i++) {
    if (lc.includes(needles[i].toLowerCase())) return true;
  }
  return false;
};

/** ---------- Heuristics / vocab ---------- */
const EXCLUDE_INURL = [
  "/kids/", "/girls/", "/boys/", "/baby/",
  "/help/", "/blog/", "/story/", "/stories/", "/press/",
  "/account/", "/privacy", "/terms",
  "size-guide", "size_guide", "guide", "policy",
  "/lookbook"
];

const EXCLUDE_TERMS = [
  "kids", "toddler", "boy", "girl", "baby",
];

const BLOCKED_DOMAINS = [
  "pinterest.", "pinimg.com",
  "twitter.", "x.com",
  "facebook.", "reddit.", "tumblr.",
  "wikipedia."
];

/** ---------- Build the text query we send to CSE ---------- */
function buildTextQuery(opts: {
  event?: string;
  mood?: string;
  style?: string;
  gender?: string;
  brands?: string[];
}) {
  const { event, mood, style, gender, brands } = opts || {};
  const parts = [event, mood, style, gender].filter(Boolean) as string[];
  let q = (parts.join(" ") || "outfit").trim();
  if (brands && brands.length) q += " " + brands.join(" ");
  // nudge toward commercial results; avoid editorial
  q += " outfit -pinterest -review -editorial";
  return q;
}

/** ---------- Google CSE (image) search with pagination ---------- */
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
    // image hints
    url.searchParams.set("imgType", "photo");
    url.searchParams.set("imgSize", "large");
    url.searchParams.set("safe", "active");

    const res = await fetch(url.toString());
    if (!res.ok) break; // if rate-limited or quota, bail with what we have
    const data = await res.json();
    const items = (data?.items || []) as any[];
    if (!items.length) break;

    results.push(...items);
    start += items.length;
  }

  return results;
}

/** ---------- API Handler ---------- */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Support POST (body) and GET (query)
    const isPost = req.method === "POST";
    const bodyOrQuery: any = isPost ? (req.body || {}) : (req.query || {});

    const event = clean(bodyOrQuery.event);
    const mood = clean(bodyOrQuery.mood);
    const style = clean(bodyOrQuery.style);
    const gender = clean(bodyOrQuery.gender);
    const brands = Array.isArray(bodyOrQuery.brands) ? bodyOrQuery.brands : undefined;
    const qParam = clean(Array.isArray(bodyOrQuery.q) ? bodyOrQuery.q[0] : bodyOrQuery.q);
    const countRaw = Number(bodyOrQuery.count);
    const desired = Math.min(Math.max(isFinite(countRaw) && countRaw > 0 ? countRaw : 18, 6), 36);

    // ENV
    const key = clean(process.env.GOOGLE_CSE_KEY);
    const cx = clean(process.env.GOOGLE_CSE_ID);
    if (!key || !cx) {
      return res.status(500).json({
        error: "Missing GOOGLE_CSE_KEY or GOOGLE_CSE_ID. Add them in Vercel → Settings → Environment Variables."
      });
    }

    // Allowed retailer hosts
    const sitesEnv = clean(process.env.RETAILER_SITES || "");
    const siteList = sitesEnv
      .split(",")
      .map((s) => normHost(s))
      .filter(Boolean);
    if (siteList.length === 0) {
      return res.status(500).json({ error: "No retailer sites configured (RETAILER_SITES)" });
    }

    // Build text query
    const baseQ = qParam;
    const textQuery = baseQ
      ? `${baseQ} outfit`
      : buildTextQuery({ event, mood, style, gender, brands });

    // Add site filters
    // (avoid [...new Set] for ES5; Set is fine, but we iterate via Array.from)
    const siteSet = new Set<string>();
    for (let i = 0; i < siteList.length; i++) siteSet.add(siteList[i]);

    let siteFilter = "";
    {
      const arr = Array.from(siteSet);
      const pieces: string[] = [];
      for (let i = 0; i < arr.length; i++) {
        pieces.push(`site:${arr[i]}`);
      }
      siteFilter = pieces.join(" OR ");
    }

    const finalQuery = `${textQuery} ${siteFilter}`.trim();

    // Query CSE (fetch extra so we can filter hard)
    const items = await googleImageSearch(finalQuery, desired * 3, key, cx);

    // Map to candidates
    let candidates: Candidate[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const img = clean(it?.link); // image url
      const ctx = clean(it?.image?.contextLink || it?.image?.context || it?.image?.source || it?.displayLink || "");
      const link = clean(ctx || it?.link); // page url (prefer context)
      const title = clean(it?.title || "");
      if (!img || !link) continue;
      try {
        const host = normHost(new URL(link).hostname);
        candidates.push({ title, link, img, host });
      } catch {
        // ignore malformed
      }
    }

    /** =========================
     *  STRICT FILTER + RANK + DEDUPE  (RELAXED)
     *  ========================= */

    // A) Domain + noise filters
    let filtered = candidates.filter((c) => {
      if (!c.img || !c.link) return false;
      for (let b = 0; b < BLOCKED_DOMAINS.length; b++) {
        if (c.host.includes(BLOCKED_DOMAINS[b])) return false;
      }
      // must be in whitelist (allow subdomains)
      let allowed = false;
      const arr = Array.from(siteSet);
      for (let i = 0; i < arr.length; i++) {
        const s = arr[i];
        if (c.host === s || c.host.endsWith(s)) {
          allowed = true;
          break;
        }
      }
      if (!allowed) return false;

      const url = (c.link + "").toLowerCase();
      const title = (c.title + "").toLowerCase();
      if (containsAny(url, EXCLUDE_INURL)) return false;
      if (containsAny(title, EXCLUDE_TERMS)) return false;

      return true;
    });

    const debug: any = {
      totalItems: candidates.length,
      afterDomainAndNoiseFilter: filtered.length,
    };

    // B) Token extraction & synonyms for simple phrases
    const phrase = (baseQ || `${event || ""} ${mood || ""} ${style || ""} ${gender || ""}`).trim().toLowerCase();

    const expansions: Record<string, string[]> = {
      oversized: ["oversized", "baggy", "wide", "loose", "relaxed", "boxy"],
      minimal: ["minimal", "clean", "simple"],
      streetwear: ["streetwear", "street", "casual", "urban"],
      workwear: ["workwear", "utility", "military", "cargo"],
      loafers: ["loafer", "loafers", "penny loafer"],
      sneakers: ["sneaker", "sneakers", "trainer", "trainers"],
      heels: ["heel", "heels", "stiletto"],
      dress: ["dress", "slip dress"],
      blazer: ["blazer", "tailored", "suit"],
      jeans: ["jeans", "denim"],
      pants: ["pant", "pants", "trouser", "trousers"],
      skirt: ["skirt", "midi skirt", "mini skirt"],
      jacket: ["jacket", "coat", "parka", "puffer"],
      top: ["top", "tee", "t-shirt", "shirt", "blouse", "knit"],
      bag: ["bag", "tote", "shoulder bag", "crossbody"],
      nightout: ["night out", "evening", "date night", "party"],
    };

    const colors = ["red","black","white","cream","beige","brown","blue","navy","green","grey","gray","pink","olive","khaki"];

    const tokenSet = new Set<string>();
    for (const key in expansions) {
      if (Object.prototype.hasOwnProperty.call(expansions, key)) {
        if (phrase.includes(key)) {
          const arr = expansions[key];
          for (let i = 0; i < arr.length; i++) tokenSet.add(arr[i]);
        }
      }
    }
    for (let i = 0; i < colors.length; i++) {
      const c = colors[i];
      if (phrase.includes(c)) tokenSet.add(c);
    }
    const TOKENS = Array.from(tokenSet);

    const isNightOut = /(\bnight\s*out\b|\bevening\b|\bdate\s*night\b|\bparty\b)/i.test(phrase);

    const fullTextOf = (c: Candidate) => (c.title + " " + c.link).toLowerCase();
    const passAll = (c: Candidate) => {
      if (TOKENS.length === 0) return true;
      const t = fullTextOf(c);
      for (let i = 0; i < TOKENS.length; i++) {
        if (!t.includes(TOKENS[i])) return false;
      }
      return true;
    };
    const passSome = (c: Candidate) => {
      if (TOKENS.length === 0) return true;
      const t = fullTextOf(c);
      for (let i = 0; i < TOKENS.length; i++) {
        if (t.includes(TOKENS[i])) return true;
      }
      return false;
    };

    // strict → soft → none
    let tokenStage = "all";
    let tokenFiltered = filtered.filter(passAll);

    if (tokenFiltered.length < Math.min(12, desired)) {
      tokenStage = "some";
      tokenFiltered = filtered.filter(passSome);
    }
    if (tokenFiltered.length < Math.min(8, desired)) {
      tokenStage = "none";
      tokenFiltered = filtered.slice(0);
    }

    debug.afterTokenFilter = tokenFiltered.length;
    debug.tokenStage = tokenStage;

    // C) Product-ish preference with graceful fallback
    const productish = (c: Candidate) => {
      const u = (c.link || "").toLowerCase();
      return (
        u.includes("/product") ||
        u.includes("/products") ||
        u.includes("/p/") ||
        u.includes("/item/") ||
        u.includes("/shop/") ||
        u.includes("/dp/") ||
        u.includes("/sku/") ||
        u.includes("/collection") ||
        u.includes("/collections") ||
        u.includes("/catalog")
      );
    };

    let ranked = tokenFiltered.filter(productish);
    if (ranked.length < Math.max(6, Math.round(desired * 0.5))) {
      ranked = tokenFiltered;
    }

    const fashionScore = (c: Candidate): number => {
      const title = (c.title || "").toLowerCase();
      const url = (c.link || "").toLowerCase();
      const text = title + " " + url;
      let s = 0;

      if (productish(c)) s += 8;

      for (let i = 0; i < TOKENS.length; i++) {
        const tok = TOKENS[i];
        if (tok && text.includes(tok)) s += 3;
      }

      if (isNightOut) {
        if (/(hoodie|sweatshirt|sweatpants|jogger|tracksuit|fleece)/.test(text)) s -= 6;
        if (/(heel|stiletto|silk|satin|blazer|dress|tailor|slip)/.test(text)) s += 4;
      }

      if (/(ssense|farfetch|matchesfashion|mrporter|endclothing|totokaelo)/.test(c.host)) s += 2;

      return s;
    };

    ranked.sort((a, b) => fashionScore(b) - fashionScore(a));

    // --- Domain cap to diversify tiles ---
    const perDomainCap = 3;
    const domainCounts = new Map<string, number>();
    const diversified: Candidate[] = [];
    for (let i = 0; i < ranked.length; i++) {
      const c = ranked[i];
      const count = domainCounts.get(c.host) || 0;
      if (count >= perDomainCap) continue;
      domainCounts.set(c.host, count + 1);
      diversified.push(c);
    }
    filtered = diversified;

    // D) Dedupe by page path + image filename
    const seen = new Set<string>();
    const out: ImageResult[] = [];
    for (let i = 0; i < filtered.length; i++) {
      const c = filtered[i];

      let pageKey = clean(c.link);
      try {
        const u = new URL(c.link);
        pageKey = `${normHost(u.hostname)}${u.pathname.replace(/\/$/, "")}`;
      } catch {
        // ignore
      }

      let imgKey = c.img;
      try {
        const u = new URL(c.img);
        const fn = (u.pathname.split("/").pop() || u.pathname).toLowerCase();
        imgKey = fn.replace(/\.(webp|jpg|jpeg|png|gif|avif)$/, "");
      } catch {
        // ignore
      }

      const k = `${pageKey}::${imgKey}`;
      if (seen.has(k)) continue;
      seen.add(k);

      out.push({
        imageUrl: c.img,
        sourceUrl: c.link,
        title: c.title,
        provider: c.host,
      });
      if (out.length >= desired) break;
    }
    debug.final = out.length;

    // Fallback so UI never blanks
    if (out.length === 0 && filtered.length) {
      const fallback: ImageResult[] = [];
      const limit = Math.max(6, desired);
      for (let i = 0; i < filtered.length && fallback.length < limit; i++) {
        const c = filtered[i];
        fallback.push({
          imageUrl: c.img,
          sourceUrl: c.link,
          title: c.title,
          provider: c.host,
        });
      }
      return res.status(200).json({
        query: finalQuery,
        images: fallback,
        source: "google-cse",
        debug,
        page: { start: 1, count: fallback.length },
      });
    }

    // Normal success
    return res.status(200).json({
      query: finalQuery,
      images: out,
      source: "google-cse",
      debug,
      page: { start: 1, count: out.length },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Unexpected error" });
  }
}
