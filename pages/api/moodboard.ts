// pages/api/moodboard.ts
import type { NextApiRequest, NextApiResponse } from "next";

/** ---------- Types ---------- */
type ImageResult = {
  imageUrl: string;
  thumbnailUrl?: string;
  sourceUrl: string;
  title: string;
  provider?: string; // normalized host
  score?: number;
  query?: string;
};

type Candidate = {
  title: string;
  link: string;     // product/page url
  img: string;      // image url
  thumb?: string;   // thumbnail url
  host: string;     // normalized host
  query: string;    // which query produced it
};

const clean = (s: any) => (typeof s === "string" ? s.trim() : "");
const normHost = (h: string) => clean(h).replace(/^www\./i, "").toLowerCase();

const containsAny = (hay: string, needles: string[]) => {
  const lc = hay.toLowerCase();
  for (let i = 0; i < needles.length; i++) {
    if (lc.includes(needles[i].toLowerCase())) return true;
  }
  return false;
};

/** ---------- Heuristics ---------- */
const EXCLUDE_INURL = [
  "/kids/", "/girls/", "/boys/", "/baby/",
  "/help/", "/blog/", "/story/", "/stories/", "/press/",
  "/account/", "/privacy", "/terms",
  "size-guide", "size_guide", "guide", "policy",
  "/lookbook", "/editorial", "/review", "/reviews"
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

// These hosts frequently block hotlinking (common blank images).
// We'll still return them, but we strongly prefer thumbnails when present.
const HOTLINK_RISK = [
  "louisvuitton.com",
  "bottegaveneta.com",
  "versace.com",
  "moncler.com",
];

/** ---------- Prompt → item-level query generation ---------- */
/**
 * We can still accept full sentences, but we convert to product-like queries.
 * This keeps relevance tight and reduces randomness.
 */
function buildItemQueries(opts: {
  prompt?: string;
  event?: string;
  mood?: string;
  style?: string;
  gender?: string;
}) {
  const prompt = clean(opts.prompt);
  const event = clean(opts.event);
  const mood = clean(opts.mood);
  const style = clean(opts.style);
  const gender = clean(opts.gender);

  const base = (prompt || [event, mood, style, gender].filter(Boolean).join(" ")).trim();

  // Minimal “intent” detection
  const lc = base.toLowerCase();
  const isNightOut = /(\bdate\b|\bdate night\b|\bnight out\b|\bevening\b|\bdinner\b|\bdrinks\b|\bparty\b)/i.test(lc);
  const isGame = /(\bgame\b|\bstadium\b|\barena\b|\bcourtside\b|\bmatch\b)/i.test(lc);
  const isStreet = /(\bstreetwear\b|\burban\b|\bcasual\b)/i.test(lc);
  const isMinimal = /(\bminimal\b|\bclean\b|\bsimple\b)/i.test(lc);

  const g = gender.toLowerCase();
  const genderHint =
    g.includes("women") || g.includes("female") ? "women" :
    g.includes("men") || g.includes("male") ? "men" :
    "unisex";

  // Build a compact style hint for the queries
  const vibeBits: string[] = [];
  if (isMinimal) vibeBits.push("minimal", "clean");
  if (isStreet) vibeBits.push("streetwear");
  if (isNightOut) vibeBits.push("evening");
  if (isGame) vibeBits.push("comfortable");

  const vibe = vibeBits.slice(0, 3).join(" ");

  // Template query sets (tight + product-like)
  // These generate items the UI can display as a “look”
  const queries: string[] = [];

  if (isNightOut && isGame) {
    // Game date night = elevated but comfortable
    queries.push(
      `black fitted turtleneck ${genderHint}`,
      `tailored trousers dark ${genderHint}`,
      `leather jacket ${genderHint}`,
      `clean white leather sneakers ${genderHint}`,
      `small shoulder bag ${genderHint}`,
      `minimal chain necklace ${genderHint}`
    );
  } else if (isNightOut) {
    queries.push(
      `blazer tailored ${genderHint}`,
      `silk satin top ${genderHint}`,
      `straight leg jeans dark ${genderHint}`,
      `ankle boots leather ${genderHint}`,
      `small bag ${genderHint}`,
      `minimal jewelry ${genderHint}`
    );
  } else {
    // General fallback outfit set
    queries.push(
      `clean knit top ${genderHint}`,
      `straight leg jeans ${genderHint}`,
      `tailored trousers ${genderHint}`,
      `clean sneakers ${genderHint}`,
      `jacket ${genderHint}`
    );
  }

  // Add vibe context lightly (don’t overload queries)
  // e.g., “minimal clean” helps without making it too broad
  const enriched = queries.map(q => (vibe ? `${q} ${vibe}` : q).trim());

  // Deduplicate
  return Array.from(new Set(enriched));
}

/** ---------- Google CSE (image) search ---------- */
async function googleImageSearch(q: string, count: number, key: string, cx: string): Promise<any[]> {
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

    // Image hints
    url.searchParams.set("imgType", "photo");
    url.searchParams.set("imgSize", "large");
    url.searchParams.set("safe", "active");

    const res = await fetch(url.toString());
    if (!res.ok) break;
    const data = await res.json();
    const items = (data?.items || []) as any[];
    if (!items.length) break;

    results.push(...items);
    start += items.length;
  }

  return results;
}

