"use client";

import { useEffect, useMemo, useState } from "react";
import { StatusPill } from "@patchbay/ui";
import { ThinkingOrb } from "./thinking-orb";

const THEME_KEY = "patch-agent-theme";

type AgentRole = "ANALYST" | "PLANNER" | "REVIEWER";
type AgentStepStatus = "STARTED" | "COMPLETED" | "FAILED";

export interface AgentOrbStep {
  id: string;
  role: AgentRole;
  status: AgentStepStatus;
  summary: string;
}

export interface AgentOrbRun {
  id: string;
  status: string;
  model: string;
  createdAt: string;
  steps: AgentOrbStep[];
}

interface OrbSpec {
  role: AgentRole;
  state: "listening" | "composing" | "shaping";
  label: string;
  verb: string;
}

const ORB_SPECS: OrbSpec[] = [
  { role: "ANALYST", state: "listening", label: "Analyst", verb: "Listening…" },
  { role: "PLANNER", state: "composing", label: "Planner", verb: "Composing…" },
  { role: "REVIEWER", state: "shaping", label: "Reviewer", verb: "Shaping…" },
];

interface OrbActivity {
  status: "waiting" | "running" | "completed" | "failed";
  speedMul: number;
  active: boolean;
}

const ACTIVITY_LABEL: Record<OrbActivity["status"], string> = {
  waiting: "Waiting",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
};

const ACTIVITY_TONE: Record<OrbActivity["status"], "neutral" | "blue" | "green" | "red"> = {
  waiting: "neutral",
  running: "blue",
  completed: "green",
  failed: "red",
};

function deriveActivity(role: AgentRole, latestRun: AgentOrbRun | undefined): OrbActivity {
  if (!latestRun) return { status: "waiting", speedMul: 0.25, active: true };
  const steps = latestRun.steps.filter((step) => step.role === role);
  if (steps.length === 0) return { status: "waiting", speedMul: 0.25, active: true };
  const latest = steps[steps.length - 1];
  if (latest.status === "FAILED") return { status: "failed", speedMul: 1, active: false };
  if (latest.status === "STARTED") return { status: "running", speedMul: 1, active: true };
  return { status: "completed", speedMul: 0.25, active: true };
}

function readStoredTheme(): "light" | "dark" | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // storage unavailable — stay on the default theme
  }
  return null;
}

export function AgentOrbsPanel({ runs }: { runs: AgentOrbRun[] }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const stored = readStoredTheme();
    if (stored) setTheme(stored);
  }, []);

  const setAndPersist = (next: "light" | "dark") => {
    setTheme(next);
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // storage unavailable — theme still applies for this session
    }
  };

  const latestRun = runs[0];
  const activities = useMemo(
    () =>
      Object.fromEntries(
        ORB_SPECS.map((orb) => [orb.role, deriveActivity(orb.role, latestRun)]),
      ) as Record<AgentRole, OrbActivity>,
    [latestRun],
  );

  const isDark = theme === "dark";

  return (
    <section
      aria-label="Agent trail"
      className={`rounded-xl border p-4 transition-colors ${
        isDark
          ? "border-[#1e1e1e] bg-[#0a0a0a] text-[#eaeaea]"
          : "border-slate-200 bg-white text-slate-800"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Agent trail</h2>
          <p className={`text-xs ${isDark ? "text-[#888]" : "text-slate-500"}`}>
            Analyst → Planner → Reviewer. Agents propose; they never hold git credentials.
          </p>
        </div>
        <div
          className={`inline-flex rounded-lg border p-0.5 ${
            isDark ? "border-[#2a2a2a]" : "border-slate-200"
          }`}
        >
          <button
            type="button"
            aria-pressed={!isDark}
            onClick={() => setAndPersist("light")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              !isDark ? "bg-slate-900 text-white" : "text-[#ccc] hover:bg-[#1a1a1a]"
            }`}
          >
            Light
          </button>
          <button
            type="button"
            aria-pressed={isDark}
            onClick={() => setAndPersist("dark")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              isDark ? "bg-[#eaeaea] text-[#0a0a0a]" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            Dark
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {ORB_SPECS.map((orb) => {
          const activity = activities[orb.role];
          return (
            <div
              key={orb.role}
              className={`flex flex-col items-center gap-2 rounded-lg border p-4 ${
                isDark ? "border-[#1e1e1e] bg-[#111]" : "border-slate-200 bg-[#f8fafc]"
              }`}
            >
              <ThinkingOrb
                state={orb.state}
                size={64}
                dark={isDark}
                speedMul={activity.speedMul}
                active={activity.active}
                aria-label={`${orb.label} agent orb, ${ACTIVITY_LABEL[activity.status]}`}
              />
              <span className={`text-sm font-medium ${isDark ? "text-[#ccc]" : "text-slate-700"}`}>
                {orb.label}
              </span>
              <span className={`text-xs ${isDark ? "text-[#555]" : "text-slate-400"}`}>
                {orb.verb}
              </span>
              <StatusPill
                label={ACTIVITY_LABEL[activity.status]}
                tone={ACTIVITY_TONE[activity.status]}
              />
            </div>
          );
        })}
      </div>

      {runs.length > 0 ? (
        <ul className="mt-4 space-y-3">
          {runs.map((run) => (
            <li
              key={run.id}
              className={`rounded-lg border p-3 ${isDark ? "border-[#1e1e1e]" : "border-slate-200"}`}
            >
              <div
                className={`flex flex-wrap items-center gap-2 text-sm ${isDark ? "text-[#ccc]" : "text-slate-600"}`}
              >
                <StatusPill
                  label={run.status}
                  tone={
                    run.status === "SUCCEEDED" ? "green" : run.status === "FAILED" ? "red" : "blue"
                  }
                />
                <span>
                  {run.model} · {run.createdAt}
                </span>
              </div>
              {run.steps.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {run.steps.map((step) => (
                    <li key={step.id} className="flex items-start gap-2 text-xs">
                      <StatusPill
                        label={step.status}
                        tone={
                          step.status === "COMPLETED"
                            ? "green"
                            : step.status === "FAILED"
                              ? "red"
                              : "blue"
                        }
                      />
                      <span className={`font-medium ${isDark ? "text-[#ccc]" : "text-slate-700"}`}>
                        {step.role.charAt(0) + step.role.slice(1).toLowerCase()}
                      </span>
                      <span className={isDark ? "text-[#888]" : "text-slate-500"}>
                        {step.summary}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={`mt-1 text-xs ${isDark ? "text-[#555]" : "text-slate-400"}`}>
                  No steps recorded.
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className={`mt-4 text-sm ${isDark ? "text-[#888]" : "text-slate-500"}`}>
          No agent runs yet.
        </p>
      )}
    </section>
  );
}
