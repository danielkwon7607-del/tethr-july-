import { loadConfig } from "@tethr/core";

// The Build 0 vertical slice: a page that can only render if the process was
// started with a valid, explicitly scoped environment (fail-fast config).
export default function Home() {
  const config = loadConfig(process.env);
  return (
    <main>
      <h1>tethr</h1>
      <p>Build 0 — Repository &amp; CI Foundation. Environment: {config.appEnv}</p>
    </main>
  );
}
