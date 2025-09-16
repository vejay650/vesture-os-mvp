export default function Home() {
  return (
    <main style={{ padding: "2rem", textAlign: "center" }}>
      <h1>Welcome to Vesture OS</h1>
      <p>AI-powered outfit curation tool.</p>

      <a href="/results?event=dinner&vibe=modern&budget=200&palette=black">
        Try a sample curation →
      </a>
    </main>
  );
}
