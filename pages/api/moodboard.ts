// pages/api/moodboard.ts
import type { NextApiRequest, NextApiResponse } from "next";

/** ---------- Types ---------- */
type ImageResult = {
  imageUrl: string;
  sourceUrl: string;
  title: string;
  thumbnailUrl?: string;
  provider?: string; // host
};

type Candidate = {
  title: string;
  link: string; // product/page url
  img: string;  // image url
  host: string; // normalized host
};

/** ---------- Small helpers ---------- */
const cleanUrl = (s: string) => (s || "").trim();
const normHost = (h: string) => h.replace(/^www\./i, "").toLowerCase();
const containsAny = (hay: string, needles: string[]) =>
  needles.some((n) => hay.includes(n.toLowerCase()));

/** ---------- Heuristics / vocab ---------- */
const EXCLUDE_INURL = [
  "/kids/",
  "/girls/",
  "/boys/",
  "/help/",
  "/blog/",
  "/story/",
  "/stories/",
  "/lookbook",
  "/press/",
  "/account/",
  "/privacy",
  "/terms",
  "size-guide",
  "guide",
  "policy",
];

const EXCLUDE_TERMS = [
  "kids",
  "toddler",
  "boy",
  "girl",
  "baby",
  "jogger",
  "sweats",
  "hoodie",
  "sweatshirt",
];

const BLOCKED_DOMAINS = [
  "pinterest.",
  "pinimg.com",
  "twitter.",
  "x.com",
  "facebook.",
  "reddit.",
  "tumblr.",
  "wikipedia.",
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
  const parts = [event, mood, style, gender].filter(Boolean);
  let q = (parts.join(" ") || "outfit").trim();
  if (brands?.length) q += " " + brands.join(" ");
  // a tiny nudge toward commercial results
  q += " outfit -pinterest -review -editorial";
  return q;
}

/** ---------- Google CSE (image) search ---------- */
async function googleImageSearch(
  q: string,
  count: number,
  key: string,
  cx: string
): Promise<any[]> {
  // Google caps num=10 per request; paginate if you ask for >10
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

    const res = await fetch(url.toString());
    if (!res.ok) {
      // Return what we have if Google rate-limits temporarily
      break;
    }
    const data = await res.json();
    const items = (data?.items || []) as any[];
    results.push(...items);
    if (!items.length) break;
    start += items.length;
  }
  return results;
}

