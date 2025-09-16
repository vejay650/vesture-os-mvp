// pages/index.tsx
import Link from "next/link";

export default function Home() {
  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>Vesture OS – MVP</h1>
      <p>
        An AI-powered outfit curation tool. Enter your vibe or occasion and we’ll suggest looks.
      </p>
      <Link href="/results">
        <button style={{ marginTop: "1rem", padding: "0.5rem 1rem" }}>
          Try It
        </button>
      </Link>
    </main>
  );
}
