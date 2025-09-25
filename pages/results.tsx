// pages/results.tsx
import { useEffect, useState } from "react";

type ImageResult = {
  imageUrl: string;
  sourceUrl: string;
  title: string;
  thumbnailUrl?: string;
  provider?: string;
};

export default function Results() {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [images, setImages] = useState<ImageResult[]>([]);

  // Read ?q= from URL and auto-run
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const q0 = (p.get("q") || "").trim();
    setQ(q0);
    if (q0) run(q0);
  }, []);

  async function run(input: string) {
    setError("");
    setImages([]);
    setLoading(true);
    try {
      // 1) Parse free text to intent
      const parsedRes = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: input }),
      });
      const { parsed, error: perr } = await parsedRes.json();
      if (perr) throw new Error(perr);

      // 2) Query moodboard with intent (base + per-garment)
      const moodRes = await fetch("/api/moodboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: parsed?.event,
          mood: parsed?.mood,
          style: parsed?.style,
          gender: parsed?.gender,
          items: parsed?.items || [],
          target: 24,
        }),
      });

      const data = await moodRes.json();
      if (data?.error) throw new Error(data.error);
      setImages(data.images || []);
    } catch (e: any) {
      setError(e?.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const newQ = q.trim();
    if (!newQ) return;
    const url = new URL(window.location.href);
    url.searchParams.set("q", newQ);
    window.history.replaceState(null, "", url.toString());
    run(newQ);
  }

  return (
    <main style={{ padding: "2rem", fontFamily: "Inter, system-ui, sans-serif", maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: 36, margin: "0 0 1rem" }}>
        Get Styled <span style={{ fontSize: 28 }}>✨</span>
      </h1>

      <form onSubmit={onSubmit} style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder='Try: "oversized japanese streetwear summer pants"'
          style={{
            flex: 1,
            padding: "12px 14px",
            border: "1px solid #ddd",
            borderRadius: 8,
            fontSize: 16,
          }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: "12px 18px",
            borderRadius: 8,
            border: "0",
            background: "#111",
            color: "#fff",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      <p style={{ color: "#666", marginBottom: 24 }}>
        Tip: keep it short — e.g. <em>“dinner minimal unisex”</em> or <em>“black denim workwear”</em>
      </p>

      <h3 style={{ margin: "18px 0" }}>Outfit Moodboard</h3>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {!error && loading && <p>Loading…</p>}
      {!error && !loading && images.length === 0 && <p>No images yet.</p>}

      {images.length > 0 && (
        <div
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            alignItems: "start",
          }}
        >
          {images.map((img, i) => (
            <a
              key={i}
              href={img.sourceUrl || img.imageUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "block",
                borderRadius: 12,
                overflow: "hidden",
                border: "1px solid #eee",
                background: "#fafafa",
              }}
              title={img.title}
            >
              <img
                src={img.imageUrl}
                alt={img.title || `look ${i + 1}`}
                loading="lazy"
                style={{
                  width: "100%",
                  height: 260,
                  objectFit: "cover",     // prevents overflow of huge images
                  display: "block",
                }}
              />
              <div style={{ padding: "8px 10px", fontSize: 12, color: "#666" }}>
                {img.provider || new URL(img.sourceUrl || img.imageUrl).hostname.replace(/^www\./, "")}
              </div>
            </a>
          ))}
        </div>
      )}
    </main>
  );
}
