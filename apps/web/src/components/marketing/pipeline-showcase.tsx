"use client";

import { useEffect, useState } from "react";

type StageId = "detect" | "patch" | "review";

const STAGES: Array<{
  id: StageId;
  number: string;
  label: string;
  title: string;
  body: string;
}> = [
  {
    id: "detect",
    number: "01",
    label: "Detect",
    title: "Watchtower detects & matches",
    body: "Patch monitors npm releases, GitHub changelogs, and OpenAPI spec diffs, then matches them against exact AST callsites in your repositories.",
  },
  {
    id: "patch",
    number: "02",
    label: "Patch",
    title: "Certified rule packs patch",
    body: "Deterministic migration rules apply bounded code patches. When sandbox validation is enabled, patches run only allowlisted commands — and a skipped check is never reported as passed.",
  },
  {
    id: "review",
    number: "03",
    label: "Review",
    title: "You review and approve",
    body: "Patch opens draft pull requests only and never auto-merges. High-risk paths require explicit human approval before any PR is created.",
  },
];

const CYCLE_MS = 3400;

const DETECT_ROWS = [
  { dot: "bg-indigo-500", source: "npm", text: "openai@4.0.0 released", time: "now" },
  { dot: "bg-indigo-500", source: "github", text: "stripe-node tagged v14.10.0", time: "12m" },
  { dot: "bg-amber-500", source: "openapi", text: "/v1/charges schema changed", time: "31m" },
  { dot: "bg-gray-300", source: "match", text: "14 AST callsites in acme/api", time: "31m" },
];

const PATCH_DIFF = [
  { type: "ctx" as const, text: 'import OpenAI from "openai";' },
  { type: "del" as const, text: "await openai.createChatCompletion({" },
  { type: "add" as const, text: "const client = new OpenAI();" },
  { type: "add" as const, text: "await client.chat.completions.create({" },
];

const REVIEW_CHECKS = [
  { ok: true, label: "AST match · 14 callsites across 3 files" },
  { ok: true, label: "Sandbox validation · pnpm test passed" },
  { ok: true, label: "Policy gate · no high-risk surface touched" },
  { ok: false, label: "Draft PR #128 opened — awaiting your review" },
];

function DetectVisual({ tick }: { tick: number }) {
  return (
    <div
      key={`detect-${tick}`}
      className="relative overflow-hidden rounded-xl border border-gray-200 bg-gray-950 font-mono text-xs shadow-sm"
    >
      <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-2.5">
        <span className="size-2 rounded-full bg-emerald-400" />
        <span className="text-gray-400">watchtower · live feed</span>
        <span className="ml-auto flex items-center gap-1 text-[10px] text-gray-500">
          <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
          polling
        </span>
      </div>
      <div className="relative px-4 py-3 leading-7">
        <div
          aria-hidden
          className="absolute left-0 right-0 h-px animate-scanline bg-gradient-to-r from-transparent via-emerald-400/60 to-transparent"
        />
        {DETECT_ROWS.map((row, index) => (
          <p
            key={row.text}
            className="flex items-center gap-2 opacity-0"
            style={{ animation: `rise-in 0.45s ease-out ${index * 0.55}s forwards` }}
          >
            <span className={`size-1.5 shrink-0 rounded-full ${row.dot}`} />
            <span className="w-14 shrink-0 text-gray-500">{row.source}</span>
            <span className="truncate text-gray-200">{row.text}</span>
            <span className="ml-auto shrink-0 text-[10px] text-gray-600">{row.time}</span>
          </p>
        ))}
      </div>
    </div>
  );
}

function PatchVisual({ tick }: { tick: number }) {
  return (
    <div
      key={`patch-${tick}`}
      className="overflow-hidden rounded-xl border border-gray-200 bg-white font-mono text-xs shadow-sm"
    >
      <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-4 py-2.5">
        <span className="text-gray-500">src/chat/chat-service.ts</span>
        <span className="ml-auto rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
          patching…
        </span>
      </div>
      <div className="py-2 leading-6">
        {PATCH_DIFF.map((line, index) => (
          <p
            key={line.text}
            className={`flex gap-3 px-4 opacity-0 ${
              line.type === "del"
                ? "bg-red-50 text-red-700"
                : line.type === "add"
                  ? "bg-emerald-50 text-emerald-700"
                  : "text-gray-500"
            }`}
            style={{ animation: `rise-in 0.4s ease-out ${0.3 + index * 0.5}s forwards` }}
          >
            <span className="w-3 shrink-0 select-none">
              {line.type === "del" ? "−" : line.type === "add" ? "+" : ""}
            </span>
            <code>{line.text}</code>
          </p>
        ))}
        <p
          className="flex items-center gap-2 px-4 pt-2 text-gray-400 opacity-0"
          style={{ animation: "rise-in 0.4s ease-out 2.4s forwards" }}
        >
          sandbox: pnpm test
          <span className="text-emerald-600">passed ✓</span>
          <span className="inline-block h-3.5 w-1.5 animate-caret bg-gray-400" />
        </p>
      </div>
    </div>
  );
}

