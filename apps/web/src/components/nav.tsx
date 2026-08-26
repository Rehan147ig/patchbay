"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  GitBranch,
  Package,
  AlertTriangle,
  FileText,
  Wrench,
  Shield,
  BarChart3,
  PlayCircle,
  Settings,
  Zap,
} from "lucide-react";
import { cn } from "@patchbay/ui";

const MONITOR_LINKS = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/repositories", label: "Repositories", icon: GitBranch },
  { href: "/releases", label: "Releases", icon: Package },
  { href: "/cases", label: "Cases", icon: AlertTriangle },
  { href: "/changes", label: "Changes", icon: Zap },
  { href: "/remediations", label: "Remediations", icon: Wrench },
] as const;

const GOVERN_LINKS = [
  { href: "/policies", label: "Policies", icon: Shield },
  { href: "/outcomes", label: "Outcomes", icon: BarChart3 },
  { href: "/audit", label: "Audit Log", icon: FileText },
] as const;

const SYSTEM_LINKS = [
  { href: "/demo", label: "Interactive Demo", icon: PlayCircle },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
}

function NavLinkItem({ link, pathname }: { link: NavItem; pathname: string }) {
  const active =
    link.href === "/overview" ? pathname === "/overview" : pathname.startsWith(link.href);
  const Icon = link.icon;
  return (
    <Link
      href={link.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative mx-2.5 flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium transition-all duration-150",
        active
          ? "bg-accent-500/15 text-accent-300 font-semibold shadow-[inset_0_1px_1px_rgba(255,255,255,0.08),0_0_12px_rgba(99,102,241,0.2)]"
          : "text-ink-300 hover:bg-ink-800/80 hover:text-gray-100",
      )}
    >
      <Icon
        className={cn(
          "size-4 shrink-0 transition-colors duration-150",
          active ? "text-accent-400" : "text-ink-400 group-hover:text-gray-200",
        )}
        aria-hidden="true"
      />
      <span className="flex-1 truncate">{link.label}</span>
      {active ? (
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full bg-accent-400 shadow-[0_0_8px_rgba(129,140,248,0.9)]"
        />
      ) : null}
    </Link>
  );
}

function NavSection({
  label,
  links,
  pathname,
}: {
  label: string;
  links: readonly NavItem[];
  pathname: string;
}) {
  return (
    <div className="py-2">
      <p className="px-5 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-500">
        {label}
      </p>
      <div role="group" className="space-y-0.5">
        {links.map((link) => (
          <NavLinkItem key={link.href} link={link} pathname={pathname} />
        ))}
      </div>
    </div>
  );
}

export function SideNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="flex flex-1 flex-col overflow-y-auto py-3 scrollbar-none divide-y divide-ink-800/50"
    >
      <NavSection label="Remediation" links={MONITOR_LINKS} pathname={pathname} />
      <NavSection label="Governance" links={GOVERN_LINKS} pathname={pathname} />
      <NavSection label="Workspace" links={SYSTEM_LINKS} pathname={pathname} />
    </nav>
  );
}

/** Backwards-compatible alias for any consumer still importing `Nav`. */
export const Nav = SideNav;

const ALL_LINKS = [...MONITOR_LINKS, ...GOVERN_LINKS, ...SYSTEM_LINKS] as const;

/** Compact horizontal rail for small screens (fixed to the viewport bottom). */
export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary mobile"
      className="scrollbar-none flex items-center gap-1.5 overflow-x-auto px-3 py-2.5"
    >
      {ALL_LINKS.map((link) => {
        const active =
          link.href === "/overview" ? pathname === "/overview" : pathname.startsWith(link.href);
        const Icon = link.icon;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all",
              active
                ? "bg-accent-500/20 text-accent-300 ring-1 ring-inset ring-accent-500/40"
                : "text-ink-400 hover:bg-ink-800 hover:text-gray-200",
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
