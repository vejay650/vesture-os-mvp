// pages/results.tsx
import { useEffect, useState } from "react";

export default function Results() {
  const [outfit, setOutfit] = useState("");

  useEffect(() => {
    fetch("/api/curate")
      .then((res) => res.json())
      .then((data) => setOutfit(data.suggestion));
  }, []);

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>Curated Outfit</h1>
      <p>{outfit || "Loading..."}</p>
    </main>
  );
}
