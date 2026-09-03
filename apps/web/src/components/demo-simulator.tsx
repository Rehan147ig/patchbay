"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge } from "@patchbay/ui";
import { cn } from "@patchbay/ui";

/**
 * Zero-install 60-second magic moment. A fully client-side, deterministic
 * simulation of the Patch pipeline (Watchtower -> AST scan -> planner/reviewer
 * -> sandbox -> verified diff) using the Stripe fixture narrative. No network
 * calls, no GitHub App, no permissions — fail-proof for live pitches, offline
 * demos, and first-time founders.
 */

const STAGES = [
  { id: "watchtower", at: 0, label: "Watchtower alert" },
  { id: "scan", at: 2000, label: "AST graph scan" },
  { id: "agents", at: 4000, label: "Planner → Reviewer" },
  { id: "sandbox", at: 6000, label: "Sandbox verification" },
  { id: "diff", at: 8000, label: "Verified diff" },
] as const;

const TERMINAL_LINES = [
  "$ pnpm install --frozen-lockfile",
  "✓ 187 packages installed in 4.2s",
  "$ pnpm test src/payments/checkout.test.ts",
  "✓ 12 passed, 0 failed",
  "Sandbox: container · no-network · read-only ✓",
];

const AFFECTED_FILES = [
  { path: "server/checkout.ts", line: 42, symbol: "stripe.charges.create" },
  { path: "server/checkout.ts", line: 87, symbol: "stripe.charges.create" },
  { path: "server/webhooks.ts", line: 19, symbol: "charge.succeeded" },
];

