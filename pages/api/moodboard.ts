// pages/api/moodboard.ts
import type { NextApiRequest, NextApiResponse } from "next";

const VERSION = "moodboard-v20-WEB-FALLBACK-2026-02-01";

/**
 * REQUIRED ENV VARS on Vercel:
 * - GOOGLE_CSE_API_KEY
 * - GOOGLE_CSE_CX
 */

type Gender = "men" | "women" | "unisex";

type ImageResult = {
  imageUrl: string;
  thumbnailUrl?: string;
  sourceUrl: string;
  title?: string;
  provider?: string;
  category?: string;
  score?: number;
  query?: string;
};

type Candidate = ImageResult & {
  _host: string;
  _q: string;
};

const DEFAULT_SITES = [
  "ssense.com",
  "yoox.com",
  "neimanmarcus.com",
  "ourlegacy.com",
  "moncler.com",
  "louisvuitton.com",
  "bottegaveneta.com",
  "us.supreme.com",
];

/**
 * If you want to FULLY block Farfetch, keep true.
 * If you want it allowed as a LAST resort, set false.
 */
const BLOCK_FARFETCH = true;

const HARD_BLOCK_HOSTS = new Set<string>([
  ...(BLOCK_FARFETCH ? ["farfetch.com"] : []),
]);

/**
 * URLs we DO NOT want (SSENSE editorial etc).
 * We also exclude “guide / editorial / blog / magazine” type content from any site.
 */
const URL_EXCLUDE_REGEX = new RegExp(
  [
    "/editorial/",
    "/market/",
    "/magazine/",
    "/blog/",
    "/stories/",
    "/journal/",
    "/press/",
    "/campaign/",
    "/lookbook/",
    "/guide",
    "utm_",
  ].join("|"),
  "i"
);

const TITLE_EXCLUDE_REGEX = new RegExp(
  [
    "editorial",
    "guide",
    "market",
    "magazine",
    "journal",
    "blog",
    "stories",
    "lookbook",
    "press",
    "campaign",
  ].join("|"),
  "i"
);

function safeString(x: any): string {
  return typeof x === "string" ? x : "";
}

function normalizeHost(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function uniqStrings(arr: string[]) {
  return Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)));
}

function pickGender(req: NextApiRequest): Gender {
  const g =
    safeString(req.query.gender) ||
    safeString((req.body as any)?.gender) ||
    "men";
  const gl = g.toLowerCase();
  if (gl === "women") return "women";
  if (gl === "unisex") return "unisex";
  return "men";
}

function readPrompt(req: NextApiRequest): string {
  // Accept GET or POST
  const fromQuery = safeString(req.query.prompt);
  const fromBody = safeString((req.body as any)?.prompt);
  const prompt = (fromQuery || fromBody || "").trim();
  return prompt;
}

