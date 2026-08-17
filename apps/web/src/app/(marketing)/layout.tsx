export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      {children}
      <footer className="border-t border-slate-100 bg-white">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 text-xs text-slate-500">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Patchbay — governed API-change remediation.</span>
            <span>Draft PRs only. No auto-merge. Human approval for high-risk changes.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
