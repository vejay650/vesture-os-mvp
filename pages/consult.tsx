// pages/consult.tsx
import React from "react";

export default function Consult() {
  return (
    <main style={{maxWidth: 960, margin: "0 auto", padding: "48px 20px", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"}}>
      <header style={{textAlign: "center", marginBottom: 28}}>
        <h1 style={{fontSize: 36, margin: 0}}>Fashion & Style Consulting</h1>
        <p style={{color: "#555", marginTop: 10}}>
          Helping individuals + creatives elevate their look with intention and vibe.
        </p>
      </header>

      {/* Services grid */}
      <section style={{display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16}}>
        <Card
          title="Personal Styling"
          price="$75"
          desc="Curated outfit direction for day-to-day, events, or a seasonal refresh."
        />
        <Card
          title="Creative Direction"
          price="$100"
          desc="Visual concepts + style curation for shoots or projects."
        />
        <Card
          title="Digital Session / Closet Revamp"
          price="$50"
          desc="Zoom call to review your wardrobe and rework what you already own."
        />
        <Card
          title="Brand / Lookbook Consulting"
          price="$150"
          desc="Styling + direction support for campaigns and visual stories."
        />
      </section>

      {/* Actions */}
      <section style={{marginTop: 28, display: "grid", gap: 16}}>
        {/* Option A: direct scheduling (Calendly) */}
        <a
          href="https://calendly.com/YOUR-HANDLE/30min" // replace with your link
          target="_blank"
          rel="noreferrer"
          style={btnPrimary}
        >
          Book a 30-min consult
        </a>

        {/* Option B: intake form (Formspree or Google Form) */}
        <form
          action="https://formspree.io/f/YOUR_FORM_ID" // replace with your Formspree form id
          method="POST"
          style={{display: "grid", gap: 12, marginTop: 8}}
        >
          <input name="name" placeholder="Your name" required style={input} />
          <input name="email" type="email" placeholder="Email" required style={input} />
          <input name="instagram" placeholder="Instagram (optional)" style={input} />
          <textarea name="goals" placeholder="What are you looking for? (event, vibe, budget)" rows={4} style={input} />
          <button type="submit" style={btnSecondary}>Join waitlist / Request styling</button>
        </form>

        {/* Optional: up-front payment links (Stripe Checkout) */}
        <div style={{display:"flex", gap: 8, flexWrap:"wrap"}}>
          <a href="https://buy.stripe.com/YOUR_LINK_75" target="_blank" rel="noreferrer" style={tag}>Pay $75 – Personal Styling</a>
          <a href="https://buy.stripe.com/YOUR_LINK_100" target="_blank" rel="noreferrer" style={tag}>Pay $100 – Creative Direction</a>
          <a href="https://buy.stripe.com/YOUR_LINK_50" target="_blank" rel="noreferrer" style={tag}>Pay $50 – Digital Session</a>
          <a href="https://buy.stripe.com/YOUR_LINK_150" target="_blank" rel="noreferrer" style={tag}>Pay $150 – Brand Consulting</a>
        </div>

        <p style={{color:"#666", fontSize:14}}>
          Prefer email? Contact: <a href="mailto:vejay650@gmail.com">vejay650@gmail.com</a>
        </p>
      </section>
    </main>
  );
}

function Card({ title, price, desc }: {title:string; price:string; desc:string}) {
  return (
    <div style={{border:"1px solid #eee", borderRadius:16, padding:20}}>
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"baseline"}}>
        <h3 style={{margin:0}}>{title}</h3>
        <strong>{price}</strong>
      </div>
      <p style={{color:"#555", marginTop:8}}>{desc}</p>
    </div>
  );
}

const input: React.CSSProperties = {
  padding: "12px 14px",
  border: "1px solid #ccc",
  borderRadius: 10,
  outline: "none"
};

const btnPrimary: React.CSSProperties = {
  display: "inline-block",
  textAlign: "center",
  padding: "12px 16px",
  background: "#111",
  color: "#fff",
  borderRadius: 10,
  textDecoration: "none"
};

const btnSecondary: React.CSSProperties = {
  padding: "12px 16px",
  background: "#111",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  cursor: "pointer"
};

const tag: React.CSSProperties = {
  display: "inline-block",
  padding: "8px 12px",
  borderRadius: 999,
  background: "#f3f3f3",
  color: "#111",
  textDecoration: "none",
  fontSize: 14
};
