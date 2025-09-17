// pages/index.tsx
import { useState } from "react";

export default function Home() {
  const [event, setEvent] = useState("");
  const [mood, setMood] = useState("");
  const [suggestion, setSuggestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSuggestion("");
    setError("");

    try {
      const res = await fetch("/api/curate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event, mood }),
      });

      const data = await res.json();
      if (res.ok) {
        setSuggestion(data.suggestion);
      } else {
        setError(data.error || "Something went wrong.");
      }
    } catch (err: any) {
      setError("Failed to reach server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif", maxWidth: "600px", margin: "0 auto" }}>
      <h1 style={{ marginBottom: "1rem" }}>AI Stylist 👗👔</h1>
      <p style={{ marginBottom: "2rem" }}>
        Describe your <strong>event</strong> and <strong>mood</strong>, and get a curated outfit instantly.
      </p>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <input
          type="text"
          placeholder="Event (e.g. wedding, dinner, date)"
          value={event}
          onChange={(e) => setEvent(e.target.value)}
          style={{ padding: "0.5rem" }}
          required
        />
        <input
          type="text"
          placeholder="Mood (e.g. elegant, casual, bold)"
          value={mood}
          onChange={(e) => setMood(e.target.value)}
          style={{ padding: "0.5rem" }}
          required
        />
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: "0.75rem",
            background: "#000",
            color: "#fff",
            border: "none",
            cursor: "pointer",
          }}
        >
          {loading ? "Styling..." : "Get Styled"}
        </button>
      </form>

      {error && <p style={{ color: "red", marginTop: "1rem" }}>{error}</p>}
      {suggestion && (
        <div style={{ marginTop: "2rem", padding: "1rem", border: "1px solid #ccc" }}>
          <h3>Suggested Outfit:</h3>
          <p>{suggestion}</p>
        </div>
      )}
    </main>
  );
}
