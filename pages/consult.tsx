// pages/consult.tsx
import Head from "next/head";
import Image from "next/image";

export default function Consult() {
  return (
    <>
      <Head>
        {/* Fonts: Cormorant Garamond (titles/prices), Inter (body) */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Inter:wght@400;600&display=swap"
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

        {/* TWO-COLUMN MENU */}
        <section className="menu">
          <ServiceCard
            img="/consult/Personal.JPG"
            title="PERSONAL STYLING"
            desc="Curated outfit direction for your day-to-day, events, or seasonal wardrobe refresh."
            price="$75"
          />
          <ServiceCard
            img="/consult/Creative.JPG"
            title="CREATIVE DIRECTION FOR SHOOTS/PROJECTS"
            desc="Visual concepts + style curation to bring your content ideas to life."
            price="$100"
          />
          <ServiceCard
            img="/consult/Digital.JPG"
            title="DIGITAL STYLING SESSION / CLOSET REVAMP"
            desc="Zoom call to walk through your wardrobe, offer styling tips, and rework what you already own."
            price="$50"
          />
          <ServiceCard
            img="/consult/Brand.JPG"
            title="BRAND/LOOKBOOK CONSULTING"
            desc="Styling and direction support for brands creating a campaign or visual story."
            price="$150"
          />
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

        /* Header block to mirror PDF hierarchy */
        .header { text-align: center; margin-bottom: 36px; }
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

        /* Two-column menu like the PDF (cards align as a grid) */
        .menu {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 28px 28px;
          margin-top: 32px;
        }

        .card {
          background: #ffffffcc;
          border: 1px solid rgba(74,69,62,0.18);
          border-radius: 14px;
          padding: 16px;
          display: grid;
          grid-template-columns: 110px 1fr 90px;
          gap: 16px;
          align-items: center;
          box-shadow: 0 8px 18px rgba(0,0,0,0.06);
        }

        .thumb {
          border-radius: 12px 12px 0 0;
          object-fit: cover;
        }

        .tTitle {
          font-weight: 600;
          font-size: 16px;
          margin: 0 0 6px;
          letter-spacing: 0.02em;
        }
        .tDesc {
          margin: 0;
          font-size: 14px;
          opacity: 0.9;
          line-height: 1.5;
        }

        .price {
          font-family: "Cormorant Garamond", serif;
          font-size: 28px;
          text-align: right;
          white-space: nowrap;
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

        /* Responsive adjustments */
        @media (max-width: 980px) {
          .menu { gap: 22px; }
          .card {
            grid-template-columns: 100px 1fr 80px;
          }
        }
        @media (max-width: 760px) {
          .menu {
            grid-template-columns: 1fr; /* stack like PDF mobile */
          }
          .card {
            grid-template-columns: 1fr;
            text-align: left;
          }
          .price { text-align: left; margin-top: 6px; }
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
      <Image
        src={img}
        alt={title}
        width={110}
        height={140}
        className="thumb"
        priority
      />
      <div>
        <h3 className="tTitle">{title}</h3>
        <p className="tDesc">{desc}</p>
      </div>
      <div className="price">{price}</div>
    </article>
  );
}
