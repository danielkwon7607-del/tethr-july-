import type { ReactNode } from "react";

export const metadata = {
  title: "tethr",
  description: "The AI cofounder.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
