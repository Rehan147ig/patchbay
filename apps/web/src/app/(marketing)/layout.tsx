import Link from "next/link";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-[#fbfbfd] font-sans antialiased text-[#1d1d1f]">
      {children}
      <footer className="border-t border-zinc-200/60 bg-white">
        <div className="mx-auto w-full max-w-6xl px-4 py-12">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold tracking-tight text-[#1d1d1f]">
                <span className="flex size-6 items-center justify-center rounded-lg bg-[#1d1d1f] text-xs font-semibold text-white shadow-sm">
                  P
                </span>
                Patch
              </p>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-zinc-500">
                Governed API-change remediation. Draft PRs only. No auto-merge. Human approval for
                high-risk changes.
              </p>
            </div>
            <nav aria-label="Footer" className="flex flex-wrap items-center gap-6 text-sm">
              <a
                href="#how-it-works"
                className="font-medium tracking-tight text-zinc-500 transition-colors hover:text-[#1d1d1f]"
              >
                How it works
              </a>
              <a
                href="#support-matrix"
                className="font-medium tracking-tight text-zinc-500 transition-colors hover:text-[#1d1d1f]"
              >
                Support Matrix
              </a>
              <a
                href="#pricing"
                className="font-medium tracking-tight text-zinc-500 transition-colors hover:text-[#1d1d1f]"
              >
                Pricing
              </a>
              <Link
                href="/login"
                className="font-medium tracking-tight text-zinc-500 transition-colors hover:text-[#1d1d1f]"
              >
                Sign in
              </Link>
            </nav>
          </div>
          <p className="mt-10 border-t border-zinc-200/60 pt-6 text-xs text-zinc-400">
            Patch local development MVP — the bundled validation sandbox and dev authentication are
            not hardened multi-tenant infrastructure.
          </p>
        </div>
      </footer>
    </div>
  );
}
