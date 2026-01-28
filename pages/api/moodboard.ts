import type { NextApiRequest, NextApiResponse } from "next";

type ImageResult = {
  imageUrl: string;
  thumbnailUrl?: string;
  sourceUrl: string;
  title: string;
  provider: string;
  score: number;
  query: string;
};

const clean = (v: any) => (typeof v === "string" ? v.trim() : "");
const normHost = (h: string) => clean(h).replace(/^www\./i, "").toLowerCase();

const BLOCK_PATHS = [
  "/editorial/",
  "/magazine/",
  "/journal/",
  "/blog/",
  "/stories/",
  "/story/",
  "/lookbook/",
  "/press/",
  "/campaign/",
  "/guides/",
  "/guide/",
  "/market/"
];

const BLOCK_TITLE_TERMS = [
  "editorial",
  "guide",
  "trends",
  "fashion month",
  "how to",
  "best of",
  "ultimate",
  "season",
  "shows"
];

function containsAny(hay: string, needles: string[]) {
  const s = hay.toLowerCase();
  for (let i = 0; i < needles.length; i++) {
    if (s.indexOf(needles[i].toLowerCase()) !== -1) return true;
  }
  return false;
}

function isBlockedPage(urlStr: string, title: string) {
  const u = (urlStr || "").toLowerCase();
  const t = (title || "").toLowerCase();
  if (containsAny(u, BLOCK_PATHS)) return true;
  if (containsAny(t, BLOCK_TITLE_TERMS)) return true;
  return false;
}

// stronger “product-ish” detection (helps avoid guides)
function looksProductLike(urlStr: string) {
  const u = (urlStr || "").toLowerCase();
  return (
    u.indexOf("/product") !== -1 ||
    u.indexOf("/products") !== -1 ||
    u.indexOf("/p/") !== -1 ||
    u.indexOf("/item") !== -1 ||
    u.indexOf("/shop") !== -1 ||
    u.indexOf("/dp/") !== -1 ||
    u.indexOf("/sku") !== -1
  );
}

// ✅ Keep a SMALL launch set that actually returns product pages reliably.
// You can expand later once stable.
function getRetailerSites(): string[] {
  const env = clean(process.env.RETAILER_SITES || "");
  if (env) {
    return env
      .split(",")
      .map(normHost)
      .filter(Boolean)
      .filter((x) => x !== "farfetch.com"); // optional hard block
  }
  // fallback if env missing
  return [
    "ssense.com",
    "yoox.com",
    "neimanmarcus.com",
    "ourlegacy.com",
    "moncler.com"
  ];
}

// Build a strict Google query that:
// - uses site: OR group (forces multi-site)
// - uses negative keywords AND inurl negatives (stops editorial)
// - nudges product intent
function buildGoogleQuery(prompt: string, gender: string, sites: string[]) {
  const g = gender ? gender : "men";
  const p = prompt || "date night outfit";

  const siteGroup = sites.map((s) => "site:" + s).join(" OR ");

  const negatives =
    "-editorial -guide -market -magazine -journal -blog -stories -lookbook -press -campaign";
  const inurlNeg =
    "-inurl:editorial -inurl:guide -inurl:market -inurl:magazine -inurl:blog -inurl:stories -inurl:lookbook -inurl:press -inurl:campaign";

  // NOTE: ( ... ) grouping works in Google query syntax
  return `${g} ${p} product ${negatives} ${inurlNeg} (${siteGroup})`.trim();
}

async function googleImageSearch(
  q: string,
  key: string,
  cx: string,
  num: number
): Promise<any[]> {
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("q", q);
  url.searchParams.set("cx", cx);
  url.searchParams.set("key", key);
  url.searchParams.set("searchType", "image");
  url.searchParams.set("num", String(Math.min(Math.max(num, 1), 10)));
  url.searchParams.set("safe", "active");

  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const data = await res.json();
  return (data && data.items) ? data.items : [];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const key = clean(process.env.GOOGLE_CSE_KEY);
    const cx = clean(process.env.GOOGLE_CSE_ID);
    if (!key || !cx) {
      return res.status(500).json({
        error: "Missing GOOGLE_CSE_KEY or GOOGLE_CSE_ID in Vercel env vars."
      });
    }

    const prompt = clean((req.query.q as any) || (req.body && (req.body as any).q) || "");
    const gender = clean((req.query.gender as any) || (req.body && (req.body as any).gender) || "men");
    const desiredRaw = Number((req.query.count as any) || (req.body && (req.body as any).count) || 18);
    const desired = Math.min(Math.max(isFinite(desiredRaw) ? desiredRaw : 18, 6), 24);

    const sites = getRetailerSites();

    // Build 3 variations so results don’t get stuck
    const base = prompt || "black minimal date night boots";
    const queries = [
      buildGoogleQuery(base, gender, sites),
      buildGoogleQuery(base + " shoes", gender, sites),
      buildGoogleQuery(base + " outfit", gender, sites)
    ];

    const seen = new Set<string>();
    const out: ImageResult[] = [];
    const domainsUsed: { [k: string]: number } = {};

    for (let qi = 0; qi < queries.length; qi++) {
      const q = queries[qi];
      const items = await googleImageSearch(q, key, cx, 10);

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const imageUrl = clean(it && it.link);
        const sourceUrl = clean((it && it.image && it.image.contextLink) || "");
        const title = clean((it && it.title) || "");

        if (!imageUrl || !sourceUrl) continue;

        let host = "";
        try {
          host = normHost(new URL(sourceUrl).hostname);
        } catch {
          continue;
        }

        // allowlist check
        let allowed = false;
        for (let s = 0; s < sites.length; s++) {
          const site = sites[s];
          if (host === site || host.endsWith("." + site) || host.indexOf(site) !== -1) {
            allowed = true;
            break;
          }
        }
        if (!allowed) continue;

        // HARD BLOCK editorial/guide pages
        if (isBlockedPage(sourceUrl, title)) continue;

        // dedupe
        const k = sourceUrl + "::" + imageUrl;
        if (seen.has(k)) continue;
        seen.add(k);

        // scoring: prefer product-like urls
        let score = 10;
        if (looksProductLike(sourceUrl)) score += 10;
        score -= qi; // earlier query variant gets slight preference

        domainsUsed[host] = (domainsUsed[host] || 0) + 1;

        out.push({
          imageUrl,
          thumbnailUrl: clean(it && it.image && it.image.thumbnailLink),
          sourceUrl,
          title,
          provider: host,
          score,
          query: q
        });

        if (out.length >= desired) break;
      }

      if (out.length >= desired) break;
    }

    // If still empty, return debug + hint (but don’t crash UI)
    return res.status(200).json({
      images: out,
      source: "google-cse",
      debug: {
        version: "moodboard-v18-SSENSE-EDITORIAL-BLOCK-SITEGROUP",
        prompt,
        sites,
        queries,
        totalCandidates: out.length,
        domainsUsed
      }
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Unexpected error" });
  }
}
