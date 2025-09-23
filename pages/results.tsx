import { useRouter } from "next/router";
import { useEffect, useState } from "react";

type Mode = "outfits" | "moodboard";

export default function Results() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("outfits");
  const [event, setEvent] = useState("");
  const [mood, setMood] = useState("");
  const [style, setStyle] = useState("");
  const [gender, setGender] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [refs, setRefs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Handle manual form submit (for outfits)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuggestions([]);
    try {
      const res = await fetch("/api/curate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event, mood, style, gender }),
      });
      const data = await res.json();
      if (data?.error) setError(data.error);
      else setSuggestions(data.suggestions || []);
    } catch (err) {
      setError("Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  // Auto-run for moodboard if query params exist
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const m = (p.get("mode") as Mode) || "outfits";
    const e = p.get("event") || "";
    const mo = p.get("mood") || "";
    const st = p.get("style") || "";
    const g = p.get("gender") || "";
    setMode(m);
    setEvent(e);
    setMood(mo);
    setStyle(st);
    setGender(g);

    const hasParams = !!(e || mo || st || g);
    if (m === "moodboard" && hasParams) {
      setLoading(true);
      fetch("/api/moodboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: e, mood: mo, style: st, gender: g, count: 12 }),
      })
        .then((r) => r.json())
        .then((data) => {
          const imgs = (data?.images || []).map((it: any) => it.imageUrl);
          setImageUrls(imgs);
          setRefs((data?.images || []).map((it: any) => it.sourceUrl).slice(0, 6));
          if (data?.error) setError(data.error);
        })
        .catch(() => setError("Failed to reach server."))
        .finally(() => setLoading(false));
    }
  }, []);

  return (
    <main
      style={{
        padding: "2rem",
        fontFamily: "sans-serif",
        maxWidth: 720,
        margin: "0 auto",
      }}
    >
      <h1 style={{ marginBottom: "1rem" }}>Get Styled ✨</h1>

      {/* FORM + Outfit results */}
      {mode === "outfits" && (
        <>
          <p style={{ marginBottom: "2rem" }}>
            Enter your event, mood, and style preferences — our AI will curate 3 outfit ideas for you.
          </p>

          <form
            onSubmit={handleSubmit}
            style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "1fr 1fr" }}
          >
            <input
              type="text"
              placeholder="Event (e.g. wedding, dinner)"
              value={event}
              onChange={(e) => setEvent(e.target.value)}
              required
              style={{ padding: "10px" }}
            />
            <input
              type="text"
              placeholder="Mood (e.g. elegant, casual)"
              value={mood}
              onChange={(e) => setMood(e.target.value)}
              required
              style={{ padding: "10px" }}
            />
            <input
              type="text"
              placeholder="Style (e.g. streetwear, minimal)"
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              style={{ padding: "10px" }}
            />
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              style={{ padding: "10px" }}
            >
              <option value="">Gender (optional)</option>
              <option value="men's">Men’s</option>
              <option value="women's">Women’s</option>
              <option value="unisex">Unisex</option>
            </select>

            <button
              type="submit"
              disabled={loading}
              style={{
                padding: "12px 16px",
                background: "#111",
                color: "#fff",
                border: "none",
                cursor: "pointer",
                gridColumn: "1 / span 2",
              }}
            >
              {loading ? "Styling..." : "Get 3 Styled Looks"}
            </button>
          </form>

          {error && <p style={{ color: "red", marginTop: "1rem" }}>{error}</p>}

          {suggestions.length > 0 && (
            <section style={{ marginTop: "2rem" }}>
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

      {/* Moodboard results */}
      {mode === "moodboard" && (
        <section style={{ marginTop: "2rem" }}>
          <h3>Outfit Moodboard</h3>
          {loading && <p>Loading…</p>}
          {!loading && imageUrls.length === 0 && !error && <p>No images yet.</p>}
          {error && <p style={{ color: "red" }}>{error}</p>}
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
                />
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
