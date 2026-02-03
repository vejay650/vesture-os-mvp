import type { NextApiRequest, NextApiResponse } from "next";

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

type CseItem = {
  title?: string;
  link?: string;
  displayLink?: string;
  image?: { thumbnailLink?: string; contextLink?: string };
};

function nowISO() {
  return new Date().toISOString().slice(0, 19);
}

function normalizeDomain(input: string): string {
  return (input || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
}

/**
 * Repairs accidental concatenation:
 *  "yoox.comneimanmarcus.com" -> "yoox.com,neimanmarcus.com"
 */
function repairConcatenatedDomains(raw: string): string {
  const s = (raw || "").trim();
  if (!s) return s;
  return s.replace(
    /(\.(?:com|net|org|co|us|io|shop|store|edu|gov))(?=[a-z0-9])/gi,
    "$1,"
  );
}

function parseSites(raw: string): string[] {
  const repaired = repairConcatenatedDomains(raw);
  const parts = repaired
    .split(/[,\n\r\t ]+/g) // comma, newline, whitespace
    .map((x) => normalizeDomain(x))
    .filter(Boolean);

  return Array.from(new Set(parts));
}

function getEnvFirst(...keys: string[]): string {
  for (const k of keys) {
    const v = process.env[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  return "";
}

function looksEditorial(url: string): boolean {
  const u = (url || "").toLowerCase();
  // SSENSE & others often return editorial pages with images
  const bad = [
    "/editorial",
    "/market",
    "/guide",
    "/magazine",
    "/journal",
    "/blog",
    "/stories",
    "/lookbook",
    "/press",
    "/campaign",
  ];
  return bad.some((b) => u.includes(b));
}

function categoryFromQuery(q: string): string {
  const s = (q || "").toLowerCase();
  if (s.includes("boot") || s.includes("shoe") || s.includes("loafer") || s.includes("sneaker")) return "shoes";
  if (s.includes("trouser") || s.includes("pants") || s.includes("jean") || s.includes("chino")) return "bottoms";
  if (s.includes("shirt") || s.includes("tee") || s.includes("t-shirt") || s.includes("top") || s.includes("button-up")) return "tops";
  if (s.includes("jacket") || s.includes("coat") || s.includes("outerwear") || s.includes("bomber")) return "outerwear";
  if (s.includes("belt") || s.includes("watch") || s.includes("bag") || s.includes("sunglasses")) return "accessories";
  return "other";
}

async function fetchCSEImages(params: {
  apiKey: string;
  cx: string;
  q: string;
  start?: number;
  num?: number;
}): Promise<CseItem[]> {
  const { apiKey, cx, q } = params;
  const start = params.start ?? 1;
  const num = Math.min(Math.max(params.num ?? 10, 1), 10);

  const url =
    `https://www.googleapis.com/customsearch/v1` +
    `?key=${encodeURIComponent(apiKey)}` +
    `&cx=${encodeURIComponent(cx)}` +
    `&searchType=image` +
    `&safe=active` +
    `&num=${num}` +
    `&start=${start}` +
    `&q=${encodeURIComponent(q)}`;

  const r = await fetch(url);
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    const err = new Error(`CSE ${r.status}: ${text.slice(0, 200)}`);
    // @ts-ignore
    err.status = r.status;
    throw err;
  }

  const json = (await r.json()) as { items?: CseItem[] };
  return Array.isArray(json.items) ? json.items : [];
}

function buildQueries(prompt: string, gender: string): string[] {
  const p = (prompt || "").trim();
  if (!p) return [];

  // Prompt-driven, but gently nudged into “product” intent
  const base = `${gender} ${p}`.trim();

  // Keep it simple & targeted. The “boots” prompt will still return pants/shirts via these.
  const qs = [
    `${base} boots`,
    `${base} shoes`,
    `${base} trousers`,
    `${base} button-up shirt`,
    `${base} jacket`,
    `${base} leather belt`,
    `${base} watch`,
  ];

  // Dedup and trim
  return Array.from(new Set(qs.map((x) => x.trim()).filter(Boolean)));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const t0 = Date.now();

  // Accept your existing env var names (you showed these in Vercel):
  const apiKey = getEnvFirst(
    "GOOGLE_CSE_API_KEY",
    "GOOGLE_CSE_KEY",
    "GOOGLE_API_KEY"
  );
  const cx = getEnvFirst(
    "GOOGLE_CSE_CX",
    "GOOGLE_CSE_ID",
    "GOOGLE_CX"
  );

  const prompt = String(req.query.prompt ?? "").trim();
  const gender = String(req.query.gender ?? "men").trim() || "men";

  const desired = Math.min(Math.max(Number(req.query.desired ?? 18), 1), 48);
  const perDomainCap = Math.min(Math.max(Number(req.query.perDomainCap ?? 3), 1), 10);

  const rawSites = getEnvFirst("RETAILER_SITES");
  const sites = parseSites(rawSites);
  const allowFarfetch = String(getEnvFirst("ALLOW_FARFETCH") || "").toLowerCase() === "true";

  const debug: any = {
    version: "moodboard-v22-RESILIENT-ENV-ALLOWLIST-2026-02-02",
    ts: nowISO(),
    prompt,
    gender,
    desired,
    perDomainCap,
    sites,
    queries: [] as string[],
    totalCandidates: 0,
    totalDeduped: 0,
    domainCounts: {} as Record<string, number>,
    categoryCounts: {} as Record<string, number>,
    allowlistRelaxed: false,
    farfetchBlocked: !allowFarfetch,
    ms: 0,
    envOk: { hasKey: !!apiKey, hasCx: !!cx },
    lastError: null as any,
  };

  try {
    if (!apiKey || !cx) {
      res.status(200).json({
        images: [],
        source: "google-cse",
        debug: { ...debug, lastError: { message: "Missing GOOGLE key or CX. Check GOOGLE_CSE_KEY + GOOGLE_CSE_ID (or GOOGLE_CX)." } },
      });
      return;
    }

    const queries = buildQueries(prompt, gender);
    debug.queries = queries;

    if (!queries.length) {
      res.status(200).json({ images: [], source: "google-cse", debug });
      return;
    }

    // We’ll collect candidates first.
    const candidates: ImageResult[] = [];
    const fetchMeta: Record<string, any> = {};

    // Pull 2 pages per query (20 images max per query)
    for (const q of queries) {
      fetchMeta[q] = { pages: 0, itemsSeen: 0, domains: {} as Record<string, number> };

      for (let page = 0; page < 2; page++) {
        const start = 1 + page * 10;
        let items: CseItem[] = [];
        try {
          items = await fetchCSEImages({ apiKey, cx, q, start, num: 10 });
        } catch (e: any) {
          debug.lastError = { message: String(e?.message || e) };
          // Keep going; we want partial results when possible.
          break;
        }

        fetchMeta[q].pages += 1;
        fetchMeta[q].itemsSeen += items.length;

        for (const it of items) {
          const link = String(it.link || it.image?.contextLink || "").trim();
          const img = String(it.link || "").trim(); // for image search, item.link is the image
          const provider = normalizeDomain(String(it.displayLink || ""));

          if (!img || !link) continue;

          // editorial blocker
          if (looksEditorial(link) || looksEditorial(img)) continue;

          // optional farfetch block
          if (!allowFarfetch && provider.includes("farfetch.com")) continue;

          fetchMeta[q].domains[provider] = (fetchMeta[q].domains[provider] || 0) + 1;

          candidates.push({
            imageUrl: img,
            thumbnailUrl: it.image?.thumbnailLink,
            sourceUrl: link,
            title: it.title,
            provider,
            category: categoryFromQuery(q),
            query: q,
            score: 0,
          });
        }
      }
    }

    debug.fetch = fetchMeta;
    debug.totalCandidates = candidates.length;

    // Dedup by (imageUrl OR sourceUrl)
    const seen = new Set<string>();
    const deduped: ImageResult[] = [];
    for (const c of candidates) {
      const k = `${c.imageUrl}::${c.sourceUrl}`;
      if (seen.has(k)) continue;
      seen.add(k);
      deduped.push(c);
    }
    debug.totalDeduped = deduped.length;

    // If allowlist exists but blocks everything, relax it (and tell you)
    const allowed = new Set(sites.map((s) => normalizeDomain(s)));
    const enforceAllowlist = allowed.size > 0;

    let filtered = deduped;
    if (enforceAllowlist) {
      filtered = deduped.filter((x) => allowed.has(normalizeDomain(x.provider || "")));
      if (filtered.length === 0 && deduped.length > 0) {
        // allowlist is probably malformed / too strict
        debug.allowlistRelaxed = true;
        filtered = deduped;
      }
    }

    // Per-domain cap + category balancing
    const domainCounts: Record<string, number> = {};
    const categoryCounts: Record<string, number> = {};
    const out: ImageResult[] = [];

    const pushIfOk = (c: ImageResult) => {
      const d = normalizeDomain(c.provider || "unknown");
      const cat = c.category || "other";

      const dCount = domainCounts[d] || 0;
      if (dCount >= perDomainCap) return false;

      // soft category balancing (don’t allow only 1 category to dominate)
      const catCount = categoryCounts[cat] || 0;
      if (out.length >= 6 && catCount >= Math.ceil(desired / 2)) return false;

      domainCounts[d] = dCount + 1;
      categoryCounts[cat] = catCount + 1;
      out.push(c);
      return true;
    };

    // Prefer items whose title/url contains prompt terms (simple heuristic)
    const terms = prompt
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((w) => w.length >= 4)
      .slice(0, 10);

    const scored = filtered.map((c) => {
      const hay = `${c.title || ""} ${c.sourceUrl} ${c.imageUrl}`.toLowerCase();
      let s = 0;
      for (const t of terms) if (hay.includes(t)) s += 2;
      // small preference for product-like urls
      if (/(product|prod|sku|item|p\/|\/products\/)/i.test(c.sourceUrl)) s += 2;
      c.score = s;
      return c;
    });

    scored.sort((a, b) => (b.score || 0) - (a.score || 0));

    for (const c of scored) {
      if (out.length >= desired) break;
      pushIfOk(c);
    }

    debug.domainCounts = domainCounts;
    debug.categoryCounts = categoryCounts;
    debug.ms = Date.now() - t0;

    res.status(200).json({
      images: out,
      source: "google-cse",
      debug,
    });
  } catch (e: any) {
    debug.ms = Date.now() - t0;
    debug.lastError = { message: String(e?.message || e) };
    res.status(200).json({ images: [], source: "google-cse", debug });
  }
}
