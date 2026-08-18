"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@patchbay/ui";

const LINKS = [
  { href: "/overview", label: "Overview" },
  { href: "/repositories", label: "Repositories" },
  { href: "/releases", label: "Releases" },
  { href: "/cases", label: "Cases" },
  { href: "/changes", label: "Changes" },
  { href: "/remediations", label: "Remediations" },
  { href: "/policies", label: "Policies" },
  { href: "/audit", label: "Audit" },
  { href: "/demo", label: "Demo" },
  { href: "/settings", label: "Settings" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="flex items-center gap-1 overflow-x-auto">
      {LINKS.map((link) => {
        const active =
          link.href === "/overview" ? pathname === "/overview" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-200 hover:text-slate-900",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
