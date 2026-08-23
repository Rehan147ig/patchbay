const DIFF_LINES: Array<{ type: "del" | "add" | "ctx"; text: string }> = [
  { type: "ctx", text: 'import OpenAI from "openai";' },
  { type: "del", text: "const completion = await openai.createChatCompletion(" },
  { type: "del", text: '  { model: "gpt-4", messages });' },
  { type: "add", text: "const client = new OpenAI();" },
  { type: "add", text: "const completion = await client.chat.completions.create(" },
  { type: "add", text: '  { model: "gpt-4", messages });' },
];

const LINE_STYLES: Record<string, string> = {
  del: "bg-red-50 text-red-700",
  add: "bg-emerald-50 text-emerald-700",
  ctx: "text-gray-500",
};

/**
 * Hero product visual: a real certified OpenAI migration diff rendered as a
 * clean code window with floating agent-event satellites orbiting it.
 */
export function DiffWindow() {
  return (
    <div className="relative w-full">
      {/* Floating satellites */}
      <div
        className="absolute -left-8 -top-6 z-10 hidden animate-float items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-[11px] text-gray-600 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.25)] lg:flex"
        style={{ animationDelay: "-1.5s" }}
      >
        <span className="size-1.5 rounded-full bg-indigo-500" />
        ANALYST · 14 callsites matched
      </div>
      <div
        className="absolute -right-6 top-1/3 z-10 hidden animate-float items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-[11px] text-gray-600 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.25)] lg:flex"
        style={{ animationDelay: "-3.2s" }}
      >
        <span className="size-1.5 rounded-full bg-emerald-500" />
        sandbox · pnpm test ✓
      </div>
      <div
        className="absolute -bottom-5 -right-4 z-10 hidden animate-float items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-[11px] text-gray-600 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.25)] lg:flex"
        style={{ animationDelay: "-4.8s" }}
      >
        <span className="size-1.5 rounded-full bg-gray-900" />
        draft PR #128 opened
      </div>

      {/* Code window */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white text-left shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
        <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50/70 px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-gray-300" />
          <span className="size-2.5 rounded-full bg-gray-300" />
          <span className="size-2.5 rounded-full bg-gray-300" />
          <span className="ml-3 truncate font-mono text-xs text-gray-500">
            openai v3.3.0 → v4.0.0 · draft PR
          </span>
          <span className="ml-auto hidden shrink-0 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 sm:flex">
            Validation passed
          </span>
        </div>

        <div className="py-2 font-mono text-[13px] leading-6">
          {DIFF_LINES.map((line, index) => (
            <div key={index} className={`flex gap-3 px-4 ${LINE_STYLES[line.type]}`}>
              <span className="w-3 shrink-0 select-none">
                {line.type === "del" ? "−" : line.type === "add" ? "+" : ""}
              </span>
              <code className="whitespace-pre">{line.text}</code>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 border-t border-gray-100 px-4 py-2.5 text-xs">
          <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-gray-600">
            rule-pack: openai/chat-completions-v4
          </span>
          <span className="hidden rounded bg-gray-100 px-1.5 py-0.5 font-mono text-gray-600 sm:inline">
            sandbox: pnpm test
          </span>
          <span className="ml-auto hidden items-center gap-1.5 text-gray-500 sm:flex">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
            ready for review
          </span>
        </div>
      </div>
    </div>
  );
}
