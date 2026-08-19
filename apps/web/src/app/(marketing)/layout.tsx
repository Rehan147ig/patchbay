import Link from "next/link";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-ink-950 text-ink-100">
      {children}
      <footer className="border-t border-white/8">
        <div className="mx-auto w-full max-w-6xl px-4 py-10">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
            <div>
              <p className="flex items-center gap-2 font-semibold tracking-tight text-ink-100">
                <span className="flex size-6 items-center justify-center rounded-md bg-gradient-to-br from-accent-400 to-accent-600 text-xs font-bold text-white">
                  P
                </span>
                Patch
              </p>
              <p className="mt-2 max-w-sm text-xs leading-relaxed text-ink-500">
                Governed API-change remediation. Draft PRs only. No auto-merge. Human approval for
                high-risk changes.
              </p>
            </div>
            <nav aria-label="Footer" className="flex flex-wrap items-center gap-6 text-sm">
              <a href="#how-it-works" className="text-ink-400 transition-colors hover:text-ink-100">
                How it works
              </a>
              <a
                href="#support-matrix"
                className="text-ink-400 transition-colors hover:text-ink-100"
              >
                Support Matrix
              </a>
              <a href="#pricing" className="text-ink-400 transition-colors hover:text-ink-100">
                Pricing
              </a>
              <Link href="/login" className="text-ink-400 transition-colors hover:text-ink-100">
                Sign in
              </Link>
            </nav>
          </div>
          <p className="mt-8 border-t border-white/8 pt-6 text-xs text-ink-600">
            Patch local development MVP — the bundled validation sandbox and dev authentication are
            not hardened multi-tenant infrastructure.
          </p>
        </div>
      </footer>
    </div>
  );
}