function readSites(req: NextApiRequest): string[] {
  const qSites = safeString(req.query.sites);
  const bSites = (req.body as any)?.sites;

  let sites: string[] = [];

  if (qSites) {
    sites = qSites.split(",").map((s) => s.trim());
  } else if (Array.isArray(bSites)) {
    sites = bSites.map((s) => String(s).trim());
  } else {
    sites = DEFAULT_SITES.slice();
  }

  // normalize hostnames
  sites = sites
    .map((s) => s.replace(/^https?:\/\//, ""))
    .map((s) => s.replace(/^www\./, ""))
    .map((s) => s.split("/")[0])
    .map((s) => s.toLowerCase())
    .filter(Boolean);

  return uniqStrings(sites);
}

function buildQueries(prompt: string, gender: Gender): string[] {
  // Prompt-driven. No hardcoded “chelsea boots” nonsense.
  // We keep it simple and high-signal, because over-complicating kills retrieval.
  const who =
    gender === "women" ? "women" : gender === "unisex" ? "unisex" : "men";
  const p = prompt.trim();

  const base = [
    `${who} ${p}`,
    `${who} ${p} shoes`,
    `${who} ${p} boots`,
    `${who} ${p} outfit`,
    `${who} ${p} jacket`,
    `${who} ${p} trousers`,
  ];

  return uniqStrings(base).slice(0, 6);
}

function shouldRejectCandidate(c: Candidate): boolean {
  if (!c.sourceUrl || !c.imageUrl) return true;

  const host = (c._host || "").toLowerCase();
  if (HARD_BLOCK_HOSTS.has(host)) return true;

  if (URL_EXCLUDE_REGEX.test(c.sourceUrl)) return true;
  if (c.title && TITLE_EXCLUDE_REGEX.test(c.title)) return true;

  // Avoid obvious non-product/editorial garbage
  if (c.sourceUrl.includes("/editorial/")) return true;

  return false;
}

async function googleCseImageSearch(q: string): Promise<any> {
  const key = process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_CX;
  if (!key || !cx) {
    throw new Error("Missing GOOGLE_CSE_API_KEY or GOOGLE_CSE_CX");
  }

  const params = new URLSearchParams({
    key,
    cx,
    q,
    searchType: "image",
    num: "10",
    safe: "active",
  });

  const url = `https://www.googleapis.com/customsearch/v1?${params.toString()}`;

  const r = await fetch(url);
  const status = r.status;
  const text = await r.text();

  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (!r.ok) {
    const err = new Error(`CSE error ${status}`);
    (err as any).status = status;
    (err as any).payload = json;
    throw err;
  }

  return json;
}

function extractCandidates(json: any, q: string): Candidate[] {
  const items = Array.isArray(json?.items) ? json.items : [];
  const out: Candidate[] = [];

  for (const it of items) {
    const imageUrl = safeString(it?.link);
    const sourceUrl = safeString(it?.image?.contextLink) || safeString(it?.image?.thumbnailLink);
    const thumb = safeString(it?.image?.thumbnailLink);
    const title = safeString(it?.title);
    const host = normalizeHost(sourceUrl);

    if (!imageUrl || !sourceUrl || !host) continue;

    out.push({
      imageUrl,
      thumbnailUrl: thumb || undefined,
      sourceUrl,
      title: title || undefined,
      provider: host,
      category: undefined,
      score: 0,
      query: q,
      _host: host,
      _q: q,
    });
  }

  return out;
}

function rankCandidates(cands: Candidate[], prompt: string): Candidate[] {
  const p = prompt.toLowerCase();

  // simple lexical scoring
  for (const c of cands) {
    let s = 0;
    const t = (c.title || "").toLowerCase();
    const u = (c.sourceUrl || "").toLowerCase();

    // reward if prompt words appear in title/url
    for (const w of p.split(/\s+/).filter(Boolean)) {
      if (w.length <= 2) continue;
      if (t.includes(w)) s += 3;
      if (u.includes(w)) s += 2;
    }

    // prefer product-y urls
    if (u.includes("/product") || u.includes("/products") || u.includes("/shop")) s += 4;

    // avoid editorial-ish even if it slipped through
    if (URL_EXCLUDE_REGEX.test(u)) s -= 20;

    c.score = s;
  }

  return cands.sort((a, b) => (b.score || 0) - (a.score || 0));
}

function dedupeAndLimit(cands: Candidate[], limit: number): ImageResult[] {
  const seen = new Set<string>();
  const out: ImageResult[] = [];

  for (const c of cands) {
    const key = `${c.sourceUrl}::${c.imageUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      imageUrl: c.imageUrl,
      thumbnailUrl: c.thumbnailUrl,
      sourceUrl: c.sourceUrl,
      title: c.title,
      provider: c.provider,
      category: c.category,
      score: c.score,
      query: c.query,
    });

    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Build a query that prefers sites but DOESN'T hard-restrict
 * (so you still get results if sites have weak indexing).
 */
function preferSitesQuery(baseQ: string, sites: string[]): string {
  if (!sites.length) return baseQ;

  // Prefer sites by adding them as soft terms, not site: filters
  // (site: filters are too strict and often return 0)
  const siteHints = sites.slice(0, 6).map((s) => `"${s}"`).join(" OR ");
  return `${baseQ} (${siteHints})`;
}

/**
 * If site-preferred search returns 0, we fallback to pure web search:
 * remove site hints entirely.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const started = Date.now();

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const prompt = readPrompt(req);
  const gender = pickGender(req);
  const sites = readSites(req);
  const desired = clamp(Number(req.query.desired || (req.body as any)?.desired || 18), 1, 30);

  // If your UI calls on page load, this will expose the bug immediately.
  if (!prompt) {
    return res.status(400).json({
      images: [],
      source: "google-cse",
      debug: {
        version: VERSION,
        error: "EMPTY_PROMPT",
        received: {
          method: req.method,
          queryPrompt: safeString(req.query.prompt),
          bodyPrompt: safeString((req.body as any)?.prompt),
        },
        note: "Your frontend is calling /api/moodboard without a prompt. Only call after user hits Generate.",
      },
    });
  }

  const baseQueries = buildQueries(prompt, gender);

  const debug: any = {
    version: VERSION,
    prompt,
    gender,
    sites,
    queries: baseQueries,
    totalCandidates: 0,
    domainsUsed: {} as Record<string, number>,
    usedWebFallback: false,
    farfetchBlocked: BLOCK_FARFETCH,
    ms: 0,
  };

  const all: Candidate[] = [];

  // 1) Try “site-preferred” (soft preference, not hard filters)
  for (const q0 of baseQueries) {
    const q = preferSitesQuery(q0, sites);

    try {
      const json = await googleCseImageSearch(q);
      const cands = extractCandidates(json, q0);

      for (const c of cands) {
        if (shouldRejectCandidate(c)) continue;
        all.push(c);
      }
    } catch (e: any) {
      // If CSE rate limits, surface it clearly
      const status = e?.status;
      if (status === 429) {
        debug.rateLimited429 = true;
        break;
      }
      debug.lastError = { status, message: String(e?.message || e) };
    }
  }

  // 2) If we got nothing, fallback to entire web (this is what makes it reliably WORK)
  if (all.length === 0 && !debug.rateLimited429) {
    debug.usedWebFallback = true;

    for (const q0 of baseQueries) {
      const q = q0; // no site hints at all

      try {
        const json = await googleCseImageSearch(q);
        const cands = extractCandidates(json, q0);

        for (const c of cands) {
          if (shouldRejectCandidate(c)) continue;
          all.push(c);
        }
      } catch (e: any) {
        const status = e?.status;
        if (status === 429) {
          debug.rateLimited429 = true;
          break;
        }
        debug.lastError = { status, message: String(e?.message || e) };
      }
    }
  }

  // Domain counts
  for (const c of all) {
    debug.domainsUsed[c._host] = (debug.domainsUsed[c._host] || 0) + 1;
  }

  debug.totalCandidates = all.length;

  const ranked = rankCandidates(all, prompt);
  const images = dedupeAndLimit(ranked, desired);

  debug.ms = Date.now() - started;

  return res.status(200).json({
    images,
    source: "google-cse",
    debug,
  });
}
