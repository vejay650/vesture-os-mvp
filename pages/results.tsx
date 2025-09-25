import { useEffect, useState } from "react";
import { useRouter } from "next/router";

type ImageItem = {
  imageUrl: string;
  sourceUrl?: string;
  title?: string;
  thumbnailUrl?: string;
  provider?: string;
};

export default function Results() {
  const router = useRouter();

  // one-field experience
  const [q, setQ] = useState("");
  const [images, setImages] = useState<ImageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // On first load: show the search bar with no demo.
  // If a q= is present in the URL, auto-run exactly that query once.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlQ = params.get("q") || "";
    setQ(urlQ);

    if (urlQ.trim()) {
      runMoodboard(urlQ.trim());
    }
  }, []);

  async function runMoodboard(query: string) {
    try {
      setLoading(true);
      setError("");
      setImages([]);

      const res = await fetch("/api/moodboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, count: 12 }),
      });

      const data = await res.json();
      if (!res.ok || data?.error) {
        setError(data?.error || "Failed to fetch images.");
        return;
      }
      setImages(data.images || []);
    } catch {
      setError("Failed to reach server.");
    } finally {
      setLoading(false);
    }
  }

  // Submit handler for the single search box
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = q.trim();
    if (!cleaned) return;
    // update URL (shareable) but do not reload page
    const next = new URL(window.location.href);
    next.searchParams.set("mode", "moodboard");
    next.searchParams.set("q", cleaned);
    window.history.replaceState({}, "", next.toString());
    runMoodboard(cleaned);
  };

  return (
    <main
      style={{
        padding: "2rem",
        fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        maxWidth: 1000,
        margin: "0 auto",
      }}
    >
      <h1 style={{ marginBottom: "1rem", fontSize: 32, fontWeight: 700 }}>
        Get Styled ✨
      </h1>

      {/* Always show the search bar */}
      <form onSubmit={onSubmit} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Describe a vibe or idea (e.g. “streetwear minimal japanese workwear unisex”)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{
            flex: 1,
            padding: "12px 14px",
            border: "1px solid #ddd",
            borderRadius: 10,
            fontSize: 14,
          }}
        />
        <button
          type="submit"
          disabled={loading || !q.trim()}
          style={{
            padding: "12px 16px",
            background: "#111",
            color: "#fff",
            border: "none",
            borderRadius: 10,
            cursor: loading || !q.trim() ? "not-allowed" : "pointer",
            fontWeight: 600,
          }}
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      <p style={{ color: "#666", marginBottom: 24 }}>
        Tip: keep it short — e.g. <i>“dinner minimal unisex”</i> or <i>“black denim workwear”</i>
      </p>

      <h3 style={{ margin: "8px 0 16px", fontSize: 18 }}>Outfit Moodboard</h3>

      {error && <p style={{ color: "red", marginTop: 8 }}>{error}</p>}
      {!error && !loading && images.length === 0 && (
        <p style={{ color: "#999" }}>Start with a search above — no demo images are auto-loaded.</p>
      )}

      {loading && <p>Loading…</p>}

      {images.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 16,
          }}
        >
          {images.map((it, i) => (
            <a
              key={i}
              href={it.sourceUrl || it.imageUrl}
              target="_blank"
              rel="noreferrer"
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <div
                style={{
                  width: "100%",
                  background: "#f6f6f6",
                  borderRadius: 12,
                  padding: 10,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: 320,
                }}
              >
                <img
                  src={it.imageUrl}
                  alt={it.title || `moodboard ${i + 1}`}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain", // ensure no overflow
                    borderRadius: 8,
                  }}
                  referrerPolicy="no-referrer"
                />
              </div>
              {it.provider && (
                <div style={{ marginTop: 6, fontSize: 12, color: "#777" }}>
                  {it.provider}
                </div>
              )}
            </a>
          ))}
        </div>
      )}
    </main>
  );
}