function ReviewVisual({ tick }: { tick: number }) {
  return (
    <div
      key={`review-${tick}`}
      className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
    >
      <div className="border-b border-gray-100 bg-gray-50 px-4 py-2.5">
        <p className="truncate text-sm font-medium text-gray-900">
          [Patch] migrate openai 3.x → 4.x{" "}
          <span className="font-mono text-xs font-normal text-gray-400">#128</span>
        </p>
      </div>
      <div className="space-y-2.5 px-4 py-3.5">
        {REVIEW_CHECKS.map((check, index) => (
          <p
            key={check.label}
            className="flex items-start gap-2.5 text-xs leading-5 text-gray-600 opacity-0"
            style={{ animation: `rise-in 0.4s ease-out ${0.3 + index * 0.55}s forwards` }}
          >
            <span
              className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full ${
                check.ok ? "bg-emerald-100 text-emerald-700" : "bg-indigo-100 text-indigo-700"
              }`}
            >
              {check.ok ? "✓" : "•"}
            </span>
            {check.label}
          </p>
        ))}
        <div
          className="flex items-center gap-2 pt-1 opacity-0"
          style={{ animation: "rise-in 0.4s ease-out 2.6s forwards" }}
        >
          <span className="flex size-6 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-semibold text-white">
            EO
          </span>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
            Ready for review
          </span>
          <span className="ml-auto text-[11px] text-gray-400">draft · never auto-merge</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Real-time pictorial for the pipeline section: cycles Detect → Patch → Review,
 * replaying each stage's entrance animations on every loop. Pauses on hover.
 */
export function PipelineShowcase() {
  const [active, setActive] = useState(0);
  const [tick, setTick] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      setActive((current) => (current + 1) % STAGES.length);
      setTick((t) => t + 1);
    }, CYCLE_MS);
    return () => clearInterval(id);
  }, [paused]);

  const stage = STAGES[active];

  return (
    <div
      className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Step list — Apple 3-step Cards */}
      <div className="order-2 space-y-3 lg:order-1">
        {STAGES.map((item, index) => {
          const isActive = index === active;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setActive(index);
                setTick((t) => t + 1);
              }}
              aria-current={isActive}
              className={`w-full rounded-[20px] border p-5 text-left transition-all duration-300 ${
                isActive
                  ? "border-[#0071e3]/20 bg-white shadow-[0_8px_24px_rgba(0,0,0,0.06)]"
                  : "border-zinc-200/60 bg-white hover:border-zinc-300 hover:shadow-sm"
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`font-mono text-sm font-semibold tracking-tight ${
                    isActive ? "text-[#0071e3]" : "text-zinc-400"
                  }`}
                >
                  {item.number}
                </span>
                <span
                  className={`text-[15px] font-semibold tracking-tight ${
                    isActive ? "text-[#1d1d1f]" : "text-zinc-500"
                  }`}
                >
                  {item.title}
                </span>
                {isActive && (
                  <span className="ml-auto flex items-center gap-1.5 rounded-full bg-[#0071e3]/10 px-2.5 py-1 text-[11px] font-medium tracking-tight text-[#0071e3]">
                    <span className="size-1.5 animate-pulse rounded-full bg-[#0071e3]" />
                    live
                  </span>
                )}
              </div>
              <div
                className={`grid transition-all duration-300 ${
                  isActive ? "mt-2 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                }`}
              >
                <p className="overflow-hidden text-[13px] leading-relaxed text-zinc-500">
                  {item.body}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Live visual */}
      <div className="order-1 lg:order-2">
        <div className="relative">
          <div
            aria-hidden
            className="absolute -inset-6 -z-10 rounded-3xl bg-gradient-to-br from-indigo-100/70 via-transparent to-emerald-100/60 blur-2xl"
          />
          <div key={stage.id}>
            {stage.id === "detect" && <DetectVisual tick={tick} />}
            {stage.id === "patch" && <PatchVisual tick={tick} />}
            {stage.id === "review" && <ReviewVisual tick={tick} />}
          </div>

          {/* Cycle progress */}
          <div className="mt-4 flex items-center gap-3">
            <div className="h-0.5 flex-1 overflow-hidden rounded-full bg-gray-200">
              <div
                key={`${active}-${tick}`}
                className="h-full rounded-full bg-accent-500"
                style={{
                  animation: paused ? undefined : `progress ${CYCLE_MS}ms linear forwards`,
                  width: paused ? "100%" : undefined,
                }}
              />
            </div>
            <span className="font-mono text-[11px] uppercase tracking-wider text-gray-400">
              {String(active + 1).padStart(2, "0")} / {String(STAGES.length).padStart(2, "0")} ·{" "}
              {stage.label}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
