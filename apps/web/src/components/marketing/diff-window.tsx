const DIFF_LINES: Array<{ type: "del" | "add" | "ctx"; text: string }> = [
  { type: "del", text: 'import OpenAI from "openai";' },
  { type: "del", text: "const completion = await openai.createChatCompletion(" },
  { type: "del", text: '  { model: "gpt-4", messages });' },
  { type: "add", text: 'import OpenAI from "openai";' },
  { type: "add", text: "const client = new OpenAI();" },
  { type: "add", text: "const completion = await client.chat.completions.create(" },
  { type: "add", text: '  { model: "gpt-4", messages });' },
];

/**
 * Hero product visual: the real certified OpenAI migration diff rendered as a
 * floating code window with a scanning line and a validation badge.
 */
export function DiffWindow() {
  return (
    <div className="relative mx-auto mt-16 w-full max-w-4xl">
      {/* Ambient glow behind the window */}
      <div
        aria-hidden
        className="absolute -inset-8 rounded-[40px] bg-gradient-to-r from-accent-500/25 via-accent-600/20 to-transparent blur-3xl"
      />
      <div
        className="relative animate-float overflow-hidden rounded-2xl border border-white/10 bg-ink-900/90 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)]"
        style={{ animationDelay: "1.2s" }}
      >
        {/* Title bar */}
        <div className="flex items-center gap-2 border-b border-white/8 px-4 py-3">
          <span className="size-3 rounded-full bg-[#ff5f57]" />
          <span className="size-3 rounded-full bg-[#febc2e]" />
          <span className="size-3 rounded-full bg-[#28c840]" />
          <span className="ml-3 font-mono text-xs text-ink-400">
            openai v3.3.0 → v4.0.0 · draft PR
          </span>
          <span className="ml-auto hidden items-center gap-1.5 rounded-full border border-mint-400/25 bg-mint-400/10 px-2.5 py-1 text-xs font-medium text-mint-300 sm:flex">
            <span className="size-1.5 animate-pulse-dot rounded-full bg-mint-400" />
            Validation passed
          </span>
        </div>

        {/* Diff body with scan line */}
        <div className="relative px-5 py-5 font-mono text-[13px] leading-7">
          {DIFF_LINES.map((line, index) => (
            <div
              key={index}
              className={`flex gap-3 rounded px-2 ${
                line.type === "del"
                  ? "text-ink-500"
                  : line.type === "add"
                    ? "text-mint-300"
                    : "text-ink-300"
              }`}
            >
              <span className="w-4 select-none text-ink-500">
                {line.type === "del" ? "−" : line.type === "add" ? "+" : ""}
              </span>
              <code>{line.text}</code>
            </div>
          ))}
          <div
            aria-hidden
            className="absolute left-2 right-2 h-px animate-scan bg-gradient-to-r from-transparent via-accent-400/80 to-transparent"
          />
        </div>

        {/* Footer strip */}
        <div className="flex items-center gap-2 border-t border-white/8 px-4 py-2.5 text-xs text-ink-400">
          <span className="rounded bg-accent-500/15 px-1.5 py-0.5 font-mono text-accent-300">
            rule-pack: openai/chat-completions-v4
          </span>
          <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-ink-300">
            sandbox: pnpm test
          </span>
          <span className="ml-auto hidden items-center gap-1.5 sm:flex">
            <span className="size-1.5 rounded-full bg-mint-400" />
            draft PR #128 ready for review
          </span>
        </div>
      </div>
    </div>
  );
}
