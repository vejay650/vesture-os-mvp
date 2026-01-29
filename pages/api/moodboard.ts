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
  const s = (hay || "").toLowerCase();
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

function looksProductLike(urlStr: string) {
  const u = (urlStr || "").toLowerCase();
  return (
    u.indexOf("/product") !== -1 ||
    u.indexOf("/products") !== -1 ||
    u.indexOf("/p/") !== -1 ||
    u.indexOf("/item") !== -1 ||
    u.indexOf("/shop") !== -1 ||
    u.indexOf("/dp/") !== -1 ||
    u.indexOf("/sku") !== -1 ||
    u.indexOf("?sku") !== -1
  );
}

function getRetailerSites(): string[] {
  const env = clean(process.env.RETAILER_SITES || "");
  if (env) {
    return env
      .split(",")
      .map(normHost)
      .filter(Boolean)
      .filter((x) => x !== "farfetch.com");
  }
  return ["ssense.com", "yoox.com", "neimanmarcus.com"];
}

function buildSiteQuery(prompt: string, gender: string, site: string) {
  const g = gender ? gender : "men";
  const p = prompt || "date night outfit";
  const negatives =
    "-editorial -guide -market -magazine -journal -blog -stories -lookbook -press -campaign";
  const inurlNeg =
    "-inurl:editorial -inurl:guide -inurl:market -inurl:magazine -inurl:blog -inurl:stories -inurl:lookbook -inurl:press -inurl:campaign";

  return `${g} ${p} product ${negatives} ${inurlNeg} site:${site}`.trim();
}

async function googleImageSearch(q: string, key: string, cx: string, start: number): Promise<any[]> {
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("q", q);
  url.searchParams.set("cx", cx);
  url.searchParams.set("key", key);
  url.searchParams.set("searchType", "image");
  url.searchParams.set("num", "10");
  url.searchParams.set("start", String(start));
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

    const prompt =
      clean((req.query.q as any) || (req.body && (req.body as any).q) || "");
    const gender =
      clean((req.query.gender as any) || (req.body && (req.body as any).gender) || "men");
    const desiredRaw =
      Number((req.query.count as any) || (req.body && (req.body as any).count) || 18);
    const desired = Math.min(Math.max(isFinite(desiredRaw) ? desiredRaw : 18, 6), 24);

    const sites = getRetailerSites();

    // 3 prompt variants (keeps it “smart” without hardcoding chelsea boots etc.)
    const base = prompt || "black minimal date night boots";
    const variants = [base, base + " shoes", base + " outfit"];

    const seen = new Set<string>();
    const out: ImageResult[] = [];
    const domainsUsed: { [k: string]: number } = {};
    const debugFetch: any = {};

    // hard cap per domain so nothing dominates
    const perDomainCap = 4;

    // SITE-BY-SITE search (best reliability)
    for (let vi = 0; vi < variants.length; vi++) {
      const vPrompt = variants[vi];

      for (let si = 0; si < sites.length; si++) {
        const site = sites[si];
        const q = buildSiteQuery(vPrompt, gender, site);

        // try first 2 pages (start=1, start=11)
        const starts = [1, 11];
        for (let pi = 0; pi < starts.length; pi++) {
          const start = starts[pi];
          const items = await googleImageSearch(q, key, cx, start);

          debugFetch[q] = debugFetch[q] || { pages: 0, itemsSeen: 0 };
          debugFetch[q].pages += 1;
          debugFetch[q].itemsSeen += items.length;

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

            // must match this site (or its subdomains)
            const sHost = normHost(site);
            if (!(host === sHost || host.endsWith("." + sHost) || host.indexOf(sHost) !== -1)) {
              continue;
            }

            if (isBlockedPage(sourceUrl, title)) continue;

            const domainCount = domainsUsed[host] || 0;
            if (domainCount >= perDomainCap) continue;

            const k = sourceUrl + "::" + imageUrl;
            if (seen.has(k)) continue;
            seen.add(k);

            let score = 10;
            if (looksProductLike(sourceUrl)) score += 12;
            score -= vi; // prefer base prompt variant
            score -= pi; // prefer earlier page

            domainsUsed[host] = domainCount + 1;

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

        if (out.length >= desired) break;
      }

      if (out.length >= desired) break;
    }

    // sort by score, stable-ish
    out.sort(function (a, b) {
      return (b.score || 0) - (a.score || 0);
    });

    return res.status(200).json({
      images: out,
      source: "google-cse",
      debug: {
        version: "moodboard-v19-SITE-BY-SITE-RELIABLE",
        prompt,
        gender,
        sites,
        variants,
        totalCandidates: out.length,
        domainsUsed,
        fetch: debugFetch
      }
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Unexpected error" });
  }
}
