// pages/results.tsx
import { useState } from "react";

export default function Results() {
  const [event, setEvent] = useState("");
  const [mood, setMood] = useState("");
  const [style, setStyle] = useState("");
  const [gender, setGender] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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

      if (!res.ok) {
        setError(data?.error || "Something went wrong.");
      } else {
        setSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []);
      }
    } catch (err: any) {
      setError("Failed to reach server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif", maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ marginBottom: "1rem" }}>Get Styled ✨</h1>
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
    </main>
  );
}
// at the top with other imports
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

  // NEW: read URL on first load and auto-run if mode=moodboard or params present
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
      // auto-fetch moodboard
      setLoading(true);
      fetch("/api/moodboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: e, mood: mo, style: st, gender: g, count: 12 }),
      })
        .then(r => r.json())
        .then(data => {
          const imgs = (data?.images || []).map((it: any) => it.imageUrl);
          setImageUrls(imgs);
          setRefs((data?.images || []).map((it: any) => it.sourceUrl).slice(0, 6));
          if (data?.error) setError(data.error);
        })
        .catch(() => setError("Failed to reach server."))
        .finally(() => setLoading(false));
    }
  }, []);

  // ...keep your existing form + submit handlers + render...
}
