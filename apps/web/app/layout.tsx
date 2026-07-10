import type { ReactNode } from "react";
import "./globals.css";

// The shell is deliberately thin and adaptive (§4.2): permanent anchors only
// — Company State, the Plan, the active Experiment — plus the §6.16 traits
// inspection surface. It supports the conversation; it is not where the work
// is driven from.

export const metadata = {
  title: "tethr",
  description: "Your cofounder's view of the company.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="shell-header">
            <a className="wordmark" href="/">
              tethr
            </a>
            <nav className="shell-nav" aria-label="Main navigation">
              <a href="/">Company</a>
              <a href="/plan">Plan</a>
              <a href="/experiment">Experiment</a>
              <a href="/traits">What tethr believes</a>
            </nav>
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
