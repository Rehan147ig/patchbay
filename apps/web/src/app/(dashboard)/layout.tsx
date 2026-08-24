import Link from "next/link";
import { Badge } from "@patchbay/ui";
import { MobileNav, SideNav } from "@/components/nav";
import { NotificationBell } from "@/components/notification-bell";
import { LogoutButton } from "@/components/logout-button";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();

  return (
    <div className="flex min-h-screen bg-ink-900">
      {/* Sidebar */}
      <aside
        data-sidebar=""
        className="fixed inset-y-0 left-0 z-50 hidden w-60 flex-col border-r border-ink-700/70 bg-ink-900 lg:flex"
      >
        <Link
          href="/overview"
          className="flex items-center gap-2.5 px-5 py-5"
          aria-label="Patch overview"
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent-500 to-accent-600 text-sm font-black text-white shadow-[0_0_24px_rgba(99,102,241,0.35)]">
            P
          </span>
          <span className="text-base font-bold tracking-tight text-white">Patch</span>
        </Link>

        {user ? (
          <>
            <SideNav />
            <div className="border-t border-ink-700/60 px-4 py-4">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink-700 text-xs font-bold uppercase text-accent-400"
                >
                  {user.name.slice(0, 2)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-gray-200">{user.name}</p>
                  <Badge tone="blue" className="mt-0.5">
                    {user.role.toLowerCase()}
                  </Badge>
                </div>
              </div>
              <div className="mt-3">
                <LogoutButton />
              </div>
            </div>
          </>
        ) : (
          <SideNav />
        )}
      </aside>

      {/* Main column */}
      <div className="flex min-h-screen w-full flex-1 flex-col bg-[#111318] lg:ml-60">
        <header className="sticky top-0 z-40 border-b border-ink-700/70 bg-[#111318]/80 backdrop-blur-xl">
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-x-4 px-6 py-3">
            <div className="flex items-center gap-3 lg:hidden">
              <Link
                href="/overview"
                aria-label="Patch overview"
                className="flex items-center gap-2"
              >
                <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-accent-500 to-accent-600 text-xs font-black text-white">
                  P
                </span>
                <span className="text-sm font-bold tracking-tight text-white">Patch</span>
              </Link>
            </div>
            <p
              aria-hidden="true"
              className="hidden text-xs font-medium uppercase tracking-widest text-ink-400 lg:block"
            >
              Governed API-change remediation
            </p>
            <div className="flex items-center gap-3">
              <NotificationBell />
              {user ? (
                <div className="hidden items-center gap-3 md:flex">
                  <div className="text-right">
                    <p className="text-xs font-medium text-gray-200">{user.name}</p>
                    <p className="text-[11px] text-ink-400">{user.role.toLowerCase()}</p>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 animate-slide-up px-6 py-6">
          {children}
        </main>

        <footer className="border-t border-ink-700/60 px-6 py-3 pb-16 text-xs text-ink-500 lg:pb-3">
          Patch local development MVP. The bundled validation sandbox and dev authentication are not
          hardened multi-tenant infrastructure.
        </footer>
      </div>

      {/* Mobile nav: horizontal scroll rail fixed to the bottom (sidebar hides below lg) */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-700/70 bg-ink-900/95 backdrop-blur-lg scrollbar-none lg:hidden">
        <MobileNav />
      </div>
    </div>
  );
}
