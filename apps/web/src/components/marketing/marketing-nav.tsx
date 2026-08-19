"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const NAV_LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#support-matrix", label: "Support Matrix" },
  { href: "#pricing", label: "Pricing" },
];

/**
 * Marketing navigation. Turns into a frosted-glass bar once the page scrolls
 * so the hero can sit edge-to-edge underneath it.
 */
export function MarketingNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "glass-strong border-b border-white/10"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3.5">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Patch overview">
          <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent-400 to-accent-600 text-sm font-bold text-white shadow-[0_0_24px_rgba(99,102,241,0.5)]">
            P
          </span>
          <span className="text-lg font-semibold tracking-tight text-ink-100">Patch</span>
        </Link>
        <nav aria-label="Marketing" className="hidden items-center gap-7 text-sm md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-ink-300 transition-colors hover:text-ink-100"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-ink-200 transition-colors hover:text-ink-100"
          >
            Sign in
          </Link>
          <Link
            href="/api/github/install"
            className="btn-glow rounded-lg bg-gradient-to-r from-accent-500 to-accent-600 px-4 py-2 text-sm font-semibold text-white"
          >
            Install GitHub App
          </Link>
        </div>
      </div>
    </header>
  );
}
