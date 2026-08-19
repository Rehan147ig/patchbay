import type { Metadata } from "next";
import "./globals.css";

// Application pages (the (dashboard) group) resolve an authenticated tenant at
// request time; the marketing group is static. Prevent Next.js from executing
// dashboard session lookups while building static marketing pages.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Patch", template: "%s · Patch" },
  description: "Governed API-change remediation platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
