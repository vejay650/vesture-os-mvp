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

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY!;
const GOOGLE_CSE_ID = process.env.GOOGLE_CSE_ID!;

// 🚨 Launch retailer allowlist — real product sites only
const RETAILER_SITES = [
  "ssense.com",
  "yoox.com",
  "neimanmarcus.com",
  "ourlegacy.com",
  "moncler.com",
  "louisvuitton.com",
  "bottegaveneta.com"
];

// ❌ Kill editorial/blog/junk
const NEGATIVE_KEYWORDS =
  "-editorial -guide -market -magazine -journal -blog -stories -lookbook -press -campaign";

function buildQueries(prompt: string, gender: string) {
  const p = prompt.toLowerCase().trim();
  const g = gender || "men";

  const queries: string[] = [];

  // Anchor product search
  queries.push(`${g} ${p} product ${NEGATIVE_KEYWORDS}`);

  // Shoes / footwear
  if (p.includes("boot") || p.includes("shoe")) {
    queries.push(`${g} ${p} footwear buy ${NEGATIVE_KEYWORDS}`);
  }

  // Pants / trousers
  queries.push(`${g} minimal trousers ${NEGATIVE_KEYWORDS}`);
  queries.push(`${g} tailored pants date night ${NEGATIVE_KEYWORDS}`);

  // Tops
  queries.push(`${g} clean button-up shirt ${NEGATIVE_KEYWORDS}`);
  queries.push(`${g} minimal black shirt ${NEGATIVE_KEYWORDS}`);

  // Outerwear
  queries.push(`${g} lightweight jacket date night ${NEGATIVE_KEYWORDS}`);

  // Accessories
  queries.push(`${g} leather belt minimal ${NEGATIVE_KEYWORDS}`);
  queries.push(`${g} minimalist watch ${NEGATIVE_KEYWORDS}`);

  return Array.from(new Set(queries)).slice(0, 8);
}

async function fetchImages(q: string) {
  const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(
    q
  )}&cx=${GOOGLE_CSE_ID}&key=${GOOGLE_API_KEY}&searchType=image&num=10`;

  const res = await fetch(url);
  const data = await res.json();

  if (!data.items) return [];

  return data.items.map((item: any) => ({
    imageUrl: item.link,
    thumbnailUrl: item.image?.thumbnailLink,
    sourceUrl: item.image?.contextLink || item.link,
    title: item.title,
    provider: new URL(item.image?.contextLink || item.link).hostname,
    score: 0,
    query: q
  }));
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const prompt = (req.query.q as string) || "minimal date night outfit";
  const gender = (req.query.gender as string) || "men";

  const queries = buildQueries(prompt, gender);

  const results: ImageResult[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    const batch = await fetchImages(q);

    for (let j = 0; j < batch.length; j++) {
      const img = batch[j];

      const domain = img.provider || "";
      if (!RETAILER_SITES.some(site => domain.includes(site))) continue;

      const key = img.sourceUrl + "::" + img.imageUrl;
      if (seen.has(key)) continue;

      seen.add(key);
      img.score = 10 - i;
      results.push(img);

      if (results.length >= 18) break;
    }

    if (results.length >= 18) break;
  }

  res.status(200).json({
    images: results,
    source: "google-cse",
    debug: {
      version: "moodboard-v18-LAUNCH-STABLE",
      prompt,
      queries,
      totalCandidates: results.length,
      domainsUsed: [...new Set(results.map(r => r.provider))]
    }
  });
}
