import { useRouter } from "next/router";
import { useEffect, useState } from "react";

export default function ResultsPage() {
  const router = useRouter();
  const { event, vibe, budget, palette } = router.query;

  const [outfits, setOutfits] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!event || !vibe || !budget || !palette) return;

    async function fetchOutfits() {
      const res = await fetch(`/api/curate?event=${event}&vibe=${vibe}&budget=${budget}&palette=${palette}`);
      const data = await res.json();
      setOutfits(data.outfits || []);
      setLoading(false);
    }

    fetchOutfits();
  }, [event, vibe, budget, palette]);

  if (loading) return <p>Loading outfits...</p>;

  return (
    <div style={{ padding: "2rem" }}>
      <h1>Your Curated Looks</h1>
      <ul>
        {outfits.map((o, i) => (
          <li key={i}>{o}</li>
        ))}
      </ul>
    </div>
  );
}
