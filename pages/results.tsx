import { useRouter } from "next/router";
import { useEffect, useState } from "react";

type Mode = "outfits" | "moodboard";

export default function Results() {
  const router = useRouter();

  // Search UI
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<Mode>("moodboard");

  // Optional structured fields (still supported)
  const [event, setEvent] = useState("");
  const [mood, setMood] = useState("");
  const [style, setStyle] = useState("");
  const [gender, setGender] = useState("");

  // Results
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [refs, setRefs] = useState<string[]>([]);           // NEW: click-through URLs
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Search submit (text bar)
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    params.set("mode", "moodboard");
    if (q.trim()) params.set("q", q.trim());
    router.replace(`/results?${params.toString()}`);
  };

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const m = (p.get("mode") as Mode) || "moodboard";
    setMode(m);

    // read both the new free-text q and legacy structured params
    const _q = p.get("q") || "";
    const e = p.get("event") || "";
    const mo = p.get("mood") || "";
    const st = p.get("style") || "";
    const g = p.get("gender") || "";

    setQ(_q);
    setEvent(e);
    setMood(mo);
    setStyle(st);
    setGender(g);

    if (m !== "moodboard") return;

    const hasStructured = !!(e || mo || st || g);
    const payload: any =
      _q.trim()
        ? { q: _q.trim(), count: 18 }
        : hasStructured
        ? { event: e, mood: mo, style: st, gender: g, count: 18 }
        : null;

    if (!payload) {
      setImageUrls([]);
      setRefs([]);
      setError("Provide q or one of: event, mood, style");
      return;
    }

    setLoading(true);
    setError("");
    setImageUrls([]);
    setRefs([]);

    fetch("/api/moodboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.error) {
          setError(String(data.error));
          setImageUrls([]);
          setRefs([]);
          return;
        }

        // Expect: data.images = [{ imageUrl, sourceUrl, title, provider }]
        const raw: { imageUrl?: string; sourceUrl?: string }[] = data?.images || [];

        // client-side dedupe by image URL
        const seen = new Set<string>();
        const urls: string[] = [];
        const hrefs: string[] = [];

        for (const it of raw) {
          const u = it?.imageUrl;
          if (!u) continue;
          if (seen.has(u)) continue;
          seen.add(u);
          urls.push(u);
          hrefs.push(it?.sourceUrl || u);
        }

        setImageUrls(urls);
        setRefs(hrefs);
      })
      .catch(() => setError("Failed to reach server."))
      .finally(() => setLoading(false));
  }, [router.asPath]);

  return (
    <main
      style={{
        padding: "2rem",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        maxWidth: 1100,
        margin: "0 auto",
      }}
    >
      <h1 style={{ marginBottom: "1rem" }}>
        Get Styled <span style={{ fontSize: "1.2rem" }}>✨</span>
      </h1>

      {/* One search bar */}
      <form onSubmit={handleSearch} style={{ display: "flex", gap: 12 }}>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder='Try: "oversized japanese streetwear"'
          style={{
            flex: 1,
            padding: "12px 16px",
            borderRadius: 8,
            border: "1px solid #ccc",
            outline: "none",
          }}
        />
        <button
          type="submit"
          style={{
            padding: "12px 16px",
            borderRadius: 8,
            border: "none",
            background: "#111",
            color: "#fff",
            cursor: "pointer",
            minWidth: 100,
          }}
        >
          Search
        </button>
      </form>

      <p style={{ marginTop: 8, color: "#666" }}>
        Tip: keep it short — e.g. <em>“dinner minimal unisex”</em> or{" "}
        <em>“black denim workwear”</em>
      </p>

      {/* Moodboard */}
      <section style={{ marginTop: "1.25rem" }}>
        <h3>Outfit Moodboard</h3>
        {loading && <p>Loading…</p>}
        {!loading && error && (
          <p style={{ color: "crimson", marginTop: 8 }}>{error}</p>
        )}
        {!loading && !error && imageUrls.length === 0 && (
          <p style={{ marginTop: 8 }}>No images yet.</p>
        )}

        {imageUrls.length > 0 && (
          <div
            style={{
              marginTop: 12,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 16,
            }}
          >
            {imageUrls.map((url, i) => (
              <a
                key={`${url}-${i}`}
                href={refs[i] || url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "block" }}
              >
                <img
                  src={url}
                  alt={`moodboard ${i + 1}`}
                  loading="lazy"
                  style={{
                    width: "100%",
                    aspectRatio: "1/1",
                    objectFit: "cover",
                    borderRadius: 12,
                    background: "#f4f4f4",
                    display: "block",
                  }}
                />
              </a>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
