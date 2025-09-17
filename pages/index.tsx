// pages/index.tsx
import { useState } from "react";

export default function Home() {
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
      <h1 style={{ marginBottom: 8 }}>AI Stylist 👗👔</h1>
      <p style={{ marginBottom: 24 }}>
        Enter your <strong>Event</strong>, <strong>Mood</strong>, optional <strong>Style</strong>, and <strong>Gender</strong> for 3 curated outfit ideas.
      </p>

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
        <input
          placeholder="Event (e.g. wedding, dinner)"
          value={event}
          onChange={(e) => setEvent(e.target.value)}
          required
          style={{ padding: "10px", gridColumn: "1 / span 1" }}
        />
        <input
          placeholder="Mood (e.g. elegant, casual)"
          value={mood}
          onChange={(e) => setMood(e.target.value)}
          required
          style={{ padding: "10px", gridColumn: "2 / span 1" }}
        />
        <input
          placeholder="Style (e.g. streetwear, minimal)"
          value={style}
          onChange={(e) => setStyle(e.target.value)}
          style={{ padding: "10px", gridColumn: "1 / span 1" }}
        />
        <select
          value={gender}
          onChange={(e) => setGender(e.target.value)}
          style={{ padding: "10px", gridColumn: "2 / span 1" }}
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
            marginTop: 4
          }}
        >
          {loading ? "Styling..." : "Get 3 Styled Looks"}
        </button>
      </form>

      {error && <p style={{ color: "red", marginTop: 16 }}>{error}</p>}

      {suggestions.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h3 style={{ marginBottom: 8 }}>Suggested Outfits</h3>
          <ol style={{ paddingLeft: 18, lineHeight: 1.6 }}>
            {suggestions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
