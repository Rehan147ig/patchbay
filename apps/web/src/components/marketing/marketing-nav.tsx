import Link from "next/link";

const NAV_LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#support-matrix", label: "Support Matrix" },
  { href: "#pricing", label: "Pricing" },
];

/** Minimal sticky marketing navigation. */
export function MarketingNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-gray-100/80 bg-white/70 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Patch overview">
          <span className="flex size-7 items-center justify-center rounded-lg bg-gray-900 text-sm font-bold text-white">
            P
          </span>
          <span className="text-base font-semibold tracking-tight text-gray-900">Patch</span>
        </Link>
        <nav
          aria-label="Marketing"
          className="hidden items-center gap-1 rounded-full border border-gray-200/80 bg-white/80 p-1 text-sm md:flex"
        >
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-full px-4 py-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="hidden rounded-full px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-900 sm:block"
          >
            Sign in
          </Link>
          <Link
            href="/api/github/install"
            className="rounded-full bg-gray-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700"
          >
            Install GitHub App
          </Link>
        </div>
      </div>
    </header>
  );
}