/** ---------- Scoring ---------- */
function isProductish(url: string) {
  const u = (url || "").toLowerCase();
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
}

function scoreCandidate(c: Candidate, tokens: string[]) {
  const text = (c.title + " " + c.link).toLowerCase();
  let s = 0;

  if (isProductish(c.link)) s += 8;

  // token relevance (soft)
  let hits = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (text.includes(tokens[i])) hits++;
  }
  s += hits * 2;

  // Farfetch soft penalty so it doesn’t dominate
  if (c.host.includes("farfetch")) s -= 2;

  return s;
}

function tokenizeQuery(q: string) {
  // Simple tokenization: keep useful words only
  const stop = new Set(["the","and","or","for","with","outfit","women","men","unisex","evening","comfortable"]);
  return q
    .toLowerCase()
    .split(/[\s,]+/)
    .map(t => t.replace(/[^a-z0-9\-]/g, ""))
    .filter(t => t.length >= 3 && !stop.has(t));
}

/** ---------- API Handler ---------- */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const isPost = req.method === "POST";
    const bodyOrQuery: any = isPost ? (req.body || {}) : (req.query || {});

    // Inputs
    const prompt = clean(bodyOrQuery.prompt);
    const event = clean(bodyOrQuery.event);
    const mood = clean(bodyOrQuery.mood);
    const style = clean(bodyOrQuery.style);
    const gender = clean(bodyOrQuery.gender);

    const countRaw = Number(bodyOrQuery.count);
    const desired = Math.min(Math.max(isFinite(countRaw) && countRaw > 0 ? countRaw : 18, 6), 36);

    // Optional override: queries[]
    const queriesOverride = Array.isArray(bodyOrQuery.queries)
      ? bodyOrQuery.queries.map(clean).filter(Boolean)
      : undefined;

    // ENV
    const key = clean(process.env.GOOGLE_CSE_KEY);
    const cx = clean(process.env.GOOGLE_CSE_ID);
    if (!key || !cx) {
      return res.status(500).json({
        error: "Missing GOOGLE_CSE_KEY or GOOGLE_CSE_ID."
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

    const siteSet = new Set<string>();
    for (let i = 0; i < siteList.length; i++) siteSet.add(siteList[i]);

    // Build site filter string
    const siteFilter = Array.from(siteSet).map(s => `site:${s}`).join(" OR ");

    // Build item-level queries
    const queries = (queriesOverride && queriesOverride.length)
      ? Array.from(new Set(queriesOverride)).slice(0, 10)
      : buildItemQueries({ prompt, event, mood, style, gender }).slice(0, 10);

    // We want a consistent number per query
    const perQuery = Math.max(6, Math.ceil(desired / Math.min(queries.length, 6)));

    const debug: any = {
      desired,
      queries,
      perQuery,
      retailers: Array.from(siteSet),
    };

    // Fetch candidates per query
    let candidates: Candidate[] = [];
    for (let qi = 0; qi < queries.length; qi++) {
      const q = queries[qi];

      // Nudge towards product pages; avoid editorial
      const finalQuery = `${q} -pinterest -editorial -review (${siteFilter})`.trim();

      const items = await googleImageSearch(finalQuery, perQuery * 3, key, cx);

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const img = clean(it?.link);
        const thumb = clean(it?.image?.thumbnailLink || "");
        const ctx = clean(it?.image?.contextLink || it?.image?.context || it?.displayLink || "");
        const link = clean(ctx); // page url
        const title = clean(it?.title || "");
        if (!img || !link) continue;

        try {
          const host = normHost(new URL(link).hostname);

          // Basic domain blocks
          let blocked = false;
          for (let b = 0; b < BLOCKED_DOMAINS.length; b++) {
            if (host.includes(BLOCKED_DOMAINS[b])) { blocked = true; break; }
          }
          if (blocked) continue;

          // Must be allowlisted (allow subdomains)
          let allowed = false;
          const arr = Array.from(siteSet);
          for (let k = 0; k < arr.length; k++) {
            const s = arr[k];
            if (host === s || host.endsWith(s)) { allowed = true; break; }
          }
          if (!allowed) continue;

          const urlLc = link.toLowerCase();
          const titleLc = title.toLowerCase();
          if (containsAny(urlLc, EXCLUDE_INURL)) continue;
          if (containsAny(titleLc, EXCLUDE_TERMS)) continue;

          candidates.push({ title, link, img, thumb, host, query: q });
        } catch {
          // ignore malformed
        }
      }
    }

    debug.totalCandidates = candidates.length;

    // Score + rank (query-aware)
    const ranked = candidates
      .map(c => {
        const tokens = tokenizeQuery(c.query);
        const s = scoreCandidate(c, tokens);
        return { ...c, _score: s };
      })
      .sort((a: any, b: any) => (b._score || 0) - (a._score || 0));

    // Diversification:
    // - cap per domain
    // - cap farfetch specifically
    const perDomainCap = desired <= 12 ? 2 : 3;
    const farfetchCap = desired <= 12 ? 2 : 3;

    const domainCounts = new Map<string, number>();
    let farfetchCount = 0;

    // Dedupe keys
    const seen = new Set<string>();
    const out: ImageResult[] = [];

    for (let i = 0; i < ranked.length; i++) {
      const c: any = ranked[i];

      // Domain caps
      const count = domainCounts.get(c.host) || 0;
      if (count >= perDomainCap) continue;

      if (c.host.includes("farfetch")) {
        if (farfetchCount >= farfetchCap) continue;
      }

      // Dedupe by page path + image filename
      let pageKey = c.link;
      try {
        const u = new URL(c.link);
        pageKey = `${normHost(u.hostname)}${u.pathname.replace(/\/$/, "")}`;
      } catch {}

      let imgKey = c.img;
      try {
        const u = new URL(c.img);
        const fn = (u.pathname.split("/").pop() || u.pathname).toLowerCase();
        imgKey = fn.replace(/\.(webp|jpg|jpeg|png|gif|avif)$/, "");
      } catch {}

      const k = `${pageKey}::${imgKey}`;
      if (seen.has(k)) continue;
      seen.add(k);

      // Hotlink mitigation: prefer thumbnail for risky domains
      const risky = HOTLINK_RISK.some(d => c.host.endsWith(d));
      const imageUrl = risky && c.thumb ? c.thumb : c.img;

      domainCounts.set(c.host, count + 1);
      if (c.host.includes("farfetch")) farfetchCount++;

      out.push({
        imageUrl,
        thumbnailUrl: c.thumb || undefined,
        sourceUrl: c.link,
        title: c.title,
        provider: c.host,
        score: c._score,
        query: c.query
      });

      if (out.length >= desired) break;
    }

    debug.final = out.length;
    debug.domainCounts = Object.fromEntries(domainCounts.entries());
    debug.farfetchCount = farfetchCount;

    // Never blank: if still empty, return top thumbnails from ranked
    if (out.length === 0 && ranked.length) {
      const fallback: ImageResult[] = [];
      const limit = Math.max(6, desired);
      for (let i = 0; i < ranked.length && fallback.length < limit; i++) {
        const c: any = ranked[i];
        fallback.push({
          imageUrl: c.thumb || c.img,
          thumbnailUrl: c.thumb || undefined,
          sourceUrl: c.link,
          title: c.title,
          provider: c.host,
          score: c._score,
          query: c.query
        });
      }
      return res.status(200).json({
        images: fallback,
        source: "google-cse",
        debug
      });
    }

    return res.status(200).json({
      images: out,
      source: "google-cse",
      debug
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Unexpected error" });
  }
}
