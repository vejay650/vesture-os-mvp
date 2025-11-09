// pages/consult.tsx
import Head from "next/head";
import Image from "next/image";

export default function Consult() {
  return (
    <>
      <Head>
        <title>Fashion & Style Consulting — Vesture OS</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Inter:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </Head>

      <main className="page">
        {/* HEADER */}
        <header className="header">
          <div className="header-col">
            <div className="vertical-label">SERVICES MENU</div>
          </div>

          <div className="header-center">
            <h1 className="title">
              Fashion & Style
              <br /> Consulting
            </h1>
            <p className="subtitle">
              helping individuals + creatives elevate their look with intention and vibe
            </p>
          </div>

          <div className="header-col right" />
        </header>

        <div className="divider" />

        {/* SERVICES LIST */}
        <section className="services">
          <ServiceRow
            img="/consult/Personal.JPG"
            title="PERSONAL STYLING"
            desc="Curated outfit direction for your day-to-day, events, or seasonal wardrobe refresh."
            price="$75"
          />
          <ServiceRow
            img="/consult/Creative.JPG"
            title="CREATIVE DIRECTION FOR SHOOTS/PROJECTS"
            desc="Visual concepts + style curation to bring your content ideas to life."
            price="$100"
          />
          <ServiceRow
            img="/consult/Digital.JPG"
            title="DIGITAL STYLING SESSION / CLOSET REVAMP"
            desc="Zoom call to walk through your wardrobe, offer styling tips, and rework what you already own."
            price="$50"
          />
          <ServiceRow
            img="/consult/Brand.JPG"
            title="BRAND/LOOKBOOK CONSULTING"
            desc="Styling and direction support for brands creating a campaign or visual story."
            price="$150"
          />
        </section>

        {/* CTA → scroll to form */}
        <section className="book">
          <a href="#book">
            <button className="book-btn">
              Book 30-min Consult
            </button>
          </a>
        </section>

        {/* SINGLE FORM (ANCHOR TARGET) */}
        <section
          id="book"
          style={{
            marginTop: 60,
            paddingTop: 40,
            borderTop: "1px solid #C8BFAF",
            maxWidth: 520,
            marginLeft: "auto",
            marginRight: "auto",
            textAlign: "left",
          }}
        >
          <h2
            style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: 26,
              marginBottom: 12,
              textAlign: "center",
            }}
          >
            Book a 30-min Consult
          </h2>
          <p
            style={{
              fontSize: 14,
              opacity: 0.85,
              marginBottom: 18,
              textAlign: "center",
            }}
          >
            Share your name, email, Instagram (optional), and what you’re looking
            for. You’ll receive a reply with available times and next steps.
          </p>

          <form
            action="mailto:consulting@vestureos.com"
            method="POST"
            encType="text/plain"
            style={{ display: "flex", flexDirection: "column", gap: 10 }}
          >
            <input
              name="name"
              placeholder="Full name"
              required
              style={{
                padding: "10px 12px",
                borderRadius: 4,
                border: "1px solid #C8BFAF",
                background: "rgba(255,255,255,0.8)",
              }}
            />
            <input
              name="email"
              type="email"
              placeholder="Email"
              required
              style={{
                padding: "10px 12px",
                borderRadius: 4,
                border: "1px solid #C8BFAF",
                background: "rgba(255,255,255,0.8)",
              }}
            />
            <input
              name="instagram"
              placeholder="Instagram (optional)"
              style={{
                padding: "10px 12px",
                borderRadius: 4,
                border: "1px solid #C8BFAF",
                background: "rgba(255,255,255,0.8)",
              }}
            />
            <textarea
              name="details"
              placeholder="What are you looking for?"
              rows={4}
              style={{
                padding: "10px 12px",
                borderRadius: 4,
                border: "1px solid #C8BFAF",
                background: "rgba(255,255,255,0.8)",
                resize: "vertical",
              }}
            />
            <button
              type="submit"
              style={{
                marginTop: 8,
                padding: "12px 16px",
                background: "#4A453E",
                color: "#fff",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 15,
              }}
            >
              Submit Request
            </button>
          </form>
        </section>
      </main>

      <style jsx>{`
        :global(html) {
          scroll-behavior: smooth;
        }

        .page {
          background: #eae5db;
          min-height: 100vh;
          padding: 40px 24px 80px;
          max-width: 960px;
          margin: 0 auto;
          color: #4a453e;
          font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont,
            sans-serif;
        }

        .header {
          display: grid;
          grid-template-columns: 80px 1fr 80px;
          align-items: center;
          column-gap: 24px;
          margin-bottom: 10px;
        }

        .header-col {
          display: flex;
          justify-content: center;
        }

        .vertical-label {
          writing-mode: vertical-rl;
          text-orientation: mixed;
          font-size: 11px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }

        .header-center {
          text-align: center;
        }

        .title {
          font-family: "Cormorant Garamond", serif;
          font-weight: 400;
          font-size: clamp(34px, 4.4vw, 46px);
          line-height: 1.08;
          margin: 0;
        }

        .subtitle {
          margin-top: 10px;
          font-size: 12px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .divider {
          border-bottom: 1px solid rgba(74, 69, 62, 0.3);
          margin: 14px 0 26px;
        }

        .services {
          display: flex;
          flex-direction: column;
          gap: 26px;
        }

        .service-row {
          display: grid;
          grid-template-columns: 160px 1fr 70px;
          align-items: center;
          column-gap: 24px;
        }

        .thumb-wrap {
          width: 160px;
          height: 190px;
          overflow: hidden;
          border-radius: 80px 80px 0 0;
          background: #d6cec0;
        }

        .thumb {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .service-text h3 {
          margin: 0 0 6px;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.06em;
        }

        .service-text p {
          margin: 0;
          font-size: 13px;
          line-height: 1.6;
        }

        .price {
          font-family: "Cormorant Garamond", serif;
          font-size: 20px;
          justify-self: flex-end;
        }

        .book {
          margin-top: 42px;
          text-align: center;
        }

        .book-btn {
          background: #4a453e;
          color: #fff;
          padding: 10px 22px;
          border-radius: 5px;
          border: none;
          font-size: 14px;
          cursor: pointer;
        }

        .book-btn:hover {
          opacity: 0.9;
        }

        @media (max-width: 720px) {
          .header {
            grid-template-columns: 40px 1fr 40px;
          }

          .service-row {
            grid-template-columns: 120px 1fr 55px;
            column-gap: 16px;
          }

          .thumb-wrap {
            width: 120px;
            height: 150px;
            border-radius: 60px 60px 0 0;
          }

          .price {
            font-size: 18px;
          }
        }
      `}</style>
    </>
  );
}

function ServiceRow(props: {
  img: string;
  title: string;
  desc: string;
  price: string;
}) {
  const { img, title, desc, price } = props;
  return (
    <article className="service-row">
      <div className="thumb-wrap">
        <Image
          src={img}
          alt={title}
          width={160}
          height={190}
          className="thumb"
        />
      </div>
      <div className="service-text">
        <h3>{title}</h3>
        <p>{desc}</p>
      </div>
      <div className="price">{price}</div>
    </article>
  );
}
