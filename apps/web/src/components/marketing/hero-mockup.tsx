import { DiffWindow } from "@/components/marketing/diff-window";

const STATS = [
  { label: "Repositories watched", value: "12" },
  { label: "Cases auto-patched", value: "34" },
  { label: "Validation pass rate", value: "98.2%" },
];

const FEED_ROWS = [
  {
    dot: "bg-indigo-500",
    case: "c_9a41",
    text: "openai@4.0.0 · 14 callsites matched",
    status: "PATCHING",
    tone: "bg-indigo-50 text-indigo-700",
  },
  {
    dot: "bg-emerald-500",
    case: "c_8f2f",
    text: "openai@4.0.0 · sandbox passed",
    status: "PR OPEN",
    tone: "bg-emerald-50 text-emerald-700",
  },
  {
    dot: "bg-gray-400",
    case: "c_7d03",
    text: "stripe@14.10.0 · PAYMENT approval required",
    status: "REVIEW",
    tone: "bg-amber-50 text-amber-700",
  },
  {
    dot: "bg-emerald-500",
    case: "c_6b88",
    text: "twilio@7.8.0 · draft PR merged by human",
    status: "MERGED",
    tone: "bg-emerald-50 text-emerald-700",
  },
  {
    dot: "bg-indigo-500",
    case: "c_5e17",
    text: "supabase-js@2.45 · impact assessed",
    status: "ASSESS",
    tone: "bg-gray-100 text-gray-600",
  },
];

/**
 * Elu-style hero product shot: a dashboard window (stats + live case ticker)
 * layered with the certified migration diff and floating event chips.
 */
export function HeroMockup() {
  return (
    <div className="relative mx-auto mt-16 w-full max-w-5xl">
      {/* Floating chips */}
      <div
        className="absolute -left-6 -top-7 z-20 hidden animate-float items-center gap-2 rounded-full border border-gray-200 bg-white px-3.5 py-2 text-xs font-medium text-gray-600 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.25)] lg:flex"
        style={{ animationDelay: "-1.2s" }}
      >
        <span className="size-2 rounded-full bg-emerald-500" />
        Draft PRs only — never auto-merge
      </div>
      <div
        className="absolute -right-5 top-24 z-20 hidden animate-float items-center gap-2 rounded-full border border-gray-200 bg-white px-3.5 py-2 font-mono text-[11px] text-gray-600 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.25)] lg:flex"
        style={{ animationDelay: "-3.4s" }}
      >
        <span className="size-2 rounded-full bg-indigo-500" />
        rule-pack openai/chat-completions-v4
      </div>

      {/* Dashboard window */}
      <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_40px_90px_-30px_rgba(15,23,42,0.25)]">
        <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50/80 px-4 py-3">
          <span className="size-2.5 rounded-full bg-gray-300" />
          <span className="size-2.5 rounded-full bg-gray-300" />
          <span className="size-2.5 rounded-full bg-gray-300" />
          <span className="mx-auto flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-0.5 font-mono text-[11px] text-gray-400">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="size-3"
            >
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
            app.patch.dev/overview
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[180px_1fr]">
          {/* Sidebar */}
          <aside className="hidden flex-col gap-1 border-r border-gray-100 bg-gray-50/50 p-3 md:flex">
            {["Overview", "Changes", "Cases", "Remediations", "Releases", "Audit"].map(
              (item, index) => (
                <span
                  key={item}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                    index === 0 ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
                  }`}
                >
                  {item}
                </span>
              ),
            )}
          </aside>

          {/* Main panel */}
          <div className="p-5">
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-semibold text-gray-900">acme/api</p>
              <p className="font-mono text-[11px] text-gray-400">live</p>
            </div>

            {/* Stat tiles */}
            <div className="mt-3 grid grid-cols-3 gap-3">
              {STATS.map((stat) => (
                <div key={stat.label} className="rounded-xl border border-gray-100 p-3">
                  <p className="text-xl font-semibold tracking-tight text-gray-900">{stat.value}</p>
                  <p className="mt-0.5 text-[11px] leading-tight text-gray-500">{stat.label}</p>
                </div>
              ))}
            </div>

            {/* Live ticker */}
            <div className="mt-4 overflow-hidden rounded-xl border border-gray-100">
              <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
                <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">
                  Case trail
                </p>
              </div>
              <div className="h-[140px] overflow-hidden">
                <div className="animate-feed">
                  {[...FEED_ROWS, FEED_ROWS[0]].map((row, index) => (
                    <div
                      key={`${row.case}-${index}`}
                      className="flex h-7 items-center gap-2.5 px-3 text-xs"
                    >
                      <span className={`size-1.5 shrink-0 rounded-full ${row.dot}`} />
                      <span className="shrink-0 font-mono text-[10px] text-gray-400">
                        {row.case}
                      </span>
                      <span className="truncate text-gray-600">{row.text}</span>
                      <span
                        className={`ml-auto shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold ${row.tone}`}
                      >
                        {row.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Embedded diff card overlapping the dashboard bottom */}
      <div className="relative z-10 mx-auto -mt-10 w-[92%] sm:-mt-14 sm:w-[78%]">
        <DiffWindow />
      </div>
    </div>
  );
}
