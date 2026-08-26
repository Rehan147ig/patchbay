import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

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
    <html lang="en" suppressHydrationWarning>
      {/* suppressHydrationWarning: browser extensions (e.g. Bing's bis_skin_checked)
          inject attributes on <body> before hydration; that noise is not a real mismatch. */}
      <body className={inter.variable} suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
