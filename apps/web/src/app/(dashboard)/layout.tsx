import Link from "next/link";
import { Badge } from "@patchbay/ui";
import { Nav } from "@/components/nav";
import { NotificationBell } from "@/components/notification-bell";
import { LogoutButton } from "@/components/logout-button";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();

  return (
    <div className="flex min-h-screen flex-col bg-gray-50/50">
      <header className="sticky top-0 z-40 border-b border-gray-200/70 bg-white/75 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-3">
            <Link
              href="/overview"
              className="flex items-center gap-2.5"
              aria-label="Patch overview"
            >
              <span className="flex size-7 items-center justify-center rounded-lg bg-gray-900 text-sm font-bold text-white">
                P
              </span>
              <span className="text-base font-semibold tracking-tight text-gray-900">Patch</span>
            </Link>
            <Badge tone="blue">Demo data</Badge>
          </div>
          {user ? (
            <div className="flex flex-wrap items-center gap-3">
              <Nav />
              <NotificationBell />
              <div className="hidden items-center gap-3 border-l border-gray-200 pl-3 md:flex">
                <div className="text-right">
                  <p className="text-xs font-medium text-gray-900">{user.name}</p>
                  <p className="text-[11px] text-gray-500">{user.role.toLowerCase()}</p>
                </div>
                <LogoutButton />
              </div>
            </div>
          ) : (
            <Nav />
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">{children}</main>

      <footer className="border-t border-gray-100 bg-white">
        <div className="mx-auto w-full max-w-7xl px-4 py-3 text-xs text-gray-400">
          Patch local development MVP. The bundled validation sandbox and dev authentication are not
          hardened multi-tenant infrastructure.
        </div>
      </footer>
    </div>
  );
}
