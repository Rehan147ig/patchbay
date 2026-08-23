import Link from "next/link";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white text-gray-900">
      {children}
      <footer className="border-t border-gray-100">
        <div className="mx-auto w-full max-w-6xl px-4 py-12">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
            <div>
              <p className="flex items-center gap-2 font-semibold tracking-tight text-gray-900">
                <span className="flex size-6 items-center justify-center rounded-md bg-gray-900 text-xs font-bold text-white">
                  P
                </span>
                Patch
              </p>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-gray-500">
                Governed API-change remediation. Draft PRs only. No auto-merge. Human approval for
                high-risk changes.
              </p>
            </div>
            <nav aria-label="Footer" className="flex flex-wrap items-center gap-6 text-sm">
              <a
                href="#how-it-works"
                className="text-gray-500 transition-colors hover:text-gray-900"
              >
                How it works
              </a>
              <a
                href="#support-matrix"
                className="text-gray-500 transition-colors hover:text-gray-900"
              >
                Support Matrix
              </a>
              <a href="#pricing" className="text-gray-500 transition-colors hover:text-gray-900">
                Pricing
              </a>
              <Link href="/login" className="text-gray-500 transition-colors hover:text-gray-900">
                Sign in
              </Link>
            </nav>
          </div>
          <p className="mt-10 border-t border-gray-100 pt-6 text-xs text-gray-400">
            Patch local development MVP — the bundled validation sandbox and dev authentication are
            not hardened multi-tenant infrastructure.
          </p>
        </div>
      </footer>
    </div>
  );
}
