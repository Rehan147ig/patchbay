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
  { href: "/overview", label: "Overview", icon: LayoutDashboard, id: "tour-overview-nav" },
  { href: "/repositories", label: "Repositories", icon: GitBranch, id: "tour-repositories-nav" },
  { href: "/releases", label: "Releases", icon: Package, id: "tour-releases-nav" },
  { href: "/cases", label: "Cases", icon: AlertTriangle, id: "tour-cases-nav" },
  { href: "/changes", label: "Changes", icon: Zap, id: "tour-changes-nav" },
  { href: "/remediations", label: "Remediations", icon: Wrench, id: "tour-remediations-nav" },
] as const;

const GOVERN_LINKS = [
  { href: "/policies", label: "Policies", icon: Shield, id: "tour-policies-nav" },
  { href: "/outcomes", label: "Outcomes", icon: BarChart3, id: "tour-outcomes-nav" },
  { href: "/audit", label: "Audit Log", icon: FileText, id: "tour-audit-nav" },
] as const;

const SYSTEM_LINKS = [
  { href: "/demo", label: "Interactive Demo", icon: PlayCircle, id: "tour-demo-nav" },
  { href: "/settings", label: "Settings", icon: Settings, id: "tour-settings-nav" },
] as const;

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  id?: string;
}

function NavLinkItem({ link, pathname }: { link: NavItem; pathname: string }) {
  const active =
    link.href === "/overview" ? pathname === "/overview" : pathname.startsWith(link.href);
  const Icon = link.icon;
  return (
    <Link
      id={link.id}
      href={link.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative mx-2 flex items-center gap-3 rounded-full px-3.5 py-2 text-[13px] font-medium tracking-tight transition-all duration-150",
        active
          ? "bg-[#1d1d1f] text-white shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
          : "text-zinc-500 hover:bg-zinc-100 hover:text-[#1d1d1f]",
      )}
    >
      <Icon
        className={cn(
          "size-[16px] shrink-0 transition-colors duration-150",
          active ? "text-white" : "text-zinc-400 group-hover:text-zinc-600",
        )}
        aria-hidden="true"
      />
      <span className="flex-1 truncate">{link.label}</span>
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
    <div className="space-y-1">
      <p className="px-5 py-2 text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
        {label}
      </p>
      <div className="space-y-0.5">
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
    <nav aria-label="Primary" className="space-y-6 py-2">
      <NavSection label="Monitor" links={MONITOR_LINKS} pathname={pathname} />
      <NavSection label="Govern" links={GOVERN_LINKS} pathname={pathname} />
      <NavSection label="System" links={SYSTEM_LINKS} pathname={pathname} />
      <div className="mx-2 mt-4 rounded-2xl bg-zinc-900 px-4 py-3 text-white">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
          Codebase management
        </p>
        <p className="mt-1 text-[12px] font-medium leading-snug tracking-tight">
          You build. We maintain. 34/34 corpus.
        </p>
        <Link
          href="/cases"
          className="mt-2 inline-flex text-[11px] font-medium tracking-wide text-white underline decoration-white/30 underline-offset-4 hover:decoration-white"
        >
          View cases ?
        </Link>
      </div>
    </nav>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const allLinks = [...MONITOR_LINKS, ...GOVERN_LINKS, ...SYSTEM_LINKS];
  return (
    <details className="group relative lg:hidden">
      <summary className="flex list-none items-center gap-2 rounded-full bg-white px-3.5 py-2 text-[13px] font-medium tracking-tight text-[#1d1d1f] shadow-sm border border-zinc-200">
        <span>Menu</span>
        <span className="text-zinc-400">�</span>
      </summary>
      <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-zinc-200 bg-white p-3 shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
        <nav className="space-y-1">
          {allLinks.map((link) => {
            const active =
              link.href === "/overview" ? pathname === "/overview" : pathname.startsWith(link.href);
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "flex items-center gap-3 rounded-full px-3 py-2 text-[13px] font-medium",
                  active ? "bg-[#1d1d1f] text-white" : "text-zinc-600 hover:bg-zinc-50",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </details>
  );
}
