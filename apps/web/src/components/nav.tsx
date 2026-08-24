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
} from "lucide-react";
import { cn } from "@patchbay/ui";

const LINKS = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/repositories", label: "Repositories", icon: GitBranch },
  { href: "/releases", label: "Releases", icon: Package },
  { href: "/cases", label: "Cases", icon: AlertTriangle },
  { href: "/changes", label: "Changes", icon: FileText },
  { href: "/remediations", label: "Remediations", icon: Wrench },
] as const;

const LINKS_SECONDARY = [
  { href: "/policies", label: "Policies", icon: Shield },
  { href: "/outcomes", label: "Outcomes", icon: BarChart3 },
  { href: "/audit", label: "Audit", icon: FileText },
] as const;

const LINKS_TERTIARY = [
  { href: "/demo", label: "Demo", icon: PlayCircle },
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
        "mx-2 flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium transition-all",
        active
          ? "border-l-2 border-accent-500 bg-accent-500/10 text-accent-400"
          : "border-l-2 border-transparent text-ink-300 hover:bg-ink-700 hover:text-gray-100",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {link.label}
    </Link>
  );
}

function NavSection({
  links,
  pathname,
  divider,
}: {
  links: readonly NavItem[];
  pathname: string;
  divider?: boolean;
}) {
  return (
    <>
      {divider ? <div aria-hidden="true" className="mx-4 my-3 border-t border-ink-700/60" /> : null}
      <div role="group">
        {links.map((link) => (
          <NavLinkItem key={link.href} link={link} pathname={pathname} />
        ))}
      </div>
    </>
  );
}

export function SideNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="flex flex-1 flex-col gap-0.5 overflow-y-auto py-2">
      <NavSection links={LINKS} pathname={pathname} />
      <NavSection links={LINKS_SECONDARY} pathname={pathname} divider />
      <NavSection links={LINKS_TERTIARY} pathname={pathname} divider />
    </nav>
  );
}

/** Backwards-compatible alias for any consumer still importing `Nav`. */
export const Nav = SideNav;

const ALL_LINKS = [...LINKS, ...LINKS_SECONDARY, ...LINKS_TERTIARY] as const;

/** Compact horizontal rail for small screens (fixed to the viewport bottom). */
export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary mobile"
      className="scrollbar-none flex items-center gap-1 overflow-x-auto px-2 py-2"
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
              "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors",
              active
                ? "bg-accent-500/15 text-accent-400 ring-1 ring-inset ring-accent-500/30"
                : "text-ink-300 hover:bg-ink-700 hover:text-gray-100",
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
