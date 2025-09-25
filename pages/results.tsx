// pages/results.tsx
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

type Mode = "outfits" | "moodboard";

export default function Results() {
  const router = useRouter();

  // single search bar
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<Mode>("moodboard");

  // legacy fields (still supported)
  const [event, setEvent] = useState("");
  const [mood, setMood] = useState("");
  const [style, setStyle] = useState("");
  const [gender, setGender] = useState("");

  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // --- helpers -------------------------------------------------------------
  const runMoodboard = async (payload: any) => {
    setLoading(true);
    setError("");
    setImageUrls([]);
    try {
      const res = await fetch("/api/moodboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data?.error) {
        setError(data.error);
      } else {
        setImageUrls((data.images || []).map((it: any) => it.imageUrl));
      }
    } catch {
      setError("Failed to reach server.");
    } finally {
      setLoading(false);
    }
  };

  const submitSearch = async (inputQ: string) => {
    if (!inputQ.trim()) {
      setError("Please enter a search idea.");
      return;
    }

    // 1) Try to parse to event/mood/style/gender
    try {
      const parsedRes = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: inputQ }),
      });
      const parsed = await parsedRes.json();

      const payload =
        parsed?.event || parsed?.mood || parsed?.style
          ? {
              event: parsed.event || "",
              mood: parsed.mood || "",
              style: parsed.style || "",
              gender: parsed.gender || "",
              count: 12,
            }
          : { q: inputQ, count: 12 };

      await runMoodboard(payload);
    } catch {
      // 2) Fallback: just search with q
      await runMoodboard({ q: inputQ, count: 12 });
    }
  };

  // --- on first load: read URL & auto-run ---------------------------------
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const m = (p.get("mode") as Mode) || "moodboard";
    const urlQ = p.get("q") || "";

    setMode(m);
    setQ(urlQ);

    const e = p.get("event") || "";
    const mo = p.get("mood") || "";
    const st = p.get("style") || "";
    const g = p.get("gender") || "";

    setEvent(e);
    setMood(mo);
    setStyle(st);
    setGender(g);

    // priority: use q if provided; else use structured fields
    if (m === "moodboard") {
      if (urlQ) {
        submitSearch(urlQ);
      } else if (e || mo || st || g) {
        runMoodboard({ event: e, mood: mo, style: st, gender: g, count: 12 });
      }
    }
  }, []);

  // --- render --------------------------------------------------------------
  return (
    <main
      style={{
        padding: "2rem",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        maxWidth: 960,
        margin: "0 auto",
      }}
    >
      <h1 style={{ marginBottom: 16 }}>Get Styled ✨</h1>

      {/* Single search bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          // update URL for shareability
          const params = new URLSearchParams({ mode: "moodboard", q });
          router.replace(`/results?${params.toString()}`, undefined, { shallow: true });
          submitSearch(q);
        }}
        style={{ display: "flex", gap: 8, marginBottom: 8 }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder='e.g. "dinner minimal unisex" or "black denim workwear"'
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
          style={{
            padding: "12px 16px",
            background: "#111",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
          }}
          disabled={loading}
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </form>
      <p style={{ color: "#666", marginTop: 4, marginBottom: 24 }}>
        Tip: keep it short — e.g. <em>"dinner minimal unisex"</em> or <em>"black denim workwear"</em>
      </p>

      <section style={{ marginTop: 8 }}>
        <h3>Outfit Moodboard</h3>

        {error && <p style={{ color: "red" }}>{error}</p>}
        {loading && <p>Loading…</p>}

        {!loading && !error && imageUrls.length === 0 && (
          <p style={{ color: "#777" }}>No images yet.</p>
        )}

        {imageUrls.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 16,
              alignItems: "start",
            }}
          >
            {imageUrls.map((url, i) => (
              <img
                key={i}
                src={url}
                alt={`moodboard ${i + 1}`}
                loading="lazy"
                style={{
                  width: "100%",
                  maxHeight: 360,
                  objectFit: "cover",
                  borderRadius: 10,
                  background: "#f6f6f6",
                }}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
