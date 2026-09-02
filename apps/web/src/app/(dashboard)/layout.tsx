import Link from "next/link";
import { MobileNav, SideNav } from "@/components/nav";
import { NotificationBell } from "@/components/notification-bell";
import { LogoutButton } from "@/components/logout-button";
import { ProductTourButton } from "@/components/product-tour";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();

  return (
    <div className="flex min-h-screen bg-[#fbfbfd]">
      {/* Apple Sidebar - glass, 280 width, SF Pro */}
      <aside
        data-sidebar=""
        className="fixed inset-y-0 left-0 z-50 hidden w-[280px] flex-col border-r border-zinc-200/60 bg-white/70 backdrop-blur-xl lg:flex"
      >
        <Link
          href="/overview"
          className="flex items-center gap-3 px-6 py-6"
          aria-label="Patch overview"
        >
          <span className="flex size-9 items-center justify-center rounded-xl bg-[#0071e3] text-[15px] font-semibold tracking-tight text-white shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
            P
          </span>
          <span className="text-[17px] font-semibold tracking-tight text-[#1d1d1f]">Patch</span>
          <span className="ml-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium tracking-widest text-zinc-500">
            BETA
          </span>
        </Link>

        {user ? (
          <>
            <div className="flex-1 overflow-y-auto px-3 py-2">
              <SideNav />
            </div>
            <div className="border-t border-zinc-200/60 bg-white/50 px-4 py-4 backdrop-blur">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[11px] font-semibold uppercase tracking-wide text-white"
                >
                  {user.name.slice(0, 2)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium tracking-tight text-[#1d1d1f]">
                    {user.name}
                  </p>
                  <p className="text-[11px] font-medium capitalize tracking-wide text-zinc-500">
                    {user.role.toLowerCase()}
                  </p>
                </div>
                <NotificationBell />
              </div>
              <div className="mt-3">
                <LogoutButton />
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 px-3 py-2">
            <SideNav />
          </div>
        )}
      </aside>

      {/* Main column - Apple 8pt grid, max 7xl */}
      <div className="flex min-h-screen w-full flex-1 flex-col bg-[#fbfbfd] lg:ml-[280px]">
        <header className="sticky top-0 z-40 border-b border-zinc-200/60 bg-white/80 backdrop-blur-xl">
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-x-4 px-6 py-3.5 lg:px-8">
            <div className="flex items-center gap-3 lg:hidden">
              <Link
                href="/overview"
                aria-label="Patch overview"
                className="flex items-center gap-2.5"
              >
                <span className="flex size-8 items-center justify-center rounded-xl bg-[#0071e3] text-sm font-semibold text-white">
                  P
                </span>
                <span className="text-[15px] font-semibold tracking-tight text-[#1d1d1f]">
                  Patch
                </span>
              </Link>
            </div>
            <p
              aria-hidden="true"
              className="hidden text-[11px] font-medium uppercase tracking-widest text-zinc-400 lg:block"
            >
              Governed API-change remediation � You build. We maintain.
            </p>
            <div className="flex items-center gap-3">
              <ProductTourButton />
              <span className="hidden text-[11px] font-medium tracking-wide text-zinc-400 lg:inline">
                System status: All services operational
              </span>
              <span
                className="hidden size-2 rounded-full bg-emerald-500 lg:inline-block"
                aria-hidden="true"
              />
              <MobileNav />
              <div className="lg:hidden">
                <NotificationBell />
              </div>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8 lg:px-8 lg:py-10">
          {children}
        </main>
        <footer className="border-t border-zinc-200/60 bg-white/50 px-6 py-4 text-center text-[11px] font-medium tracking-wide text-zinc-400 lg:px-8">
          Patch � You take care of development, we take care of codebase management.{" "}
          <span className="text-zinc-500">34/34 corpus � 9 DRAFT_PR � SOC2</span>
        </footer>
      </div>
    </div>
  );
}
