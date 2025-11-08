// pages/consult.tsx
import Head from "next/head";
import Image from "next/image";

export default function Consult() {
  return (
    <>
      <Head>
        {/* Fonts: serif (Caslon vibe) + sans (TT Commons vibe) */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Inter:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <title>Consulting — Vesture OS</title>
      </Head>

      <main className="wrap">
        {/* HEADER */}
        <header className="header">
          <h1 className="title">
            Fashion & Style
            <br /> Consulting
          </h1>

          <p className="kicker">Service Menu</p>

          <p className="tagline">
            helping individuals + creatives elevate their look with intention and vibe
          </p>
        </header>

        {/* TWO EVEN COLUMNS */}
        <section className="menuCols">
          <div className="col">
            <ServiceCard
              img="/consult/Personal.JPG"
              title="PERSONAL STYLING"
              desc="Curated outfit direction for your day-to-day, events, or seasonal wardrobe refresh."
              price="$75"
            />
            <ServiceCard
              img="/consult/Digital.JPG"
              title="DIGITAL STYLING SESSION / CLOSET REVAMP"
              desc="Zoom call to walk through your wardrobe, offer styling tips, and rework what you already own."
              price="$50"
            />
          </div>

          <div className="col">
            <ServiceCard
              img="/consult/Creative.JPG"
              title="CREATIVE DIRECTION FOR SHOOTS/PROJECTS"
              desc="Visual concepts + style curation to bring your content ideas to life."
              price="$100"
            />
            <ServiceCard
              img="/consult/Brand.JPG"
              title="BRAND/LOOKBOOK CONSULTING"
              desc="Styling and direction support for brands creating a campaign or visual story."
              price="$150"
            />
          </div>
        </section>

        {/* BOOK CTA */}
        <div className="ctaWrap">
          <a className="cta" href="#book">Book 30-min Consult</a>
        </div>

        {/* BOOK FORM */}
        <section id="book" className="book">
          <h2>Book a 30-min Consult</h2>
          <p className="bookSub">
            Share your name, email, Instagram (optional), and what you’re looking for.
          </p>

          <form className="form" onSubmit={(e) => e.preventDefault()}>
            <input placeholder="Full name" required />
            <input type="email" placeholder="Email" required />
            <input placeholder="Instagram (optional)" />
            <textarea placeholder="What are you looking for?" rows={5} />
            <button type="submit">Request 30-min Consult</button>
          </form>
        </section>
      </main>

      <style jsx>{`
        :global(html) { scroll-behavior: smooth; }

        .wrap {
          background: #EAE5DB;
          min-height: 100vh;
          padding: 56px 20px 88px;
          max-width: 1100px;
          margin: 0 auto;
          color: #4A453E;
          font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        }

        .header { text-align: center; margin-bottom: 32px; }
        .title {
          font-family: "Cormorant Garamond", serif;
          font-weight: 400;
          font-size: clamp(42px, 6vw, 58px);
          line-height: 1.05;
          letter-spacing: 0.2px;
          margin: 0 0 10px;
        }
        .kicker {
          font-family: "Cormorant Garamond", serif;
          font-size: clamp(16px, 2.4vw, 18px);
          letter-spacing: 0.08em;
          text-transform: uppercase;
          margin: 0 0 8px;
        }
        .tagline {
          font-size: 15px;
          opacity: 0.9;
          margin: 0;
        }

        /* Two even columns */
        .menuCols {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 40px;
          margin-top: 40px;
        }

        .col {
          display: grid;
          gap: 40px;
        }

        /* Card with arched image top */
        .card {
          background: #ffffffcc;
          border: 1px solid rgba(74,69,62,0.18);
          border-radius: 16px;
          padding: 16px;
          box-shadow: 0 8px 18px rgba(0,0,0,0.06);
          display: flex;
          flex-direction: column;
          align-items: stretch;
        }

        .thumb {
          width: 100%;
          height: 260px;
          object-fit: cover;
          border-radius: 140px 140px 0 0; /* arched top */
          display: block;
        }

        .tTitle {
          font-weight: 600;
          font-size: 16px;
          margin: 14px 0 6px;
          letter-spacing: 0.02em;
        }

        .tDesc {
          margin: 0;
          font-size: 14px;
          opacity: 0.9;
          line-height: 1.6;
        }

        .price {
          font-family: "Cormorant Garamond", serif;
          font-size: 26px;
          margin-top: 10px;
          align-self: flex-end;
        }

        .ctaWrap { text-align: center; margin-top: 40px; }
        .cta {
          display: inline-block;
          background: #4A453E;
          color: #fff;
          padding: 14px 26px;
          font-size: 16px;
          border-radius: 8px;
          text-decoration: none;
          transition: transform .12s ease, opacity .12s ease;
        }
        .cta:hover { transform: translateY(-1px); opacity: .95; }

        .book {
          margin-top: 70px;
          scroll-margin-top: 120px;
        }
        .book h2 {
          text-align: center;
          margin: 0 0 8px;
          font-family: "Cormorant Garamond", serif;
          font-weight: 500;
          font-size: clamp(26px, 3.4vw, 34px);
        }
        .bookSub {
          text-align: center;
          margin: 0 0 20px;
          opacity: 0.85;
          font-size: 15px;
        }

        .form {
          max-width: 560px;
          margin: 0 auto;
          background: #FFFFFFCC;
          padding: 20px;
          border-radius: 12px;
          display: grid;
          gap: 12px;
          border: 1px solid rgba(74,69,62,0.15);
          box-shadow: 0 6px 18px rgba(0,0,0,0.05);
        }
        .form input, .form textarea {
          padding: 12px 14px;
          border-radius: 8px;
          border: 1px solid rgba(74,69,62,0.25);
          outline: none;
          background: #fff;
          font-size: 14px;
        }
        .form textarea { resize: vertical; }
        .form button {
          padding: 12px 16px;
          background: #111;
          color: #fff;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 600;
          letter-spacing: 0.2px;
        }
        .form button:hover { opacity: .95; }

        /* Responsive */
        @media (max-width: 860px) {
          .menuCols { grid-template-columns: 1fr; }
        }
      `}</style>
    </>
  );
}

function ServiceCard({
  img,
  title,
  desc,
  price,
}: {
  img: string;
  title: string;
  desc: string;
  price: string;
}) {
  return (
    <article className="card">
      <Image src={img} alt={title} width={900} height={600} className="thumb" priority />
      <h3 className="tTitle">{title}</h3>
      <p className="tDesc">{desc}</p>
      <div className="price">{price}</div>
    </article>
  );
}
