// pages/consult.tsx
import Head from "next/head";
import Image from "next/image";

export default function Consult() {
  const bg = "#EAE5DB"; // Canva background color

  return (
    <>
      <Head>
        {/* Fonts: Cormorant Garamond (for titles/prices), Inter (for body) */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Inter:wght@400;600&display=swap"
          rel="stylesheet"
        />
        <title>Consulting — Vesture OS</title>
        <meta name="description" content="Fashion & Style Consulting by Vejay — personal styling, creative direction, digital closet revamp, and brand/lookbook consulting." />
      </Head>

      <main className="consult">
        <header className="hero">
          <h1 className="title">
            Fashion & Style
            <br /> Consulting
          </h1>

          <p className="sub">
            Helping individuals + creatives elevate
            <br />
            their look with intention and vibe
          </p>

          <p className="contact">CONTACT: VEJAY — consulting@vestureos.com</p>
        </header>

        <div className="divider" />

        {/* SERVICES */}
        <section className="services">
          <Service
            title="PERSONAL STYLING"
            desc="Curated outfit direction for your day-to-day, events, or seasonal wardrobe refresh."
            price="$75"
            img="/consult/Personal.JPG"
          />

          <div className="rule" />

          <Service
            title="CREATIVE DIRECTION FOR SHOOTS/PROJECTS"
            desc="Visual concepts + style curation to bring your content ideas to life."
            price="$100"
            img="/consult/Creative.JPG"
          />

          <div className="rule" />

          <Service
            title="DIGITAL STYLING SESSION / CLOSET REVAMP"
            desc="Zoom call to walk through your wardrobe, offer styling tips, and rework what you already own."
            price="$50"
            img="/consult/Digital.JPG"
          />

          <div className="rule" />

          <Service
            title="BRAND/LOOKBOOK CONSULTING"
            desc="Styling and direction support for brands creating a campaign or visual story."
            price="$150"
            img="/consult/Brand.JPG"
          />
        </section>

        <div className="ctaWrap">
          <a className="cta" href="#book">Book 30-min Consult</a>
        </div>

        {/* BOOKING FORM */}
        <section id="book" className="book">
          <h2>Book a 30-min Consult</h2>
          <p className="bookSub">
            Share your name, email, Instagram (optional), and what you’re looking for.
          </p>

          <form className="form">
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

        .consult {
          background: ${bg};
          min-height: 100vh;
          padding: 48px 20px 80px;
          color: #4A453E;
          max-width: 1100px;
          margin: 0 auto;
          font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        }

        .hero {
          text-align: center;
          margin-bottom: 32px;
        }
        .title {
          font-family: "Cormorant Garamond", serif;
          font-weight: 400;
          font-size: clamp(40px, 6vw, 56px);
          line-height: 1.05;
          letter-spacing: 0.2px;
          margin: 0 0 12px;
        }
        .sub {
          font-size: 15px;
          opacity: 0.85;
          margin: 0;
        }
        .contact {
          margin-top: 12px;
          font-size: 15px;
        }

        .divider {
          height: 1px;
          background: rgba(74, 69, 62, 0.25);
          margin: 24px 0 32px;
        }

        .services {
          display: grid;
          gap: 28px;
        }
        .rule {
          height: 1px;
          background: rgba(74, 69, 62, 0.2);
        }

        .ctaWrap {
          text-align: center;
          margin-top: 40px;
        }
        .cta {
          display: inline-block;
          background: #4A453E;
          color: #fff;
          padding: 14px 26px;
          font-size: 16px;
          border-radius: 6px;
          text-decoration: none;
          transition: transform 0.12s ease, opacity 0.12s ease;
        }
        .cta:hover { transform: translateY(-1px); opacity: 0.95; }

        .book {
          margin-top: 72px;
          scroll-margin-top: 100px;
        }
        .book h2 {
          text-align: center;
          margin: 0 0 8px;
          font-family: "Cormorant Garamond", serif;
          font-weight: 500;
          font-size: clamp(28px, 3.6vw, 34px);
        }
        .bookSub {
          text-align: center;
          margin: 0 0 22px;
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
          border: 1px solid rgba(74, 69, 62, 0.15);
          box-shadow: 0 6px 18px rgba(0,0,0,0.05);
        }
        .form input, .form textarea {
          padding: 12px 14px;
          border-radius: 8px;
          border: 1px solid rgba(74, 69, 62, 0.25);
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
        .form button:hover { opacity: 0.95; }

        /* Service card layout */
        .service {
          display: grid;
          grid-template-columns: 220px 1fr 120px;
          gap: 20px;
          align-items: center;
        }
        .serviceTitle {
          font-weight: 600;
          font-size: 18px;
          margin: 0 0 6px;
        }
        .serviceDesc {
          margin: 0;
          font-size: 15px;
          opacity: 0.9;
          line-height: 1.5;
        }
        .servicePrice {
          font-family: "Cormorant Garamond", serif;
          font-size: clamp(26px, 4vw, 32px);
          text-align: right;
        }
        .thumb {
          border-radius: 12px 12px 0 0;
          object-fit: cover;
        }

        /* Responsive */
        @media (max-width: 860px) {
          .service {
            grid-template-columns: 150px 1fr 90px;
          }
        }
        @media (max-width: 680px) {
          .service {
            grid-template-columns: 1fr;
            gap: 12px;
          }
          .servicePrice { text-align: left; }
        }
      `}</style>
    </>
  );
}

/** Reusable service card */
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
    <article className="service">
      <Image
        src={img}
        width={220}
        height={280}
        className="thumb"
        alt={title}
        priority
      />
      <div>
        <h3 className="serviceTitle">{title}</h3>
        <p className="serviceDesc">{desc}</p>
      </div>
      <div className="servicePrice">{price}</div>
    </article>
  );
}
