import { useEffect, useState } from "react";

type Mode = "outfits" | "moodboard";

export default function Results() {
  const [mode, setMode] = useState<Mode>("outfits");

  // One-box query (used for both modes)
  const [query, setQuery] = useState("");

  // Parsed fields for outfits
  const [event, setEvent] = useState("");
  const [mood, setMood] = useState("");
  const [style, setStyle] = useState("");
  const [gender, setGender] = useState("");

  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // On first load: read URL (?mode=..., or old params, or ?q=)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const m = (p.get("mode") as Mode) || "outfits";
    setMode(m);

    const qParam = p.get("q") || "";
    if (qParam) {
      setQuery(qParam);
      if (m === "moodboard") runMoodboard(qParam);
      if (m === "outfits") runOutfits(qParam);
      return;
    }

    // Backward compatibility with old params
    const e = p.get("event") || "";
    const mo = p.get("mood") || "";
    const st = p.get("style") || "";
    const g = p.get("gender") || "";
    const seed = [e, mo, st, g].filter(Boolean).join(", ");
    setQuery(seed);

    if (m === "moodboard" && seed) runMoodboard(seed);
    if (m === "moodboard" && !seed) runMoodboard("lookbook, minimal, streetwear, unisex");
  }, []);

  async function runOutfits(q: string) {
    setLoading(true);
    setError("");
    setSuggestions([]);

    try {
      // 1) Parse the natural text into fields
      const parseRes = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q }),
      });
      const parsed = await parseRes.json();
      if (parsed?.error) throw new Error(parsed.error);

      setEvent(parsed.event || "");
      setMood(parsed.mood || "");
      setStyle(parsed.style || "");
      setGender(parsed.gender || "unisex");

      // 2) Call curate with normalized fields
      const res = await fetch("/api/curate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: parsed.event,
          mood: parsed.mood,
          style: parsed.style,
          gender: parsed.gender,
        }),
      });
      const data = await res.json();
      if (data?.error) setError(data.error);
      else setSuggestions(data.suggestions || []);
    } catch (err: any) {
      setError(err?.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function runMoodboard(q: string) {
    setLoading(true);
    setError("");
    setImageUrls([]);
    try {
      const res = await fetch("/api/moodboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q, count: 12 }),
      });
      const data = await res.json();
      if (data?.error) setError(data.error);
      const imgs = (data?.images || []).map((it: any) => it.imageUrl);
      setImageUrls(imgs);
    } catch {
      setError("Failed to reach server.");
    } finally {
      setLoading(false);
    }
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    if (mode === "outfits") return runOutfits(query);
    return runMoodboard(query);
  }

  return (
    <main
      style={{
        padding: "2rem",
        fontFamily: "sans-serif",
        maxWidth: 920,
        margin: "0 auto",
      }}
    >
      <h1 style={{ marginBottom: "1rem" }}>Get Styled ✨</h1>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          onClick={() => setMode("outfits")}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid #ddd",
            background: mode === "outfits" ? "#111" : "#fff",
            color: mode === "outfits" ? "#fff" : "#111",
            cursor: "pointer",
          }}
        >
          Outfits
        </button>
        <button
          onClick={() => setMode("moodboard")}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid #ddd",
            background: mode === "moodboard" ? "#111" : "#fff",
            color: mode === "moodboard" ? "#fff" : "#111",
            cursor: "pointer",
          }}
        >
          Moodboard
        </button>
      </div>

      {/* One search bar */}
      <form onSubmit={handleSearch} style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          type="text"
          placeholder="e.g. dinner, minimal, japanese workwear, unisex"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, padding: "12px", borderRadius: 8, border: "1px solid #ddd" }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: "12px 16px",
            borderRadius: 8,
            background: "#111",
            color: "#fff",
            border: "none",
            cursor: "pointer",
            minWidth: 120,
          }}
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {error && <p style={{ color: "red", marginBottom: 16 }}>{error}</p>}

      {/* Outfits (text) */}
      {mode === "outfits" && (
        <>
          {suggestions.length > 0 && (
            <section style={{ marginTop: "1rem" }}>
              <h3>Suggested Outfits</h3>
              <ol style={{ paddingLeft: "1.25rem", lineHeight: 1.6 }}>
                {suggestions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </section>
          )}
        </>
      )}

      {/* Moodboard (images) */}
      {mode === "moodboard" && (
        <section style={{ marginTop: "1rem" }}>
          {imageUrls.length === 0 && !loading && !error && <p>No images yet — try a broader phrase.</p>}
          {imageUrls.length > 0 && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                gap: 16,
              }}
            >
              {imageUrls.map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt={`moodboard ${i + 1}`}
                  style={{ width: "100%", borderRadius: 10 }}
                  referrerPolicy="no-referrer"
                />
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
