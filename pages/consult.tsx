// pages/consult.tsx
import Image from "next/image";
import Link from "next/link";

export default function Consult() {
  const bg = "#EAE5DB"; // Canva background color

  return (
    <main
      style={{
        background: bg,
        minHeight: "100vh",
        padding: "40px 20px",
        fontFamily: "'TT Commons Pro', sans-serif",
        color: "#4A453E",
        maxWidth: 1000,
        margin: "0 auto",
      }}
    >
      <header style={{ textAlign: "center", marginBottom: 40 }}>
        <h1
          style={{
            fontSize: "48px",
            fontWeight: 400,
            fontFamily: "'Cormorant Garamond', serif",
          }}
        >
          Fashion & Style
          <br /> Consulting
        </h1>
        <p style={{ marginTop: 12, fontSize: "15px", opacity: 0.8 }}>
          Helping individuals + creatives elevate
          <br />
          their look with intention and vibe
        </p>
        <p style={{ marginTop: 12, fontSize: "15px" }}>
          CONTACT: VEJAY — consulting@vestureos.com
        </p>
      </header>

      {/* SERVICES LIST */}
      <div style={{ display: "flex", flexDirection: "column", gap: 60 }}>
        {/* PERSONAL STYLING */}
        <Service
          title="PERSONAL STYLING"
          desc="Curated outfit direction for your day-to-day, events, or seasonal wardrobe refresh."
          price="$75"
          img="/consult/Personal.JPG"
        />

        {/* CREATIVE DIRECTION */}
        <Service
          title="CREATIVE DIRECTION FOR SHOOTS/PROJECTS"
          desc="Visual concepts + style curation to bring your content ideas to life."
          price="$100"
          img="/consult/Creative.JPG"
        />

        {/* DIGITAL STYLING */}
        <Service
          title="DIGITAL STYLING SESSION / CLOSET REVAMP"
          desc="Zoom call to walk through your wardrobe, offer styling tips, and rework what you already own."
          price="$50"
          img="/consult/Digital.JPG"
        />

        {/* BRAND CONSULT */}
        <Service
          title="BRAND/LOOKBOOK CONSULTING"
          desc="Styling and direction support for brands creating a campaign or visual story."
          price="$150"
          img="/consult/Brand.JPG"
        />
      </div>

      {/* Booking Button */}
      <div style={{ textAlign: "center", marginTop: 60 }}>
        <a
          href="#book"
          style={{
            background: "#4A453E",
            color: "#fff",
            padding: "14px 26px",
            fontSize: "16px",
            borderRadius: 6,
            border: "none",
            cursor: "pointer",
            textDecoration: "none",
            display: "inline-block",
          }}
        >
          Book 30-min Consult
        </a>
      </div>

      {/* === FORM SECTION === */}
      <section id="book" style={{ marginTop: 80, scrollMarginTop: 100 }}>
        <h2 style={{ textAlign: "center", marginBottom: 12 }}>
          Book a 30-min Consult
        </h2>
        <p style={{ textAlign: "center", marginBottom: 24 }}>
          Share your name, email, Instagram (optional), and what you’re looking for.
        </p>

        <form
          style={{
            display: "grid",
            gap: 12,
            maxWidth: 500,
            margin: "0 auto",
            background: "#fff",
            padding: 20,
            borderRadius: 10,
          }}
        >
          <input
            placeholder="Full name"
            required
            style={{ padding: 12, borderRadius: 8, border: "1px solid #ccc" }}
          />
          <input
            type="email"
            placeholder="Email"
            required
            style={{ padding: 12, borderRadius: 8, border: "1px solid #ccc" }}
          />
          <input
            placeholder="Instagram (optional)"
            style={{ padding: 12, borderRadius: 8, border: "1px solid #ccc" }}
          />
          <textarea
            placeholder="What are you looking for?"
            rows={5}
            style={{ padding: 12, borderRadius: 8, border: "1px solid #ccc" }}
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
          >
            Request 30-min Consult
          </button>
        </form>
      </section>
    </main>
  );
}

// Reusable service card component
function Service({
  title,
  desc,
  price,
  img,
}: {
  title: string;
  desc: string;
  price: string;
  img: string;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "200px 1fr 100px",
        gap: 20,
        alignItems: "center",
      }}
    >
      <Image
        src={img}
        width={200}
        height={260}
        style={{
          objectFit: "cover",
          borderRadius: "12px 12px 0 0",
        }}
        alt={title}
      />
      <div>
        <h3 style={{ marginBottom: 8, fontSize: 18, fontWeight: 600 }}>
          {title}
        </h3>
        <p style={{ fontSize: 15, opacity: 0.8 }}>{desc}</p>
      </div>
      <p
        style={{
          fontSize: 26,
          fontFamily: "'Cormorant Garamond', serif",
        }}
      >
        {price}
      </p>
    </div>
  );
}
