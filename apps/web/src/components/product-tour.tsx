"use client";

import { useEffect, useCallback } from "react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import { Sparkles } from "lucide-react";

export function ProductTourButton() {
  const startTour = useCallback(() => {
    const driverObj = driver({
      showProgress: true,
      animate: true,
      allowClose: true,
      overlayColor: "rgba(0, 0, 0, 0.45)",
      stagePadding: 6,
      stageRadius: 16,
      nextBtnText: "Next ?",
      prevBtnText: "? Back",
      doneBtnText: "Done",
      steps: [
        {
          element: "#tour-overview-stats",
          popover: {
            title: "Fleet Health & Metrics",
            description:
              "Real-time visibility into active repositories, affected SDK usages, pending approvals, and compiler validation pass rates.",
            side: "bottom",
            align: "start",
          },
        },
        {
          element: "#tour-cases-nav",
          popover: {
            title: "Autonomous Remediation Cases",
            description:
              "Policy-governed change cases. Watch the 3-agent AI supervisor (Analyst, Planner, Reviewer) calculate blast radius and generate verified AST patches.",
            side: "right",
            align: "center",
          },
        },
        {
          element: "#tour-releases-nav",
          popover: {
            title: "24/7 Release Watchtower",
            description:
              "Continuous upstream package monitoring across npm, PyPI, and private registries. Automatically classifies breaking changes.",
            side: "right",
            align: "center",
          },
        },
        {
          element: "#tour-policies-nav",
          popover: {
            title: "Fail-Closed Policy Engine",
            description:
              "Enforce compliance and governance. Payment, auth, and infrastructure changes require human review before opening draft PRs.",
            side: "right",
            align: "center",
          },
        },
        {
          element: "#tour-demo-nav",
          popover: {
            title: "Interactive Sandbox Demos",
            description:
              "Run 1-click deterministic migrations for OpenAI, Stripe, Anthropic, AWS SDK, Supabase, and Auth0 in isolated ephemeral sandboxes.",
            side: "right",
            align: "center",
          },
        },
      ],
      onDestroyed: () => {
        try {
          localStorage.setItem("patchbay_tour_completed", "true");
        } catch {
          // ignore localStorage failure
        }
      },
    });

    driverObj.drive();
  }, []);

  useEffect(() => {
    try {
      const completed = localStorage.getItem("patchbay_tour_completed");
      if (!completed) {
        const timer = setTimeout(() => {
          if (window.innerWidth >= 1024) {
            startTour();
          }
        }, 1200);
        return () => clearTimeout(timer);
      }
    } catch {
      // ignore
    }
  }, [startTour]);

  return (
    <button
      onClick={startTour}
      className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200/80 bg-white/80 px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm backdrop-blur-sm transition-all hover:border-[#0071e3]/40 hover:bg-white hover:text-[#0071e3] hover:shadow-[0_2px_8px_rgba(0,113,227,0.12)] active:scale-95"
      title="Start guided product tour"
    >
      <Sparkles className="size-3.5 text-[#0071e3]" aria-hidden="true" />
      <span>Take a tour</span>
    </button>
  );
}
