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
  { href: "/outcomes", label: "Outcomes" },
  { href: "/audit", label: "Audit" },
  { href: "/demo", label: "Demo" },
  { href: "/settings", label: "Settings" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="scrollbar-none flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border border-gray-200/80 bg-white/90 p-1 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
    >
      {LINKS.map((link) => {
        const active =
          link.href === "/overview" ? pathname === "/overview" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              active
                ? "bg-gray-900 text-white shadow-sm"
                : "text-gray-500 hover:bg-gray-100 hover:text-gray-900",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