export function DemoSimulator() {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [terminalCount, setTerminalCount] = useState(0);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const terminalRef = useRef<HTMLDivElement>(null);

  const clear = useCallback(() => {
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [];
  }, []);

  const run = useCallback(() => {
    clear();
    setRunning(true);
    setElapsed(0);
    setTerminalCount(0);
    const startedAt = Date.now();
    const tick = () => setElapsed(Date.now() - startedAt);
    const ticker = setInterval(tick, 100);
    timers.current.push(setTimeout(() => clearInterval(ticker), 9500) as never);

    for (const stage of STAGES) {
      timers.current.push(
        setTimeout(() => {
          setElapsed(Date.now() - startedAt);
          if (stage.id === "diff") setRunning(false);
        }, stage.at) as never,
      );
    }
    TERMINAL_LINES.forEach((_, index) => {
      timers.current.push(
        setTimeout(
          () => {
            setTerminalCount(index + 1);
            terminalRef.current?.scrollTo({ top: 9999 });
          },
          6100 + index * 450,
        ) as never,
      );
    });
  }, [clear]);

  useEffect(() => clear, [clear]);

  const visible = (at: number) => elapsed >= at;
  const activeStage = [...STAGES].reverse().find((stage) => elapsed >= stage.at);

  return (
    <div className="overflow-hidden rounded-[20px] border border-zinc-200/60 bg-white shadow-[0_4px_24px_rgba(0,0,0,0.04)]">
      <div className="flex flex-col gap-3 border-b border-zinc-200/60 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
            Interactive simulation · no install needed
          </p>
          <h2 className="mt-1 text-[17px] font-semibold tracking-tight text-[#1d1d1f]">
            Watch Patch fix a breaking Stripe change in 60 seconds
          </h2>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-full bg-[#0071e3] px-6 text-[13px] font-medium tracking-tight text-white shadow-sm transition-colors hover:bg-[#0077ed] disabled:cursor-wait disabled:opacity-60"
        >
          {elapsed === 0
            ? "▶ Try the live simulation"
            : running
              ? "Running…"
              : "↻ Replay simulation"}
        </button>
      </div>

      {/* Stage stepper */}
      <div className="flex flex-wrap items-center gap-2 px-6 pt-5">
        {STAGES.map((stage, index) => {
          const done = visible(stage.at + 1);
          const active = activeStage?.id === stage.id && running;
          return (
            <span key={stage.id} className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium tracking-tight",
                  done
                    ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                    : active
                      ? "bg-[#0071e3]/10 text-[#0071e3] ring-1 ring-[#0071e3]/20"
                      : "bg-zinc-100 text-zinc-400",
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    done ? "bg-emerald-500" : active ? "animate-pulse bg-[#0071e3]" : "bg-zinc-300",
                  )}
                  aria-hidden="true"
                />
                {index + 1}. {stage.label}
              </span>
              {index < STAGES.length - 1 ? (
                <span className="text-zinc-300" aria-hidden="true">
                  →
                </span>
              ) : null}
            </span>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-5 px-6 py-5 lg:grid-cols-2">
        {/* Left: event stream */}
        <div className="space-y-3" aria-live="polite">
          {visible(0) && (
            <div className="animate-slide-up rounded-[16px] border border-red-200 bg-red-50/60 p-4">
              <div className="flex items-center gap-2">
                <Badge tone="red" variant="solid">
                  BREAKING
                </Badge>
                <p className="text-[12px] font-semibold tracking-tight text-[#1d1d1f]">
                  Watchtower alert · stripe@16.1.0
                </p>
              </div>
              <p className="mt-1.5 font-mono text-[12px] text-zinc-600">
                charges.create removed → use paymentIntents.create
              </p>
            </div>
          )}

          {visible(2000) && (
            <div className="animate-slide-up rounded-[16px] border border-zinc-200 bg-zinc-50/60 p-4">
              <p className="text-[12px] font-semibold tracking-tight text-[#1d1d1f]">
                AST graph scan · billing-service
              </p>
              <ul className="mt-2 space-y-1.5">
                {AFFECTED_FILES.map((file) => (
                  <li
                    key={`${file.path}:${file.line}`}
                    className="font-mono text-[12px] text-zinc-600"
                  >
                    <span className="text-[#0071e3]">
                      {file.path}:{file.line}
                    </span>{" "}
                    <span className="text-zinc-400">{file.symbol}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] font-medium tracking-tight text-zinc-500">
                3 affected call-sites · blast radius 68 (HIGH · PAYMENT)
              </p>
            </div>
          )}

          {visible(4000) && (
            <div className="animate-slide-up rounded-[16px] border border-zinc-200 bg-white p-4">
              <p className="text-[12px] font-semibold tracking-tight text-[#1d1d1f]">
                Planner → Reviewer
              </p>
              <div className="mt-2 space-y-1.5">
                <p className="flex items-center gap-2 text-[12px] text-zinc-600">
                  <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />
                  Planner: rule pack stripe-16 · confidence 92 · 3 patches
                </p>
                <p className="flex items-center gap-2 text-[12px] text-zinc-600">
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      visible(5000) ? "bg-emerald-500" : "animate-pulse bg-[#0071e3]",
                    )}
                    aria-hidden="true"
                  />
                  Reviewer: {visible(5000) ? "approved — schema-valid, hash-bound" : "reviewing…"}
                </p>
              </div>
            </div>
          )}

          {visible(6000) && (
            <div
              ref={terminalRef}
              className="animate-slide-up overflow-hidden rounded-[16px] border border-zinc-800 bg-zinc-900"
            >
              <div className="flex items-center gap-1.5 border-b border-zinc-800 px-4 py-2.5">
                <span className="size-2.5 rounded-full bg-[#ff5f57]" aria-hidden="true" />
                <span className="size-2.5 rounded-full bg-[#ffbd2e]" aria-hidden="true" />
                <span className="size-2.5 rounded-full bg-[#28c840]" aria-hidden="true" />
                <span className="ml-2 font-mono text-[11px] text-zinc-500">
                  sandbox — container
                </span>
              </div>
              <div className="h-[118px] space-y-1 overflow-y-auto px-4 py-3 font-mono text-[12px] leading-relaxed">
                {TERMINAL_LINES.slice(0, terminalCount).map((line) => (
                  <p
                    key={line}
                    className={line.startsWith("✓") ? "text-emerald-400" : "text-zinc-300"}
                  >
                    {line}
                  </p>
                ))}
                {terminalCount < TERMINAL_LINES.length && running ? (
                  <p className="animate-pulse text-zinc-500">▌</p>
                ) : null}
              </div>
            </div>
          )}
        </div>

        {/* Right: verified diff */}
        <div>
          {visible(8000) ? (
            <div className="animate-slide-up overflow-hidden rounded-[16px] border border-zinc-800 bg-zinc-900">
              <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-4 py-3">
                <span className="size-2.5 rounded-full bg-[#ff5f57]" aria-hidden="true" />
                <span className="size-2.5 rounded-full bg-[#ffbd2e]" aria-hidden="true" />
                <span className="size-2.5 rounded-full bg-[#28c840]" aria-hidden="true" />
                <span className="ml-1 font-mono text-[11px] text-zinc-500">server/checkout.ts</span>
                <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-400 ring-1 ring-emerald-500/30">
                  ✓ Verified by Patchbay
                </span>
              </div>
              <pre className="overflow-x-auto px-4 py-3 font-mono text-[12px] leading-relaxed">
                <code>
                  <span className="text-red-400">
                    - const charge = await stripe.charges.create({"{"}
                  </span>
                  {"\n"}
                  <span className="text-red-400">
                    - amount: 2000, currency: &quot;usd&quot;, source: token,
                  </span>
                  {"\n"}
                  <span className="text-red-400">- {"}"});</span>
                  {"\n"}
                  <span className="text-emerald-400">
                    + const intent = await stripe.paymentIntents.create({"{"}
                  </span>
                  {"\n"}
                  <span className="text-emerald-400">
                    + amount: 2000, currency: &quot;usd&quot;,
                  </span>
                  {"\n"}
                  <span className="text-emerald-400">
                    + automatic_payment_methods: {"{"} enabled: true {"}"},
                  </span>
                  {"\n"}
                  <span className="text-emerald-400">+ {"}"});</span>
                </code>
              </pre>
              <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 px-4 py-3">
                <Link
                  href="/demo"
                  className="inline-flex h-8 items-center rounded-full bg-[#0071e3] px-4 text-[12px] font-medium text-white hover:bg-[#0077ed]"
                >
                  Run the real demo change →
                </Link>
                <Link
                  href="/settings/github"
                  className="inline-flex h-8 items-center rounded-full border border-zinc-700 px-4 text-[12px] font-medium text-zinc-200 hover:bg-zinc-800"
                >
                  Install GitHub App
                </Link>
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-[280px] flex-col items-center justify-center rounded-[16px] border border-dashed border-zinc-200 bg-zinc-50/60 p-6 text-center">
              <p className="text-[13px] font-medium tracking-tight text-zinc-500">
                {elapsed === 0
                  ? "Press “Try the live simulation” — the full pipeline streams here in 60 seconds."
                  : "Pipeline running — the verified diff appears here at the end."}
              </p>
              <p className="mt-1 text-[11px] tracking-tight text-zinc-400">
                Deterministic · offline-safe · no GitHub permissions needed
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