/** ---------- Next API handler ---------- */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { event, mood, style, gender, brands, count = 18, q } = req.method === "POST"
      ? (req.body || {})
      : (req.query || {});

    // 0) ENV checks
    const key = process.env.GOOGLE_CSE_KEY || "";
    const cx = process.env.GOOGLE_CSE_ID || "";
    if (!key || !cx) {
      return res
        .status(500)
        .json({ error: "Missing GOOGLE_CSE_KEY or GOOGLE_CSE_ID. Add them in Vercel → Settings → Environment Variables." });
    }

    // 1) Allowed retailer hosts
    const siteList = (process.env.RETAILER_SITES || "")
      .split(",")
      .map((s) => normHost(s.trim()))
      .filter(Boolean);

    if (siteList.length === 0) {
      return res
        .status(500)
        .json({ error: "No retailer sites configured (RETAILER_SITES)" });
    }
    const siteSet = new Set(siteList);

    // 2) Build the query (either user `q`, or from event/mood/style/gender)
    const baseQ = cleanUrl(Array.isArray(q) ? q[0] : (q as string));
    const textQuery =
      baseQ && baseQ.length > 0
        ? `${baseQ} outfit`
        : buildTextQuery({ event, mood, style, gender, brands });

    // 3) Add site: filters so we only search your retailers
    const siteFilter = Array.from(siteSet)
      .map((s) => `site:${s}`)
      .join(" OR ");
    const finalQuery = `${textQuery} ${siteFilter}`;

    // 4) Call Google CSE (image) search
    const desired = Math.min(Math.max(Number(count) || 18, 6), 36);
    const items = await googleImageSearch(finalQuery, desired * 3, key, cx); // fetch more, we’ll filter

    // 5) Map raw items → candidates
    let candidates: Candidate[] = (items || [])
      .map((it: any): Candidate | null => {
        const img = cleanUrl(it?.link); // image url
        const ctx = cleanUrl(it?.image?.contextLink || it?.image?.context || it?.image?.source || it?.displayLink || "");
        const link = cleanUrl(ctx || it?.link); // page url (prefer context)
        const title = cleanUrl(it?.title || "");
        if (!img || !link) return null;
        try {
          const host = normHost(new URL(link).hostname);
          return { title, link, img, host };
        } catch {
          return null;
        }
      })
      .filter(Boolean) as Candidate[];

    /** =========================
     *  STRICT FILTER + RANK + DEDUPE
     *  ========================= */

    // A) Drop blocked domains, non-allowed hosts, noisy sections
    candidates = candidates.filter((c) => {
      if (!c.img || !c.link) return false;
      if (BLOCKED_DOMAINS.some((d) => c.host.includes(d))) return false;

      const allowed = Array.from(siteSet).some((s) => c.host === s || c.host.endsWith(s));
      if (!allowed) return false;

      const url = (c.link + "").toLowerCase();
      const title = (c.title + "").toLowerCase();
      if (containsAny(url, EXCLUDE_INURL)) return false;
      if (containsAny(title, EXCLUDE_TERMS)) return false;

      return true;
    });

    // B) Must-have tokens (derived from user words)
    const userWords = (baseQ || `${event || ""} ${mood || ""} ${style || ""} ${gender || ""}`)
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    const lcQuery = userWords.join(" ").toLowerCase();
    const vocab = [
      "jeans","denim","trousers","pants","skirt","dress","top","tee","t-shirt","shirt","blazer",
      "heels","boots","sneakers","loafer","sandal","bag","belt","scarf","accessories",
      "jacket","coat","cardigan","sweater"
    ];
    const colors = ["red","black","white","cream","beige","brown","blue","navy","green","grey","gray","pink","olive","khaki"];
    const MUST_TOKENS: string[] = [];
    for (const v of [...vocab, ...colors]) {
      if (lcQuery.includes(v)) MUST_TOKENS.push(v);
    }
    const isNightOut = /\b(night\s*out|evening|date\s*night)\b/i.test(lcQuery);

    const hasToken = (s: string, token: string) => s.includes(token.toLowerCase());
    const passMustTokensAll = (c: Candidate) => {
      if (MUST_TOKENS.length === 0) return true;
      const full = (c.title + " " + c.link).toLowerCase();
      return MUST_TOKENS.every((t) => hasToken(full, t));
    };
    const passMustTokensSome = (c: Candidate) => {
      if (MUST_TOKENS.length === 0) return true;
      const full = (c.title + " " + c.link).toLowerCase();
      return MUST_TOKENS.some((t) => hasToken(full, t));
    };

    // Try strict pass first; if too few, relax
    let filtered = candidates.filter(passMustTokensAll);
    if (filtered.length < Math.min(12, desired)) {
      filtered = candidates.filter(passMustTokensSome);
    }

    // C) Re-rank: product-like pages + tokens + night-out bias
    function fashionScore(c: Candidate) {
      const title = (c.title || "").toLowerCase();
      const url = (c.link || "").toLowerCase();
      let s = 0;
      // product semantics
      if (containsAny(url, ["product","products","collections","collection","catalog","item","p/"])) s += 8;

      // token hits
      for (const tok of MUST_TOKENS) if (tok && (title.includes(tok) || url.includes(tok))) s += 3;

      // night out bias
      if (isNightOut) {
        if (containsAny(title + url, ["hoodie","sweatshirt","sweatpants","jogger","tracksuit","fleece"])) s -= 6;
        if (containsAny(title + url, ["heel","stiletto","silk","satin","blazer","dress","tailor","slip"])) s += 4;
      }

      // small bump for curated retailers (edit to taste)
      if (containsAny(c.host, ["ssense","farfetch","matchesfashion","mrporter","endclothing","totokaelo"])) s += 2;

      return s;
    }
    filtered.sort((a, b) => fashionScore(b) - fashionScore(a));

    // D) De-duplicate by (page path + image filename)
    const seen = new Set<string>();
    const out: ImageResult[] = [];
    for (const c of filtered) {
      const pageKey = (() => {
        try {
          const u = new URL(c.link);
          return `${normHost(u.hostname)}${u.pathname.replace(/\/$/, "")}`;
        } catch { return cleanUrl(c.link); }
      })();
      const imgKey = (() => {
        try {
          const u = new URL(c.img);
          const fn = (u.pathname.split("/").pop() || u.pathname).toLowerCase();
          return fn.replace(/\.(webp|jpg|jpeg|png|gif|avif)$/, "");
        } catch { return c.img; }
      })();
      const key = `${pageKey}::${imgKey}`;
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({
        imageUrl: c.img,
        sourceUrl: c.link,
        title: c.title,
        provider: c.host,
      });
      if (out.length >= desired) break;
    }

    return res.status(200).json({
      query: finalQuery,
      images: out,
      source: "google-cse",
      page: { start: 1, count: out.length },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Unexpected error" });
  }
}
