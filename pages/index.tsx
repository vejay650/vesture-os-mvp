// pages/index.tsx

export default function Home() {
  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "40px 24px 64px",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        background: "#F5F3EE",
        color: "#111",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      {/* Brand + simple nav */}
      <header
        style={{
          width: "100%",
          maxWidth: 960,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 40,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 500,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            VESTURE OS
          </div>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: 13,
              opacity: 0.7,
            }}
          >
            AI-powered outfit moodboards & fashion consulting.
          </p>
        </div>

        <nav
          style={{
            display: "flex",
            gap: 18,
            fontSize: 13,
          }}
        >
          <a
            href="/results?mode=moodboard"
            style={{ textDecoration: "none", color: "#111" }}
          >
            Try the moodboard
          </a>
          <a
            href="/consult"
            style={{ textDecoration: "none", color: "#111" }}
          >
            Consulting
          </a>
        </nav>
      </header>

      {/* Hero */}
      <section
        style={{
          width: "100%",
          maxWidth: 960,
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(260px, 1.4fr)",
          gap: 32,
          alignItems: "flex-start",
        }}
      >
        {/* Left column */}
        <div>
          <h1
            style={{
              fontSize: 34,
              lineHeight: 1.15,
              fontWeight: 500,
              margin: 0,
            }}
          >
            Get visual outfit ideas in seconds.
          </h1>
          <p
            style={{
              marginTop: 14,
              fontSize: 14,
              maxWidth: 440,
              opacity: 0.8,
            }}
          >
            Type a vibe, event, or reference. Vesture OS pulls looks from your
            configured retailers into a clean outfit moodboard. When you&apos;re
            ready for deeper direction, explore the Fashion &amp; Style
            Consulting menu.
          </p>

          {/* CTA buttons */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              marginTop: 26,
            }}
          >
            <a
              href="/results?mode=moodboard"
              style={{
                padding: "11px 20px",
                borderRadius: 999,
                border: "none",
                background: "#111",
                color: "#fff",
                fontSize: 13,
                cursor: "pointer",
                textDecoration: "none",
                display: "inline-block",
              }}
            >
              Try the Outfit Moodboard
            </a>

            <a
              href="/consult"
              style={{
                padding: "11px 18px",
                borderRadius: 999,
                border: "1px solid #111",
                background: "transparent",
                color: "#111",
                fontSize: 13,
                cursor: "pointer",
                textDecoration: "none",
                display: "inline-block",
              }}
            >
              View Consulting Menu
            </a>
          </div>

          <p
            style={{
              marginTop: 14,
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.16em",
              opacity: 0.6,
            }}
          >
            prototype — for demos, early users & collaborators
          </p>
        </div>

        {/* Right column explainer */}
        <div
          style={{
            padding: "18px 18px 16px",
            borderRadius: 18,
            background: "#EAE5DB",
            border: "1px solid rgba(0,0,0,0.08)",
            fontSize: 12,
            display: "grid",
            gap: 10,
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: 13,
              textTransform: "uppercase",
              letterSpacing: "0.14em",
            }}
          >
            How the demo works
          </h3>
          <ol
            style={{
              margin: 0,
              paddingLeft: 18,
              lineHeight: 1.6,
            }}
          >
            <li>Click “Try the Outfit Moodboard”.</li>
            <li>
              Enter a phrase like <em>“minimal dinner unisex”</em> or{" "}
              <em>“oversized japanese streetwear”</em>.
            </li>
            <li>
              We surface a tight grid of looks from your selected retailers.
            </li>
          </ol>
          <p
            style={{
              margin: 0,
              opacity: 0.75,
            }}
          >
            For 1:1 styling, shoots, or brand visuals, go to the Consulting
            page and submit the request form.
          </p>
        </div>
      </section>
    </main>
  );
}
