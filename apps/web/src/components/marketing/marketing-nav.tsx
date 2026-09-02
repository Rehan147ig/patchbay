import Link from "next/link";

const NAV_LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#support-matrix", label: "Support Matrix" },
  { href: "#pricing", label: "Pricing" },
];

/** Minimal sticky marketing navigation — Apple glass. */
export function MarketingNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-zinc-200/60 bg-white/80 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Patch overview">
          <span className="flex size-7 items-center justify-center rounded-lg bg-[#1d1d1f] text-sm font-semibold text-white shadow-sm">
            P
          </span>
          <span className="text-base font-semibold tracking-tight text-[#1d1d1f]">Patch</span>
        </Link>
        <nav
          aria-label="Marketing"
          className="hidden items-center gap-1 rounded-full border border-zinc-200/80 bg-white/80 p-1 text-sm shadow-sm md:flex"
        >
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-full px-4 py-1.5 font-medium tracking-tight text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-[#1d1d1f]"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="hidden rounded-full px-4 py-2 text-sm font-medium tracking-tight text-zinc-500 transition-colors hover:text-[#1d1d1f] sm:block"
          >
            Sign in
          </Link>
          <Link
            href="/api/github/install"
            className="rounded-full bg-[#0071e3] px-5 py-2 text-sm font-medium tracking-tight text-white shadow-sm transition-colors hover:bg-[#0077ed]"
          >
            Install GitHub App
          </Link>
        </div>
      </div>
    </header>
  );
}
